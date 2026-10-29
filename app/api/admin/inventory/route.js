import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureSqliteTable } from '@/lib/db/ensure-sqlite-table.js';
import { ensureRecipeTables } from '@/lib/recipes.js';
import { applyStockChange, normalizeName } from '@/lib/inventory-ledger.js';
import { resolveSupplier } from '@/lib/purchases.js';
import { ensureInventoryCategorySchema, resolveInventoryCategory } from '@/lib/inventory-categories.js';
import { normalizeUnitOrKeep } from '@/lib/units.js';

/**
 * Canonicalise the unit spellings on the way in, so a direct API client can't
 * reintroduce the "kg"/"Kg"/"kilo" drift the picker exists to prevent.
 * Best-effort by design: anything outside the catalogue (box_24) is kept
 * exactly as sent — this must never rewrite a unit it can't confidently map.
 */
function normalizeUnitFields(data, before = null) {
  const consumption = normalizeUnitOrKeep(data.consumption_unit ?? before?.consumption_unit ?? data.unit ?? before?.unit);
  const purchaseRaw = data.purchase_unit ?? before?.purchase_unit;
  return {
    // `unit` is the legacy column and MUST mirror the consumption unit —
    // quantity is stored in it. A client that sends unit:'kg' alongside
    // consumption_unit:'g' would otherwise label 5000 grams as 5000 kg.
    unit: consumption || normalizeUnitOrKeep(data.unit ?? before?.unit),
    consumption_unit: consumption || null,
    purchase_unit: normalizeUnitOrKeep(purchaseRaw) || null,
  };
}

async function ensureInventoryReady(db) {
  await ensureSqliteTable(
    db,
    `
    CREATE TABLE IF NOT EXISTS inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_name TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit TEXT NOT NULL,
      cost_per_unit REAL NOT NULL,
      selling_price REAL,
      min_stock_level REAL DEFAULT 5,
      supplier TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `
  );
  await ensureRecipeTables(db);
  await ensureInventoryCategorySchema(db);
}

/** Reject a name that collides with a live item (case/whitespace-insensitive). */
async function assertNameFree(db, itemName, exceptId = null) {
  const key = normalizeName(itemName);
  const clash = await db.get(
    `SELECT id, item_name FROM inventory_items
     WHERE COALESCE(is_archived, 0) = 0 AND lower(trim(item_name)) = ?
     LIMIT 1`,
    [key]
  );
  if (clash && Number(clash.id) !== Number(exceptId)) {
    const err = new Error(`"${clash.item_name}" already exists. Rename it, or edit the existing item.`);
    err.status = 409;
    throw err;
  }
}

async function resolveMenuItemLink(db, value, exceptInventoryId = null) {
  if (value == null || value === '') return null;
  const menuItemId = Number(value);
  if (!Number.isInteger(menuItemId) || menuItemId <= 0) {
    throw Object.assign(new Error('Choose a valid menu item to link.'), { status: 400 });
  }
  const menuItem = await db.get('SELECT id, name FROM menu_items WHERE id = ?', [menuItemId]);
  if (!menuItem) throw Object.assign(new Error('That menu item no longer exists.'), { status: 400 });
  const clash = await db.get(
    `SELECT id, item_name FROM inventory_items
     WHERE menu_item_id = ? AND COALESCE(is_archived, 0) = 0 AND id <> COALESCE(?, -1)
     LIMIT 1`,
    [menuItemId, exceptInventoryId]
  );
  if (clash) {
    throw Object.assign(
      new Error(`${menuItem.name} is already linked to inventory item "${clash.item_name}".`),
      { status: 409 }
    );
  }
  return menuItemId;
}

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'kitchen', 'waiter', 'cashier'], permission: 'inventory.view' });
    if (auth.error) return auth.error;

    const db = Database.getInstance();
    await ensureInventoryReady(db);

    // Archived items stay out of pickers / recipe lines / purchasing by
    // default; history and reports opt back in with ?include_archived=1.
    const includeArchived = new URL(request.url).searchParams.get('include_archived') === '1';

    const items = await db.all(`
      SELECT i.*, mi.name AS linked_menu_item_name
      FROM inventory_items i
      LEFT JOIN menu_items mi ON mi.id = i.menu_item_id
      ${includeArchived ? '' : 'WHERE COALESCE(i.is_archived, 0) = 0'}
      ORDER BY i.created_at DESC
    `);

    return NextResponse.json({ items });
  } catch (error) {
    return handleRouteError(error, 'Failed to fetch inventory');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'inventory.manage' });
    if (auth.error) return auth.error;

    const data = await request.json();
    if (!String(data.item_name || '').trim()) {
      return NextResponse.json({ error: 'Item name is required.' }, { status: 400 });
    }

    const db = Database.getInstance();
    await ensureInventoryReady(db);
    await assertNameFree(db, data.item_name);
    const units = normalizeUnitFields(data);
    const menuItemId = await resolveMenuItemLink(db, data.menu_item_id);

    const item = await db.transaction(async (tx) => {
      const supplier = await resolveSupplier(tx, data.supplier);
      const category = await resolveInventoryCategory(tx, data.category);
      // Created at zero, then stocked through the ledger so the opening
      // balance is a real movement with a cost basis.
      const result = await tx.run(
        `
        INSERT INTO inventory_items (
          item_name, quantity, unit, cost_per_unit, selling_price,
          min_stock_level, supplier, supplier_id, notes,
          purchase_unit, consumption_unit, conversion_factor, category, category_id, menu_item_id, is_archived
        ) VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      `,
        [
          String(data.item_name).trim(),
          units.unit,
          Number(data.cost_per_unit || 0),
          data.selling_price || null,
          data.min_stock_level || 5,
          supplier?.name || data.supplier || null,
          supplier?.id || null,
          data.notes || null,
          units.purchase_unit,
          units.consumption_unit,
          data.conversion_factor || 1,
          category?.name || null,
          category?.id || null,
          menuItemId,
        ]
      );
      const id = result.lastInsertRowid;

      const opening = Number(data.quantity || 0);
      if (opening !== 0) {
        await applyStockChange(tx, {
          inventory_item_id: id,
          quantity: opening,
          change_type: 'opening_balance',
          unit_cost: data.cost_per_unit ?? null,
          performed_by: auth.user?.id || null,
          reason: 'Opening balance',
        });
      }
      return tx.get('SELECT * FROM inventory_items WHERE id = ?', [id]);
    });

    return NextResponse.json(
      { message: 'Inventory item created successfully', item },
      { status: 201 }
    );
  } catch (error) {
    return handleRouteError(error, 'Failed to create inventory item');
  }
}

