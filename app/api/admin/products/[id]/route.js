import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureMenuVariantsSchema, replaceVariants } from '@/lib/menu-variants.js';
import { ensureColumn } from '@/lib/db/schema-helpers.js';
import { ensureComboSchema } from '@/lib/combos.js';

async function rejectComboEdit(db, id) {
  await ensureComboSchema(db);
  const item = await db.get('SELECT COALESCE(is_combo, 0) AS is_combo FROM menu_items WHERE id = ?', [id]);
  if (Number(item?.is_combo)) {
    throw Object.assign(new Error('Manage this item from Combo Packs so its components and price stay in sync.'), { status: 409 });
  }
}

async function syncInventoryLink(db, menuItemId, inventoryItemId, posStockVisible) {
  await ensureColumn(db, 'inventory_items', 'pos_stock_visible', 'INTEGER DEFAULT 0');
  const inventoryId = inventoryItemId === '' || inventoryItemId == null ? null : Number(inventoryItemId);
  if (inventoryId != null && (!Number.isInteger(inventoryId) || inventoryId <= 0)) {
    throw Object.assign(new Error('Choose a valid inventory item to link.'), { status: 400 });
  }
  if (inventoryId != null) {
    const inventory = await db.get('SELECT id, item_name, menu_item_id FROM inventory_items WHERE id = ?', [inventoryId]);
    if (!inventory) throw Object.assign(new Error('The selected inventory item no longer exists.'), { status: 400 });
    if (inventory.menu_item_id && Number(inventory.menu_item_id) !== Number(menuItemId)) {
      throw Object.assign(new Error(`Inventory item "${inventory.item_name}" is already linked to another menu item.`), { status: 409 });
    }
  }
  await db.run('UPDATE inventory_items SET menu_item_id = NULL, pos_stock_visible = 0 WHERE menu_item_id = ?', [menuItemId]);
  if (inventoryId != null) {
    await db.run('UPDATE inventory_items SET menu_item_id = ?, pos_stock_visible = ? WHERE id = ?', [menuItemId, posStockVisible ? 1 : 0, inventoryId]);
  }
}

function normalizeStockUsage(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return n;
}

