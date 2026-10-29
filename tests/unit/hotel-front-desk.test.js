import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PosDatabase } from '../../lib/db/index.js';
import { runHotelCommand, hotelSnapshot } from '../../lib/hotel/service.js';
import { prepareHotelAccounting } from '../../lib/hotel/folios.js';
import { addGuestDocument, getGuest, getGuestDocument, listGuests, saveGuest } from '../../lib/hotel/guests.js';
import { accountBalance } from '../../lib/accounting.js';

const owner = { id: 1, role: 'admin' };
const desk = { id: 1, role: 'receptionist' };
const now = new Date('2026-10-28T04:00:00Z');

async function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-front-desk-'));
  const db = new PosDatabase(path.join(dir, 'test.db'));
  const run = (action, actor = owner, date = now) => runHotelCommand(db, action, actor, randomUUID(), date);
  try {
    for (const [roomId, rate] of [['101', 100], ['102', 100], ['103', 150]]) await run({ type: 'room', roomId, roomType: 'King', capacity: 2, floor: 1, rate });
    const openDay = async () => {
      await prepareHotelAccounting(db);
      await db.run("INSERT INTO business_days (business_date, status, opening_cash) VALUES ('2026-10-28', 'open', 0)");
      const day = await db.get("SELECT id FROM business_days WHERE status = 'open'");
      const drawer = await db.get('SELECT id FROM cash_drawers ORDER BY id LIMIT 1');
      const session = await db.run("INSERT INTO drawer_sessions (drawer_id, business_day_id, status, opening_amount) VALUES (?, ?, 'open', 0)", [drawer.id, day.id]);
      await db.run("INSERT INTO business_day_sessions (business_day_id, session_number, status, opening_cash, drawer_session_id) VALUES (?, 1, 'open', 0, ?)", [day.id, session.lastInsertRowid]);
    };
    const stay = async (id) => (await hotelSnapshot(db, now)).bookings.find((b) => b.id === id);
    await fn({ db, run, openDay, stay });
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('bookings create or reuse guest profiles; blacklisted guests cannot book', async () => fixture(async ({ db, run }) => {
  const first = await run({ type: 'book', guest: 'Asha Rai', phone: '9800000001', roomId: '101', start: '2026-10-28', end: '2026-10-29', guests: 1 }, desk);
  await run({ type: 'book', guest: 'Asha Rai', phone: '9800000001', roomId: '102', start: '2026-11-01', end: '2026-11-02', guests: 1 }, desk);
  const [guest] = await listGuests(db, 'asha');
  assert.equal(guest.stays, 2, 'second booking reused the same profile');
  await saveGuest(db, owner, { id: guest.id, name: 'Asha Rai', phone: '9800000001', blacklisted: true });
  await assert.rejects(run({ type: 'book', guestId: guest.id, roomId: '103', start: '2026-11-05', end: '2026-11-06', guests: 1 }, desk), { status: 403 });
  assert.equal((await getGuest(db, guest.id)).stays[0].id.startsWith('HT-'), true);
  assert.ok(first.id);
}));

test('group booking reserves several rooms atomically', async () => fixture(async ({ db, run }) => {
  const result = await run({ type: 'book', guest: 'Tour Group', roomIds: ['101', '102'], start: '2026-10-29', end: '2026-10-31', guests: 2 }, desk);
  assert.match(result.message, /Group booking GRP-.*2 rooms/);
  const rows = await db.all('SELECT group_id FROM hotel_reservations');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].group_id, rows[1].group_id);
  // 102 is now taken: a group including it fails and saves nothing.
  await assert.rejects(run({ type: 'book', guest: 'Another', roomIds: ['103', '102'], start: '2026-10-30', end: '2026-10-31', guests: 1 }, desk), /Room 102 is unavailable/);
  assert.equal((await db.get('SELECT COUNT(*) AS c FROM hotel_reservations')).c, 2);
}));

test('rate override needs permission, is audited and alerts the owner', async () => fixture(async ({ db, run }) => {
  const booking = { type: 'book', guest: 'VIP', roomId: '101', start: '2026-10-28', end: '2026-10-29', guests: 1, rate: 80 };
  await assert.rejects(run(booking, desk), /cannot override/);
  await run(booking, { id: 1, role: 'manager' });
  assert.equal((await db.get('SELECT nightly_rate_cents FROM hotel_reservations')).nightly_rate_cents, 8000);
  const alert = await db.get('SELECT severity, message FROM owner_alerts');
  assert.equal(alert.severity, 'medium');
  assert.match(alert.message, /room 101 from 100 to 80/);
  assert.ok(await db.get("SELECT id FROM hotel_audit_events WHERE action = 'rate_override'"));
  // Same as tariff is not an override.
  await run({ ...booking, roomId: '102', rate: 100 }, desk);
}));

