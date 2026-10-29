/**
 * Managed vocabulary for table floors and table types.
 *
 * tables.floor / tables.table_type stay as the stored text value (the live
 * floor board filters and sorts on them). These lists just give the owner a
 * controlled set to pick from and rename in one place. Renaming a floor/type
 * rewrites the mirrored text on every table so the board stays consistent.
 */

import { ensureSqliteTable } from '@/lib/db/ensure-sqlite-table.js';
import { normalizeName } from '@/lib/inventory-ledger.js';

export async function ensureTableTaxonomySchema(db) {
  await ensureSqliteTable(
    db,
    `
    CREATE TABLE IF NOT EXISTS table_floors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `
  );
  await ensureSqliteTable(
    db,
    `
    CREATE TABLE IF NOT EXISTS table_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      color TEXT DEFAULT '#3b82f6',
      default_capacity INTEGER DEFAULT 4,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `
  );
}

const conflict = (message) => Object.assign(new Error(message), { status: 409 });
const bad = (message) => Object.assign(new Error(message), { status: 400 });

/* ------------------------------------------------------------------ floors */

export async function listFloors(db) {
  return db.all(
    `SELECT f.*,
       (SELECT COUNT(*) FROM tables t WHERE lower(trim(t.floor)) = f.normalized_name) AS table_count
     FROM table_floors f ORDER BY f.sort_order, f.name`
  );
}

export async function createFloor(db, { name, sort_order = 0 }) {
  const clean = String(name || '').trim();
  if (!clean) throw bad('Floor name is required.');
  const key = normalizeName(clean);
  if (await db.get(`SELECT id FROM table_floors WHERE normalized_name = ?`, [key])) throw conflict('That floor already exists.');
  await db.run(`INSERT INTO table_floors (name, normalized_name, sort_order) VALUES (?, ?, ?)`, [clean, key, Number(sort_order) || 0]);
  return db.get(`SELECT * FROM table_floors WHERE normalized_name = ?`, [key]);
}

export async function updateFloor(db, id, { name, sort_order }) {
  const clean = String(name || '').trim();
  if (!clean) throw bad('Floor name is required.');
  const key = normalizeName(clean);
  if (await db.get(`SELECT id FROM table_floors WHERE normalized_name = ? AND id <> ?`, [key, id])) throw conflict('That floor already exists.');
  const before = await db.get(`SELECT * FROM table_floors WHERE id = ?`, [id]);
  if (!before) throw bad('Floor not found.');
  await db.transaction(async (tx) => {
    await tx.run(
      `UPDATE table_floors SET name = ?, normalized_name = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [clean, key, sort_order == null ? before.sort_order : Number(sort_order) || 0, id]
    );
    // Keep the mirrored text on tables aligned with the rename.
    await tx.run(`UPDATE tables SET floor = ? WHERE lower(trim(floor)) = ?`, [clean, before.normalized_name]);
  });
  return db.get(`SELECT * FROM table_floors WHERE id = ?`, [id]);
}

export async function deleteFloor(db, id) {
  const row = await db.get(`SELECT * FROM table_floors WHERE id = ?`, [id]);
  if (!row) return;
  const inUse = await db.get(`SELECT COUNT(*) AS n FROM tables WHERE lower(trim(floor)) = ?`, [row.normalized_name]);
  if (Number(inUse?.n || 0) > 0) throw conflict(`${row.name} still has tables assigned. Move them to another floor first.`);
  await db.run(`DELETE FROM table_floors WHERE id = ?`, [id]);
}

/* ------------------------------------------------------------------- types */

export async function listTypes(db) {
  return db.all(
    `SELECT ty.*,
       (SELECT COUNT(*) FROM tables t WHERE lower(trim(t.table_type)) = ty.normalized_name) AS table_count
     FROM table_types ty ORDER BY ty.name`
  );
}

export async function createType(db, { name, color = '#3b82f6', default_capacity = 4 }) {
  const clean = String(name || '').trim();
  if (!clean) throw bad('Type name is required.');
  const key = normalizeName(clean);
  if (await db.get(`SELECT id FROM table_types WHERE normalized_name = ?`, [key])) throw conflict('That type already exists.');
  await db.run(`INSERT INTO table_types (name, normalized_name, color, default_capacity) VALUES (?, ?, ?, ?)`, [
    clean,
    key,
    color || '#3b82f6',
    Number(default_capacity) || 4,
  ]);
  return db.get(`SELECT * FROM table_types WHERE normalized_name = ?`, [key]);
}

export async function updateType(db, id, { name, color, default_capacity }) {
  const clean = String(name || '').trim();
  if (!clean) throw bad('Type name is required.');
  const key = normalizeName(clean);
  if (await db.get(`SELECT id FROM table_types WHERE normalized_name = ? AND id <> ?`, [key, id])) throw conflict('That type already exists.');
  const before = await db.get(`SELECT * FROM table_types WHERE id = ?`, [id]);
  if (!before) throw bad('Type not found.');
  await db.transaction(async (tx) => {
    await tx.run(
      `UPDATE table_types SET name = ?, normalized_name = ?, color = ?, default_capacity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [clean, key, color || before.color, default_capacity == null ? before.default_capacity : Number(default_capacity) || 4, id]
    );
    await tx.run(`UPDATE tables SET table_type = ? WHERE lower(trim(table_type)) = ?`, [clean, before.normalized_name]);
  });
  return db.get(`SELECT * FROM table_types WHERE id = ?`, [id]);
}

export async function deleteType(db, id) {
  const row = await db.get(`SELECT * FROM table_types WHERE id = ?`, [id]);
  if (!row) return;
  const inUse = await db.get(`SELECT COUNT(*) AS n FROM tables WHERE lower(trim(table_type)) = ?`, [row.normalized_name]);
  if (Number(inUse?.n || 0) > 0) throw conflict(`${row.name} is still used by some tables. Change their type first.`);
  await db.run(`DELETE FROM table_types WHERE id = ?`, [id]);
}
