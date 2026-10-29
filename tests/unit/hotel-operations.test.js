import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PosDatabase } from '../../lib/db/index.js';
import { runHotelCommand, hotelSnapshot } from '../../lib/hotel/service.js';
import { prepareHotelAccounting } from '../../lib/hotel/folios.js';
import { pickHousekeeper } from '../../lib/hotel/operations.js';
import { clockIn, ensureStaffHrSchema, listOwnerAlerts } from '../../lib/staff-hr.js';
import { deliverPending, ensureNotificationSchema, markRead, myNotifications } from '../../lib/notifications.js';
import { addSecurityEntry, checkOutEntry, ensureSecuritySchema, securityDay } from '../../lib/security.js';
import { isPermissionAllowedSync } from '../../lib/permissions.js';

const owner = { id: 1, role: 'admin' };
const now = new Date('2026-10-28T04:00:00Z');

async function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-ops-'));
  const db = new PosDatabase(path.join(dir, 'test.db'));
  const run = (action, actor = owner) => runHotelCommand(db, action, actor, randomUUID(), now);
  try {
    await ensureStaffHrSchema(db);
    await ensureNotificationSchema(db);
    const add = async (username, role, phone = '') => ({ id: Number((await db.run('INSERT INTO users (username, password_hash, full_name, role, phone) VALUES (?, ?, ?, ?, ?)', [username, 'x', username, role, phone])).lastInsertRowid), role });
    for (const [roomId, floor] of [['101', 1], ['102', 1], ['201', 2]]) await run({ type: 'room', roomId, roomType: 'King', capacity: 2, floor, rate: 100 });
    await prepareHotelAccounting(db);
    await db.run("INSERT INTO business_days (business_date, status, opening_cash) VALUES ('2026-10-28', 'open', 0)");
    const day = await db.get("SELECT id FROM business_days WHERE status = 'open'");
    const drawer = await db.get('SELECT id FROM cash_drawers ORDER BY id LIMIT 1');
    const session = await db.run("INSERT INTO drawer_sessions (drawer_id, business_day_id, status, opening_amount) VALUES (?, ?, 'open', 0)", [drawer.id, day.id]);
    await db.run("INSERT INTO business_day_sessions (business_day_id, session_number, status, opening_cash, drawer_session_id) VALUES (?, 1, 'open', 0, ?)", [day.id, session.lastInsertRowid]);
    await fn({ db, run, add });
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('housekeeper choice balances workload, then floor', () => {
  const a = { id: 1, open: 1, floors: [2] };
  const b = { id: 2, open: 1, floors: [1] };
  const c = { id: 3, open: 0, floors: [] };
  assert.equal(pickHousekeeper([a, b, c], 1).id, 3, 'least busy first');
  assert.equal(pickHousekeeper([a, b], 1).id, 2, 'then already on that floor');
  assert.equal(pickHousekeeper([], 1), null);
});

test('checkout dispatches to an on-shift housekeeper, urgent when someone arrives today, with notification', async () => fixture(async ({ db, run, add }) => {
  const off = await add('off', 'housekeeping');
  const on = await add('on', 'housekeeping', '9800000000');
  await clockIn(db, on, now);
  const stay = await run({ type: 'book', guest: 'Leaving', roomId: '101', start: '2026-10-28', end: '2026-10-29', guests: 1 });
  await run({ type: 'checkin', id: stay.id });
  await run({ type: 'book', guest: 'Arriving', roomId: '101', start: '2026-10-29', end: '2026-10-30', guests: 1 });
  await run({ type: 'post_nights', id: stay.id });
  let snap = await hotelSnapshot(db, now);
  const due = snap.bookings.find((b) => b.id === stay.id);
  await run({ type: 'payment', id: stay.id, method: 'Cash', amount: due.entries.reduce((s, e) => s + e.amount, 0), revision: due.folioRevision });
  snap = await hotelSnapshot(db, now);
  await run({ type: 'checkout', id: stay.id, revision: snap.bookings.find((b) => b.id === stay.id).folioRevision });
  snap = await hotelSnapshot(db, now);
  const task = snap.tasks.find((t) => t.roomId === '101' && t.status === 'dirty');
  assert.equal(task.assignee, 'on');
  assert.equal(task.priority, 'Normal', 'next arrival is tomorrow, not today');
  assert.equal((await myNotifications(db, on.id)).unread, 1);
  assert.equal((await myNotifications(db, off.id)).unread, 0);
  await markRead(db, on.id);
  assert.equal((await myNotifications(db, on.id)).unread, 0);

  // Same-day arrival makes the turnover urgent.
  await run({ type: 'book', guest: 'Today', roomId: '102', start: '2026-10-28', end: '2026-10-29', guests: 1 });
  await run({ type: 'room_status', roomId: '102', version: snap.rooms.find((r) => r.id === '102').version, cleaning: 'dirty', blocked: 0 });
  const urgent = (await hotelSnapshot(db, now)).tasks.find((t) => t.roomId === '102');
  assert.equal(urgent.priority, 'High');
  assert.match(urgent.note, /URGENT/);

  // Manual reassignment.
  await run({ type: 'assign_task', id: urgent.id, userId: off.id });
  assert.equal((await hotelSnapshot(db, now)).tasks.find((t) => t.id === urgent.id).assignee, 'off');
  await assert.rejects(run({ type: 'assign_task', id: urgent.id, userId: owner.id }), /housekeeping staff/);

  // External delivery through the webhook adapter.
  const calls = [];
  const sent = await deliverPending(db, { url: 'https://gateway.test/send', fetchImpl: async (url, init) => { calls.push(JSON.parse(init.body)); return { ok: true }; } });
  assert.equal(sent, 2, 'both tasks for the on-shift housekeeper; staff without a phone are skipped');
  assert.equal(calls[0].to, '9800000000');
  const failed = await db.get("SELECT delivery_error FROM staff_notifications WHERE user_id = ? AND delivery_error IS NOT NULL", [off.id]);
  assert.match(failed.delivery_error, /no phone/);
}));

test('minibar charges only an in-house guest; housekeeping role may post it', async () => fixture(async ({ db, run, add }) => {
  const hk = await add('hk', 'housekeeping');
  await assert.rejects(run({ type: 'minibar', roomId: '101', item: 'Coke', quantity: 2, unitPrice: 80 }, hk), /no in-house guest/);
  const stay = await run({ type: 'book', guest: 'Thirsty', roomId: '101', start: '2026-10-28', end: '2026-10-29', guests: 1 });
  await run({ type: 'checkin', id: stay.id });
  await run({ type: 'minibar', roomId: '101', item: 'Coke', quantity: 2, unitPrice: 80 }, hk);
  const entry = (await hotelSnapshot(db, now)).bookings.find((b) => b.id === stay.id).entries[0];
  assert.deepEqual([entry.label, entry.amount], ['Minibar · Coke x2', 160]);
}));

test('damage report blocks the room, notifies maintenance, and resolving releases it', async () => fixture(async ({ db, run, add }) => {
  const hk = await add('hk', 'housekeeping');
  const tech = await add('tech', 'maintenance');
  const desk = await add('desk', 'receptionist');
  assert.ok(isPermissionAllowedSync('maintenance', 'hotel.maintenance'));
  assert.ok(!isPermissionAllowedSync('watchman', 'hotel.view'), 'watchman does not see guest folios');
  const ticket = await run({ type: 'report_issue', roomId: '201', title: 'Leaking tap', description: 'Bathroom sink', priority: 'urgent', blockRoom: true }, hk);
  let snap = await hotelSnapshot(db, now);
  assert.equal(snap.rooms.find((r) => r.id === '201').blocked, true);
  assert.equal(snap.tickets[0].status, 'open');
  assert.match((await myNotifications(db, tech.id)).items[0].title, /URGENT: Room 201/);
  await assert.rejects(run({ type: 'ticket_update', id: ticket.id, status: 'resolved' }, desk), { status: 403 });
  await run({ type: 'ticket_update', id: ticket.id, status: 'in_progress' }, tech);
  await run({ type: 'ticket_update', id: ticket.id, status: 'resolved', note: 'Washer replaced' }, tech);
  snap = await hotelSnapshot(db, now);
  assert.equal(snap.rooms.find((r) => r.id === '201').blocked, false);
  assert.equal(snap.tickets[0].assignedTo, 'tech');
  // An occupied room cannot be taken out of order.
  const stay = await run({ type: 'book', guest: 'Here', roomId: '101', start: '2026-10-28', end: '2026-10-29', guests: 1 });
  await run({ type: 'checkin', id: stay.id });
  await assert.rejects(run({ type: 'report_issue', roomId: '101', title: 'TV', priority: 'low', blockRoom: true }, hk), /occupied/);
}));

test('security log and watchman emergency alert', async () => fixture(async ({ db, add }) => {
  await ensureSecuritySchema(db);
  const guard = await add('guard', 'watchman');
  await assert.rejects(addSecurityEntry(db, guard, { kind: 'vehicle', name: 'Delivery van' }, now), /vehicle number/);
  await addSecurityEntry(db, guard, { kind: 'vehicle', name: 'Delivery van', vehicleNo: 'ba 2 pa 1234' }, now);
  await addSecurityEntry(db, guard, { kind: 'patrol', name: 'Rear gate' }, now);
  let day = await securityDay(db, '2026-10-28', now);
  assert.equal(day.inside.length, 1);
  assert.equal(day.inside[0].vehicle_no, 'BA 2 PA 1234');
  await checkOutEntry(db, day.inside[0].id, now);
  await assert.rejects(checkOutEntry(db, day.inside[0].id, now), /already/);
  day = await securityDay(db, '2026-10-28', now);
  assert.deepEqual([day.inside.length, day.entries.length], [0, 2]);
  const { createOwnerAlert } = await import('../../lib/staff-hr.js');
  await createOwnerAlert(db, guard, { severity: 'critical', category: 'Security', title: 'Fire alarm', message: 'Kitchen smoke' });
  assert.equal((await listOwnerAlerts(db, owner)).alerts[0].category, 'Security');
}));
