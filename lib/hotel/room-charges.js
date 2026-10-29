/**
 * Restaurant bills charged to an in-house hotel stay.
 *
 * The restaurant bill stays a real restaurant bill. Its sale journal recognizes
 * F&B revenue once: Dr 1320 Hotel Guest Receivables (method `room`) and/or
 * Dr 2160 Package Allowance Liability (method `package`, the part covered by the
 * guest's meal plan), Cr 4010 Sales / 2020 tax. The folio row posted here
 * (source RESTAURANT or ROOM_SERVICE, source_id = bill id) carries no journal of
 * its own; it links to that sale journal so the guest's checkout balance
 * includes it and the folio payment (Dr Cash/Bank, Cr 1320) clears it. Paying
 * the folio never recognizes F&B revenue again.
 *
 * Retries: the folio row key is restaurant-bill:<bill id> (unique), package
 * usage keys are pkg:<bill id>:<component> (unique).
 */
import { ensureHotelSchema } from './schema.js';
import { loadFolio, postCharge, prepareHotelAccounting } from './folios.js';
import { folioTotals } from './folio-math.js';
import { hotelBusinessDate } from './service.js';
import { consumePackage, kathmanduClock, packageAllowance } from './packages.js';

const fail = (message, status = 409) => { throw Object.assign(new Error(message), { status }); };

/** Schema + hotel accounts. Call before the POS transaction starts. */
export async function prepareRoomCharges(db) {
  await ensureHotelSchema(db);
  await prepareHotelAccounting(db);
}

/** Outlet of a restaurant order: a room-service table or order type, else restaurant. */
export async function orderOutlet(db, orderId) {
  if (!orderId) return 'restaurant';
  const row = await db.get(`SELECT o.order_type, t.table_type, t.hotel_room_id FROM orders o LEFT JOIN tables t ON t.id = o.table_id WHERE o.id = ?`, [orderId]).catch(() => null);
  return row && (row.order_type === 'room_service' || row.table_type === 'room_service' || row.hotel_room_id) ? 'room_service' : 'restaurant';
}

/** In-house stays the POS can charge to, with what the cashier must see. */
export async function listChargeableStays(db, { now = new Date(), outlet = 'restaurant', query = '' } = {}) {
  await ensureHotelSchema(db);
  const q = `%${String(query || '').trim().toLowerCase()}%`;
  const rows = await db.all(`SELECT b.*, r.room_number
    FROM hotel_reservations b JOIN hotel_rooms r ON r.id = b.room_id
    WHERE b.property_id = 'main' AND b.status = 'in_house' AND b.checked_out_at IS NULL
      AND (LOWER(r.room_number) LIKE ? OR LOWER(b.guest_name) LIKE ? OR LOWER(b.id) LIKE ? OR b.guest_phone LIKE ?)
    ORDER BY r.room_number`, [q, q, q, q]);
  const { date, time } = kathmanduClock(now);
  const out = [];
  for (const row of rows) {
    const totals = folioTotals(await loadFolio(db, row.id));
    const allowance = await packageAllowance(db, row, { date, time, outlet }).catch(() => []);
    const blocked = Number(row.no_post) ? 'No-post: room charging is blocked for this stay.'
      : row.credit_limit_cents != null && totals.balance >= Number(row.credit_limit_cents) ? 'Credit limit reached. Collect a payment at the front desk first.' : null;
    out.push({
      id: row.id, room: row.room_number, guest: row.guest_name, phone: row.guest_phone, meal: row.meal_plan, arrival: row.arrival_date, departure: row.departure_date,
      folioBalance: totals.balance / 100, creditLimit: row.credit_limit_cents == null ? null : Number(row.credit_limit_cents) / 100,
      allowance: allowance.map((a) => ({ label: a.label, remaining: a.remaining / 100, daily: a.daily / 100, eligible: a.eligible, reason: a.reason })),
      allowanceRemaining: allowance.reduce((s, a) => s + a.remaining, 0) / 100,
      chargeable: !blocked, reason: blocked,
    });
  }
  return out;
}

/**
 * Re-check the stay inside the settling transaction. PostgreSQL locks the
 * property row, the same lock hotel checkout takes, so a stay cannot be
 * checked out between this check and the folio insert.
 */
export async function lockChargeableStay(tx, reservationId) {
  if (!reservationId) fail('Choose the guest room to charge.', 400);
  if (tx.driver === 'postgres') await tx.get("SELECT id FROM hotel_properties WHERE id = 'main' FOR UPDATE");
  const stay = await tx.get(`SELECT b.*, r.room_number
    FROM hotel_reservations b JOIN hotel_rooms r ON r.id = b.room_id WHERE b.id = ? AND b.property_id = 'main'`, [String(reservationId)]);
  if (!stay) fail('That hotel stay was not found.', 404);
  if (stay.status !== 'in_house' || stay.checked_out_at) fail(`Room ${stay.room_number} is not checked in. Choose an in-house guest.`);
  if (Number(stay.no_post)) fail(`Room ${stay.room_number} is marked no-post. Take payment directly.`);
  return { id: stay.id, room: stay.room_number, guest: stay.guest_name, booking: stay };
}

/**
 * Split the `room` allocation into the meal-plan covered part (`package`) and
 * the overage (`room`). Server-side only; clients cannot send `package`.
 * Mutates and returns the allocation list.
 */
