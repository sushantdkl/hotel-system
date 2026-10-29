import { ensureSqliteTable } from '@/lib/db/ensure-sqlite-table.js';

export const WAITER_REQUEST_TYPES = new Set(['service', 'order', 'bill', 'water']);
export const ACTIVE_WAITER_REQUEST_STATUSES = new Set(['pending', 'acknowledged']);

export function waiterRequestTypeLabel(type) {
  return ({
    service: 'Need service',
    order: 'Ready to order',
    bill: 'Request bill',
    water: 'Need water',
  })[type] || 'Need service';
}

export async function ensureWaiterRequestsSchema(db) {
  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS waiter_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_id INTEGER NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
    request_type TEXT NOT NULL DEFAULT 'service' CHECK (request_type IN ('service','order','bill','water')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','acknowledged','completed','cancelled')),
    requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    acknowledged_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    acknowledged_at DATETIME,
    completed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    completed_at DATETIME,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await ensureSqliteTable(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_waiter_requests_one_active_table
    ON waiter_requests(table_id) WHERE status IN ('pending','acknowledged')`);
  await ensureSqliteTable(db, `CREATE INDEX IF NOT EXISTS idx_waiter_requests_active
    ON waiter_requests(status, requested_at)`);
  await ensureSqliteTable(db, `CREATE INDEX IF NOT EXISTS idx_waiter_requests_history
    ON waiter_requests(requested_at DESC, id DESC)`);
}

const requestSelect = `
  SELECT wr.id, wr.table_id, wr.request_type, wr.status, wr.requested_at,
         wr.acknowledged_at, wr.completed_at, wr.updated_at,
         t.table_number, t.floor, t.section,
         au.full_name AS acknowledged_by_name,
         cu.full_name AS completed_by_name
  FROM waiter_requests wr
  JOIN tables t ON t.id = wr.table_id
  LEFT JOIN users au ON au.id = wr.acknowledged_by
  LEFT JOIN users cu ON cu.id = wr.completed_by`;

export async function getWaiterRequest(db, id) {
  await ensureWaiterRequestsSchema(db);
  return db.get(`${requestSelect} WHERE wr.id = ?`, [id]);
}

export async function getActiveWaiterRequestForTable(db, tableId) {
  await ensureWaiterRequestsSchema(db);
  return db.get(
    `${requestSelect}
     WHERE wr.table_id = ? AND wr.status IN ('pending','acknowledged')
     ORDER BY wr.requested_at DESC, wr.id DESC LIMIT 1`,
    [tableId]
  );
}

export async function createWaiterRequest(db, { tableId, requestType = 'service' }) {
  await ensureWaiterRequestsSchema(db);
  const type = WAITER_REQUEST_TYPES.has(requestType) ? requestType : 'service';
  const existing = await getActiveWaiterRequestForTable(db, tableId);
  if (existing) return { request: existing, created: false };

  try {
    const result = await db.run(
      `INSERT INTO waiter_requests (table_id, request_type, status)
       VALUES (?, ?, 'pending')`,
      [tableId, type]
    );
    return { request: await getWaiterRequest(db, result.lastInsertRowid), created: true };
  } catch (error) {
    // The partial unique index settles simultaneous taps from the same table.
    const active = await getActiveWaiterRequestForTable(db, tableId);
    if (active) return { request: active, created: false };
    throw error;
  }
}

export async function listWaiterRequests(db, { status = 'active', limit = 100 } = {}) {
  await ensureWaiterRequestsSchema(db);
  const cappedLimit = Math.min(250, Math.max(1, Number(limit) || 100));
  let where = `wr.status IN ('pending','acknowledged')`;
  if (status === 'pending') where = `wr.status = 'pending'`;
  if (status === 'acknowledged') where = `wr.status = 'acknowledged'`;
  if (status === 'completed') where = `wr.status = 'completed'`;
  if (status === 'cancelled') where = `wr.status = 'cancelled'`;
  if (status === 'all') where = '1=1';

  const rows = await db.all(
    `${requestSelect} WHERE ${where}
     ORDER BY CASE wr.status WHEN 'pending' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END,
              wr.requested_at DESC, wr.id DESC
     LIMIT ?`,
    [cappedLimit]
  );
  const counts = await db.get(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
      COALESCE(SUM(CASE WHEN status = 'acknowledged' THEN 1 ELSE 0 END), 0) AS acknowledged,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completed,
      COALESCE(SUM(CASE WHEN status IN ('pending','acknowledged') THEN 1 ELSE 0 END), 0) AS active
    FROM waiter_requests`);
  return { rows, counts };
}

export async function updateWaiterRequest(db, { id, action, actor }) {
  await ensureWaiterRequestsSchema(db);
  const requestId = Number(id);
  if (!requestId) throw Object.assign(new Error('Waiter request not found.'), { status: 404 });

  if (action === 'acknowledge') {
    await db.run(
      `UPDATE waiter_requests
       SET status = 'acknowledged', acknowledged_by = ?, acknowledged_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'pending'`,
      [actor?.id || null, requestId]
    );
  } else if (action === 'complete') {
    await db.run(
      `UPDATE waiter_requests
       SET status = 'completed', completed_by = ?, completed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status IN ('pending','acknowledged')`,
      [actor?.id || null, requestId]
    );
  } else if (action === 'cancel') {
    await db.run(
      `UPDATE waiter_requests
       SET status = 'cancelled', completed_by = ?, completed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status IN ('pending','acknowledged')`,
      [actor?.id || null, requestId]
    );
  } else {
    throw Object.assign(new Error('Choose acknowledge, complete, or cancel.'), { status: 400 });
  }

  const request = await getWaiterRequest(db, requestId);
  if (!request) throw Object.assign(new Error('Waiter request not found.'), { status: 404 });
  return request;
}
