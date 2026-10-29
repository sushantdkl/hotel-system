import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PosDatabase } from '../../lib/db/index.js';
import { runHotelCommand, hotelSnapshot } from '../../lib/hotel/service.js';
import { prepareHotelAccounting } from '../../lib/hotel/folios.js';
import { dueRoomNights, folioTotals } from '../../lib/hotel/folio-math.js';
import { digitalReceipts } from '../../lib/summary-report.js';

const actor = { id: 1, role: 'admin' };
const now = new Date('2026-10-27T10:00:00Z');
async function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-folios-'));
  const file = path.join(dir, 'test.db');
  const db = new PosDatabase(file);
  const command = (action, key = randomUUID(), date = now) => runHotelCommand(db, action, actor, key, date);
  try {
    await command({ type: 'property', name: 'Test Hotel', taxPercent: '13' });
    await command({ type: 'room', roomId: '101', roomType: 'King', capacity: 2, floor: 1, rate: 100.01 });
    const booking = await command({ type: 'book', guest: 'Test guest', roomId: '101', start: '2026-10-27', end: '2026-10-30', guests: 2 });
    await command({ type: 'checkin', id: booking.id });
    const openDay = async () => {
      await prepareHotelAccounting(db);
      await db.run("INSERT INTO business_days (business_date, status, opening_cash) VALUES ('2026-10-27', 'open', 0)");
      const day = await db.get("SELECT id FROM business_days WHERE status = 'open'");
      const drawer = await db.get('SELECT id FROM cash_drawers ORDER BY id LIMIT 1');
      const session = await db.run("INSERT INTO drawer_sessions (drawer_id, business_day_id, status, opening_amount) VALUES (?, ?, 'open', 0)", [drawer.id, day.id]);
      await db.run("INSERT INTO business_day_sessions (business_day_id, session_number, status, opening_cash, drawer_session_id) VALUES (?, 1, 'open', 0, ?)", [day.id, session.lastInsertRowid]);
    };
    await fn({ db, command, id: booking.id, openDay });
  } finally {
    db.close(); for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(file + suffix)) fs.unlinkSync(file + suffix); fs.rmdirSync(dir);
  }
}

test('room-night policy bills one arrival night, elapsed nights and overdue stays', () => {
  assert.deepEqual(dueRoomNights('2026-10-27', '2026-10-27'), ['2026-10-27']);
  assert.deepEqual(dueRoomNights('2026-10-27', '2026-10-28'), ['2026-10-27']);
  assert.deepEqual(dueRoomNights('2026-10-27', '2026-10-29'), ['2026-10-27', '2026-10-28']);
  assert.deepEqual(dueRoomNights('2028-02-28', '2028-03-01'), ['2028-02-28', '2028-02-29']);
  assert.deepEqual(dueRoomNights('2026-10-28', '2026-10-27'), []);
});

test('room charges are unique, tax/rate snapshots survive changes and ledger balances', async () => fixture(async ({ db, command, id, openDay }) => {
  await openDay();
  await command({ type: 'property', name: 'Changed Hotel', taxPercent: 5 });
  await command({ type: 'room_edit', roomId: '101', roomType: 'King', capacity: 2, floor: 1, rate: 900, version: 1 });
  await Promise.all([command({ type: 'post_nights', id }), command({ type: 'post_nights', id })]);
  const entries = await db.all('SELECT * FROM hotel_folio_entries WHERE reservation_id = ?', [id]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].net_cents, 10001);
  assert.equal(entries[0].tax_cents, 1300);
  assert.equal(entries[0].amount_cents, 11301);
  const journals = await db.all("SELECT je.id, SUM(jl.debit) AS d, SUM(jl.credit) AS c FROM journal_entries je JOIN journal_lines jl ON jl.journal_id = je.id WHERE je.source_type = 'hotel_charge' GROUP BY je.id");
  assert.equal(journals.length, 1);
  assert.equal(journals[0].d, journals[0].c);
  assert.equal(journals[0].d, 113.01);
}));

test('partial/split payments settle receivables without recognizing revenue again', async () => fixture(async ({ db, command, id, openDay }) => {
  await openDay();
  await command({ type: 'post_nights', id });
  await command({ type: 'charge', id, description: 'Laundry', amount: '150.05' });
  const receipt = randomUUID();
  await command({ type: 'payment', id, amount: 100, method: 'Cash', revision: 2 }, receipt);
  await command({ type: 'payment', id, amount: 100, method: 'Cash', revision: 2 }, receipt);
  await command({ type: 'payment', id, amount: 182.57, method: 'Online', revision: 3 });
  const totals = folioTotals(await db.all('SELECT * FROM hotel_folio_entries WHERE reservation_id = ?', [id]));
  assert.deepEqual({ charges: totals.charges, payments: totals.payments, balance: totals.balance, net: totals.net, tax: totals.tax }, { charges: 28257, payments: 28257, balance: 0, net: 25006, tax: 3251 });
  const accounts = await db.all(`SELECT a.code, ROUND(SUM(jl.debit - jl.credit),2) AS balance FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id GROUP BY a.code`);
  const amount = (code) => Number(accounts.find((row) => row.code === code)?.balance || 0);
  assert.equal(amount('1320'), 0);
  assert.equal(amount('1010'), 100);
  assert.equal(amount('1020'), 182.57);
  assert.equal(amount('4030'), -100.01);
  assert.equal(amount('4040'), -150.05);
  assert.equal(amount('4010'), 0, 'restaurant revenue is unchanged');
  const digital = await digitalReceipts(db, '2026-10-27', '2026-10-27');
  assert.equal(digital.totals.hotel_collections, 182.57);
  assert.equal(digital.totals.total, 182.57);
}));

