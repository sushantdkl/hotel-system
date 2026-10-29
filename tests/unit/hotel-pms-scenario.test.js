/**
 * End-to-end regression for the interconnected hotel + restaurant flow
 * (brief section 67): booking -> check-in -> half board -> restaurant table
 * reservation -> order -> KOT -> bill -> charge to room with allowance ->
 * overage on folio -> revenue once -> room move keeps charges -> room service
 * -> night audit idempotent -> added family room with master payer ->
 * checkout with deposit -> invoice -> dirty room + housekeeping -> ledger
 * balances. Plus: walk-in restaurant customer, void of a room-charged bill,
 * and concurrent booking of one room.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PosDatabase } from '../../lib/db/index.js';
import { runHotelCommand, hotelSnapshot, hotelDate } from '../../lib/hotel/service.js';
import { applyPackageAllowance, lockChargeableStay, orderOutlet, postRoomChargeToFolio, prepareRoomCharges, folioLinkForBill, listChargeableStays } from '../../lib/hotel/room-charges.js';
import { recordInitialSplitSettlement, validateAllocations } from '../../lib/split-payments.js';
import { voidPaidBill } from '../../lib/bill-corrections.js';
import { accountBalance } from '../../lib/accounting.js';
import { openBusinessDay } from '../../lib/business-days.js';
import { ensureKotProSchema, issueKot } from '../../lib/kot-service.js';
import { enableRoomService } from '../../lib/hotel/room-service.js';
import { linkTableReservationToStay, stayBadges, updateRoomService } from '../../lib/hotel/links.js';
import { consumePackage, packageAllowance } from '../../lib/hotel/packages.js';
import { folioTotals } from '../../lib/hotel/folio-math.js';
import { departmentalRevenue, runHotelReport } from '../../lib/hotel/reports.js';
import { gmDashboard } from '../../lib/hotel/gm-dashboard.js';
import { getGuest } from '../../lib/hotel/guests.js';
import { globalSearch } from '../../lib/global-search.js';
import { ensureColumn } from '../../lib/db/schema-helpers.js';

const admin = { id: 1, role: 'admin', full_name: 'Owner' };
const now = new Date();
const T = hotelDate(now);
const plus = (days) => new Date(Date.parse(T) + days * 86400000).toISOString().slice(0, 10);

async function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-pms-'));
  const file = path.join(dir, 'test.db');
  const db = new PosDatabase(file);
  const run = (action, key = randomUUID()) => runHotelCommand(db, action, admin, key, now);
  try {
    await run({ type: 'property', name: 'Aadhar Test Hotel', taxPercent: '13' });
    for (const [roomId, roomType, rate, capacity] of [['203', 'Deluxe', 5000, 2], ['204', 'Deluxe', 5000, 2], ['305', 'Suite', 8000, 3]]) {
      await run({ type: 'room', roomId, roomType, capacity, floor: Number(roomId[0]), rate });
    }
    await run({ type: 'plan', name: 'Half board', supplement: 2000 });
    const snapshot = await hotelSnapshot(db, now);
    const plan = snapshot.plans.find((p) => p.name === 'Half board');
    await run({ type: 'plan_package', planId: plan.id, planCode: 'HALF_BOARD', description: 'Breakfast and dinner', components: [
      { label: 'Breakfast', adult: 800, child: 400, timing: 'after_night', start: '00:00', end: '23:59', outlets: ['restaurant', 'room_service'] },
      { label: 'Dinner', adult: 1200, child: 600, timing: 'night_of', start: '00:00', end: '23:59', outlets: ['restaurant'] },
    ] });
    await prepareRoomCharges(db);
    await ensureKotProSchema(db);
    await ensureColumn(db, 'order_items', 'combo_snapshot', 'TEXT'); // restaurant void reads combo items
    const day = await openBusinessDay(db, { business_date: T, opening_cash: 0 }, admin);
    // A restaurant bill for an order with one served item; returns ids.
    const restaurantOrder = async ({ tableId = null, number, price, kot = true }) => {
      const order = await db.run("INSERT INTO orders (order_number, table_id, status, business_day_id, order_type) VALUES (?, ?, 'preparing', ?, 'dine_in')", [number, tableId, day.id]);
      const orderId = order.lastInsertRowid;
      await db.run("INSERT INTO order_items (order_id, item_name, quantity, price, subtotal, status) VALUES (?, 'Dal bhat set', 1, ?, ?, 'pending')", [orderId, price, price]);
      let kotRow = null;
      if (kot) {
        await issueKot(db, { orderId, actor: admin });
        kotRow = await db.get('SELECT * FROM kots WHERE order_id = ?', [orderId]);
      }
      return { orderId, kot: kotRow };
    };
    const settle = async ({ orderId, number, subtotal, tax, allocations, stayId = null, usePackage = true }) => db.transaction(async (tx) => {
      const total = subtotal + tax;
      const room = stayId ? await lockChargeableStay(tx, stayId) : null;
      const valid = validateAllocations(allocations, total, { room, actorRole: 'admin' });
      const bill = await tx.run("INSERT INTO bills (bill_number, order_id, subtotal, tax, vat_amount, grand_total, status, business_day_id) VALUES (?, ?, ?, ?, ?, ?, 'unpaid', ?)", [number, orderId, subtotal, tax, tax, total, day.id]);
      const billId = bill.lastInsertRowid;
      const outlet = room ? await orderOutlet(tx, orderId) : 'restaurant';
      const settled = room ? await applyPackageAllowance(tx, { room, allocations: valid, billId, billNumber: number, actorId: 1, outlet, now, usePackage }) : { allocations: valid };
      if (room) await tx.run('UPDATE orders SET hotel_stay_id = ? WHERE id = ?', [room.id, orderId]);
      await recordInitialSplitSettlement(tx, { billId, billNumber: number, total, tax, allocations: settled.allocations, actorId: 1, requestKey: randomUUID(), businessDayId: day.id, room, outlet });
      await tx.run("UPDATE orders SET status = 'completed' WHERE id = ?", [orderId]);
      return { billId, allocations: settled.allocations, covered: settled.covered || 0, room };
    });
    const stay = async (id) => (await hotelSnapshot(db, now)).bookings.find((b) => b.id === id);
    const ledgerBalanced = async () => {
      const row = await db.get('SELECT ROUND(SUM(debit), 2) AS d, ROUND(SUM(credit), 2) AS c FROM journal_lines');
      assert.equal(Number(row.d), Number(row.c), 'total debits equal total credits');
    };
    await fn({ db, run, day, restaurantOrder, settle, stay, ledgerBalanced });
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('interconnected scenario: stay, restaurant, package, move, room service, audit, family room, checkout', async () => fixture(async ({ db, run, restaurantOrder, settle, stay, ledgerBalanced }) => {
  // Guest books Room 203 on half board with a deposit, then checks in.
  const booking = await run({ type: 'book', guest: 'Ram Sharma', phone: '9800000001', roomId: '203', start: T, end: plus(3), adults: 2, children: 0, meal: 'Half board', source: 'Direct', bookingType: 'guaranteed', segment: 'Leisure', specialRequests: 'Late dinner' });
  const id = booking.id;
  await run({ type: 'payment', id, method: 'Cash', amount: 5000, revision: 0 });
  assert.equal(await accountBalance(db, '2150'), -5000, 'deposit is a liability (credit balance), not revenue');
  assert.equal(await accountBalance(db, '4030'), 0);
  await run({ type: 'checkin', id });
  let s = await stay(id);
  assert.equal(s.status, 'in_house');
  assert.equal(s.adults, 2);

  // In-house guest reserves restaurant Table 12; the reservation is linked to the stay.
  const reservation = await db.run("INSERT INTO reservations (name, phone, date, time, party_size, status) VALUES ('Ram Sharma', '9800000001', ?, '19:30', 2, 'confirmed')", [T]);
  await linkTableReservationToStay(db, admin, { reservationId: reservation.lastInsertRowid, stayId: id });
  const badges = await stayBadges(db, { reservationIds: [reservation.lastInsertRowid] });
  assert.equal(badges.reservations[reservation.lastInsertRowid].room, '203');

  // Waiter places the order at T12, the KOT reaches the kitchen, the bill is generated.
  const table = await db.run("INSERT INTO tables (table_number, status) VALUES ('T12', 'occupied')");
  const dinner = await restaurantOrder({ tableId: table.lastInsertRowid, number: 'ORD-T12', price: 3540 });
  assert.ok(dinner.kot, 'KOT issued to the kitchen');
  await db.run("UPDATE order_items SET status = 'served' WHERE order_id = ?", [dinner.orderId]);

  // Charge to room is optional: the cashier sees the guest, folio and allowance.
  const lookup = (await listChargeableStays(db, { now, query: '203' }))[0];
  assert.equal(lookup.guest, 'Ram Sharma');
  assert.equal(lookup.allowanceRemaining, 2400, 'no breakfast on the arrival day; dinner 1,200 x 2 adults');

  // Mixed settlement: NPR 1,000 cash + NPR 3,000 room. Dinner allowance covers 2,400; 600 overage reaches the folio.
  const paid = await settle({ orderId: dinner.orderId, number: 'FB-0148', subtotal: 3540, tax: 460, allocations: [{ method: 'cash', amount: 1000, cash_tendered: 1000 }, { method: 'room', amount: 3000 }], stayId: id });
  assert.equal(paid.covered, 240000, 'covered amount in cents');
  assert.deepEqual(paid.allocations.map((a) => [a.method, a.amount]).sort(), [['cash', 1000], ['package', 2400], ['room', 600]]);
  const bill = await db.get('SELECT status FROM bills WHERE id = ?', [paid.billId]);
  assert.equal(bill.status, 'paid', 'restaurant bill is settled (cash + package + room)');
  assert.equal(await accountBalance(db, '4010'), -3540, 'restaurant revenue recognized once at the sale');
  const link = await folioLinkForBill(db, paid.billId);
  assert.equal(link.stayId, id);
  assert.equal(link.folioAmount, 600);
  assert.equal(link.packageAmount, 2400);
  // A retried folio posting and a retried allowance use cannot duplicate.
  const retry = await db.transaction(async (tx) => postRoomChargeToFolio(tx, { stay: paid.room, billId: paid.billId, billNumber: 'FB-0148', amount: 600, actorId: 1 }));
  assert.equal(retry.duplicate, true);
  assert.equal(await db.transaction((tx) => consumePackage(tx, { booking: paid.room.booking, billId: paid.billId, maxCents: 300000, date: T, time: '20:00', outlet: 'restaurant', actorId: 1 })), 240000);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM hotel_package_usage')).n, 2 - 1, 'one dinner usage row');
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM hotel_folio_entries WHERE source_type = 'RESTAURANT'")).n, 1);

  // The guest moves 203 -> 305 (upgrade at the new rate); every charge stays on the same stay.
  await run({ type: 'move', id, roomId: '305', reason: 'Maintenance issue', notes: 'AC noisy', rateDecision: 'new' });
  s = await stay(id);
  assert.equal(s.roomId, '305');
  assert.equal(s.moves.length, 1);
  assert.equal(s.moves[0].reason, 'Maintenance issue');
  assert.ok(s.entries.find((e) => e.sourceType === 'RESTAURANT' && e.room === '203'), 'restaurant charge still on the folio, with the room it was posted for');
  assert.equal(s.payments.find((p) => p.category === 'deposit').amount, 5000, 'deposit still on the folio');
  const vacated = (await hotelSnapshot(db, now)).rooms.find((r) => r.id === '203');
  assert.equal(vacated.cleaning, 'dirty');

  // More room service from 305 through the same kitchen; dinner allowance is used up, so it all goes to the folio.
  await enableRoomService(db);
  const rsTable = await db.get("SELECT t.id FROM tables t JOIN hotel_rooms r ON r.id = t.hotel_room_id WHERE r.room_number = '305'");
  const rs = await restaurantOrder({ tableId: rsTable.id, number: 'ORD-RS-305', price: 1000 });
  for (const status of ['preparing', 'ready', 'out_for_delivery', 'delivered']) await updateRoomService(db, admin, { orderId: rs.orderId, status });
  await assert.rejects(updateRoomService(db, admin, { orderId: rs.orderId, status: 'preparing' }), /cannot go/);
  const rsPaid = await settle({ orderId: rs.orderId, number: 'RS-0001', subtotal: 1000, tax: 130, allocations: [{ method: 'room', amount: 1130 }], stayId: id });
  assert.equal(rsPaid.covered, 0, 'dinner allowance is not valid for room service in this plan');
  s = await stay(id);
  assert.ok(s.entries.find((e) => e.sourceType === 'ROOM_SERVICE' && e.amount === 1130));

  // Night audit posts tonight's room once; a re-run (with reason) posts nothing more.
  await run({ type: 'night_audit' });
  await assert.rejects(run({ type: 'night_audit' }), /already run/);
  await run({ type: 'night_audit', force: true, reason: 'Re-check after late arrival' });
  s = await stay(id);
  const nights = s.entries.filter((e) => e.sourceType === 'ROOM');
  assert.equal(nights.length, 1, 'one night posted, never duplicated');
  assert.equal(nights[0].net, 10000, 'Suite 8,000 + half board 2,000 at the new rate');
  assert.equal(nights[0].packageAmount, 4000, 'breakfast 1,600 + dinner 2,400 deferred to the package liability');

  // The guest adds a second room for family, paid by the master folio.
  const family = await run({ type: 'book', groupId: id, roomId: '204', start: T, end: plus(3), adults: 2, children: 0, meal: 'Room only', payer: 'master' });
  await run({ type: 'checkin', id: family.id });
  await run({ type: 'post_nights', id: family.id });
  const group = (await hotelSnapshot(db, now)).groups.find((g) => g.masterId === id);
  assert.equal(group.payerMode, 'master');
  s = await stay(id);
  assert.ok(s.entries.find((e) => e.sourceType === 'ROOM' && e.room === '204'), "the family room's night lands on the master folio");
  assert.equal((await stay(family.id)).balance, 0);

  // Checkout: family room first, then the master folio. The deposit is applied, the balance collected.
  await assert.rejects(run({ type: 'checkout', id, revision: s.folioRevision }), /204|Settle/);
  await run({ type: 'checkout', id: family.id, revision: (await stay(family.id)).folioRevision });
  s = await stay(id);
  await run({ type: 'payment', id, method: 'Cash', amount: s.balance, revision: s.folioRevision });
  s = await stay(id);
  assert.equal(s.balance, 0);
  await run({ type: 'checkout', id, revision: s.folioRevision });
  s = await stay(id);
  assert.equal(s.status, 'checked_out');
  assert.ok(s.statement.number.startsWith('HS-'));
  assert.equal(s.statement.packageUsage.length, 1);
  const room305 = (await hotelSnapshot(db, now)).rooms.find((r) => r.id === '305');
  assert.equal(room305.cleaning, 'dirty');
  assert.ok((await db.get("SELECT t.id FROM hotel_housekeeping_tasks t JOIN hotel_rooms r ON r.id = t.room_id WHERE r.room_number = '305' AND t.status = 'dirty' AND t.task_type = 'checkout'")));

  // Accounting invariants.
  await ledgerBalanced();
  assert.equal(await accountBalance(db, '1320'), 0, 'guest receivable cleared');
  assert.equal(await accountBalance(db, '2150'), 0, 'deposit liability applied');
  assert.equal(await accountBalance(db, '2160'), 0, 'package liability cleared (consumed + breakage)');
  assert.equal(await accountBalance(db, '4010'), -(3540 + 1000), 'F&B revenue = the two restaurant bills, once');
  const dept = await departmentalRevenue(db, T, T);
  const fnb = dept.departments.find((d) => d.department === 'FOOD_BEVERAGE');
  assert.equal(fnb.revenue, 4540, 'combined F&B is not doubled by folio postings');
  const income = await db.get("SELECT ROUND(SUM(l.credit - l.debit), 2) AS n FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.type = 'income'");
  assert.equal(dept.total, Number(income.n), 'departmental total reconciles to income accounts');
  // Breakage: accrued 4,000 (one night) - consumed 2,400 = 1,600 gross -> 4045 net + tax.
  assert.equal(Math.round((-(await accountBalance(db, '4045')) + 0) * 100) / 100, Math.round((160000 - Math.round(160000 * 1300 / 11300)) ) / 100);

  // Reports and dashboards derive from the same records.
  const occupancy = await runHotelReport(db, 'occupancy', { from: T, to: T });
  assert.equal(occupancy.summary.roomsSold, 2);
  const fb = await runHotelReport(db, 'fb_hotel', { from: T, to: T });
  assert.equal(fb.rows.find((r) => r.line === 'Covered by meal plans').amount, 2400);
  assert.equal(fb.rows.find((r) => r.line === 'Room service').amount, 1000);
  const pkg = await runHotelReport(db, 'packages', { from: T, to: T });
  assert.equal(pkg.rows.find((r) => r.plan === 'Half board').consumed, 2400);
  const gm = await gmDashboard(db, now);
  assert.equal(gm.restaurant.roomService, 1000);
  assert.equal(gm.finance.guestDeposits, 0);
  const guest = await getGuest(db, s.guestId);
  assert.equal(guest.spend.restaurant, 600);
  assert.equal(guest.spend.roomService, 1130);
  assert.equal(guest.spend.mealsInPlan, 2400);
  assert.ok((await globalSearch(db, admin, 'Ram Sharma')).results.some((r) => r.type === 'Stay'));
}));

test('walk-in restaurant customer needs no hotel stay', async () => fixture(async ({ db, restaurantOrder, settle, ledgerBalanced }) => {
  const order = await restaurantOrder({ number: 'ORD-WALKIN', price: 885 });
  const paid = await settle({ orderId: order.orderId, number: 'BILL-WALKIN', subtotal: 885, tax: 115, allocations: [{ method: 'cash', amount: 1000, cash_tendered: 1000 }] });
  assert.equal((await db.get('SELECT status FROM bills WHERE id = ?', [paid.billId])).status, 'paid');
  assert.equal(await folioLinkForBill(db, paid.billId), null);
  assert.equal(await accountBalance(db, '1320'), 0);
  assert.equal(await accountBalance(db, '4010'), -885);
  await ledgerBalanced();
}));

test('voiding a room-charged bill neutralizes the folio row and releases the meal allowance', async () => fixture(async ({ db, run, restaurantOrder, settle, stay, ledgerBalanced }) => {
  const b = await run({ type: 'book', guest: 'Void Guest', roomId: '203', start: T, end: plus(2), adults: 2, meal: 'Half board' });
  await run({ type: 'checkin', id: b.id });
  const order = await restaurantOrder({ number: 'ORD-VOID', price: 3000, kot: false });
  const paid = await settle({ orderId: order.orderId, number: 'BILL-VOID', subtotal: 3000, tax: 390, allocations: [{ method: 'room', amount: 3390 }], stayId: b.id });
  assert.equal(paid.covered, 240000, 'covered amount in cents');
  assert.equal((await stay(b.id)).balance, 990);
  await voidPaidBill(db, { bill_id: paid.billId, reason: 'Wrong table', created_by: 1, restock: false });
  const after = await stay(b.id);
  assert.equal(after.balance, 0, 'folio charge reversed by a credit row');
  assert.ok(after.entries.find((e) => e.kind === 'credit' && e.reversalOf));
  assert.equal(after.packageUsage.length, 0, 'allowance released for the guest');
  assert.equal(await accountBalance(db, '1320'), 0);
  assert.equal(await accountBalance(db, '2160'), 0);
  assert.equal(await accountBalance(db, '4010'), 0);
  await ledgerBalanced();
}));

test('folio reversal, allowance, window transfer, routing and city ledger stay auditable and balanced', async () => fixture(async ({ db, run, stay, ledgerBalanced }) => {
  const b = await run({ type: 'book', guest: 'Corporate Guest', roomId: '204', start: T, end: plus(2), adults: 1, meal: 'Room only', company: 'Himal Traders' });
  await run({ type: 'checkin', id: b.id });
  await run({ type: 'post_nights', id: b.id });
  await run({ type: 'charge', id: b.id, description: 'Airport pickup', amount: 1500, sourceType: 'TRANSPORT' });
  await run({ type: 'charge', id: b.id, description: 'Laundry wrong', amount: 300, sourceType: 'LAUNDRY' });
  let s = await stay(b.id);
  const wrong = s.entries.find((e) => e.label === 'Laundry wrong');
  await assert.rejects(run({ type: 'reverse', id: b.id, entryId: wrong.id }), /reason/);
  await run({ type: 'reverse', id: b.id, entryId: wrong.id, reason: 'Posted to the wrong room' });
  await assert.rejects(run({ type: 'reverse', id: b.id, entryId: wrong.id, reason: 'again' }), /already/);
  assert.equal(await accountBalance(db, '4041'), 0, 'reversal mirrors the original journal');
  // Company pays the room in window 2.
  await run({ type: 'window', id: b.id, window: 2, payerType: 'company', payerName: 'Himal Traders' });
  s = await stay(b.id);
  const night = s.entries.find((e) => e.sourceType === 'ROOM');
  const before = Number((await db.get("SELECT ROUND(SUM(l.credit - l.debit), 2) AS n FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.type = 'income'")).n);
  await run({ type: 'transfer', id: b.id, entryId: night.id, window: 2, reason: 'Company pays room' });
  const afterTransfer = Number((await db.get("SELECT ROUND(SUM(l.credit - l.debit), 2) AS n FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.type = 'income'")).n);
  assert.equal(afterTransfer, before, 'a transfer is not revenue');
  s = await stay(b.id);
  assert.equal(s.windowBalances['2'], 5650);
  await run({ type: 'adjust', id: b.id, amount: 565, sourceType: 'TRANSPORT', reason: 'Service recovery' });
  s = await stay(b.id);
  await run({ type: 'payment', id: b.id, method: 'City Ledger', account: 'Himal Traders', amount: 5650, window: 2, revision: s.folioRevision });
  s = await stay(b.id);
  await run({ type: 'payment', id: b.id, method: 'Cash', amount: s.windowBalances['1'], window: 1, revision: s.folioRevision });
  s = await stay(b.id);
  await run({ type: 'checkout', id: b.id, revision: s.folioRevision });
  assert.equal(await accountBalance(db, '1330'), 5650, 'company owes the room on the city ledger');
  assert.equal(await accountBalance(db, '1320'), 0);
  const audit = await db.all("SELECT action, reason FROM hotel_audit_events WHERE action IN ('folio_reversal', 'folio_transfer', 'folio_adjustment')");
  assert.equal(audit.length, 3);
  assert.ok(audit.every((a) => a.reason));
  await ledgerBalanced();
}));

test('concurrent bookings cannot double-book one room; cancellation keeps a forfeited deposit as revenue only via a fee', async () => fixture(async ({ db, run, stay, ledgerBalanced }) => {
  const results = await Promise.allSettled([
    run({ type: 'book', guest: 'A', roomId: '305', start: plus(1), end: plus(3), adults: 1 }),
    run({ type: 'book', guest: 'B', roomId: '305', start: plus(2), end: plus(4), adults: 1 }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.match(results.find((r) => r.status === 'rejected').reason.message, /unavailable/);
  const id = results.find((r) => r.status === 'fulfilled').value.id;
  await run({ type: 'payment', id, method: 'Cash', amount: 3000, revision: 0 });
  await assert.rejects(run({ type: 'cancel', id }), /deposit/);
  // Fee with 13% tax equal to the deposit: net 2,654.87 -> 3,000.00 gross.
  await run({ type: 'charge', id, description: 'Cancellation fee', amount: 2654.87, sourceType: 'OTHER' });
  const settled = await stay(id);
  assert.equal(settled.balance, 0);
  await run({ type: 'cancel', id, reason: 'Guest cancelled' });
  assert.equal(await accountBalance(db, '2150'), 0, 'deposit applied against the fee, liability cleared');
  assert.equal(await accountBalance(db, '1320'), 0);
  await ledgerBalanced();
}));

test('meal allowance respects date, time window and outlet', async () => fixture(async ({ db, run }) => {
  const b = await run({ type: 'book', guest: 'Plan Guest', roomId: '203', start: T, end: plus(2), adults: 1, children: 1, meal: 'Half board' });
  const booking = await db.get('SELECT * FROM hotel_reservations WHERE id = ?', [b.id]);
  const arrival = await packageAllowance(db, booking, { date: T, time: '20:00', outlet: 'restaurant' });
  assert.equal(arrival.find((c) => c.label === 'Breakfast').remaining, 0, 'no breakfast on the arrival morning');
  assert.equal(arrival.find((c) => c.label === 'Dinner').remaining, 180000, 'dinner 1,200 adult + 600 child');
  const morning = await packageAllowance(db, booking, { date: plus(1), time: '08:00', outlet: 'room_service' });
  assert.equal(morning.find((c) => c.label === 'Breakfast').remaining, 120000);
  assert.equal(morning.find((c) => c.label === 'Dinner').remaining, 0, 'dinner not valid for room service');
  const afterDeparture = await packageAllowance(db, booking, { date: plus(3), time: '08:00', outlet: 'restaurant' });
  assert.ok(afterDeparture.every((c) => c.remaining === 0));
}));