export async function applyPackageAllowance(tx, { room, allocations, billId, billNumber, actorId, outlet = 'restaurant', now = new Date(), usePackage = true }) {
  const roomRow = allocations.find((row) => row.method === 'room');
  if (!roomRow || !usePackage || !room?.booking) return { allocations, covered: 0 };
  const { date, time } = kathmanduClock(now);
  const covered = await consumePackage(tx, { booking: room.booking, billId, billNumber, maxCents: roomRow.cents, date, time, outlet, actorId });
  if (!covered) return { allocations, covered: 0 };
  roomRow.cents -= covered;
  roomRow.amount = roomRow.cents / 100;
  const pkg = { ...roomRow, method: 'package', cents: covered, amount: covered / 100, notes: `Meal plan allowance (${room.booking.meal_plan})` };
  const next = allocations.filter((row) => row !== roomRow || roomRow.cents > 0);
  next.push(pkg);
  return { allocations: next, covered };
}

export async function postRoomChargeToFolio(tx, { stay, billId, billNumber, amount, journalId, actorId, businessDayId, outlet = 'restaurant', now = new Date() }) {
  const cents = Math.round(Number(amount) * 100);
  if (!(cents > 0)) return null;
  const booking = stay.booking || await tx.get('SELECT b.*, r.room_number FROM hotel_reservations b JOIN hotel_rooms r ON r.id = b.room_id WHERE b.id = ?', [stay.id]);
  const today = await hotelBusinessDate(tx, now);
  const sourceType = outlet === 'room_service' ? 'ROOM_SERVICE' : 'RESTAURANT';
  // The bill total already includes VAT/service; the folio shows it gross.
  return postCharge(tx, {
    booking, actor: { id: actorId }, day: businessDayId ? { id: businessDayId } : null, today, sourceType, sourceId: String(billId),
    description: `${outlet === 'room_service' ? 'Room service' : 'Restaurant'} bill ${billNumber || billId}`, netCents: cents, taxCents: 0,
    key: `restaurant-bill:${billId}`, journalId: journalId || null,
  });
}

/** Folio row(s) and package usage behind a restaurant bill, for cross-navigation. */
export async function folioLinkForBill(db, billId) {
  const row = await db.get(`SELECT f.id, f.reservation_id, f.amount_cents, f.window_no, b.guest_name, r.room_number FROM hotel_folio_entries f
    JOIN hotel_reservations b ON b.id = f.reservation_id JOIN hotel_rooms r ON r.id = b.room_id
    WHERE f.source_type IN ('RESTAURANT', 'ROOM_SERVICE') AND f.source_id = ? AND f.kind = 'charge' AND f.transfer_ref IS NULL`, [String(billId)]).catch(() => null);
  const pkg = await db.get('SELECT reservation_id, COALESCE(SUM(amount_cents), 0) AS c FROM hotel_package_usage WHERE bill_id = ? AND reversed = 0 GROUP BY reservation_id', [billId]).catch(() => null);
  if (!row && !pkg) return null;
  return { stayId: row?.reservation_id || pkg.reservation_id, folioEntryId: row ? Number(row.id) : null, folioAmount: row ? Number(row.amount_cents) / 100 : 0, packageAmount: pkg ? Number(pkg.c) / 100 : 0, guest: row?.guest_name, room: row?.room_number };
}

/**
 * Restaurant void of a room-charged bill: the sale journal reversal (done by the
 * restaurant) clears 1320/2160; here the folio row is neutralized with a credit
 * (no journal) and the package usage is released. The stay must still be open.
 */
export async function reverseRoomChargeForBill(tx, { billId, actorId, reason, businessDayId = null, now = new Date() }) {
  const row = await tx.get("SELECT f.*, b.status, b.checked_out_at FROM hotel_folio_entries f JOIN hotel_reservations b ON b.id = f.reservation_id WHERE f.source_type IN ('RESTAURANT', 'ROOM_SERVICE') AND f.source_id = ? AND f.kind = 'charge' AND f.transfer_ref IS NULL", [String(billId)]);
  const usage = await tx.get('SELECT reservation_id FROM hotel_package_usage WHERE bill_id = ? AND reversed = 0 LIMIT 1', [billId]);
  if (!row && !usage) return false;
  const stayId = row?.reservation_id || usage.reservation_id;
  const stay = await tx.get('SELECT status, checked_out_at FROM hotel_reservations WHERE id = ?', [stayId]);
  if (stay.status !== 'in_house' || stay.checked_out_at) fail('The guest has already checked out. Correct this bill with a hotel folio adjustment instead.');
  if (row) {
    if (await tx.get('SELECT id FROM hotel_folio_entries WHERE reversal_of = ?', [row.id])) fail('The folio charge for this bill was transferred or reversed. Transfer it back to the guest folio first.');
    const today = await hotelBusinessDate(tx, now);
    await tx.run(`INSERT INTO hotel_folio_entries (reservation_id, kind, category, description, service_date, net_cents, tax_cents, amount_cents, source_key, business_day_id, created_by, source_type, source_id, room_number, window_no, reversal_of, reason)
      VALUES (?, 'credit', 'adjustment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.reservation_id, `Bill voided · ${row.description}`, today, row.net_cents, row.tax_cents, row.amount_cents, `restaurant-void:${billId}`, businessDayId, actorId, row.source_type, row.source_id, row.room_number, row.window_no, row.id, reason || 'Restaurant bill voided']);
  }
  await tx.run('UPDATE hotel_package_usage SET reversed = 1 WHERE bill_id = ?', [billId]);
  return true;
}

/** Corrections other than a full void (refund, reopen, settlement edit) stay blocked. */
export async function assertNotRoomCharged(db, billId) {
  const row = await db.get("SELECT id FROM bill_payment_allocations WHERE bill_id = ? AND method IN ('room', 'package') LIMIT 1", [billId]).catch(() => null);
  if (row) fail('This bill was charged to a hotel room. Void it (the folio is corrected automatically) or post a folio adjustment at the front desk.');
}