test('closed/stale business days, bad amounts and stale folios cannot accept postings', async () => fixture(async ({ db, command, id, openDay }) => {
  await assert.rejects(command({ type: 'post_nights', id }), /Open today/);
  await openDay();
  await command({ type: 'post_nights', id });
  for (const amount of [0, -1, 'bad', 1.234, 1000001]) await assert.rejects(command({ type: 'payment', id, amount, method: 'Cash', revision: 1 }), /amount/);
  await assert.rejects(command({ type: 'payment', id, amount: 1, method: 'Cash', revision: 0 }), /folio changed/);
  await assert.rejects(command({ type: 'payment', id, amount: 114, method: 'Cash', revision: 1 }), /exceeds/);
  await db.run("UPDATE business_days SET business_date = '2026-10-26' WHERE status = 'open'");
  await assert.rejects(command({ type: 'payment', id, amount: 1, method: 'Cash', revision: 1 }), /Open today/);
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM hotel_folio_entries WHERE kind = 'payment'")).n, 0);
}));

test('checkout finalizes one immutable statement, frees inventory and dispatches one cleaning task', async () => fixture(async ({ db, command, id, openDay }) => {
  await openDay();
  await assert.rejects(command({ type: 'checkout', id, revision: 0 }), /Post all due/);
  await command({ type: 'post_nights', id });
  await assert.rejects(command({ type: 'checkout', id, revision: 1 }), /Settle/);
  await command({ type: 'payment', id, amount: 113.01, method: 'Cash', revision: 1 });
  const key = randomUUID();
  await command({ type: 'checkout', id, revision: 2 }, key);
  await command({ type: 'checkout', id, revision: 2 }, key);
  await assert.rejects(command({ type: 'checkout', id, revision: 2 }), /active/);
  await assert.rejects(command({ type: 'charge', id, description: 'Late change', amount: 1 }), /active/);
  await assert.rejects(command({ type: 'payment', id, amount: 1, method: 'Cash', revision: 2 }), /active/);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM hotel_checkout_statements')).n, 1);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM hotel_housekeeping_tasks')).n, 1);
  const snapshot = await hotelSnapshot(db, now);
  assert.equal(snapshot.bookings[0].status, 'checked_out');
  assert.equal(snapshot.bookings[0].statement.totals.balance, 0);
  assert.equal(snapshot.rooms[0].cleaning, 'dirty');
  const next = await command({ type: 'book', guest: 'Next guest', roomId: '101', start: '2026-10-27', end: '2026-10-28', guests: 2 });
  await assert.rejects(command({ type: 'checkin', id: next.id }), /ready/);
  const task = snapshot.tasks[0];
  for (const version of [1, 2, 3]) await command({ type: 'clean', id: task.id, version });
  await assert.rejects(command({ type: 'clean', id: task.id, version: 3 }), /already completed/);
  await command({ type: 'checkin', id: next.id });
  const final = await hotelSnapshot(db, now);
  assert.equal(final.rooms[0].cleaning, 'ready');
  assert.equal(final.bookings.filter((b) => b.status === 'in_house').length, 1);
}));

test('failed journal or housekeeping writes roll back the whole business command', async () => fixture(async ({ db, command, id, openDay }) => {
  await openDay();
  await db.run("CREATE TRIGGER reject_hotel_journal BEFORE INSERT ON journal_lines BEGIN SELECT RAISE(ABORT, 'test journal failure'); END");
  const postKey = randomUUID();
  await assert.rejects(command({ type: 'post_nights', id }, postKey), /test journal failure/);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM hotel_folio_entries')).n, 0);
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM journal_entries WHERE source_type = 'hotel_charge'")).n, 0);
  await db.run('DROP TRIGGER reject_hotel_journal');
  await command({ type: 'post_nights', id }, postKey);
  await command({ type: 'payment', id, amount: 113.01, method: 'Cash', revision: 1 });
  await db.run("CREATE TRIGGER reject_checkout_cleaning BEFORE INSERT ON hotel_housekeeping_tasks BEGIN SELECT RAISE(ABORT, 'test cleaning failure'); END");
  const closeKey = randomUUID();
  await assert.rejects(command({ type: 'checkout', id, revision: 2 }, closeKey), /test cleaning failure/);
  assert.equal((await db.get('SELECT checked_out_at FROM hotel_reservations WHERE id = ?', [id])).checked_out_at, null);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM hotel_checkout_statements')).n, 0);
  assert.equal((await db.get('SELECT cleaning_status FROM hotel_rooms')).cleaning_status, 'ready');
  await db.run('DROP TRIGGER reject_checkout_cleaning');
  await command({ type: 'checkout', id, revision: 2 }, closeKey);
}));

test('account conflicts and missing bank mappings cannot create an untagged payment', async () => fixture(async ({ db, command, id, openDay }) => {
  await openDay();
  await command({ type: 'post_nights', id });
  await db.run('UPDATE bank_accounts SET is_active = 0');
  await assert.rejects(command({ type: 'payment', id, amount: 10, method: 'Online', revision: 1 }), /active Primary Bank/);
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM hotel_folio_entries WHERE kind = 'payment'")).n, 0);
  await db.run("UPDATE accounts SET subtype = 'custom_account' WHERE code = '1320'");
  await assert.rejects(command({ type: 'payment', id, amount: 10, method: 'Cash', revision: 1 }), /already used/);
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM journal_entries WHERE source_type = 'hotel_payment'")).n, 0);
}));
