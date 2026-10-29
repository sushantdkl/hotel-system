/** Read-only list of migrations that the normal runner would apply. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url || !/^postgres(ql)?:\/\//i.test(url)) {
  console.error('Set DATABASE_URL to the PostgreSQL database to inspect.');
  process.exit(1);
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = fs.readdirSync(path.join(root, 'migrations'))
  .filter((file) => file.endsWith('.sql') && !/^(admin_|seed_|grant_)/.test(file))
  .sort();
const client = new pg.Client({
  connectionString: url,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 10000),
});

await client.connect();
try {
  const exists = await client.query(`SELECT to_regclass('public.schema_migrations') AS table_name`);
  const applied = new Set(
    exists.rows[0]?.table_name
      ? (await client.query('SELECT version FROM schema_migrations')).rows.map((row) => row.version)
      : []
  );
  const pending = files.filter((file) => !applied.has(file.replace(/\.sql$/, '')));
  console.log(`Applied: ${applied.size}; local migrations: ${files.length}; pending: ${pending.length}`);
  for (const file of pending) console.log(`  ${file}`);
} finally {
  await client.end();
}
