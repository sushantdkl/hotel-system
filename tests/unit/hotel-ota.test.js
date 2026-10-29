import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PosDatabase } from '../../lib/db/index.js';
import { runHotelCommand } from '../../lib/hotel/service.js';
import { exportIcs, otaOverview, parseIcs, receiveWebhook, resolveConflict, saveChannel, saveFeed, syncIcalFeeds } from '../../lib/hotel/ota.js';

const owner = { id: 1, role: 'admin' };
const now = new Date('2026-10-28T04:00:00Z');

async function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-ota-'));
  const db = new PosDatabase(path.join(dir, 'test.db'));
  const run = (action) => runHotelCommand(db, action, owner, randomUUID(), now);
  try {
    for (const [roomId, type] of [['101', 'Deluxe'], ['102', 'Deluxe'], ['201', 'Suite']]) await run({ type: 'room', roomId, roomType: type, capacity: 2, floor: 1, rate: 100 });
    const { id } = await saveChannel(db, { name: 'Booking.com', commissionPercent: 15 });
    const channel = (await otaOverview(db)).channels.find((c) => c.id === id);
    const hook = (body, token = channel.token) => receiveWebhook(db, id, token, body);
    await fn({ db, run, channel, hook });
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const booking = (over = {}) => ({ event: 'new', external_id: 'BDC-1', room_type: 'Deluxe', guest: { name: 'Ota Guest', phone: '9811' }, arrival: '2030-01-10', departure: '2030-01-12', guests: 2, total_amount: 300, prepaid: true, ...over });

test('webhook token is required and events are validated', async () => fixture(async ({ hook }) => {
  await assert.rejects(hook(booking(), 'wrong'), { status: 401 });
  await assert.rejects(hook(booking({ arrival: 'soon' })), /valid YYYY-MM-DD/);
  await assert.rejects(hook(booking({ event: 'hold' })), /new, modified or cancelled/);
}));

test('new booking picks a free room, records commission; overbooking goes to the conflict queue', async () => fixture(async ({ db, hook }) => {
  const first = await hook(booking());
  assert.equal(first.outcome, 'ok');
  const res = await db.get("SELECT r.*, rm.room_number FROM hotel_reservations r JOIN hotel_rooms rm ON rm.id = r.room_id WHERE r.source = 'Booking.com'");
  assert.deepEqual([res.room_number, Number(res.nightly_rate_cents), res.guest_name], ['101', 15000, 'Ota Guest']);
  const ota = (await otaOverview(db)).bookings[0];
  assert.deepEqual([ota.total, ota.commission, ota.prepaid], [300, 45, true]);
  // Repeating the same event does not double-book.
  await hook(booking());
  assert.equal((await db.get("SELECT COUNT(*) AS c FROM hotel_reservations WHERE source = 'Booking.com'")).c, 1);
  await hook(booking({ external_id: 'BDC-2' }));
  const third = await hook(booking({ external_id: 'BDC-3' }));
  assert.equal(third.outcome, 'conflict');
  assert.match(third.message, /Overbooking/);
  const { conflicts } = await otaOverview(db);
  assert.equal(conflicts.length, 1);
  assert.equal((await db.get("SELECT COUNT(*) AS c FROM hotel_reservations WHERE source = 'Booking.com'")).c, 2, 'never overbooked');
  // Free a room by cancelling BDC-2, then retry the conflict.
  await hook({ event: 'cancelled', external_id: 'BDC-2' });
  const retried = await resolveConflict(db, owner, conflicts[0].id, { action: 'retry' });
  assert.match(retried.message, /Applied/);
  assert.equal((await otaOverview(db)).conflicts.length, 0);
}));

test('modification moves dates; cancellation with a deposit waits for review', async () => fixture(async ({ db, run, hook }) => {
  await hook(booking({ room: '201', room_type: '' }));
  const modified = await hook(booking({ event: 'modified', room: '201', room_type: '', arrival: '2030-01-11', departure: '2030-01-14', total_amount: 450 }));
  assert.match(modified.message, /room 201, 2030-01-11 to 2030-01-14/);
  const res = await db.get("SELECT id, arrival_date, nightly_rate_cents FROM hotel_reservations WHERE source = 'Booking.com'");
  assert.deepEqual([res.arrival_date, Number(res.nightly_rate_cents)], ['2030-01-11', 15000]);
  // Put a deposit on it: OTA cancellation must not silently drop money.
  const { prepareHotelAccounting } = await import('../../lib/hotel/folios.js');
  await prepareHotelAccounting(db);
  await db.run("INSERT INTO business_days (business_date, status, opening_cash) VALUES ('2026-10-28', 'open', 0)");
  const day = await db.get("SELECT id FROM business_days WHERE status = 'open'");
  const drawer = await db.get('SELECT id FROM cash_drawers ORDER BY id LIMIT 1');
  const session = await db.run("INSERT INTO drawer_sessions (drawer_id, business_day_id, status, opening_amount) VALUES (?, ?, 'open', 0)", [drawer.id, day.id]);
  await db.run("INSERT INTO business_day_sessions (business_day_id, session_number, status, opening_cash, drawer_session_id) VALUES (?, 1, 'open', 0, ?)", [day.id, session.lastInsertRowid]);
  await run({ type: 'payment', id: res.id, method: 'Cash', amount: 50, revision: 0 });
  const cancel = await hook({ event: 'cancelled', external_id: 'BDC-1' });
  assert.equal(cancel.outcome, 'conflict');
  assert.match(cancel.message, /deposit or charges/);
}));

test('iCal parse, import with echo protection and removal, and private export', async () => fixture(async ({ db, run, channel }) => {
  const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:abc@airbnb\r\nDTSTART;VALUE=DATE:20301201\r\nDTEND;VALUE=DATE:20301203\r\nSUMMARY:Reserved\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:echo@x\r\nDTSTART;VALUE=DATE:20301210\r\nDTEND;VALUE=DATE:20301211\r\nSUMMARY:Not available\r\nEND:VEVENT\r\nEND:VCALENDAR';
  assert.deepEqual(parseIcs(ics).map((e) => [e.uid, e.start, e.end]), [['abc@airbnb', '2030-12-01', '2030-12-03'], ['echo@x', '2030-12-10', '2030-12-11']]);
  // A direct booking on the echo dates must not be re-imported as an OTA booking.
  await run({ type: 'book', guest: 'Direct', roomId: '102', start: '2030-12-10', end: '2030-12-11', guests: 1 });
  await saveFeed(db, { channelId: channel.id, roomNumber: '102', importUrl: 'https://ical.test/102.ics' });
  let body = ics;
  const fetchImpl = async () => ({ ok: true, text: async () => body });
  const first = await syncIcalFeeds(db, { fetchImpl, now });
  assert.equal(first.applied, 1);
  assert.equal((await db.get("SELECT COUNT(*) AS c FROM hotel_reservations WHERE source = 'Booking.com'")).c, 1);
  assert.equal((await syncIcalFeeds(db, { fetchImpl, now })).applied, 0, 'unchanged feed is a no-op');
  body = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR';
  await syncIcalFeeds(db, { fetchImpl, now });
  assert.equal((await db.get("SELECT status FROM hotel_reservations WHERE source = 'Booking.com'")).status, 'cancelled');
  const failing = await syncIcalFeeds(db, { fetchImpl: async () => ({ ok: false, status: 404 }), now });
  assert.equal(failing.errors, 1);

  const feed = (await otaOverview(db)).feeds[0];
  const out = await exportIcs(db, feed.exportToken, now);
  assert.match(out, /DTSTART;VALUE=DATE:20301210/);
  assert.doesNotMatch(out, /Direct/, 'no guest names in the export');
  await assert.rejects(exportIcs(db, 'nope', now), { status: 404 });
}));
