import { ensureSqliteTable } from './db/ensure-sqlite-table.js';
import { ensureKotProSchema } from './kot-service.js';
import { ensureBillCorrectionsSchema } from './bill-corrections.js';
import { ensureOrderColumns } from './online-orders.js';
import { paginateQuery, buildSearch } from './paginate.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export const KOT_CANCELLATION_APPROVAL_SETTING = 'kot_cancellation_approval_enabled';

/** Global owner switch. Permissions still decide which staff member may use it. */
export async function isKotCancellationApprovalEnabled(db) {
  try {
    const row = await db.get(
      'SELECT setting_value FROM system_settings WHERE setting_key=? LIMIT 1',
      [KOT_CANCELLATION_APPROVAL_SETTING],
    );
    return String(row?.setting_value || '').toLowerCase() === 'true';
  } catch {
    // A missing settings table/key is a safe "off" state on older databases.
    return false;
  }
}

export async function assertKotCancellationApprovalEnabled(db) {
  if (!await isKotCancellationApprovalEnabled(db)) {
    fail('Cancelled KOT approval is disabled. An administrator can enable it in Settings.', 403);
  }
}
export async function ensureCancellationVerificationSchema(db) {
  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS cancellation_verifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT, document_type TEXT NOT NULL CHECK(document_type IN ('order','kot','bill')),
    document_id INTEGER NOT NULL, reviewer_scope TEXT NOT NULL CHECK(reviewer_scope IN ('kitchen','admin')),
    status TEXT NOT NULL CHECK(status IN ('verified','disputed')), note TEXT,
    verified_by INTEGER NOT NULL REFERENCES users(id), verified_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    request_key TEXT NOT NULL UNIQUE)`);
  await ensureSqliteTable(db, `CREATE INDEX IF NOT EXISTS idx_cancellation_verifications_document ON cancellation_verifications(document_type, document_id, reviewer_scope, id)`);
}

async function prepare(db) {
  await ensureCancellationVerificationSchema(db);
  await ensureKotProSchema(db);
  await ensureBillCorrectionsSchema(db);
  await ensureOrderColumns(db);
}

function scopeFor(actor) {
  if (!['admin', 'kitchen'].includes(actor?.role)) fail('Only kitchen staff and administrators can verify cancellations.', 403);
  return actor.role;
}

const documentsSql = `
  SELECT 'order' AS document_type, o.id AS document_id, o.order_number AS document_number,
    o.id AS order_id, o.table_number, o.cancel_reason AS reason, o.cancelled_at AS cancelled_at,
    o.business_day_id, NULL AS previous_status, NULL AS cancellation_kind, NULL AS amends_kot_number,
    (SELECT a.actor_id FROM pos_audit_log a WHERE a.order_id=o.id AND (a.action LIKE '%cancel%' OR a.action LIKE '%void%') ORDER BY a.id DESC LIMIT 1) AS cancelled_by
  FROM orders o WHERE o.status IN ('cancelled','voided')
  UNION ALL
  SELECT 'kot', k.id, k.kot_number, k.order_id, COALESCE(k.table_number,o.table_number),
    COALESCE(k.cancel_reason,k.void_reason,CASE WHEN k.kot_type='cancellation' THEN REPLACE(k.order_notes,'CANCEL: ','') END),
    COALESCE(k.cancelled_at,k.voided_at,CASE WHEN k.kot_type='cancellation' THEN k.printed_at END),
    COALESCE(k.business_day_id,o.business_day_id), k.previous_status,
    CASE WHEN k.kot_type='cancellation' THEN 'item' ELSE 'whole_kot' END,
    (SELECT source.kot_number FROM kots source WHERE source.id=k.amends_kot_id),
    COALESCE(k.cancelled_by,k.issued_by)
  FROM kots k LEFT JOIN orders o ON o.id=k.order_id
  WHERE (k.status='cancelled' OR k.voided=1 OR k.kot_type='cancellation')
    AND NOT (
      COALESCE(k.voided,0)=1
      AND k.void_reason='All items on this ticket were cancelled.'
      AND EXISTS (SELECT 1 FROM kots notice WHERE notice.amends_kot_id=k.id AND notice.kot_type='cancellation')
    )
  UNION ALL
  SELECT 'bill', b.id, b.bill_number, b.order_id, o.table_number, b.void_reason, b.voided_at, b.business_day_id, NULL, NULL, NULL,
    (SELECT c.created_by FROM bill_corrections c WHERE c.bill_id=b.id AND c.type='void' ORDER BY c.id DESC LIMIT 1)
  FROM bills b LEFT JOIN orders o ON o.id=b.order_id WHERE b.status IN ('void','voided','cancelled')`;

export async function listCancellationVerifications(db, actor, options = {}) {
  const scope = scopeFor(actor);
  await prepare(db);
  const conditions = ['1=1']; const params = [];
  if (scope === 'kitchen') conditions.push("d.document_type <> 'bill' AND (d.document_type='kot' OR EXISTS(SELECT 1 FROM kots relevant WHERE relevant.order_id=d.order_id))");
  if (options.documentType) { conditions.push('d.document_type=?'); params.push(options.documentType); }
  if (options.businessDayId) { conditions.push('d.business_day_id=?'); params.push(Number(options.businessDayId)); }
  if (options.from) { conditions.push("date(d.cancelled_at, '+5 hours', '+45 minutes')>=date(?)"); params.push(options.from); }
  if (options.to) { conditions.push("date(d.cancelled_at, '+5 hours', '+45 minutes')<=date(?)"); params.push(options.to); }
  const requestedStatus = { approved: 'verified', disallowed: 'disputed' }[options.status] || options.status;
  if (requestedStatus && ['verified','disputed','unverified'].includes(requestedStatus)) {
    conditions.push("COALESCE(lv.status,'unverified')=?"); params.push(requestedStatus);
  }
  const search = buildSearch(options.search, ['d.document_number', 'd.table_number', 'd.reason', 'cu.full_name']);
  if (search.clause) { conditions.push(search.clause); params.push(...search.params); }
  const result = await paginateQuery(db, {
    columns: `d.*, cu.full_name AS cancelled_by_name, lv.status AS review_status, lv.note AS review_note,
      lv.reviewer_scope AS reviewed_by_scope, lv.verified_at AS reviewed_at, lu.full_name AS reviewed_by_name,
      kv.status AS kitchen_status, kv.note AS kitchen_note,
      kv.verified_at AS kitchen_verified_at, ku.full_name AS kitchen_verifier,
      av.status AS admin_status, av.note AS admin_note, av.verified_at AS admin_verified_at, au.full_name AS admin_verifier`,
    from: `(${documentsSql}) d LEFT JOIN users cu ON cu.id=d.cancelled_by
      LEFT JOIN cancellation_verifications lv ON lv.id=(SELECT MAX(v.id) FROM cancellation_verifications v WHERE v.document_type=d.document_type AND v.document_id=d.document_id)
      LEFT JOIN cancellation_verifications kv ON kv.id=(SELECT MAX(v.id) FROM cancellation_verifications v WHERE v.document_type=d.document_type AND v.document_id=d.document_id AND v.reviewer_scope='kitchen')
      LEFT JOIN cancellation_verifications av ON av.id=(SELECT MAX(v.id) FROM cancellation_verifications v WHERE v.document_type=d.document_type AND v.document_id=d.document_id AND v.reviewer_scope='admin')
      LEFT JOIN users lu ON lu.id=lv.verified_by LEFT JOIN users ku ON ku.id=kv.verified_by LEFT JOIN users au ON au.id=av.verified_by`,
    where: conditions.join(' AND '), params, orderBy: 'd.cancelled_at DESC, d.document_type, d.document_id DESC',
    page: options.page || 1, pageSize: options.pageSize || 50,
  });

  // The review screen needs the immutable ticket snapshot to make a useful
  // fraud decision. Fetch the current page in one query (not one query/KOT).
  const kotIds = result.rows.filter((row) => row.document_type === 'kot').map((row) => Number(row.document_id));
  if (kotIds.length) {
    const placeholders = kotIds.map(() => '?').join(',');
    const items = await db.all(
      `SELECT ki.kot_id, COALESCE(ki.item_name, mi.name, 'Menu item') AS item_name,
        COALESCE(ki.variant_name, '') AS variant_name, ki.quantity
       FROM kot_items ki LEFT JOIN menu_items mi ON mi.id=ki.menu_item_id
       WHERE ki.kot_id IN (${placeholders}) ORDER BY ki.kot_id, ki.id`,
      kotIds,
    );
    const byKot = new Map();
    for (const item of items) {
      const group = byKot.get(Number(item.kot_id)) || [];
      group.push(item);
      byKot.set(Number(item.kot_id), group);
    }
    result.rows = result.rows.map((row) => ({ ...row, items: byKot.get(Number(row.document_id)) || [] }));
  }
  return result;
}

export async function verifyCancellation(db, actor, data) {
  const scope = scopeFor(actor);
  const type = data.document_type;
  const id = Number(data.document_id);
  if (!['order','kot','bill'].includes(type) || !Number.isInteger(id) || id <= 0) fail('Choose a valid cancelled document.');
  if (scope === 'kitchen' && type === 'bill') fail('Kitchen staff cannot verify bills.', 403);
  const status = { approved: 'verified', disallowed: 'disputed' }[data.status] || data.status;
  if (!['verified','disputed'].includes(status)) fail('Choose Approved or Disallowed.');
  const note = String(data.note || '').trim();
  if (note.length > 1000) fail('Verification notes must be 1,000 characters or fewer.');
  const key = String(data.request_key || '');
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(key)) fail('A valid request key is required.');
  await prepare(db);
  return db.transaction(async (tx) => {
    const table = { order: 'orders', kot: 'kots', bill: 'bills' }[type];
    const row = await tx.get(`SELECT * FROM ${table} WHERE id=?${tx.driver === 'postgres' ? ' FOR UPDATE' : ''}`, [id]);
    const isCancelled = row && (
      ['cancelled','void','voided'].includes(row.status)
      || (type === 'kot' && (Number(row.voided) || row.kot_type === 'cancellation'))
    );
    if (!isCancelled) fail('This document is not cancelled.', 409);
    if (scope === 'kitchen' && type === 'order' && !await tx.get('SELECT id FROM kots WHERE order_id=? LIMIT 1',[id])) fail('This order has no kitchen tickets.', 403);
    const prior = await tx.get('SELECT * FROM cancellation_verifications WHERE request_key=?', [key]);
    if (prior) {
      if (prior.document_type !== type || Number(prior.document_id) !== id || Number(prior.verified_by) !== Number(actor.id) || prior.status !== status || (prior.note || '') !== note) fail('Request key belongs to another verification.', 409);
      return prior;
    }
    const inserted = await tx.run(`INSERT INTO cancellation_verifications (document_type, document_id, reviewer_scope, status, note, verified_by, request_key) VALUES (?,?,?,?,?,?,?)`,[type,id,scope,status,note,actor.id,key]);
    return tx.get('SELECT * FROM cancellation_verifications WHERE id=?',[inserted.lastInsertRowid || inserted.lastID]);
  });
}

export async function cancellationVerificationHistory(db, actor, type, id) {
  scopeFor(actor);
  if (actor.role === 'kitchen' && type === 'bill') fail('Kitchen staff cannot inspect bills.', 403);
  if (actor.role === 'kitchen' && type === 'order' && !await db.get('SELECT id FROM kots WHERE order_id=? LIMIT 1',[Number(id)])) fail('This order has no kitchen tickets.', 403);
  await ensureCancellationVerificationSchema(db);
  return db.all(`SELECT v.*, u.full_name AS verifier_name FROM cancellation_verifications v LEFT JOIN users u ON u.id=v.verified_by WHERE v.document_type=? AND v.document_id=? ORDER BY v.id DESC`,[type,Number(id)]);
}

export async function cancellationWarningCounts(db, businessDayId) {
  const unverified = await listCancellationVerifications(db,{role:'admin'},{businessDayId,status:'unverified',pageSize:1});
  const disputedAdmin = await listCancellationVerifications(db,{role:'admin'},{businessDayId,status:'disputed',pageSize:1});
  const disputedKitchen = await listCancellationVerifications(db,{role:'kitchen'},{businessDayId,status:'disputed',pageSize:1});
  return { unverified:unverified.pagination.total, disputedAdmin:disputedAdmin.pagination.total, disputedKitchen:disputedKitchen.pagination.total, blocksClosing:false };
}
