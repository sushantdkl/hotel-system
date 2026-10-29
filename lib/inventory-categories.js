/**
 * Managed vocabulary for raw-material categories (Vegetables, Meat, Spices…).
 *
 * inventory_items.category kept a free-text name (migration 007). This gives
 * that column a managed backing list plus a category_id FK, mirroring the
 * supplier pattern in lib/purchases.js: the item stores both the id and the
 * name, so every existing read that uses the text keeps working while the id
 * makes the relationship a real, normalizable one.
 */

import { ensureSqliteTable } from '@/lib/db/ensure-sqlite-table.js';
import { ensureColumn } from '@/lib/db/schema-helpers.js';
import { normalizeName } from '@/lib/inventory-ledger.js';

/** Idempotent schema top-up. Postgres gets it from migration 012; SQLite here. */
export async function ensureInventoryCategorySchema(db) {
  await ensureSqliteTable(
    db,
    `
    CREATE TABLE IF NOT EXISTS inventory_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `
  );
  await ensureColumn(db, 'inventory_items', 'category_id', 'INTEGER');
}

/** Find-or-create a category by normalized name. Returns the row, or null for blank input. */
export async function resolveInventoryCategory(db, name) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const key = normalizeName(clean);

  const existing = await db.get(`SELECT * FROM inventory_categories WHERE normalized_name = ?`, [key]);
  if (existing) return existing;

  await db.run(`INSERT INTO inventory_categories (name, normalized_name) VALUES (?, ?)`, [clean, key]);
  return db.get(`SELECT * FROM inventory_categories WHERE normalized_name = ?`, [key]);
}

/** Categories with a live-item count for the management page. */
export async function listInventoryCategories(db) {
  return db.all(
    `SELECT c.*,
       (SELECT COUNT(*) FROM inventory_items i
         WHERE i.category_id = c.id AND COALESCE(i.is_archived, 0) = 0) AS item_count
     FROM inventory_categories c
     ORDER BY c.name`
  );
}

export async function createInventoryCategory(db, name) {
  const clean = String(name || '').trim();
  if (!clean) throw Object.assign(new Error('Category name is required.'), { status: 400 });
  const key = normalizeName(clean);
  const clash = await db.get(`SELECT id FROM inventory_categories WHERE normalized_name = ?`, [key]);
  if (clash) throw Object.assign(new Error('That category already exists.'), { status: 409 });
  await db.run(`INSERT INTO inventory_categories (name, normalized_name) VALUES (?, ?)`, [clean, key]);
  return db.get(`SELECT * FROM inventory_categories WHERE normalized_name = ?`, [key]);
}

export async function updateInventoryCategory(db, id, name) {
  const clean = String(name || '').trim();
  if (!clean) throw Object.assign(new Error('Category name is required.'), { status: 400 });
  const key = normalizeName(clean);
  const clash = await db.get(
    `SELECT id FROM inventory_categories WHERE normalized_name = ? AND id <> ?`,
    [key, id]
  );
  if (clash) throw Object.assign(new Error('That category already exists.'), { status: 409 });
  await db.transaction(async (tx) => {
    await tx.run(
      `UPDATE inventory_categories SET name = ?, normalized_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [clean, key, id]
    );
    // Keep the mirrored text on items in step with the rename.
    await tx.run(`UPDATE inventory_items SET category = ? WHERE category_id = ?`, [clean, id]);
  });
  return db.get(`SELECT * FROM inventory_categories WHERE id = ?`, [id]);
}

/** Delete a category and unlink its items (id → NULL, mirrored text cleared). */
export async function deleteInventoryCategory(db, id) {
  await db.transaction(async (tx) => {
    await tx.run(`UPDATE inventory_items SET category_id = NULL, category = NULL WHERE category_id = ?`, [id]);
    await tx.run(`DELETE FROM inventory_categories WHERE id = ?`, [id]);
  });
}
