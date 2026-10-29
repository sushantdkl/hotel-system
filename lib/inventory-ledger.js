/**
 * THE single write path for `inventory_items.quantity`.
 *
 * ── CANONICAL UNIT RULE ───────────────────────────────────────────────────
 *   inventory_items.quantity          stored in CONSUMPTION units (== .unit)
 *   inventory_items.cost_per_unit     cost of ONE CONSUMPTION unit (moving avg)
 *   inventory_items.conversion_factor consumption units inside 1 purchase unit
 *
 *   Callers that speak purchase units (deliveries, CSV cost columns) pass
 *   `units: 'purchase'` and the ledger converts once, here. Nothing downstream
 *   converts again. Recipes, wastage and order deductions are all in
 *   consumption units and pass `units: 'consumption'` (the default).
 *
 *   This matches the data already in the database (Green Chili: 5000 grams @
 *   0.25/gram, conversion_factor 1000 => Rs 250/kg) so no backfill was needed.
 *   It deliberately differs from "cost_per_unit is a purchase-unit price":
 *   that reading would have required rewriting every seeded row *and*
 *   getRecipeCost(), for no gain.
 *
 * Every mutation must go through applyStockChange(). It always:
 *   - converts units
 *   - clamps stored quantity at 0 but RECORDS the shortfall (variance) on the
 *     movement row and returns a structured warning
 *   - updates the moving-average cost on inbound moves
 *   - writes a stock_movements row carrying unit_cost + balance_after
 *   - never opens its own transaction (pass a tx-scoped db handle)
 */

import { ensureColumn } from '@/lib/db/schema-helpers.js';
import { ensureSqliteTable } from '@/lib/db/ensure-sqlite-table.js';

/** Movement vocabulary. 'manual_restock'/'adjustment' remain readable legacy values. */
export const CHANGE_TYPES = [
  'order_deduction',
  'order_void',
  'purchase_receipt',
  'wastage',
  'manual_adjustment',
  'transfer',
  'opening_balance',
  'hotel_consumption', // minibar / amenities used by a hotel guest (lib/hotel/minibar.js)
];

/**
 * Movements that represent goods coming in from a supplier. 'manual_restock'
 * is the pre-008 name — kept here so history written before the rename still
 * shows up everywhere the new name does.
 */
export const RECEIPT_CHANGE_TYPES = ['purchase_receipt', 'manual_restock'];

/** Case- and whitespace-insensitive key used by every unique/dedupe check. */
export function normalizeName(name = '') {
  return String(name).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Idempotent schema top-up. Postgres gets everything from migration 008 and
 * these calls become no-ops; SQLite (dev fallback) gets it created here.
 */
export async function ensureLedgerSchema(db) {
  await ensureSqliteTable(
    db,
    `CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      phone TEXT, email TEXT, address TEXT, notes TEXT,
      is_archived INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  );
  await ensureSqliteTable(
    db,
    `CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER REFERENCES suppliers(id),
      supplier TEXT,
      invoice_number TEXT,
      invoice_date TEXT,
      expected_delivery_date TEXT,
      received_by INTEGER REFERENCES users(id),
      subtotal REAL DEFAULT 0, tax REAL DEFAULT 0, discount REAL DEFAULT 0,
      shipping REAL DEFAULT 0, total REAL DEFAULT 0,
      notes TEXT, attachment_url TEXT,
      status TEXT NOT NULL DEFAULT 'received',
      void_reason TEXT, voided_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  );
  await ensureSqliteTable(
    db,
    `CREATE TABLE IF NOT EXISTS purchase_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
      inventory_item_id INTEGER REFERENCES inventory_items(id),
      quantity_ordered REAL DEFAULT 0,
      quantity_received REAL DEFAULT 0,
      unit_cost REAL DEFAULT 0,
      line_total REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  );
  await ensureColumn(db, 'inventory_items', 'is_archived', 'INTEGER DEFAULT 0');
  await ensureColumn(db, 'inventory_items', 'supplier_id', 'INTEGER');
  await ensureColumn(db, 'stock_movements', 'unit_cost', 'REAL');
  await ensureColumn(db, 'stock_movements', 'balance_after', 'REAL');
  await ensureColumn(db, 'stock_movements', 'quantity_requested', 'REAL');
  await ensureColumn(db, 'stock_movements', 'variance', 'REAL');
  await ensureColumn(db, 'stock_movements', 'business_day_id', 'INTEGER');
  await ensureColumn(db, 'expenses', 'source_type', 'TEXT');
  await ensureColumn(db, 'expenses', 'source_id', 'INTEGER');
  await ensureColumn(db, 'wastage_log', 'employee_id', 'INTEGER');
  await ensureColumn(db, 'wastage_log', 'shift', 'TEXT');
  await ensureColumn(db, 'wastage_log', 'photo_url', 'TEXT');
  await ensureColumn(db, 'wastage_log', 'total_cost', 'REAL');

  // After is_archived exists, so the partial index can reference it.
  try {
    await ensureSqliteTable(
      db,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_items_normalized_name
         ON inventory_items (lower(trim(item_name)))
         WHERE COALESCE(is_archived, 0) = 0`
    );
  } catch {
    /* pre-existing duplicate names on the SQLite dev DB — index stays absent */
  }
}

