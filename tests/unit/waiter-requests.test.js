import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PosDatabase } from '../../lib/db/index.js';
import {
  createWaiterRequest,
  getActiveWaiterRequestForTable,
  listWaiterRequests,
  updateWaiterRequest,
} from '../../lib/waiter-requests.js';

const dbPath = path.join(os.tmpdir(), `waiter-requests-test-${process.pid}-${Date.now()}.db`);
const db = new PosDatabase(dbPath);
const waiter = { id: 1, full_name: 'Test Waiter', role: 'waiter' };

test.after(() => {
  try { db.close(); } catch { /* already closed */ }
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* already gone */ }
  }
});

let tableId;
let requestId;

test('first QR waiter call creates one pending request', async () => {
  const table = await db.run(`INSERT INTO tables (table_number, floor) VALUES ('WR-1', 'Ground')`);
  tableId = table.lastInsertRowid;
  const result = await createWaiterRequest(db, { tableId, requestType: 'water' });
  requestId = result.request.id;
  assert.equal(result.created, true);
  assert.equal(result.request.status, 'pending');
  assert.equal(result.request.request_type, 'water');
  assert.equal(result.request.table_number, 'WR-1');
});

test('repeated taps return the existing active request instead of duplicating it', async () => {
  const duplicate = await createWaiterRequest(db, { tableId, requestType: 'bill' });
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.request.id, requestId);
  assert.equal(duplicate.request.request_type, 'water');
  const rows = await db.all(`SELECT id FROM waiter_requests WHERE table_id = ?`, [tableId]);
  assert.equal(rows.length, 1);
});

test('staff can acknowledge a call and ownership is visible', async () => {
  const request = await updateWaiterRequest(db, { id: requestId, action: 'acknowledge', actor: waiter });
  assert.equal(request.status, 'acknowledged');
  assert.equal(request.acknowledged_by_name, 'Restaurant Admin');
  const active = await getActiveWaiterRequestForTable(db, tableId);
  assert.equal(active.id, requestId);
});

test('completing a call clears it and permits a fresh call from the same table', async () => {
  const completed = await updateWaiterRequest(db, { id: requestId, action: 'complete', actor: waiter });
  assert.equal(completed.status, 'completed');
  assert.equal(await getActiveWaiterRequestForTable(db, tableId), undefined);

  const next = await createWaiterRequest(db, { tableId, requestType: 'bill' });
  assert.equal(next.created, true);
  assert.notEqual(next.request.id, requestId);
  assert.equal(next.request.request_type, 'bill');

  const active = await listWaiterRequests(db, { status: 'active' });
  assert.equal(Number(active.counts.active), 1);
  assert.equal(active.rows[0].id, next.request.id);
});
