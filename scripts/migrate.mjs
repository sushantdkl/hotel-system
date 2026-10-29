/**
 * Apply ordered SQL migrations to PostgreSQL.
 * Usage: DATABASE_URL=postgresql://... node scripts/migrate.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.DATABASE_URL;

if (!url || !/^postgres(ql)?:\/\//i.test(url)) {
  console.error('Set DATABASE_URL=postgresql://user:pass@host:5432/dbname');
  process.exit(1);
}

async function connectWithRetry(retries = 5) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    const client = new pg.Client({
      connectionString: url,
      ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 10000),
    });
    try {
      await client.connect();
      return client;
    } catch (err) {
      lastErr = err;
      try {
        await client.end();
      } catch {
        /* ignore */
      }
      const wait = 1000 * (i + 1);
      console.warn(`DB connect failed (${i + 1}/${retries}): ${err.message}`);
      console.warn(`retry in ${wait}ms…`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

const client = await connectWithRetry();
const migrationLock = [684321, 20260824];

try {
  // Prevent two application instances from applying the same migration at once.
  await client.query('SELECT pg_advisory_lock($1, $2)', migrationLock);

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      version TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const dir = path.join(root, 'migrations');
  const files = fs
    .readdirSync(dir)
    .filter(
      (f) =>
        f.endsWith('.sql') &&
        !f.startsWith('admin_') &&
        !f.startsWith('seed_') &&
        !f.startsWith('grant_')
    )
    .sort();

  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    const exists = await client.query(`SELECT 1 FROM schema_migrations WHERE version = $1`, [version]);
    if (exists.rowCount > 0) {
      console.log(`skip ${file}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (version) VALUES ($1)`, [version]);
      await client.query('COMMIT');
      console.log(`applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  }
  console.log('✓ Migrations complete');
} finally {
  await client.query('SELECT pg_advisory_unlock($1, $2)', migrationLock).catch(() => {});
  await client.end();
}
