import { ensureColumn } from '@/lib/db/schema-helpers.js';

const schemaReady = new WeakMap();

export async function ensureMenuVariantsSchema(db) {
  if (schemaReady.has(db)) return schemaReady.get(db);
  const ready = upgradeMenuSchema(db).catch((error) => {
    schemaReady.delete(db);
    throw error;
  });
  schemaReady.set(db, ready);
  return ready;
}

async function upgradeMenuSchema(db) {
  await ensureColumn(db, 'menu_item_variants', 'price', 'REAL');
  await ensureColumn(db, 'menu_item_variants', 'stock_quantity', 'REAL');
  await ensureColumn(db, 'menu_item_variants', 'stock_unit', 'TEXT');
  await ensureColumn(db, 'menu_item_variants', 'inventory_item_id', 'INTEGER');
  await ensureColumn(db, 'menu_item_variants', 'pos_stock_visible', 'INTEGER DEFAULT 0');
  await ensureColumn(db, 'inventory_items', 'pos_stock_visible', 'INTEGER DEFAULT 0');
  // Both item and variant stock queries reference these columns before the
  // inventory management page has had a chance to initialize its schema.
  await ensureColumn(db, 'inventory_items', 'is_archived', 'INTEGER DEFAULT 0');
  await ensureColumn(db, 'inventory_items', 'menu_item_id', 'INTEGER');
  await ensureColumn(db, 'menu_items', 'unit', 'TEXT');
  await ensureColumn(db, 'menu_items', 'cost', 'NUMERIC(14,2)');
}

export async function getVariantsByMenuItemIds(db, menuItemIds) {
  if (!menuItemIds.length) return new Map();
  await ensureMenuVariantsSchema(db);
  const placeholders = menuItemIds.map(() => '?').join(',');
  const rows = await db.all(
    `SELECT v.*, COALESCE(v.price, mi.base_price + COALESCE(v.price_modifier, 0)) AS price,
            CASE WHEN COALESCE(v.pos_stock_visible, 0) = 1
                       AND COALESCE(i.is_archived, 0) = 0
                 THEN i.quantity ELSE NULL END AS pos_stock_quantity,
            CASE WHEN COALESCE(v.pos_stock_visible, 0) = 1
                       AND COALESCE(i.is_archived, 0) = 0
                 THEN i.unit ELSE NULL END AS pos_stock_unit
     FROM menu_item_variants v
     JOIN menu_items mi ON mi.id = v.menu_item_id
     LEFT JOIN inventory_items i ON i.id = v.inventory_item_id
     WHERE v.menu_item_id IN (${placeholders})
     ORDER BY v.is_default DESC, v.id`,
    menuItemIds
  );
  const byItem = new Map();
  for (const row of rows) {
    const list = byItem.get(row.menu_item_id) || [];
    list.push(row);
    byItem.set(row.menu_item_id, list);
  }
  return byItem;
}

// Replaces the full variant set for a menu item (delete + reinsert — the form
// always submits the complete list, there's no partial-edit case).
export async function replaceVariants(db, menuItemId, variants) {
  await db.run('DELETE FROM menu_item_variants WHERE menu_item_id = ?', [menuItemId]);
  const clean = (variants || [])
    .map((v) => ({
      variant_name: String(v.variant_name || '').trim(),
      price: Number(v.price),
      stock_quantity: v.stock_quantity === '' || v.stock_quantity == null ? null : Number(v.stock_quantity),
      stock_unit: v.stock_unit || null,
      inventory_item_id: v.inventory_item_id ? Number(v.inventory_item_id) : null,
      pos_stock_visible: !!v.pos_stock_visible,
      is_default: !!v.is_default,
    }))
    .filter((v) => v.variant_name && Number.isFinite(v.price) && v.price >= 0);

  if (!clean.length) return [];

  if (!clean.some((v) => v.is_default)) clean[0].is_default = true;

  for (const v of clean) {
    await db.run(
      `INSERT INTO menu_item_variants (menu_item_id, variant_name, price, stock_quantity, stock_unit, inventory_item_id, pos_stock_visible, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [menuItemId, v.variant_name, v.price, v.stock_quantity, v.stock_unit, v.inventory_item_id, v.pos_stock_visible ? 1 : 0, v.is_default ? 1 : 0]
    );
  }
  return clean;
}
