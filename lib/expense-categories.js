/**
 * Managed expense-category list. expenses.category stays free text (nothing in
 * the expense flow changes); this just gives the picker a controlled, editable
 * vocabulary. Same shape as lib/inventory-categories.js.
 */

import { ensureSqliteTable } from '@/lib/db/ensure-sqlite-table.js';
import { normalizeName } from '@/lib/inventory-ledger.js';
import { ensureColumn } from '@/lib/db/schema-helpers.js';

// Which business an expense category belongs to, for restaurant / hotel P&L.
export const BUSINESS_UNITS = ['restaurant', 'hotel', 'shared'];

export async function ensureExpenseCategorySchema(db) {
  await ensureSqliteTable(
    db,
    `CREATE TABLE IF NOT EXISTS expense_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  );
  if (db.driver !== 'postgres') await ensureColumn(db, 'expense_categories', 'business_unit', "TEXT NOT NULL DEFAULT 'shared'");
}

export async function listExpenseCategories(db) {
  return db.all(
    `SELECT c.*,
       (SELECT COUNT(*) FROM expenses e WHERE lower(trim(e.category)) = c.normalized_name) AS usage_count
     FROM expense_categories c ORDER BY c.name`
  );
}

export async function createExpenseCategory(db, name) {
  const clean = String(name || '').trim();
  if (!clean) throw Object.assign(new Error('Category name is required.'), { status: 400 });
  const key = normalizeName(clean);
  if (await db.get(`SELECT id FROM expense_categories WHERE normalized_name = ?`, [key]))
    throw Object.assign(new Error('That category already exists.'), { status: 409 });
  await db.run(`INSERT INTO expense_categories (name, normalized_name) VALUES (?, ?)`, [clean, key]);
  return db.get(`SELECT * FROM expense_categories WHERE normalized_name = ?`, [key]);
}

export async function updateExpenseCategory(db, id, name, businessUnit = null) {
  if (businessUnit !== null && !BUSINESS_UNITS.includes(businessUnit)) throw Object.assign(new Error('Choose restaurant, hotel or shared.'), { status: 400 });
  const clean = String(name || '').trim();
  if (!clean) throw Object.assign(new Error('Category name is required.'), { status: 400 });
  const key = normalizeName(clean);
  if (await db.get(`SELECT id FROM expense_categories WHERE normalized_name = ? AND id <> ?`, [key, id]))
    throw Object.assign(new Error('That category already exists.'), { status: 409 });
  const before = await db.get(`SELECT * FROM expense_categories WHERE id = ?`, [id]);
  if (!before) throw Object.assign(new Error('Category not found.'), { status: 404 });
  await db.transaction(async (tx) => {
    await tx.run(`UPDATE expense_categories SET name = ?, normalized_name = ?, business_unit = COALESCE(?, business_unit), updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [clean, key, businessUnit, id]);
    // Keep already-tagged expenses aligned with the rename.
    await tx.run(`UPDATE expenses SET category = ? WHERE lower(trim(category)) = ?`, [clean, before.normalized_name]);
  });
  return db.get(`SELECT * FROM expense_categories WHERE id = ?`, [id]);
}

export async function deleteExpenseCategory(db, id) {
  await db.run(`DELETE FROM expense_categories WHERE id = ?`, [id]);
}
