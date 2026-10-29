import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PosDatabase } from '../../lib/db/index.js';
import { runHotelCommand, hotelSnapshot } from '../../lib/hotel/service.js';
import { prepareHotelAccounting } from '../../lib/hotel/folios.js';
import { priceStay, seasonFor } from '../../lib/hotel/rates.js';
import { ensureAccountingSchema, postJournal } from '../../lib/accounting.js';
import { ensureExpenseCategorySchema, createExpenseCategory, updateExpenseCategory } from '../../lib/expense-categories.js';
import { businessReport, businessReportCsv } from '../../lib/business-report.js';
import { ensureStaffHrSchema, payrollAttendance, clockIn, clockOut } from '../../lib/staff-hr.js';
import { ensurePayrollSchema } from '../../lib/payroll.js';

const owner = { id: 1, role: 'admin' };

async function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase5-'));
  const db = new PosDatabase(path.join(dir, 'test.db'));
  const run = (action, now) => runHotelCommand(db, action, owner, randomUUID(), now);
  const openDay = async (date) => {
    await prepareHotelAccounting(db);
    await db.run("UPDATE business_days SET status = 'closed' WHERE status = 'open'");
    await db.run("INSERT INTO business_days (business_date, status, opening_cash) VALUES (?, 'open', 0)", [date]);
    const day = await db.get("SELECT id FROM business_days WHERE status = 'open'");
    const drawer = await db.get('SELECT id FROM cash_drawers ORDER BY id LIMIT 1');
    const session = await db.run("INSERT INTO drawer_sessions (drawer_id, business_day_id, status, opening_amount) VALUES (?, ?, 'open', 0)", [drawer.id, day.id]);
    await db.run("INSERT INTO business_day_sessions (business_day_id, session_number, status, opening_cash, drawer_session_id) VALUES (?, 1, 'open', 0, ?)", [day.id, session.lastInsertRowid]);
  };
  try { await fn({ db, run, openDay }); } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

test('season and plan pricing per night', () => {
  const seasons = [
    { start: '2026-12-20', end: '2026-12-31', roomType: '', adjustBps: 2000 },
    { start: '2026-12-24', end: '2026-12-25', roomType: 'Suite', adjustBps: 5000 },
  ];
  assert.equal(seasonFor(seasons, '2026-12-24', 'Suite').adjustBps, 5000, 'room-type season wins');
  assert.equal(seasonFor(seasons, '2026-12-24', 'King').adjustBps, 2000);
  const nights = priceStay({ baseCents: 10000, roomType: 'King', start: '2026-12-19', end: '2026-12-21', seasons, supplementCents: 500 });
  assert.deepEqual(nights, [{ date: '2026-12-19', cents: 10500 }, { date: '2026-12-20', cents: 12500 }]);
});

test('bookings snapshot seasonal prices; night audit posts them and marks no-shows', async () => fixture(async ({ db, run, openDay }) => {
  const day1 = new Date('2026-10-28T04:00:00Z');
  const day2 = new Date('2026-10-30T04:00:00Z');
  await run({ type: 'room', roomId: '101', roomType: 'King', capacity: 2, floor: 1, rate: 100 }, day1);
  await run({ type: 'room', roomId: '102', roomType: 'King', capacity: 2, floor: 1, rate: 100 }, day1);
  await run({ type: 'season', name: 'Festival', start: '2026-10-29', end: '2026-10-31', percent: 50 }, day1);
  await run({ type: 'plan', name: 'Breakfast included', supplement: 10 }, day1);
  const stay = await run({ type: 'book', guest: 'Season Guest', roomId: '101', start: '2026-10-28', end: '2026-10-30', guests: 1, meal: 'Breakfast included' }, day1);
  await run({ type: 'book', guest: 'Never Came', roomId: '102', start: '2026-10-28', end: '2026-10-29', guests: 1 }, day1);
  // Changing the season later must not re-price the booking.
  const snap = await hotelSnapshot(db, day1);
  await run({ type: 'season_delete', id: snap.seasons[0].id }, day1);
  await run({ type: 'checkin', id: stay.id }, day1);

  await openDay('2026-10-30');
  const audit = await run({ type: 'night_audit' }, day2);
  assert.match(audit.message, /2 room night\(s\) posted, 1 no-show/);
  await assert.rejects(run({ type: 'night_audit' }, day2), /already run/);
  const nights = await db.all("SELECT service_date, net_cents FROM hotel_folio_entries WHERE category = 'room' ORDER BY service_date");
  assert.deepEqual(nights.map((n) => [n.service_date, n.net_cents]), [['2026-10-28', 11000], ['2026-10-29', 16000]]);
  const noShow = await db.get("SELECT status, no_show FROM hotel_reservations WHERE guest_name = 'Never Came'");
  assert.deepEqual([noShow.status, Number(noShow.no_show)], ['cancelled', 1]);
  const latest = (await hotelSnapshot(db, day2)).audits[0];
  assert.equal(latest.roomNightsPosted, 2);

  // Revenue is booked on the posting date (30th); KPIs use each night's service date.
  const report = await businessReport(db, { from: '2026-10-28', to: '2026-10-30' });
  assert.equal(report.hotelKpis.roomNightsSold, 2);
  assert.equal(report.hotelKpis.availableRoomNights, 6);
  assert.equal(report.hotelKpis.occupancyPercent, 33.33);
  assert.equal(report.hotelKpis.adr, 135);
  assert.equal(report.hotelKpis.revpar, 45);
  assert.equal(report.hotelKpis.noShows, 1);
  assert.equal(report.pnl.hotel.revenue, 270);
  assert.match(businessReportCsv(report), /Hotel KPI,ADR,,,135/);
}));

