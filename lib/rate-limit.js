/**
 * Simple DB-backed rate limiter for login / public forms.
 */

import Database from '@/lib/db/index.js';

export async function checkRateLimit({
  key,
  limit = 20,
  windowSeconds = 60,
} = {}) {
  if (!key) return { ok: true };
  const db = Database.getInstance();
  await ensureRateLimitTable(db);

  const now = Date.now();
  const windowStart = new Date(now - windowSeconds * 1000).toISOString();

  await db.run(`DELETE FROM rate_limits WHERE created_at < ?`, [windowStart]);

  const row = await db.get(
    `SELECT COUNT(*) as c FROM rate_limits WHERE rate_key = ? AND created_at >= ?`,
    [key, windowStart]
  );
  const count = Number(row?.c || 0);
  if (count >= limit) {
    return { ok: false, retryAfter: windowSeconds };
  }

  await db.run(`INSERT INTO rate_limits (rate_key, created_at) VALUES (?, ?)`, [
    key,
    new Date(now).toISOString(),
  ]);
  return { ok: true };
}

async function ensureRateLimitTable(db) {
  if (db.driver === 'postgres') {
    await db.run(`
      CREATE TABLE IF NOT EXISTS rate_limits (
        id SERIAL PRIMARY KEY,
        rate_key TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } else {
    await db.run(`
      CREATE TABLE IF NOT EXISTS rate_limits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rate_key TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
  }
  try {
    await db.run(`CREATE INDEX IF NOT EXISTS idx_rate_limits_key_created ON rate_limits(rate_key, created_at)`);
  } catch {
    /* ignore */
  }
}

export function clientIp(request) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}