export function conversionFactor(item) {
  const cf = Number(item?.conversion_factor);
  return Number.isFinite(cf) && cf > 0 ? cf : 1;
}

/** Consumption units for a quantity expressed in `units`. */
export function toConsumption(item, quantity, units = 'consumption') {
  return units === 'purchase' ? Number(quantity) * conversionFactor(item) : Number(quantity);
}

/** Cost per consumption unit for a price expressed per `units`. */
export function toConsumptionCost(item, unitCost, units = 'consumption') {
  if (unitCost === null || unitCost === undefined || unitCost === '') return null;
  const n = Number(unitCost);
  if (!Number.isFinite(n)) return null;
  return units === 'purchase' ? n / conversionFactor(item) : n;
}

/**
 * Apply one signed stock change. MUST be called with a transaction-scoped `db`
 * when the caller has an open transaction — it never opens its own.
 *
 * @param {object} db                     tx-scoped or plain db handle
 * @param {object} opts
 * @param {number} opts.inventory_item_id
 * @param {number} opts.quantity          signed, expressed in `opts.units`
 * @param {'consumption'|'purchase'} [opts.units='consumption']
 * @param {string} opts.change_type       one of CHANGE_TYPES
 * @param {number} [opts.unit_cost]       price per `opts.units`; inbound moves only
 * @param {number} [opts.performed_by]
 * @param {string} [opts.reason]          REQUIRED for manual_adjustment
 * @param {string|number} [opts.reference_id]
 * @param {boolean} [opts.allow_negative=false]
 * @returns {Promise<object|null>} { inventory_item_id, item_name, from, to,
 *   requested, applied, shortfall, unit_cost, movement_id, warning }
 */
export async function applyStockChange(db, opts) {
  const {
    inventory_item_id,
    quantity,
    units = 'consumption',
    change_type,
    unit_cost = null,
    performed_by = null,
    reason = null,
    reference_id = null,
    business_day_id = null,
    allow_negative = false,
  } = opts || {};

  if (!inventory_item_id) throw new Error('applyStockChange: inventory_item_id is required.');
  if (!CHANGE_TYPES.includes(change_type)) {
    throw new Error(`applyStockChange: unknown change_type "${change_type}".`);
  }
  if (change_type === 'manual_adjustment' && !String(reason || '').trim()) {
    throw new Error('A reason is required for manual stock adjustments.');
  }

  // Serialize read/modify/write on each item inside the caller's transaction.
  const item = await db.get(`SELECT * FROM inventory_items WHERE id = ?${db.driver === 'postgres' ? ' FOR UPDATE' : ''}`, [inventory_item_id]);
  if (!item) return null;

  const requested = toConsumption(item, quantity, units);
  if (!Number.isFinite(requested) || requested === 0) return null;

  const from = Number(item.quantity ?? 0);
  const raw = from + requested;
  const to = !allow_negative && raw < 0 ? 0 : raw;
  const applied = to - from;
  const shortfall = requested - applied; // negative when stock was clamped

  const incomingCost = toConsumptionCost(item, unit_cost, units);
  const currentCost = Number(item.cost_per_unit ?? 0);

  // Moving average on inbound moves that carry a price.
  let newCost = currentCost;
  if (applied > 0 && incomingCost !== null) {
    const base = Math.max(0, from);
    newCost = base + applied > 0 ? (base * currentCost + applied * incomingCost) / (base + applied) : incomingCost;
  }

  await db.run(
    `UPDATE inventory_items
     SET quantity = ?, cost_per_unit = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [to, newCost, inventory_item_id]
  );

  // Cost basis recorded on the movement: what the stock leaving/entering was
  // worth at this instant, so historical COGS never gets rewritten by a later
  // price change.
  const basis = applied > 0 ? (incomingCost ?? newCost) : currentCost;
  let resolvedBusinessDayId = business_day_id || null;
  if (!resolvedBusinessDayId && reference_id && ['order_deduction', 'order_void'].includes(change_type)) {
    try {
      resolvedBusinessDayId = (await db.get(`SELECT business_day_id FROM orders WHERE id = ?`, [reference_id]))?.business_day_id || null;
    } catch {
      resolvedBusinessDayId = null;
    }
  }

  if (!resolvedBusinessDayId && !['order_deduction', 'order_void'].includes(change_type)) {
    const exists = db.driver === 'postgres'
      ? await db.get("SELECT 1 AS present FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='business_days'")
      : await db.get("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='business_days'");
    if (exists) resolvedBusinessDayId = (await db.get("SELECT id FROM business_days WHERE status='open' ORDER BY id DESC LIMIT 1"))?.id || null;
  }

  const result = await db.run(
    `INSERT INTO stock_movements
       (inventory_item_id, change_type, quantity_changed, performed_by, reason, reference_id,
        unit_cost, balance_after, quantity_requested, variance, business_day_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      inventory_item_id,
      change_type,
      applied,
      performed_by || null,
      reason || null,
      reference_id === null || reference_id === undefined ? null : String(reference_id),
      basis,
      to,
      requested,
      shortfall,
      resolvedBusinessDayId,
    ]
  );

  const name = item.item_name || item.name || `Item #${inventory_item_id}`;
  let warning = null;
  if (shortfall !== 0) {
    warning = `${name}: short by ${Math.abs(shortfall).toFixed(2)} ${item.consumption_unit || item.unit || 'units'} — stock floored at 0 and the variance was recorded.`;
  }

  return {
    inventory_item_id,
    inventory_id: inventory_item_id, // legacy key used by existing callers
    item_name: name,
    name,
    from,
    to,
    requested,
    applied,
    amount: Math.abs(applied),
    shortfall,
    unit_cost: basis,
    cost_value: Math.abs(applied) * basis,
    movement_id: result?.lastInsertRowid ?? null,
    warning,
  };
}

