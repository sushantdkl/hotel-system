import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PosDatabase } from '../../lib/db/index.js';
import {
  applyLeave, canDecideLeave, cancelLeave, clockIn, clockOut, clockedInNow, createOwnerAlert, decideLeave,
  ensureStaffHrSchema, leaveQueue, listOwnerAlerts, staffMonth, updateOwnerAlert,
} from '../../lib/staff-hr.js';
import { saveAttendanceRegister } from '../../lib/hrm.js';

const now = new Date('2026-10-28T03:00:00Z'); // 08:45 Kathmandu

async function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'staff-hr-'));
  const db = new PosDatabase(path.join(dir, 'test.db'));
  try {
    await ensureStaffHrSchema(db);
    const add = async (username, role) => {
      const r = await db.run('INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)', [username, 'x', username, role]);
      return { id: Number(r.lastInsertRowid), role, full_name: username };
    };
    const owner = { ...(await db.get("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")), role: 'admin' };
    await fn({ db, owner, manager: await add('mgr', 'manager'), waiter: await add('w1', 'waiter'), waiter2: await add('w2', 'waiter'), desk: await add('desk', 'receptionist') });
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('approval routing: nobody decides their own leave; manager leave goes to the owner', () => {
  const owner = { id: 1, role: 'admin' };
  const manager = { id: 2, role: 'manager' };
  const waiter = { id: 3, role: 'waiter' };
  assert.ok(canDecideLeave(manager, waiter));
  assert.ok(canDecideLeave(owner, manager));
  assert.ok(!canDecideLeave(manager, manager));
  assert.ok(!canDecideLeave({ id: 9, role: 'manager' }, manager), 'another manager cannot approve a manager');
  assert.ok(!canDecideLeave(waiter, { id: 4, role: 'waiter' }), 'waiters cannot approve');
  assert.ok(!canDecideLeave(manager, owner));
});

test('clock in/out marks attendance and totals hours with overtime', async () => fixture(async ({ db, waiter }) => {
  await clockIn(db, waiter, now);
  await assert.rejects(clockIn(db, waiter, now), /already clocked in/);
  assert.equal((await clockedInNow(db)).length, 1);
  await clockOut(db, waiter, { note: 'Table 4 handed to w2' }, new Date(now.getTime() + 9.5 * 3600000));
  await assert.rejects(clockOut(db, waiter, {}, now), /not clocked in/);
  const month = await staffMonth(db, waiter.id, '2026-10', now);
  assert.deepEqual(month.days, [{ date: '2026-10-28', status: 'present', hours: 9.5 }]);
  assert.equal(month.totals.overtime, 1.5);
  assert.equal(month.clockedInSince, null);
}));

test('leave request lifecycle marks approved days as leave', async () => fixture(async ({ db, owner, manager, waiter, waiter2 }) => {
  await assert.rejects(applyLeave(db, owner, { type: 'casual', start: '2026-11-01', reason: 'x' }, now), /owner/);
  await assert.rejects(applyLeave(db, waiter, { type: 'casual', start: '2026-10-01', reason: 'x' }, now), /past/);
  await applyLeave(db, waiter, { type: 'sick', start: '2026-11-02', end: '2026-11-03', reason: 'Fever' }, now);
  await assert.rejects(applyLeave(db, waiter, { type: 'casual', start: '2026-11-03', end: '2026-11-04', reason: 'x' }, now), /already/);
  await applyLeave(db, waiter2, { type: 'casual', start: '2026-11-03', end: '2026-11-03', reason: 'Wedding' }, now);

  const queue = await leaveQueue(db, manager);
  const mine = queue.find((r) => r.user_id === waiter.id);
  assert.equal(mine.overlapping, 1, 'coverage warning sees the other waiter');
  assert.equal(mine.days, 2);
  assert.ok(mine.canDecide);

  await decideLeave(db, manager, mine.id, { decision: 'approved' });
  await assert.rejects(decideLeave(db, manager, mine.id, { decision: 'rejected' }), /already decided/);
  const statuses = await db.all('SELECT business_date, status FROM attendance WHERE user_id = ? ORDER BY business_date', [waiter.id]);
  assert.deepEqual(statuses.map((r) => [r.business_date, r.status]), [['2026-11-02', 'leave'], ['2026-11-03', 'leave']]);

  const other = queue.find((r) => r.user_id === waiter2.id);
  await cancelLeave(db, waiter2, other.id);
  await assert.rejects(cancelLeave(db, waiter2, other.id), /pending/);
}));

test("a manager's own leave and attendance are owner-only", async () => fixture(async ({ db, owner, manager, waiter }) => {
  await applyLeave(db, manager, { type: 'casual', start: '2026-11-05', reason: 'Family' }, now);
  assert.equal((await leaveQueue(db, manager)).length, 0, 'manager does not see their own request');
  const [request] = await leaveQueue(db, owner);
  await assert.rejects(decideLeave(db, manager, request.id, { decision: 'approved' }), { status: 403 });
  await decideLeave(db, owner, request.id, { decision: 'rejected', note: 'Busy week' });

  // Register save by a manager skips their own row and the owner's, keeps the rest.
  await saveAttendanceRegister(db, { business_date: '2026-10-28', entries: [
    { user_id: manager.id, status: 'present' }, { user_id: owner.id, status: 'absent' }, { user_id: waiter.id, status: 'half_day' },
  ] }, manager.id, 'manager');
  const rows = await db.all("SELECT user_id, status FROM attendance WHERE business_date = '2026-10-28'");
  assert.deepEqual(rows.map((r) => [r.user_id, r.status]), [[waiter.id, 'half_day']]);
}));

test('owner alerts: manager sends, owner acknowledges and resolves', async () => fixture(async ({ db, owner, manager, desk }) => {
  await assert.rejects(createOwnerAlert(db, desk, { severity: 'urgent', title: 'x', message: 'y' }), { status: 403 });
  await assert.rejects(createOwnerAlert(db, manager, { severity: 'huge', title: 'x', message: 'y' }), /severity/);
  await createOwnerAlert(db, manager, { severity: 'critical', category: 'Cash dispute', title: 'Drawer short', message: 'Rs 2,000 short at close', link: 'Cash Counter cam' });
  const forOwner = await listOwnerAlerts(db, owner);
  assert.equal(forOwner.open, 1);
  assert.equal(forOwner.alerts[0].created_by_name, 'mgr');
  await assert.rejects(updateOwnerAlert(db, manager, forOwner.alerts[0].id, 'resolved'), { status: 403 });
  await updateOwnerAlert(db, owner, forOwner.alerts[0].id, 'acknowledged');
  await updateOwnerAlert(db, owner, forOwner.alerts[0].id, 'resolved');
  await assert.rejects(updateOwnerAlert(db, owner, forOwner.alerts[0].id, 'resolved'), /already resolved/);
  assert.equal((await listOwnerAlerts(db, manager)).alerts[0].status, 'resolved');
}));