export async function PUT(request, context) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'menu.manage' });
    if (auth.error) return auth.error;

    const { id } = await context.params;
    const data = await request.json();
    const db = Database.getInstance();
    await ensureMenuVariantsSchema(db);
    await rejectComboEdit(db, id);
    await ensureColumn(db, 'menu_items', 'stock_usage', 'REAL DEFAULT 1');

    const hasVariants = Array.isArray(data.variants) && data.variants.length > 0;
    let variants = hasVariants ? await replaceVariants(db, id, data.variants) : await replaceVariants(db, id, []);
    const defaultVariant = variants.find((v) => v.is_default) || variants[0];
    const price = defaultVariant ? defaultVariant.price : (data.price || data.base_price || 0);
    const stockUsage = hasVariants ? 1 : normalizeStockUsage(data.stock_usage);

    await db.run(`
      UPDATE menu_items
      SET name = ?, category_id = ?, base_price = ?,
          description = ?, image_url = ?, is_available = ?, is_vegetarian = ?,
          preparation_time = ?, unit = ?, cost = ?, stock_usage = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [
      data.name,
      data.category_id || null,
      price,
      data.description || null,
      data.image_url ?? null,
      data.is_available ? 1 : 0,
      data.is_vegetarian ? 1 : 0,
      data.preparation_time || 15,
      data.unit || null,
      data.cost === '' || data.cost == null ? null : Number(data.cost),
      stockUsage,
      id,
    ]);

    await syncInventoryLink(db, id, hasVariants ? null : data.inventory_item_id, data.pos_stock_visible);

    const product = await db.get(`
      SELECT
        mi.*,
        mi.base_price as price,
        mc.name as category,
        (SELECT i.id FROM inventory_items i WHERE i.menu_item_id = mi.id AND COALESCE(i.is_archived, 0) = 0 LIMIT 1) AS inventory_item_id,
        (SELECT COALESCE(i.pos_stock_visible, 0) FROM inventory_items i WHERE i.menu_item_id = mi.id AND COALESCE(i.is_archived, 0) = 0 LIMIT 1) AS pos_stock_visible
      FROM menu_items mi
      LEFT JOIN menu_categories mc ON mi.category_id = mc.id
      WHERE mi.id = ?
    `, [id]);
    product.variants = variants;

    return NextResponse.json({
      message: 'Product updated successfully',
      product,
    });
  } catch (error) {
    return handleRouteError(error, 'Failed to update product');
  }
}

// Small, table-friendly updates without resubmitting the full edit form.
export async function PATCH(request, context) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'menu.manage' });
    if (auth.error) return auth.error;

    const { id } = await context.params;
    const data = await request.json();
    const allowed = ['is_available', 'is_vegetarian'];
    const fields = allowed.filter((key) => Object.prototype.hasOwnProperty.call(data, key));
    const updatesStockVisibility = Object.prototype.hasOwnProperty.call(data, 'pos_stock_visible');
    if (fields.length === 0 && !updatesStockVisibility) {
      return NextResponse.json({ error: 'No supported menu fields were provided.' }, { status: 400 });
    }

    const db = Database.getInstance();
    await ensureMenuVariantsSchema(db);
    await rejectComboEdit(db, id);
    const existing = await db.get('SELECT id, name FROM menu_items WHERE id = ?', [id]);
    if (!existing) return NextResponse.json({ error: 'Menu item not found.' }, { status: 404 });

    if (updatesStockVisibility) {
      const inventory = await db.get(
        'SELECT id FROM inventory_items WHERE menu_item_id = ? AND COALESCE(is_archived, 0) = 0 LIMIT 1',
        [id]
      );
      if (inventory) {
        await db.run(
          'UPDATE inventory_items SET pos_stock_visible = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [data.pos_stock_visible ? 1 : 0, inventory.id]
        );
      } else {
        const linkedVariants = await db.get(
          `SELECT COUNT(*) AS n
             FROM menu_item_variants v
             JOIN inventory_items i ON i.id = v.inventory_item_id
            WHERE v.menu_item_id = ? AND COALESCE(i.is_archived, 0) = 0`,
          [id]
        );
        if (Number(linkedVariants?.n || 0) === 0) {
          return NextResponse.json(
            { error: `"${existing.name}" is not linked to inventory. Link an inventory item before enabling stock visibility.` },
            { status: 409 }
          );
        }
        await db.run(
          `UPDATE menu_item_variants
              SET pos_stock_visible = ?
            WHERE menu_item_id = ? AND inventory_item_id IS NOT NULL`,
          [data.pos_stock_visible ? 1 : 0, id]
        );
      }
    }

    if (fields.length > 0) {
      const values = fields.map((key) => (data[key] ? 1 : 0));
      values.push(id);
      await db.run(
        `UPDATE menu_items SET ${fields.map((key) => `${key} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        values
      );
    }
    const product = await db.get(
      `SELECT mi.*, mi.base_price AS price,
              (SELECT i.id FROM inventory_items i WHERE i.menu_item_id = mi.id AND COALESCE(i.is_archived, 0) = 0 LIMIT 1) AS inventory_item_id,
              (SELECT COALESCE(i.pos_stock_visible, 0) FROM inventory_items i WHERE i.menu_item_id = mi.id AND COALESCE(i.is_archived, 0) = 0 LIMIT 1) AS pos_stock_visible,
              (SELECT i.quantity FROM inventory_items i WHERE i.menu_item_id = mi.id AND COALESCE(i.is_archived, 0) = 0 AND COALESCE(i.pos_stock_visible, 0) = 1 LIMIT 1) AS stock_quantity,
              (SELECT i.unit FROM inventory_items i WHERE i.menu_item_id = mi.id AND COALESCE(i.is_archived, 0) = 0 AND COALESCE(i.pos_stock_visible, 0) = 1 LIMIT 1) AS stock_unit
         FROM menu_items mi WHERE mi.id = ?`,
      [id]
    );
    return NextResponse.json({ message: 'Menu item updated successfully', product });
  } catch (error) {
    return handleRouteError(error, 'Failed to update menu item');
  }
}

export async function DELETE(request, context) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'menu.manage' });
    if (auth.error) return auth.error;

    const { id } = await context.params;
    const db = Database.getInstance();
    await rejectComboEdit(db, id);
    await ensureColumn(db, 'inventory_items', 'pos_stock_visible', 'INTEGER DEFAULT 0');

    // Deleting a menu item with order history would silently orphan those
    // order_items (menu_item_id is ON DELETE SET NULL) and drop them out of
    // any report that joins on menu_items. Mark it unavailable instead.
    const ordered = await db.get('SELECT 1 AS n FROM order_items WHERE menu_item_id = ? LIMIT 1', [id]);
    if (ordered) {
      return NextResponse.json(
        { error: 'This item has order history and cannot be deleted. Mark it unavailable instead to hide it from the menu.' },
        { status: 409 }
      );
    }

    // Clear the inventory link in the same transaction as the delete — see the
    // note in lib/db/repositories/menu.js deleteItem(): the FK is not
    // guaranteed on databases where menu_item_id was added by ensureColumn().
    await db.transaction(async (tx) => {
      await tx.run(
        'UPDATE inventory_items SET menu_item_id = NULL, pos_stock_visible = 0, updated_at = CURRENT_TIMESTAMP WHERE menu_item_id = ?',
        [id]
      );
      await tx.run('DELETE FROM menu_items WHERE id = ?', [id]);
    });

    return NextResponse.json({
      message: 'Product deleted successfully',
    });
  } catch (error) {
    return handleRouteError(error, 'Failed to delete product');
  }
}
