/** Delivery executive roster + order assignment. */

import { ensureSqliteTable } from '@/lib/db/ensure-sqlite-table.js';
import { ensureColumn } from '@/lib/db/schema-helpers.js';

export const DELIVERY_STATUSES = ['available', 'busy', 'off_duty'];

export async function ensureDeliverySchema(db) {
  await ensureSqliteTable(
    db,
    `CREATE TABLE IF NOT EXISTS delivery_executives (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      status TEXT NOT NULL DEFAULT 'available',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  );
  await ensureColumn(db, 'orders', 'delivery_executive_id', 'INTEGER');
}

export async function listDeliveryExecutives(db, { search } = {}) {
  await ensureDeliverySchema(db);
  const params = [];
  let where = '';
  if (search && search.trim()) {
    where = 'WHERE (de.name LIKE ? OR de.phone LIKE ? OR de.email LIKE ?)';
    const q = `%${search.trim()}%`;
    params.push(q, q, q);
  }
  const rows = await db.all(
    `SELECT de.id, de.name, de.phone, de.email, de.status, de.created_at,
            COUNT(o.id) AS total_orders
     FROM delivery_executives de
     LEFT JOIN orders o ON o.delivery_executive_id = de.id
     ${where}
     GROUP BY de.id, de.name, de.phone, de.email, de.status, de.created_at
     ORDER BY de.name ASC`,
    params
  );
  return (rows || []).map((r) => ({ ...r, total_orders: Number(r.total_orders || 0) }));
}

export async function createDeliveryExecutive(db, { name, phone, email }) {
  await ensureDeliverySchema(db);
  const cleanName = String(name || '').trim();
  if (!cleanName) throw Object.assign(new Error('Name is required.'), { status: 400 });
  const result = await db.run(
    `INSERT INTO delivery_executives (name, phone, email, status) VALUES (?, ?, ?, 'available')`,
    [cleanName, phone?.trim() || null, email?.trim() || null]
  );
  return db.get('SELECT * FROM delivery_executives WHERE id = ?', [result.lastInsertRowid]);
}

export async function updateDeliveryExecutive(db, id, { name, phone, email, status }) {
  await ensureDeliverySchema(db);
  const existing = await db.get('SELECT * FROM delivery_executives WHERE id = ?', [id]);
  if (!existing) throw Object.assign(new Error('Delivery executive not found.'), { status: 404 });
  if (status && !DELIVERY_STATUSES.includes(status)) {
    throw Object.assign(new Error('Invalid status.'), { status: 400 });
  }
  await db.run(
    `UPDATE delivery_executives SET name = ?, phone = ?, email = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [
      name != null ? String(name).trim() : existing.name,
      phone != null ? (phone.trim() || null) : existing.phone,
      email != null ? (email.trim() || null) : existing.email,
      status || existing.status,
      id,
    ]
  );
  return db.get('SELECT * FROM delivery_executives WHERE id = ?', [id]);
}

export async function getExecutiveOrders(db, id) {
  await ensureDeliverySchema(db);
  return db.all(
    `SELECT id, order_number, order_type, status, delivery_address, customer_name, customer_phone,
            created_at, completed_at,
            (SELECT b.grand_total FROM bills b WHERE b.order_id = orders.id ORDER BY b.id DESC LIMIT 1) AS total
     FROM orders
     WHERE delivery_executive_id = ?
     ORDER BY created_at DESC
     LIMIT 200`,
    [id]
  );
}

export async function assignOrderExecutive(db, orderId, executiveId) {
  await ensureDeliverySchema(db);
  if (executiveId != null) {
    const exec = await db.get('SELECT id FROM delivery_executives WHERE id = ?', [executiveId]);
    if (!exec) throw Object.assign(new Error('Delivery executive not found.'), { status: 404 });
  }
  await db.run(
    `UPDATE orders SET delivery_executive_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [executiveId || null, orderId]
  );
}
