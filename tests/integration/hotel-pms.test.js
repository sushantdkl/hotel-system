/**
 * PostgreSQL contract for the hotel PMS: real POS pay route with Charge to
 * Room + meal allowance, row-lock concurrency, idempotent night audit and
 * folio postings, room move, void, checkout with deposit, reports, dashboard,
 * search, and ledger invariants. Run through scripts/run-integration.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Database from '../../lib/db/index.js';
import { AuthService } from '../../lib/auth/auth.js';
import { openBusinessDay } from '../../lib/business-days.js';
import { nepalDateString } from '../../lib/report-dates.js';
import { runHotelCommand, hotelSnapshot } from '../../lib/hotel/service.js';
import { prepareRoomCharges, folioLinkForBill, listChargeableStays } from '../../lib/hotel/room-charges.js';
import { voidPaidBill } from '../../lib/bill-corrections.js';
import { accountBalance } from '../../lib/accounting.js';
import { runHotelReport, REPORT_LIST, departmentalRevenue } from '../../lib/hotel/reports.js';
import { gmDashboard } from '../../lib/hotel/gm-dashboard.js';
import { globalSearch } from '../../lib/global-search.js';
import { getGuest } from '../../lib/hotel/guests.js';
import { linkOrderToStay, listRoomServiceOrders } from '../../lib/hotel/links.js';
import { POST as payOrder } from '../../app/api/admin/pos/orders/[id]/pay/route.js';

if (!/^\/km_test_\d+_\d+$/.test(new URL(process.env.DATABASE_URL).pathname)) throw Error('Use scripts/run-integration.mjs to isolate this mutating test.');
const db = Database.getInstance();
const admin = { id: 1, role: 'admin', full_name: 'Test Admin' };
const T = nepalDateString();
const plus = (d) => new Date(Date.parse(T) + d * 86400000).toISOString().slice(0, 10);
const run = (action, key = randomUUID()) => runHotelCommand(db, action, admin, key);
const stay = async (id) => (await hotelSnapshot(db)).bookings.find((b) => b.id === id);
test.after(async () => { await Database.close(); });

async function order(number, price) {
  const day = await db.get("SELECT id FROM business_days WHERE status = 'open' ORDER BY id DESC LIMIT 1");
  const id = (await db.run("INSERT INTO orders (order_number, status, order_type, business_day_id) VALUES (?, 'dining', 'takeaway', ?)", [number, day.id])).lastInsertRowid;
  await db.run("INSERT INTO order_items (order_id, item_name, quantity, price, subtotal, sent_quantity, status) VALUES (?, 'Thakali set', 1, ?, ?, 1, 'served')", [id, price, price]);
  return id;
}
async function pay(orderId, body) {
  const response = await payOrder(new Request(`http://localhost/api/admin/pos/orders/${orderId}/pay`, { method: 'POST', headers: { authorization: 'Bearer contract' }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: String(orderId) }) });
  const data = await response.json();
  return { status: response.status, data };
}
async function balanced() {
  const row = await db.get('SELECT ROUND(SUM(debit)::numeric, 2) AS d, ROUND(SUM(credit)::numeric, 2) AS c FROM journal_lines');
  assert.equal(Number(row.d), Number(row.c), 'total debits equal total credits');
}

test('PostgreSQL hotel PMS: charge to room via POS route, package, concurrency, audit, move, void, checkout, reports', async () => {
  await openBusinessDay(db, { business_date: T, opening_cash: 0 }, admin);
  await run({ type: 'property', name: 'PG Hotel', taxPercent: '13' });
  for (const [roomId, roomType, rate] of [['101', 'Deluxe', 4000], ['102', 'Deluxe', 4000], ['201', 'Suite', 7000]]) await run({ type: 'room', roomId, roomType, capacity: 3, floor: Number(roomId[0]), rate });
  await run({ type: 'plan', name: 'Bed and breakfast', supplement: 1000 });
  const plan = (await hotelSnapshot(db)).plans.find((p) => p.name === 'Bed and breakfast');
  await run({ type: 'plan_package', planId: plan.id, planCode: 'BED_AND_BREAKFAST', components: [{ label: 'Dinner credit', adult: 700, timing: 'night_of', start: '00:00', end: '23:59', outlets: ['restaurant', 'room_service'] }] });

  // Row lock on the property serializes bookings: only one of two concurrent bookings of a room wins.
  const race = await Promise.allSettled([
    run({ type: 'book', guest: 'Race A', roomId: '102', start: plus(5), end: plus(7), adults: 1 }),
    run({ type: 'book', guest: 'Race B', roomId: '102', start: plus(6), end: plus(8), adults: 1 }),
  ]);
  assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);

  const b = await run({ type: 'book', guest: 'Sita Thapa', phone: '9811111111', roomId: '101', start: T, end: plus(2), adults: 2, meal: 'Bed and breakfast', bookingType: 'guaranteed' });
  await run({ type: 'payment', id: b.id, method: 'Cash', amount: 3000, revision: 0 });
  await run({ type: 'checkin', id: b.id });
  await prepareRoomCharges(db);
  assert.equal((await listChargeableStays(db, { query: 'Sita' }))[0].allowanceRemaining, 1400);

  const realVerify = AuthService.prototype.verifySession;
  AuthService.prototype.verifySession = async () => admin;
  try {
    // Real POS settlement: Charge to Room. Allowance covers 1,400; the rest reaches the folio.
    const orderId = await order('PG-ROOM-1', 2000);
    await linkOrderToStay(db, admin, { orderId, stayId: b.id });
    const first = await pay(orderId, { idempotency_key: 'pg-room-charge-1', payment_method: 'room', room_reservation_id: b.id });
    assert.equal(first.status, 200, JSON.stringify(first.data));
    const again = await pay(orderId, { idempotency_key: 'pg-room-charge-1', payment_method: 'room', room_reservation_id: b.id });
    assert.ok(again.status === 200 || again.status === 409, 'a retried settlement is not posted twice');
    const bill = await db.get('SELECT id, grand_total, status FROM bills WHERE order_id = ?', [orderId]);
    assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM bills WHERE order_id = ?', [orderId])).n), 1);
    const link = await folioLinkForBill(db, bill.id);
    assert.equal(link.packageAmount, 1400);
    assert.equal(Math.round((link.folioAmount + link.packageAmount) * 100), Math.round(Number(bill.grand_total) * 100));
    assert.equal(Number((await db.get("SELECT COUNT(*) AS n FROM hotel_folio_entries WHERE source_type = 'RESTAURANT'")).n), 1);
    const sale = await db.get("SELECT ROUND(SUM(l.credit - l.debit)::numeric, 2) AS n FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = '4010'");
    assert.ok(Number(sale.n) > 0 && Number(sale.n) <= 2000, 'restaurant revenue recognized once at the sale');

    // A second room-charged bill, then voided: the folio is corrected automatically.
    const voidOrder = await order('PG-ROOM-VOID', 500);
    assert.equal((await pay(voidOrder, { idempotency_key: 'pg-room-void', payment_method: 'room', room_reservation_id: b.id })).status, 200);
    const voidBill = await db.get('SELECT id FROM bills WHERE order_id = ?', [voidOrder]);
    await voidPaidBill(db, { bill_id: voidBill.id, reason: 'Wrong guest', created_by: 1, restock: false });
    assert.ok((await stay(b.id)).entries.find((e) => e.kind === 'credit' && e.reversalOf));
  } finally { AuthService.prototype.verifySession = realVerify; }

  // Night audit posts once, re-runs never duplicate.
  await run({ type: 'night_audit' });
  await run({ type: 'night_audit', force: true, reason: 'Contract re-run' });
  assert.equal(Number((await db.get("SELECT COUNT(*) AS n FROM hotel_folio_entries WHERE source_type = 'ROOM'")).n), 1);

  // Room move keeps the folio; then checkout applies the deposit and settles the package.
  await run({ type: 'move', id: b.id, roomId: '201', reason: 'Upgrade', rateDecision: 'new' });
  let s = await stay(b.id);
  assert.equal(s.roomId, '201');
  assert.ok(s.entries.find((e) => e.sourceType === 'RESTAURANT'));
  await run({ type: 'payment', id: b.id, method: 'Cash', amount: s.balance, revision: s.folioRevision });
  s = await stay(b.id);
  await run({ type: 'checkout', id: b.id, revision: s.folioRevision });
  s = await stay(b.id);
  assert.equal(s.status, 'checked_out');
  assert.equal(await accountBalance(db, '1320'), 0);
  assert.equal(await accountBalance(db, '2150'), 0);
  assert.equal(await accountBalance(db, '2160'), 0);
  await balanced();

  // Every report, the dashboard, guest 360 and search run on PostgreSQL.
  for (const { id } of REPORT_LIST) {
    const report = await runHotelReport(db, id, { from: plus(-1), to: plus(1) });
    assert.ok(Array.isArray(report.rows), id);
  }
  const dept = await departmentalRevenue(db, T, T);
  const income = await db.get("SELECT ROUND(SUM(l.credit - l.debit)::numeric, 2) AS n FROM journal_lines l JOIN journal_entries e ON e.id = l.journal_id JOIN accounts a ON a.id = l.account_id WHERE a.type = 'income' AND e.entry_date = ?", [T]);
  assert.equal(dept.total, Number(income.n));
  const gm = await gmDashboard(db);
  assert.equal(gm.finance.guestReceivables, 0);
  assert.ok(gm.hotel.roomsTotal >= 3);
  assert.ok((await getGuest(db, s.guestId)).spend.restaurant >= 0);
  assert.ok((await globalSearch(db, admin, 'Sita')).results.length > 0);
  assert.ok(Array.isArray(await listRoomServiceOrders(db)));
});
