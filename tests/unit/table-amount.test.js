/**
 * Regression: a table with every item on its order cancelled showed a stale
 * non-zero amount on the floor board (dashboard/waiter) while the POS order
 * screen correctly showed Rs 0. Root cause was two bugs stacked:
 *  1. TableRepository's current_amount/item_count subqueries summed ALL
 *     order_items, including cancelled/voided ones.
 *  2. app/api/admin/pos/tables/route.js used `totalAmount || t.current_amount`
 *     — since 0 is falsy, a correctly-computed zero total fell through to
 *     that stale, uncancelled-inclusive value instead of using 0.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DB_NAME = `table-amount-test-${process.pid}-${Date.now()}.db`;
const dbFullPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'databases', process.env.DB_NAME);

const Database = (await import('../../lib/db/index.js')).default;
const { TableRepository } = await import('../../lib/db/repositories/tables.js');
const db = Database.getInstance();

test.after(async () => {
  await Database.close();
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(`${dbFullPath}${suffix}`); } catch { /* already gone */ }
  }
});

test('TableRepository.getAll() excludes cancelled items from current_amount and item_count', async () => {
  const table = await db.run(`INSERT INTO tables (table_number, status) VALUES ('TEST-AMT', 'occupied')`);
  const tableId = table.lastInsertRowid;
  const order = await db.run(`INSERT INTO orders (order_number, table_id, status) VALUES ('TEST-ORD-AMT', ?, 'pending')`, [tableId]);
  const orderId = order.lastInsertRowid;
  await db.run(`UPDATE tables SET current_order_id = ? WHERE id = ?`, [orderId, tableId]);
  await db.run(
    `INSERT INTO order_items (order_id, item_name, quantity, price, subtotal, status) VALUES (?, 'Cancelled Item', 1, 450, 450, 'cancelled')`,
    [orderId]
  );
  await db.run(
    `INSERT INTO order_items (order_id, item_name, quantity, price, subtotal, status) VALUES (?, 'Live Item', 1, 60, 60, 'pending')`,
    [orderId]
  );

  const rows = await new TableRepository().getAll();
  const row = rows.find((r) => r.table_number === 'TEST-AMT');
  assert.equal(Number(row.current_amount), 60); // not 510
  assert.equal(Number(row.current_order_amount), 60);
  assert.equal(Number(row.item_count), 1); // not 2
});

test('TableRepository.getAll() reports zero, not a stale total, when every item is cancelled', async () => {
  await db.run(`UPDATE order_items SET status = 'cancelled' WHERE order_id = (SELECT id FROM orders WHERE order_number = 'TEST-ORD-AMT')`);
  const rows = await new TableRepository().getAll();
  const row = rows.find((r) => r.table_number === 'TEST-AMT');
  assert.equal(Number(row.current_amount), 0);
  assert.equal(Number(row.item_count), 0);
});
