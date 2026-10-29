import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureRecipeTables } from '@/lib/recipes.js';
import { listStockMovements } from '@/lib/stock-movements.js';
import { normalizeName } from '@/lib/inventory-ledger.js';

export async function GET(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'kitchen', 'cashier'], permission: 'inventory.view' });
    if (auth.error) return auth.error;

    const { id } = await params;
    const db = Database.getInstance();
    await ensureRecipeTables(db);

    const item = await db.get('SELECT * FROM inventory_items WHERE id = ?', [id]);
    if (!item) return NextResponse.json({ error: 'Raw material not found' }, { status: 404 });

    // One item's own history — a single generous page is the whole story here,
    // and the drawer has no pager of its own.
    const { rows: movements, pagination: movementPagination } = await listStockMovements(db, {
      inventoryItemId: id,
      pageSize: 200,
    });

    const recipesUsing = await db.all(
      `SELECT r.id, r.name, r.type, mi.name as menu_item_name, ri.quantity, ri.unit
       FROM recipe_items ri
       JOIN recipes r ON ri.recipe_id = r.id
       LEFT JOIN menu_items mi ON r.menu_item_id = mi.id
       WHERE ri.raw_material_id = ?
       ORDER BY r.type, r.name`,
      [id]
    );

    const wastageEntries = await db.all(
      `SELECT w.*, u.full_name as logged_by_name
       FROM wastage_log w
       LEFT JOIN users u ON w.logged_by = u.id
       WHERE w.raw_material_id = ?
       ORDER BY w.created_at DESC
       LIMIT 100`,
      [id]
    );

    const lastPurchase = movements.find((m) =>
      ['purchase_receipt', 'manual_restock'].includes(m.change_type)
    );

    const purchases = await db.all(
      `SELECT p.id, p.invoice_number, p.invoice_date, p.supplier, p.status,
              pi.quantity_received, pi.unit_cost, pi.line_total
       FROM purchase_items pi
       JOIN purchases p ON pi.purchase_id = p.id
       WHERE pi.inventory_item_id = ?
       ORDER BY p.created_at DESC
       LIMIT 100`,
      [id]
    );

    return NextResponse.json({
      item,
      movements,
      movementPagination,
      recipesUsing,
      wastageEntries,
      purchases,
      lastPurchaseDate: lastPurchase?.created_at || null,
    });
  } catch (error) {
    return handleRouteError(error, 'Failed to load raw material detail');
  }
}

/**
 * PATCH /api/admin/inventory/[id]  { action: 'archive' | 'unarchive' | 'duplicate' }
 */
export async function PATCH(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'inventory.manage' });
    if (auth.error) return auth.error;

    const { id } = await params;
    const { action, item_name } = await request.json();
    const db = Database.getInstance();
    await ensureRecipeTables(db);

    const item = await db.get('SELECT * FROM inventory_items WHERE id = ?', [id]);
    if (!item) return NextResponse.json({ error: 'Raw material not found' }, { status: 404 });

    if (action === 'archive' || action === 'unarchive') {
      const archived = action === 'archive' ? 1 : 0;
      if (!archived) {
        const clash = await db.get(
          `SELECT id FROM inventory_items
           WHERE COALESCE(is_archived, 0) = 0 AND lower(trim(item_name)) = ? AND id <> ?
           LIMIT 1`,
          [normalizeName(item.item_name), id]
        );
        if (clash) {
          return NextResponse.json(
            { error: 'An active item already uses that name — rename this one before unarchiving.' },
            { status: 409 }
          );
        }
      }
      await db.run(
        `UPDATE inventory_items SET is_archived = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [archived, id]
      );
      return NextResponse.json({
        message: archived ? 'Item archived.' : 'Item restored.',
        item: await db.get('SELECT * FROM inventory_items WHERE id = ?', [id]),
      });
    }

    if (action === 'duplicate') {
      const name = String(item_name || `${item.item_name} (copy)`).trim();
      const clash = await db.get(
        `SELECT id FROM inventory_items WHERE COALESCE(is_archived, 0) = 0 AND lower(trim(item_name)) = ? LIMIT 1`,
        [normalizeName(name)]
      );
      if (clash) {
        return NextResponse.json({ error: `"${name}" already exists.` }, { status: 409 });
      }
      // Copies the definition, not the stock — a duplicate starts empty.
      const result = await db.run(
        `INSERT INTO inventory_items
           (item_name, quantity, unit, cost_per_unit, selling_price, min_stock_level,
            supplier, supplier_id, notes, purchase_unit, consumption_unit, conversion_factor,
            category, is_archived)
         VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          name,
          item.unit,
          item.cost_per_unit,
          item.selling_price,
          item.min_stock_level,
          item.supplier,
          item.supplier_id ?? null,
          item.notes,
          item.purchase_unit,
          item.consumption_unit,
          item.conversion_factor,
          item.category,
        ]
      );
      return NextResponse.json(
        {
          message: 'Item duplicated (starts with zero stock).',
          item: await db.get('SELECT * FROM inventory_items WHERE id = ?', [result.lastInsertRowid]),
        },
        { status: 201 }
      );
    }

    return NextResponse.json({ error: 'Unknown action. Use archive, unarchive or duplicate.' }, { status: 400 });
  } catch (error) {
    return handleRouteError(error, 'Failed to update raw material');
  }
}