export async function PUT(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'inventory.manage' });
    if (auth.error) return auth.error;

    const data = await request.json();
    const db = Database.getInstance();
    await ensureInventoryReady(db);

    const id = data.id || new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Which item should be updated?' }, { status: 400 });

    const before = await db.get('SELECT * FROM inventory_items WHERE id = ?', [id]);
    if (!before) return NextResponse.json({ error: 'Inventory item not found.' }, { status: 404 });
    await assertNameFree(db, data.item_name ?? before.item_name, id);

    const nextQty = data.quantity === undefined || data.quantity === '' ? Number(before.quantity) : Number(data.quantity);
    const qtyChanged = Number(before.quantity) !== nextQty;
    const reason = String(data.adjustment_reason || '').trim();
    if (qtyChanged && !reason) {
      return NextResponse.json(
        { error: 'Manual stock adjustments need a reason (e.g. "stock count correction").' },
        { status: 400 }
      );
    }

    const units = normalizeUnitFields(data, before);
    const requestedMenuItemId = Object.prototype.hasOwnProperty.call(data, 'menu_item_id')
      ? data.menu_item_id
      : before.menu_item_id;
    const menuItemId = await resolveMenuItemLink(db, requestedMenuItemId, id);

    const item = await db.transaction(async (tx) => {
      const supplier = await resolveSupplier(tx, data.supplier);
      const category = await resolveInventoryCategory(tx, data.category);
      // Quantity is deliberately NOT written here — the ledger owns it.
      await tx.run(
        `
        UPDATE inventory_items
        SET item_name = ?, unit = ?, cost_per_unit = ?,
            selling_price = ?, min_stock_level = ?, supplier = ?, supplier_id = ?, notes = ?,
            purchase_unit = ?, consumption_unit = ?, conversion_factor = ?, category = ?, category_id = ?, menu_item_id = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
        [
          data.item_name ?? before.item_name,
          units.unit,
          data.cost_per_unit ?? before.cost_per_unit,
          data.selling_price || null,
          data.min_stock_level || 5,
          supplier?.name || data.supplier || null,
          supplier?.id || null,
          data.notes || null,
          units.purchase_unit,
          units.consumption_unit,
          data.conversion_factor || 1,
          category?.name || null,
          category?.id || null,
          menuItemId,
          id,
        ]
      );

      if (qtyChanged) {
        await applyStockChange(tx, {
          inventory_item_id: Number(id),
          quantity: nextQty - Number(before.quantity),
          change_type: 'manual_adjustment',
          performed_by: auth.user?.id || null,
          reason,
          allow_negative: true, // an explicit count correction is authoritative
        });
      }
      return tx.get('SELECT * FROM inventory_items WHERE id = ?', [id]);
    });

    return NextResponse.json({ message: 'Inventory item updated successfully', item });
  } catch (error) {
    return handleRouteError(error, 'Failed to update inventory item');
  }
}

/**
 * Archive-first delete. A hard DELETE only happens when the item has no
 * movements, no recipe lines and no purchase lines — otherwise it is archived
 * so history, recipes and reports keep resolving it.
 */
export async function DELETE(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'inventory.manage' });
    if (auth.error) return auth.error;

    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Which item should be removed?' }, { status: 400 });

    const db = Database.getInstance();
    await ensureInventoryReady(db);

    const counts = await db.get(
      `SELECT
         (SELECT COUNT(*) FROM stock_movements WHERE inventory_item_id = ?) AS movements,
         (SELECT COUNT(*) FROM recipe_items WHERE raw_material_id = ?) AS recipe_lines,
         (SELECT COUNT(*) FROM purchase_items WHERE inventory_item_id = ?) AS purchase_lines,
         (SELECT COUNT(*) FROM wastage_log WHERE raw_material_id = ?) AS wastage_entries`,
      [id, id, id, id]
    );

    const referenced =
      Number(counts?.movements || 0) +
      Number(counts?.recipe_lines || 0) +
      Number(counts?.purchase_lines || 0) +
      Number(counts?.wastage_entries || 0);

    if (referenced > 0) {
      await db.run(
        `UPDATE inventory_items SET is_archived = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [id]
      );
      return NextResponse.json({
        message: 'Item archived — it has history, so it stays available in reports and recipes.',
        archived: true,
        references: counts,
      });
    }

    await db.run('DELETE FROM inventory_items WHERE id = ?', [id]);
    return NextResponse.json({ message: 'Inventory item deleted successfully', archived: false });
  } catch (error) {
    return handleRouteError(error, 'Failed to delete inventory item');
  }
}