/**
 * Apply a Map<inventory_item_id, consumptionQty> (or array of opts) in one go.
 * @returns {Promise<{applied: Array, warnings: string[]}>}
 */
export async function applyStockChanges(db, entries, shared = {}) {
  const list =
    entries instanceof Map
      ? Array.from(entries, ([inventory_item_id, quantity]) => ({ inventory_item_id, quantity }))
      : entries || [];

  const applied = [];
  const warnings = [];
  for (const entry of list) {
    const row = await applyStockChange(db, { ...shared, ...entry });
    if (!row) continue;
    applied.push(row);
    if (row.warning) warnings.push(row.warning);

    // Low-stock nudge, unchanged in spirit from the old callers.
    if (row.applied < 0) {
      const item = await db.get(
        `SELECT min_stock_level, unit FROM inventory_items WHERE id = ?`,
        [row.inventory_item_id]
      );
      const min = Number(item?.min_stock_level ?? 0);
      if (row.to <= 0 && !row.warning) {
        warnings.push(`${row.name} is now out of stock.`);
      } else if (min > 0 && row.to > 0 && row.to <= min) {
        warnings.push(`${row.name} is running low (${row.to} ${item?.unit || 'left'}).`);
      }
    }
  }
  return { applied, warnings };
}

/**
 * Match a sold line to an inventory row. Deliberately strict: a wrong match
 * silently drains the wrong item, so anything short of an exact/near-exact
 * name hit returns an ambiguity warning and deducts nothing.
 *
 * @returns {Promise<{row: object|null, warning: string|null}>}
 */
export async function resolveInventoryItem(db, item) {
  const menuId = item.menu_item_id || item.item_id || item.id || null;
  if (menuId) {
    try {
      const byLink = await db.get(
        `SELECT * FROM inventory_items WHERE menu_item_id = ? AND COALESCE(is_archived, 0) = 0 LIMIT 1`,
        [menuId]
      );
      if (byLink) return { row: byLink, warning: null };
    } catch {
      /* menu_item_id column may not exist yet */
    }
  }

  const itemName = item.item_name || item.name || '';
  if (!itemName.trim()) return { row: null, warning: null };

  const needle = normalizeName(itemName);
  const rows = await db.all(
    `SELECT * FROM inventory_items WHERE COALESCE(is_archived, 0) = 0`
  );

  const exact = rows.filter((r) => normalizeName(r.item_name || r.name) === needle);
  if (exact.length === 1) return { row: exact[0], warning: null };
  if (exact.length > 1) {
    return {
      row: null,
      warning: `"${itemName}" matches ${exact.length} inventory items — no stock deducted. Merge the duplicates or link the menu item.`,
    };
  }

  // Near-exact: one side fully contains the other AND lengths are close, so
  // "Coke" ↔ "Coke Cans" still resolves but "Chicken" ↔ "Chicken Momo Filling"
  // (which shares a word only) does not.
  const near = rows.filter((r) => {
    const hay = normalizeName(r.item_name || r.name);
    if (!hay) return false;
    if (!hay.includes(needle) && !needle.includes(hay)) return false;
    const short = Math.min(hay.length, needle.length);
    const long = Math.max(hay.length, needle.length);
    return short / long >= 0.6;
  });

  if (near.length === 1) return { row: near[0], warning: null };
  if (near.length > 1) {
    return {
      row: null,
      warning: `"${itemName}" is ambiguous (${near.map((r) => r.item_name).join(', ')}) — no stock deducted.`,
    };
  }
  return { row: null, warning: null };
}
