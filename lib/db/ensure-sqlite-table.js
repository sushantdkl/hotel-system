/**
 * Skip SQLite DDL on Postgres (schema comes from migrations).
 * On SQLite, run the provided createSql.
 */
export async function ensureSqliteTable(db, createSql) {
  if (!db) return;
  if (db.driver === 'postgres') return;
  await db.run(createSql);
}
