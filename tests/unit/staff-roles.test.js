import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { PosDatabase } from '../../lib/db/index.js';
import { canManageAccount, canSignInTo } from '../../lib/roles.js';
import { isPermissionAllowedSync, listRolePermissions, setRolePermissions } from '../../lib/permissions.js';
import { runHotelCommand } from '../../lib/hotel/service.js';
import { ensureAccountingSchema, postJournal } from '../../lib/accounting.js';
import { ledgerTotals } from '../../lib/overview.js';

const now = new Date('2026-10-27T10:00:00Z');

function withFile(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'staff-roles-'));
  const file = path.join(dir, 'test.db');
  return Promise.resolve(fn(file)).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
}

test('login sides and owner-only account management', () => {
  assert.ok(canSignInTo('hotel', 'receptionist'));
  assert.ok(!canSignInTo('restaurant', 'housekeeping'));
  assert.ok(!canSignInTo('hotel', 'waiter'));
  assert.ok(canSignInTo('hotel', 'manager') && canSignInTo('restaurant', 'admin'));
  assert.ok(canManageAccount('admin', 'manager'));
  assert.ok(!canManageAccount('manager', 'manager'));
  assert.ok(!canManageAccount('manager', 'admin'));
  assert.ok(canManageAccount('manager', 'receptionist'));
});

test('hotel permission defaults and scoping', async () => withFile(async (file) => {
  const db = new PosDatabase(file);
  try {
    assert.ok(isPermissionAllowedSync('manager', 'hotel.setup'));
    assert.ok(isPermissionAllowedSync('receptionist', 'hotel.front_desk'));
    assert.ok(!isPermissionAllowedSync('housekeeping', 'hotel.front_desk'));
    assert.ok(isPermissionAllowedSync('housekeeping', 'hotel.housekeeping'));
    assert.ok(!isPermissionAllowedSync('receptionist', 'orders.create'));
    assert.ok(!isPermissionAllowedSync('waiter', 'hotel.view'));
    // Restaurant permissions cannot be granted to hotel roles, or the reverse.
    await assert.rejects(setRolePermissions(db, [{ role: 'receptionist', key: 'bills.void', allowed: true }], { id: 1 }), /No valid permission/);
    await assert.rejects(setRolePermissions(db, [{ role: 'waiter', key: 'hotel.view', allowed: true }], { id: 1 }), /No valid permission/);
    const { matrix } = await setRolePermissions(db, [{ role: 'receptionist', key: 'hotel.setup', allowed: true }], { id: 1 });
    assert.equal(matrix.receptionist['hotel.setup'], true);
    assert.ok((await listRolePermissions(db)).roles.includes('housekeeping'));
  } finally { db.close(); }
}));

test('hotel commands are gated by role permission', async () => withFile(async (file) => {
  const db = new PosDatabase(file);
  const run = (action, role) => runHotelCommand(db, action, { id: 1, role }, randomUUID(), now);
  try {
    await assert.rejects(run({ type: 'room', roomId: '101', floor: 1, roomType: 'Deluxe', capacity: 2, rate: 100 }, 'receptionist'), { status: 403 });
    await run({ type: 'room', roomId: '101', floor: 1, roomType: 'Deluxe', capacity: 2, rate: 100 }, 'manager');
    const booking = { type: 'book', roomId: '101', guest: 'Guest', start: '2026-10-27', end: '2026-10-28', guests: 1 };
    await assert.rejects(run(booking, 'housekeeping'), { status: 403 });
    await assert.rejects(run(booking, 'cashier'), { status: 403 });
    assert.match((await run(booking, 'receptionist')).message, /Reservation/);
  } finally { db.close(); }
}));

test('existing SQLite users table is upgraded to accept the new roles', async () => withFile((file) => {
  const require = createRequire(import.meta.url);
  const Sqlite = require('better-sqlite3');
  const old = new Sqlite(file);
  old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('admin', 'cashier', 'waiter', 'kitchen')), is_active INTEGER DEFAULT 1);
    CREATE TABLE sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, token TEXT);
    INSERT INTO users (username, password_hash, full_name, role) VALUES ('owner', 'x', 'Owner', 'admin');
    INSERT INTO sessions (user_id, token) VALUES (1, 't');`);
  old.close();
  const db = new PosDatabase(file);
  try {
    db.db.prepare("INSERT INTO users (username, password_hash, full_name, role) VALUES ('desk', 'x', 'Desk', 'receptionist')").run();
    assert.throws(() => db.db.prepare("INSERT INTO users (username, password_hash, full_name, role) VALUES ('bad', 'x', 'Bad', 'boss')").run());
    assert.equal(db.db.prepare('SELECT COUNT(*) AS c FROM sessions').get().c, 1);
    assert.equal(db.db.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { db.close(); }
}));

test('combined ledger totals split hotel and restaurant income', async () => withFile(async (file) => {
  const db = new PosDatabase(file);
  try {
    await ensureAccountingSchema(db);
    await db.run("INSERT INTO accounts (code, name, type) VALUES ('1320', 'Hotel Guest Receivables', 'asset'), ('4030', 'Hotel Room Revenue', 'income')");
    const post = (code, amount) => postJournal(db, { entry_date: '2026-10-27', memo: 'test', lines: [{ code: '1010', debit: amount, credit: 0 }, { code, debit: 0, credit: amount }] });
    await post('4010', 1200);
    await post('4030', 3000);
    await postJournal(db, { entry_date: '2026-10-27', memo: 'expense', lines: [{ code: '5020', debit: 500, credit: 0 }, { code: '1010', debit: 0, credit: 500 }] });
    const totals = await ledgerTotals(db, '2026-10-27', '2026-10-27');
    assert.equal(totals.restaurant, 1200);
    assert.equal(totals.hotel, 3000);
    assert.equal(totals.hotelRooms, 3000);
    assert.equal(totals.revenue, 4200);
    assert.equal(totals.expenses, 500);
    assert.equal(totals.net, 3700);
    assert.deepEqual(await ledgerTotals(db, '2026-10-28', '2026-10-28'), { restaurant: 0, hotel: 0, hotelRooms: 0, revenue: 0, expenses: 0, net: 0 });
  } finally { db.close(); }
}));
