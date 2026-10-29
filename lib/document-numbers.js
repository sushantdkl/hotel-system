/**
 * Short, staff-facing document numbers.
 *
 * These numbers are display/search/print identifiers. Existing internal row IDs
 * and old long order_number/bill_number/kot_number values remain valid.
 */

import { serialPkSql } from '@/lib/db/schema-helpers.js';
import { normalizedOrderType } from '@/lib/order-types.js';

const WIDTH = 3;
const COMPACT_PREFIX = {
  ORD: 'O',
  BILL: 'B',
};

/**
 * Channel-specific prefixes, so a number says where the sale came from.
 *
 *   dine-in    order O-001      bill T-001    kot K-001
 *   takeaway   order O-TW-001   bill TW-001   kot K-TW-001
 *   delivery   order O-D-001    bill D-001    kot K-D-001
 *
 * Order, bill and KOT stay tellable apart at a glance — O / T-TW-D / K — so a
 * number read down the phone is never ambiguous about which document it is.
 *
 * The SERIAL behind the prefix is deliberately shared: there is still one bill
 * counter and one KOT counter, so numbers keep running 001, 002, 003 across the
 * whole shop and nothing can collide or restart. Only the prefix changes.
 * Reading them in order, T-001 / TW-002 / T-003 is one continuous bill book
 * with the channel written on each line — which is what makes it auditable.
 *
 * The channel comes from normalizedOrderType() in lib/order-types.js — the same
 * classifier every report groups by, so a bill printed TW can never be counted
 * as dine-in on a report.
 */
export const CHANNEL_PREFIX = {
  order: { dine_in: 'O', takeaway: 'O-TW', delivery: 'O-D' },
  bill: { dine_in: 'T', takeaway: 'TW', delivery: 'D' },
  kot: { dine_in: 'K', takeaway: 'K-TW', delivery: 'K-D' },
};

/**
 * Prefix for a document type and the order it belongs to.
 * Falls back to the legacy prefix when the type has no channel scheme (orders)
 * or the order is unknown, so a caller can never end up with no number at all.
 */
export function documentPrefix(type, order, fallback) {
  const scheme = CHANNEL_PREFIX[String(type || '').toLowerCase()];
  if (!scheme) return fallback;
  if (order == null) return fallback || scheme.dine_in;
  return scheme[normalizedOrderType(order)] || fallback || scheme.dine_in;
}

/**
 * Every shape a bill number has ever taken, for callers that accept a
 * caller-supplied number (imports, retries) and must not mint a second one:
 * BILL-0001 and B0001 from before channel prefixes, T/TW/D now.
 */
export const BILL_NUMBER_PATTERN = /^(BILL-\d{3,}|B\d{3,}|T-\d{3,}|TW-\d{3,}|D-\d{3,})$/i;

export async function ensureDocumentNumberSchema(db) {
  const pk = serialPkSql(db);
  await db.run(`CREATE TABLE IF NOT EXISTS document_counters (
    ${pk},
    document_type TEXT NOT NULL UNIQUE,
    last_value INTEGER NOT NULL DEFAULT 0,
    updated_at ${db.driver === 'postgres' ? 'TIMESTAMP' : 'DATETIME'} DEFAULT CURRENT_TIMESTAMP
  )`).catch(() => {});
}

export function formatDocumentNumber(prefix, value) {
  const cleanPrefix = String(prefix || '').toUpperCase();
  const displayPrefix = COMPACT_PREFIX[cleanPrefix] || cleanPrefix;
  const sep = COMPACT_PREFIX[cleanPrefix] ? '' : '-';
  return `${displayPrefix}${sep}${String(Number(value) || 0).padStart(WIDTH, '0')}`;
}

/**
 * @param {object}  options
 * @param {string}  options.type    counter to draw from ('bill', 'kot', 'order').
 *   One counter per type, never per channel — see CHANNEL_PREFIX.
 * @param {string}  [options.prefix] explicit prefix; used when there is no
 *   channel scheme for the type, or no order to classify.
 * @param {object|string} [options.order] order row (or order-type string) whose
 *   channel decides the prefix.
 */
export async function nextDocumentNumber(db, { type, prefix, order = null, seed = 0 }) {
  const resolvedPrefix = documentPrefix(type, order, prefix);
  if (!type || !resolvedPrefix) throw new Error('Document number type and prefix are required.');
  await ensureDocumentNumberSchema(db);

  const cleanType = String(type).toLowerCase();
  const seedValue = Math.max(0, Number(seed) || 0);

  if (db.driver === 'postgres') {
    await db.run(
      `INSERT INTO document_counters (document_type, last_value)
       VALUES (?, ?)
       ON CONFLICT (document_type) DO NOTHING`,
      [cleanType, seedValue]
    );
    const row = await db.get(
      `SELECT last_value FROM document_counters WHERE document_type = ? FOR UPDATE`,
      [cleanType]
    );
    const next = Math.max(Number(row?.last_value || 0), seedValue) + 1;
    await db.run(
      `UPDATE document_counters
       SET last_value = ?, updated_at = CURRENT_TIMESTAMP
       WHERE document_type = ?`,
      [next, cleanType]
    );
    return formatDocumentNumber(resolvedPrefix, next);
  }

  await db.run(
    `INSERT OR IGNORE INTO document_counters (document_type, last_value)
     VALUES (?, ?)`,
    [cleanType, seedValue]
  );
  const row = await db.get(
    `SELECT last_value FROM document_counters WHERE document_type = ?`,
    [cleanType]
  );
  const next = Math.max(Number(row?.last_value || 0), seedValue) + 1;
  await db.run(
    `UPDATE document_counters
     SET last_value = ?, updated_at = CURRENT_TIMESTAMP
     WHERE document_type = ?`,
    [next, cleanType]
  );
  return formatDocumentNumber(resolvedPrefix, next);
}
