import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PosDatabase } from '../../lib/db/index.js';
import { runHotelCommand, hotelSnapshot } from '../../lib/hotel/service.js';
import { listChargeableStays, lockChargeableStay, prepareRoomCharges } from '../../lib/hotel/room-charges.js';
import { recordInitialSplitSettlement, validateAllocations } from '../../lib/split-payments.js';
import { refundBill } from '../../lib/bill-corrections.js';
import { accountBalance } from '../../lib/accounting.js';

const actor = { id: 1, role: 'admin' };
const now = new Date('2026-10-27T10:00:00Z');

async function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-room-charges-'));
  const file = path.join(dir, 'test.db');
  const db = new PosDatabase(file);
  const command = (action) => runHotelCommand(db, action, actor, randomUUID(), now);
  try {
    await command({ type: 'room', roomId: '101', roomType: 'King', capacity: 2, floor: 1, rate: 100 });
    await command({ type: 'room', roomId: '102', roomType: 'King', capacity: 2, floor: 1, rate: 100 });
    const stay = await command({ type: 'book', guest: 'Asha Rai', roomId: '101', start: '2026-10-27', end: '2026-10-29', guests: 1 });
    await command({ type: 'checkin', id: stay.id });
    const future = await command({ type: 'book', guest: 'Not Arrived', roomId: '102', start: '2026-10-28', end: '2026-10-29', guests: 1 });
    await prepareRoomCharges(db);
    await db.run("INSERT INTO business_days (business_date, status, opening_cash) VALUES ('2026-10-27', 'open', 0)");
    const day = await db.get("SELECT id FROM business_days WHERE status = 'open'");
    const drawer = await db.get('SELECT id FROM cash_drawers ORDER BY id LIMIT 1');
    const session = await db.run("INSERT INTO drawer_sessions (drawer_id, business_day_id, status, opening_amount) VALUES (?, ?, 'open', 0)", [drawer.id, day.id]);
    await db.run("INSERT INTO business_day_sessions (business_day_id, session_number, status, opening_cash, drawer_session_id) VALUES (?, 1, 'open', 0, ?)", [day.id, session.lastInsertRowid]);
    const order = await db.get('SELECT id FROM orders ORDER BY id LIMIT 1');
    const chargeBill = async (reservationId, total, number) => db.transaction(async (tx) => {
      const room = await lockChargeableStay(tx, reservationId);
      const bill = await tx.run("INSERT INTO bills (bill_number, order_id, subtotal, tax, grand_total, status) VALUES (?, ?, ?, 0, ?, 'unpaid')", [number, order.id, total, total]);
      const allocations = validateAllocations([{ method: 'room', amount: total }], total, { room });
      await recordInitialSplitSettlement(tx, { billId: bill.lastInsertRowid, billNumber: number, total, allocations, actorId: 1, requestKey: randomUUID(), businessDayId: day.id, room });
      return bill.lastInsertRowid;
    });
    await fn({ db, command, stayId: stay.id, futureId: future.id, chargeBill });
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('restaurant bill charged to a room lands on the folio once and checkout clears it', async () => fixture(async ({ db, command, stayId, chargeBill }) => {
  assert.deepEqual((await listChargeableStays(db)).map((s) => s.room), ['101']);
  const billId = await chargeBill(stayId, 450, 'BILL-ROOM-1');

  const bill = await db.get('SELECT status, outstanding_amount FROM bills WHERE id = ?', [billId]);
  assert.equal(bill.status, 'paid');
  assert.equal(Number(bill.outstanding_amount), 0);
  assert.equal((await db.get('SELECT COUNT(*) AS c FROM bill_payments WHERE bill_id = ?', [billId])).c, 0, 'no money was received');
  assert.equal((await db.get('SELECT settlement_status FROM bill_payment_allocations WHERE bill_id = ?', [billId])).settlement_status, 'room_charge');
  assert.equal(await accountBalance(db, '1320'), 450);
  assert.equal(await accountBalance(db, '1010'), 0);

  const folio = (await hotelSnapshot(db, now)).bookings.find((b) => b.id === stayId);
  assert.deepEqual(folio.entries.map((e) => [e.label, e.amount]), [['Restaurant bill BILL-ROOM-1', 450]]);
  assert.ok(folio.entries[0].journalId, 'folio entry links to the sale journal');

  // A partial refund would leave the folio charge behind, so it stays blocked (a full void corrects the folio).
  await assert.rejects(refundBill(db, { bill_id: billId, amount: 100, reason: 'mistake' }), /charged to a hotel room/);

  await command({ type: 'post_nights', id: stayId });
  const before = (await hotelSnapshot(db, now)).bookings.find((b) => b.id === stayId);
  const due = before.entries.reduce((s, e) => s + e.amount, 0);
  await command({ type: 'payment', id: stayId, method: 'Cash', amount: due, revision: before.folioRevision });
  const paid = (await hotelSnapshot(db, now)).bookings.find((b) => b.id === stayId);
  await command({ type: 'checkout', id: stayId, revision: paid.folioRevision });
  assert.equal(await accountBalance(db, '1320'), 0, 'guest receivable fully collected');
  assert.equal(await accountBalance(db, '1010'), due);
}));

test('only in-house stays can be charged and room rows need a resolved stay', async () => fixture(async ({ db, futureId, chargeBill }) => {
  await assert.rejects(chargeBill(futureId, 100, 'BILL-ROOM-2'), /not checked in/);
  await assert.rejects(chargeBill('HT-MISSING', 100, 'BILL-ROOM-3'), /not found/);
  assert.throws(() => validateAllocations([{ method: 'room', amount: 100 }], 100), /not available/);
  assert.equal((await db.get("SELECT COUNT(*) AS c FROM bills WHERE bill_number LIKE 'BILL-ROOM-%'")).c, 0, 'failed charges roll back');
}));
