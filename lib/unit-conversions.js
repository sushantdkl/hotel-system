/**
 * User-defined unit conversions.
 *
 * The static catalogue in lib/units.js only knows physics-derivable ratios
 * (kg→g, dozen→pcs). It deliberately returns null for supplier-defined packs
 * like "1 Box = 24 Bottles" or "1 Sack = 25 Kg" — a box holds whatever the
 * supplier put in it. This table is where the owner records those, so the same
 * box→bottle question stops being asked on every inventory item.
 *
 * `factor` = how many `to_unit` are inside one `from_unit`.
 *   { from_unit: 'box', to_unit: 'bottle', factor: 24 }  -> 1 box = 24 bottles
 */

import { ensureSqliteTable } from './db/ensure-sqlite-table.js';
import { conversionFactor as catalogueFactor, normalizeUnitOrKeep } from './units.js';

/** Idempotent schema top-up. Postgres gets it from migration 011; SQLite here. */
export async function ensureUnitConversionSchema(db) {
  await ensureSqliteTable(
    db,
    `
    CREATE TABLE IF NOT EXISTS unit_conversions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_unit TEXT NOT NULL,
      to_unit TEXT NOT NULL,
      factor REAL NOT NULL,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (from_unit, to_unit)
    )
  `
  );
}

function cleanUnit(value) {
  return normalizeUnitOrKeep(value);
}

function validate({ from_unit, to_unit, factor }) {
  const from = cleanUnit(from_unit);
  const to = cleanUnit(to_unit);
  const f = Number(factor);
  if (!from || !to) throw badRequest('Both units are required.');
  if (from === to) throw badRequest('The two units must be different.');
  if (!Number.isFinite(f) || f <= 0) throw badRequest('Factor must be a positive number.');
  return { from, to, factor: f };
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

export async function listUnitConversions(db) {
  return db.all(`SELECT * FROM unit_conversions ORDER BY from_unit, to_unit`);
}

export async function createUnitConversion(db, data) {
  const { from, to, factor } = validate(data);
  const clash = await db.get(
    `SELECT id FROM unit_conversions WHERE from_unit = ? AND to_unit = ?`,
    [from, to]
  );
  if (clash) throw Object.assign(new Error('A conversion between these units already exists.'), { status: 409 });
  await db.run(
    `INSERT INTO unit_conversions (from_unit, to_unit, factor, note) VALUES (?, ?, ?, ?)`,
    [from, to, factor, data.note || null]
  );
  return db.get(`SELECT * FROM unit_conversions WHERE from_unit = ? AND to_unit = ?`, [from, to]);
}

export async function updateUnitConversion(db, id, data) {
  const { from, to, factor } = validate(data);
  const clash = await db.get(
    `SELECT id FROM unit_conversions WHERE from_unit = ? AND to_unit = ? AND id <> ?`,
    [from, to, id]
  );
  if (clash) throw Object.assign(new Error('A conversion between these units already exists.'), { status: 409 });
  await db.run(
    `UPDATE unit_conversions SET from_unit = ?, to_unit = ?, factor = ?, note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [from, to, factor, data.note || null, id]
  );
  return db.get(`SELECT * FROM unit_conversions WHERE id = ?`, [id]);
}

export async function deleteUnitConversion(db, id) {
  await db.run(`DELETE FROM unit_conversions WHERE id = ?`, [id]);
}

/**
 * How many `to` units are inside one `from`, consulting the owner's custom
 * conversions first (both directions) and falling back to the physics
 * catalogue. Returns null when nothing can answer it — the caller must then
 * ask the user, never assume 1.
 *
 * @param {Array} list  rows from listUnitConversions (pass [] for catalogue-only)
 */
export function resolveConversionFactor(from, to, list = []) {
  const a = cleanUnit(from);
  const b = cleanUnit(to);
  if (!a || !b) return null;
  if (a === b) return 1;

  for (const row of list) {
    const rf = cleanUnit(row.from_unit);
    const rt = cleanUnit(row.to_unit);
    const factor = Number(row.factor);
    if (!Number.isFinite(factor) || factor <= 0) continue;
    if (rf === a && rt === b) return factor;
    if (rf === b && rt === a) return Number((1 / factor).toPrecision(12));
  }

  return catalogueFactor(from, to);
}
