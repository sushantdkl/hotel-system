/**
 * Table QR tokens. The token is what the customer QR encodes; it maps to a
 * table without exposing the table id. Kept unguessable (128-bit random hex).
 */

import crypto from 'crypto';
import { ensureColumn } from '@/lib/db/schema-helpers.js';

export function generateTableToken() {
  return crypto.randomBytes(16).toString('hex');
}

/** Backfill tokens for any table missing one (SQLite dev / safety net). */
export async function ensureTableTokens(db) {
  await ensureColumn(db, 'tables', 'qr_token', 'TEXT');
  const rows = await db.all(`SELECT id FROM tables WHERE qr_token IS NULL OR qr_token = ''`);
  for (const r of rows) {
    await db.run(`UPDATE tables SET qr_token = ? WHERE id = ?`, [generateTableToken(), r.id]);
  }
}

/** Resolve an active table by its QR token, or null. */
export async function resolveTableByToken(db, token) {
  await ensureColumn(db, 'tables', 'qr_token', 'TEXT');
  const clean = String(token || '').trim();
  if (!clean) return null;
  return db.get(
    `SELECT id, table_number, floor, section, capacity, status, current_order_id, is_active
     FROM tables WHERE qr_token = ?`,
    [clean]
  );
}
