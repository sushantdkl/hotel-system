import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureRecipeTables } from '@/lib/recipes.js';
import { applyStockChange, normalizeName, toConsumptionCost } from '@/lib/inventory-ledger.js';
import { resolveSupplier } from '@/lib/purchases.js';
import { normalizeUnitOrKeep, normalizeUnit, conversionFactor as deriveFactor } from '@/lib/units.js';

/**
 * CSV columns: item_name, purchase_unit, consumption_unit, conversion_factor,
 * cost_per_unit, min_stock_level, supplier, quantity, category.
 *
 * cost_per_unit and quantity are read in PURCHASE units when the row supplies
 * a purchase_unit + conversion_factor (that's how a supplier price list reads:
 * "Chili, kg, grams, 1000, 250" means Rs 250/kg = Rs 0.25/gram). The ledger
 * does the conversion; see lib/inventory-ledger.js.
 *
 * ponytail: CSV only. The client already parses the file with lib/csv.js and
 * POSTs rows, so xlsx support is a client-side swap — no xlsx parser is
 * installed and this route never needs one.
 */

function numberOrNull(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function validateRow(row) {
  if (!String(row.item_name || '').trim()) return 'Missing item name';
  if (!String(row.consumption_unit || '').trim()) return 'Missing consumption unit';
  for (const field of ['cost_per_unit', 'conversion_factor', 'min_stock_level', 'quantity']) {
    if (Number.isNaN(numberOrNull(row[field]))) return `${field} must be a number`;
  }
  const cf = numberOrNull(row.conversion_factor);
  if (cf !== null && cf <= 0) return 'conversion_factor must be greater than zero';
  return null;
}

/**
 * Unit spellings + factor for one row, plus human-readable notes about
 * anything that was changed. The notes exist so the preview can say "kilo ->
 * kg" out loud instead of silently rewriting the owner's file.
 */
function resolveRowUnits(row) {
  const notes = [];
  const out = {};

  for (const field of ['purchase_unit', 'consumption_unit']) {
    const raw = String(row[field] || '').trim();
    out[field] = normalizeUnitOrKeep(raw) || null;
    if (raw && normalizeUnit(raw) && out[field] !== raw) {
      notes.push(`${field.replace('_', ' ')} "${raw}" read as "${out[field]}"`);
    } else if (raw && !normalizeUnit(raw)) {
      notes.push(`${field.replace('_', ' ')} "${raw}" kept as a custom unit`);
    }
  }

  // A blank/absent conversion factor is derivable for a known unit pair, which
  // is the whole point — "kg, grams" needs no 1000 typed in the CSV.
  const givenFactor = numberOrNull(row.conversion_factor);
  let factor = givenFactor;
  if (factor === null && out.purchase_unit) {
    const derived = deriveFactor(out.purchase_unit, out.consumption_unit);
    if (derived !== null) {
      factor = derived;
      notes.push(`conversion factor ${derived} derived from ${out.purchase_unit} -> ${out.consumption_unit}`);
    }
  }

  return { ...out, factor: factor ?? 1, notes };
}

/** Classify every row without touching the database. */
async function buildPreview(db, rows) {
  const existing = await db.all(
    `SELECT id, item_name, COALESCE(is_archived, 0) AS is_archived FROM inventory_items`
  );
  const active = new Map();
  const archived = new Map();
  for (const r of existing) {
    (Number(r.is_archived) === 1 ? archived : active).set(normalizeName(r.item_name), r);
  }

  const seen = new Set();
  const details = rows.map((row, i) => {
    const rowNo = i + 1;
    const error = validateRow(row);
    if (error) return { row: rowNo, status: 'validation_error', reason: error, data: row };

    const key = normalizeName(row.item_name);
    if (seen.has(key)) {
      return { row: rowNo, status: 'duplicate_conflict', reason: 'Duplicate item name inside this file', data: row };
    }
    seen.add(key);

    const { notes } = resolveRowUnits(row);

    if (active.has(key)) {
      return {
        row: rowNo,
        status: 'updated',
        reason: 'Matches an existing item — its details will be updated',
        inventory_item_id: active.get(key).id,
        notes,
        data: row,
      };
    }
    if (archived.has(key)) {
      return {
        row: rowNo,
        status: 'duplicate_conflict',
        reason: 'An archived item already uses this name — unarchive or rename it',
        inventory_item_id: archived.get(key).id,
        notes,
        data: row,
      };
    }
    return { row: rowNo, status: 'added', notes, data: row };
  });

  const counts = { added: 0, updated: 0, skipped: 0, duplicate_conflict: 0, validation_error: 0 };
  for (const d of details) counts[d.status] = (counts[d.status] || 0) + 1;
  counts.skipped = counts.duplicate_conflict + counts.validation_error;

  return { counts, details, total: rows.length };
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'inventory.import' });
    if (auth.error) return auth.error;

    const data = await request.json();
    const rows = Array.isArray(data.rows) ? data.rows : [];
    if (!rows.length) {
      return NextResponse.json({ error: 'No rows to import.' }, { status: 400 });
    }

    const db = Database.getInstance();
    await ensureRecipeTables(db);

    const preview = await buildPreview(db, rows);
    if (data.mode === 'preview') {
      return NextResponse.json({ mode: 'preview', ...preview });
    }

    const inserted = [];
    const updated = [];
    const skipped = [];

    await db.transaction(async (tx) => {
      for (const detail of preview.details) {
        if (detail.status === 'validation_error' || detail.status === 'duplicate_conflict') {
          skipped.push({ row: detail.data, reason: detail.reason });
          continue;
        }

        const row = detail.data;
        const name = String(row.item_name).trim();
        // Same resolution the preview showed, so the commit can hold no
        // surprises the owner didn't already see.
        const resolved = resolveRowUnits(row);
        const cf = resolved.factor;
        const purchaseUnit = resolved.purchase_unit;
        const consumptionUnit = resolved.consumption_unit;
        // A purchase_unit means the price/quantity columns are in purchase units.
        const units = purchaseUnit ? 'purchase' : 'consumption';
        const costPerConsumption =
          toConsumptionCost({ conversion_factor: cf }, numberOrNull(row.cost_per_unit), units) ?? 0;
        const supplier = await resolveSupplier(tx, row.supplier);

        let id = detail.inventory_item_id;
        if (detail.status === 'updated') {
          await tx.run(
            `UPDATE inventory_items
             SET unit = ?, cost_per_unit = ?, min_stock_level = ?, supplier = ?, supplier_id = ?,
                 purchase_unit = ?, consumption_unit = ?, conversion_factor = ?, category = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [
              consumptionUnit,
              costPerConsumption,
              numberOrNull(row.min_stock_level) ?? 5,
              supplier?.name || row.supplier || null,
              supplier?.id || null,
              purchaseUnit,
              consumptionUnit,
              cf,
              row.category || null,
              id,
            ]
          );
          updated.push({ id, item_name: name });
        } else {
          const result = await tx.run(
            `INSERT INTO inventory_items (
              item_name, quantity, unit, cost_per_unit, min_stock_level, supplier, supplier_id,
              purchase_unit, consumption_unit, conversion_factor, category, is_archived
            ) VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
            [
              name,
              consumptionUnit,
              costPerConsumption,
              numberOrNull(row.min_stock_level) ?? 5,
              supplier?.name || row.supplier || null,
              supplier?.id || null,
              purchaseUnit,
              consumptionUnit,
              cf,
              row.category || null,
            ]
          );
          id = result.lastInsertRowid;
          inserted.push({ id, item_name: name });
        }

        const qty = numberOrNull(row.quantity) ?? 0;
        if (qty > 0) {
          await applyStockChange(tx, {
            inventory_item_id: id,
            quantity: qty,
            units,
            unit_cost: numberOrNull(row.cost_per_unit),
            change_type: 'opening_balance',
            performed_by: auth.user?.id || null,
            reason: 'CSV import',
          });
        }
      }
    });

    return NextResponse.json({
      mode: 'commit',
      message: `Imported ${inserted.length} new item(s), updated ${updated.length}, skipped ${skipped.length}.`,
      counts: preview.counts,
      details: preview.details,
      inserted,
      updated,
      skipped,
    });
  } catch (error) {
    return handleRouteError(error, 'Failed to import stock items');
  }
}
