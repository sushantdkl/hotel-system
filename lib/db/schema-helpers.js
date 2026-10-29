/**
 * Driver-safe schema introspection helpers (SQLite + PostgreSQL).
 */

export async function columnExists(db, table, column) {
  if (!db || !table || !column) return false;
  try {
    const isPg =
      db.driver === 'postgres' ||
      (typeof process !== 'undefined' &&
        process.env.DATABASE_URL &&
        /^postgres(ql)?:\/\//i.test(process.env.DATABASE_URL));
    if (isPg) {
      const row = await db.get(
        `SELECT 1 AS ok
         FROM information_schema.columns
         WHERE table_name = ?
           AND column_name = ?
           AND table_schema = ANY (current_schemas(false))
         LIMIT 1`,
        [String(table).toLowerCase(), String(column).toLowerCase()]
      );
      return !!row;
    }
    const cols = await db.all(`PRAGMA table_info(${table})`);
    return (cols || []).some((c) => c.name === column);
  } catch {
    return false;
  }
}

export async function ensureColumn(db, table, column, typeSql) {
  if (await columnExists(db, table, column)) return false;
  try {
    await db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeSql}`);
    return true;
  } catch (e) {
    const msg = String(e?.message || e || '');
    // Concurrent boot / already exists / cPanel non-owner DB user — never 500 list pages.
    if (/no such table|does not exist/i.test(msg)) return false;
    if (/already exists|duplicate column|must be owner|permission denied|insufficient privilege/i.test(msg)) {
      console.warn(`ensureColumn(${table}.${column}): ${msg}`);
      return false;
    }
    throw e;
  }
}

export function serialPkSql(db) {
  return db?.driver === 'postgres'
    ? 'id SERIAL PRIMARY KEY'
    : 'id INTEGER PRIMARY KEY AUTOINCREMENT';
}
