import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureMenuVariantsSchema, getVariantsByMenuItemIds, replaceVariants } from '@/lib/menu-variants.js';
import { ensureColumn } from '@/lib/db/schema-helpers.js';
import { comboAvailableOn, ensureComboSchema, getCombosForMenuItems } from '@/lib/combos.js';
import { sortCombosFirst } from '@/lib/promotion-display.js';

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

async function ensureMenuStockUsageColumn(db) {
  await ensureColumn(db, 'menu_items', 'stock_usage', 'REAL DEFAULT 1');
}

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'menu.view' });
    if (auth.error) return auth.error;

    const db = Database.getInstance();
    await ensureMenuVariantsSchema(db);
    await ensureComboSchema(db);
    await ensureColumn(db, 'inventory_items', 'pos_stock_visible', 'INTEGER DEFAULT 0');
    await ensureMenuStockUsageColumn(db);

    const products = await db.all(`
      SELECT
        mi.*,
        mi.base_price as price,
        COALESCE(mi.stock_usage, 1) AS stock_usage,
        mc.name as category_name,
        (SELECT i.id FROM inventory_items i WHERE i.menu_item_id = mi.id AND COALESCE(i.is_archived, 0) = 0 LIMIT 1) AS inventory_item_id,
        (SELECT i.quantity FROM inventory_items i WHERE i.menu_item_id = mi.id AND COALESCE(i.is_archived, 0) = 0 AND COALESCE(i.pos_stock_visible, 0) = 1 LIMIT 1) AS stock_quantity,
        (SELECT i.unit FROM inventory_items i WHERE i.menu_item_id = mi.id AND COALESCE(i.is_archived, 0) = 0 AND COALESCE(i.pos_stock_visible, 0) = 1 LIMIT 1) AS stock_unit,
        (SELECT i.item_name FROM inventory_items i WHERE i.menu_item_id = mi.id AND COALESCE(i.is_archived, 0) = 0 LIMIT 1) AS inventory_item_name,
        (SELECT COALESCE(i.pos_stock_visible, 0) FROM inventory_items i WHERE i.menu_item_id = mi.id AND COALESCE(i.is_archived, 0) = 0 LIMIT 1) AS pos_stock_visible
      FROM menu_items mi
      LEFT JOIN menu_categories mc ON mi.category_id = mc.id
      ORDER BY mi.name
    `);

    const variantsByItem = await getVariantsByMenuItemIds(db, products.map((p) => p.id));
    const combosByItem = await getCombosForMenuItems(db, products.map((p) => p.id));
    for (const product of products) {
      product.variants = variantsByItem.get(product.id) || [];
      const combo = combosByItem.get(Number(product.id));
      product.is_combo = combo ? 1 : Number(product.is_combo || 0);
      product.combo = combo ? {
        ...combo,
        savings: Math.max(0, Number(combo.original_price || 0) - Number(product.price || 0)),
      } : null;
    }

    const channel = new URL(request.url).searchParams.get('channel');
    const visibleProducts = channel
      ? products.filter((product) => !product.combo || comboAvailableOn(product.combo, channel))
      : products;

    return NextResponse.json({ products: sortCombosFirst(visibleProducts) });
  } catch (error) {
    return handleRouteError(error, 'Could not load the menu. Please try again.');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'menu.manage' });
    if (auth.error) return auth.error;

    const data = await request.json();
    const db = Database.getInstance();
    await ensureMenuVariantsSchema(db);
    await ensureMenuStockUsageColumn(db);

    const hasVariants = Array.isArray(data.variants) && data.variants.length > 0;
    const price = data.price || data.base_price || 0;
    const stockUsage = hasVariants ? 1 : normalizeStockUsage(data.stock_usage);

    const result = await db.run(`
      INSERT INTO menu_items (
        name, category_id, base_price, description, image_url,
        is_available, is_vegetarian, preparation_time, unit, cost, stock_usage
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      data.name,
      data.category_id || 1,
      price,
      data.description || null,
      data.image_url || null,
      data.is_available ? 1 : 0,
      data.is_vegetarian ? 1 : 0,
      data.preparation_time || 15,
      data.unit || null,
      data.cost === '' || data.cost == null ? null : Number(data.cost),
      stockUsage,
    ]);

    const menuItemId = result.lastInsertRowid;

    let variants = [];
    if (hasVariants) {
      variants = await replaceVariants(db, menuItemId, data.variants);
      const defaultVariant = variants.find((v) => v.is_default) || variants[0];
      if (defaultVariant) await db.run('UPDATE menu_items SET base_price = ? WHERE id = ?', [defaultVariant.price, menuItemId]);
    }

    const product = await db.get(`
      SELECT *
      FROM menu_items
      WHERE id = ?
    `, [menuItemId]);
    product.variants = variants;

    await syncInventoryLink(db, product.id, hasVariants ? null : data.inventory_item_id, data.pos_stock_visible);

    return NextResponse.json({
      message: 'Product created successfully',
      product,
    }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to create product');
  }
}
