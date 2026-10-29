/**
 * Read-only production/staging data fingerprint for upgrade verification.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/db-upgrade-snapshot.mjs --output=before.json
 *   DATABASE_URL=... node scripts/db-upgrade-snapshot.mjs --output=after.json
 *
 * The output contains counts and aggregates, never row-level customer data or
 * credentials. Run while writes are stopped for a meaningful before/after check.
 */
import fs from 'node:fs';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url || !/^postgres(ql)?:\/\//i.test(url)) {
  console.error('Set DATABASE_URL to the PostgreSQL database to inspect.');
  process.exit(1);
}

const outputArg = process.argv.find((arg) => arg.startsWith('--output='));
const output = outputArg?.slice('--output='.length);
if (!output) {
  console.error('Pass --output=FILE.json.');
  process.exit(1);
}

const client = new pg.Client({
  connectionString: url,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 10000),
});

const criticalTables = [
  'users', 'menu_categories', 'menu_items', 'tables', 'customers',
  'orders', 'order_items', 'kots', 'bills', 'bill_items', 'bill_payments',
  'expenses', 'inventory_items', 'stock_movements', 'wastage_log',
  'suppliers', 'purchases', 'purchase_items', 'journal_entries', 'journal_lines',
  'business_days', 'business_day_sessions', 'salary_payments', 'savings_deposits', 'reservations',
];

async function scalar(sql) {
  const result = await client.query(sql);
  return result.rows[0] || {};
}

await client.connect();
try {
  await client.query('BEGIN READ ONLY');
  const existing = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
  );
  const existingTables = new Set(existing.rows.map((row) => row.table_name));

  const counts = {};
  for (const table of criticalTables) {
    if (!existingTables.has(table)) continue;
    const row = await scalar(`SELECT COUNT(*)::text AS count FROM public."${table}"`);
    counts[table] = row.count;
  }

  const aggregates = {};
  const metric = async (name, sql) => {
    // A failed optional metric (for example a column absent in an older
    // database) aborts a PostgreSQL transaction. Isolate it so the remaining
    // read-only fingerprint can still be collected.
    await client.query('SAVEPOINT snapshot_metric');
    try {
      aggregates[name] = await scalar(sql);
      await client.query('RELEASE SAVEPOINT snapshot_metric');
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT snapshot_metric');
      await client.query('RELEASE SAVEPOINT snapshot_metric');
      aggregates[name] = { unavailable: error.code || 'query_failed' };
    }
  };

  await metric('orders', `SELECT COUNT(*)::text AS rows,
    COALESCE(SUM(total_amount), 0)::text AS total_amount,
    COALESCE(MIN(id), 0)::text AS min_id, COALESCE(MAX(id), 0)::text AS max_id FROM orders`);
  await metric('bills', `SELECT COUNT(*)::text AS rows,
    COALESCE(SUM(total_amount), 0)::text AS total_amount,
    COALESCE(MIN(id), 0)::text AS min_id, COALESCE(MAX(id), 0)::text AS max_id FROM bills`);
  await metric('payments', `SELECT COUNT(*)::text AS rows,
    COALESCE(SUM(amount), 0)::text AS amount FROM bill_payments`);
  await metric('expenses', `SELECT COUNT(*)::text AS rows,
    COALESCE(SUM(amount), 0)::text AS amount FROM expenses`);
  await metric('journal', `SELECT COUNT(*)::text AS rows,
    COALESCE(SUM(debit), 0)::text AS debit,
    COALESCE(SUM(credit), 0)::text AS credit FROM journal_lines`);
  await metric('inventory', `SELECT COUNT(*)::text AS rows,
    COALESCE(SUM(quantity), 0)::text AS quantity,
    COALESCE(SUM(quantity * COALESCE(cost_per_unit, 0)), 0)::text AS stock_value
    FROM inventory_items`);
  await metric('purchases', `SELECT COUNT(*)::text AS rows,
    COALESCE(SUM(total), 0)::text AS total FROM purchases`);

  const migrations = existingTables.has('schema_migrations')
    ? (await client.query('SELECT version FROM schema_migrations ORDER BY version')).rows.map((row) => row.version)
    : [];

  const identity = await scalar(`SELECT current_database() AS database, current_user AS user_name,
    current_setting('server_version') AS postgres_version`);
  const snapshot = {
    format: 1,
    captured_at: new Date().toISOString(),
    identity,
    data: { counts, aggregates },
    schema_migrations: migrations,
  };
  fs.writeFileSync(output, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'wx' });
  await client.query('COMMIT');
  console.log(`Wrote read-only database snapshot to ${output}`);
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  await client.end();
}