test('expense category business unit drives segment P&L, including voids', async () => fixture(async ({ db }) => {
  await ensureExpenseCategorySchema(db);
  await ensureAccountingSchema(db);
  const laundry = await createExpenseCategory(db, 'Laundry');
  await updateExpenseCategory(db, laundry.id, 'Laundry', 'hotel');
  await assert.rejects(updateExpenseCategory(db, laundry.id, 'Laundry', 'garage'), /restaurant, hotel or shared/);
  const expense = await db.run("INSERT INTO expenses (description, category, amount, expense_date) VALUES ('Linen', 'Laundry', 300, '2026-10-28')");
  const posted = await postJournal(db, { entry_date: '2026-10-28', memo: 'Linen', source_type: 'expense', source_id: expense.lastInsertRowid, lines: [{ code: '5020', debit: 300, credit: 0 }, { code: '1010', debit: 0, credit: 300 }] });
  await postJournal(db, { entry_date: '2026-10-28', memo: 'Rent', source_type: 'expense', source_id: 999, lines: [{ code: '5020', debit: 100, credit: 0 }, { code: '1010', debit: 0, credit: 100 }] });
  await postJournal(db, { entry_date: '2026-10-28', memo: 'Veg', source_type: 'purchase', source_id: 1, lines: [{ code: '5010', debit: 50, credit: 0 }, { code: '1010', debit: 0, credit: 50 }] });
  await postJournal(db, { entry_date: '2026-10-28', memo: 'Sale', source_type: 'bill', source_id: 1, lines: [{ code: '1010', debit: 500, credit: 0 }, { code: '4010', debit: 0, credit: 500 }] });
  let report = await businessReport(db, { from: '2026-10-28', to: '2026-10-28' });
  assert.deepEqual([report.pnl.hotel.expenses, report.pnl.restaurant.expenses, report.pnl.shared.expenses], [300, 50, 100]);
  assert.equal(report.pnl.combined.net, 500 - 450);
  // Combined report breakdown: expenses by category, cash collected per business, bill count.
  assert.deepEqual(report.expenseLines.find((l) => l.label === 'Laundry'), { business: 'hotel', label: 'Laundry', amount: 300 });
  assert.equal(report.revenueLines.reduce((s, l) => s + l.amount, 0), report.pnl.combined.revenue);
  assert.deepEqual(report.collections.map((c) => [c.restaurant, c.hotel]), [[500, 0]]);
  assert.deepEqual(report.restaurantKpis, { bills: 1, avgBill: 500 });
  // Void (reversal) of the hotel expense stays in the hotel segment.
  await postJournal(db, { entry_date: '2026-10-28', memo: 'Void', source_type: 'reversal', source_id: posted, lines: [{ code: '1010', debit: 300, credit: 0 }, { code: '5020', debit: 0, credit: 300 }] });
  report = await businessReport(db, { from: '2026-10-28', to: '2026-10-28' });
  assert.deepEqual([report.pnl.hotel.expenses, report.pnl.shared.expenses], [0, 100]);
  await assert.rejects(businessReport(db, { from: '2026-10-29', to: '2026-10-28' }), /valid date range/);
}));

test('attendance payroll suggestion', async () => fixture(async ({ db }) => {
  await ensureStaffHrSchema(db);
  await ensurePayrollSchema(db);
  const r = await db.run("INSERT INTO users (username, password_hash, full_name, role, salary) VALUES ('pay', 'x', 'Pay Test', 'waiter', 31000)");
  const user = { id: Number(r.lastInsertRowid), role: 'waiter' };
  await clockIn(db, user, new Date('2026-10-05T03:00:00Z'));
  await clockOut(db, user, {}, new Date('2026-10-05T13:00:00Z')); // 10 h: 2 h overtime
  await db.run("INSERT INTO attendance (user_id, business_date, status) VALUES (?, '2026-10-06', 'half_day'), (?, '2026-10-07', 'leave'), (?, '2026-10-08', 'absent')", [user.id, user.id, user.id]);
  const { rows, daysInMonth } = await payrollAttendance(db, '2026-10');
  const row = rows.find((x) => x.id === user.id);
  assert.equal(daysInMonth, 31);
  assert.equal(row.paidDays, 2.5);
  assert.equal(row.basePay, 2500);
  assert.equal(row.overtimePay, 250);
  assert.equal(row.suggestedNet, 2750);
}));