test('room move dirties the vacated room; extend and shorten respect conflicts and posted nights', async () => fixture(async ({ db, run, openDay, stay }) => {
  await openDay();
  const a = await run({ type: 'book', guest: 'Mover', roomId: '101', start: '2026-10-28', end: '2026-10-30', guests: 1 });
  await run({ type: 'checkin', id: a.id });
  await run({ type: 'book', guest: 'Next', roomId: '103', start: '2026-10-30', end: '2026-11-01', guests: 1 });
  await assert.rejects(run({ type: 'move', id: a.id, roomId: '103' }), /reason/);
  await run({ type: 'move', id: a.id, roomId: '103', reason: 'Guest request', rateDecision: 'keep' });
  assert.equal((await stay(a.id)).roomId, '103');
  const old = (await hotelSnapshot(db, now)).rooms.find((r) => r.id === '101');
  assert.equal(old.cleaning, 'dirty');
  assert.equal((await db.get("SELECT COUNT(*) AS c FROM hotel_housekeeping_tasks WHERE status = 'dirty'")).c, 1);
  await assert.rejects(run({ type: 'change_dates', id: a.id, end: '2026-10-31' }), /booked for some of those dates/);
  await run({ type: 'post_nights', id: a.id });
  await assert.rejects(run({ type: 'change_dates', id: a.id, end: '2026-10-28' }), /valid arrival and departure/);
  await run({ type: 'change_dates', id: a.id, end: '2026-10-29' });
  assert.equal((await stay(a.id)).end, '2026-10-29');
}));

test('advance deposit, cancellation guard and refund keep the ledger balanced', async () => fixture(async ({ db, run, openDay, stay }) => {
  await openDay();
  const b = await run({ type: 'book', guest: 'Deposit', roomId: '101', start: '2026-11-01', end: '2026-11-03', guests: 1 });
  await assert.rejects(run({ type: 'payment', id: b.id, method: 'Cash', amount: 250, revision: 0 }), /cannot exceed/);
  await run({ type: 'payment', id: b.id, method: 'Cash', amount: 150, revision: 0 });
  assert.equal((await stay(b.id)).payments[0].label, 'Advance deposit · Cash');
  await assert.rejects(run({ type: 'cancel', id: b.id }), /Refund the deposit/);
  await assert.rejects(run({ type: 'refund', id: b.id, method: 'Cash', amount: 200, revision: 1 }), /credit balance/);
  await run({ type: 'refund', id: b.id, method: 'Cash', amount: 150, revision: 1 });
  assert.equal(await accountBalance(db, '1320'), 0);
  assert.equal(await accountBalance(db, '1010'), 0);
  const refunded = await stay(b.id);
  assert.ok(refunded.payments.find((p) => p.refund));
  // The deposit sat in 2150 Guest Advance Deposits (a liability, never revenue); the refund cleared it.
  assert.equal(await accountBalance(db, '2150'), 0);
  await run({ type: 'cancel', id: b.id });
  assert.equal((await stay(b.id)).status, 'cancelled');
}));

test('ID documents are validated and stored privately', async () => fixture(async ({ db }) => {
  const { id } = await saveGuest(db, owner, { name: 'Doc Guest', idType: 'Passport', idNumber: 'P123', email: 'doc@example.com' });
  await assert.rejects(addGuestDocument(db, owner, id, { label: 'x', fileName: 'a.exe', mime: 'application/x-msdownload', bytes: new Uint8Array([1]) }), /JPG, PNG/);
  await assert.rejects(addGuestDocument(db, owner, id, { label: 'x', fileName: 'big.png', mime: 'image/png', bytes: new Uint8Array(2 * 1024 * 1024 + 1) }), /2 MB/);
  const doc = await addGuestDocument(db, owner, id, { label: 'Passport', fileName: 'passport.png', mime: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]) });
  const file = await getGuestDocument(db, doc.id);
  assert.deepEqual([...file.bytes], [137, 80, 78, 71]);
  assert.equal((await getGuest(db, id)).documents[0].label, 'Passport');
  await assert.rejects(saveGuest(db, owner, { name: 'Bad', email: 'nope' }), /valid email/);
}));
