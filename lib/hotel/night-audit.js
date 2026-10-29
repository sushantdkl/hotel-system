/**
 * Night audit for one hotel business date (the open restaurant business day,
 * see hotelBusinessDate). Run manually from the front desk; there is no
 * background scheduler. It:
 *  1. reports the pre-audit checklist (arrivals not checked in, due-outs still
 *     in house, open restaurant orders, unverified payments, OTA conflicts,
 *     folios over credit limit),
 *  2. posts every due room night for in-house stays, with the package
 *     (meal-plan) part deferred to 2160 — idempotent per stay and night
 *     (source_key night:<stay>:<date>), so a re-run never duplicates charges,
 *  3. marks unarrived non-guaranteed reservations from earlier dates as
 *     no-shows when their folio is settled; guaranteed or deposit-holding ones
 *     are listed for review (charge the no-show fee, then mark no-show),
 *  4. records occupancy, ADR, RevPAR and revenue for the date.
 * The whole run is one transaction: a failure leaves nothing half-posted, and
 * the audit can simply be run again (restartable).
 */
import { closeUnarrivedFolio, loadFolio, postDueNights } from './folios.js';
import { folioTotals } from './folio-math.js';

const fail = (message, status = 409) => { throw Object.assign(new Error(message), { status }); };
const safe = async (promise, fallback) => { try { return await promise; } catch { return fallback; } };

export async function auditChecklist(tx, today) {
  const arrivals = await tx.all(`SELECT b.id, b.guest_name, r.room_number FROM hotel_reservations b JOIN hotel_rooms r ON r.id = b.room_id
    WHERE b.status = 'confirmed' AND b.booking_type <> 'waitlist' AND b.arrival_date <= ? ORDER BY b.arrival_date`, [today]);
  const dueOuts = await tx.all(`SELECT b.id, b.guest_name, r.room_number, b.departure_date FROM hotel_reservations b JOIN hotel_rooms r ON r.id = b.room_id
    WHERE b.status = 'in_house' AND b.checked_out_at IS NULL AND b.departure_date <= ?`, [today]);
  const openOrders = await safe(tx.get(`SELECT COUNT(*) AS n FROM orders WHERE status NOT IN ('completed', 'cancelled', 'voided', 'paid', 'rejected', 'refunded')
    AND business_day_id = (SELECT id FROM business_days WHERE status = 'open' ORDER BY id DESC LIMIT 1)`), { n: 0 });
  const unverified = await safe(tx.get("SELECT COUNT(*) AS n FROM bill_payments WHERE verification_status = 'pending'"), { n: 0 });
  const otaConflicts = await safe(tx.get("SELECT COUNT(*) AS n FROM hotel_ota_conflicts WHERE status = 'open'"), { n: 0 });
  const inHouse = await tx.all("SELECT id, guest_name, credit_limit_cents FROM hotel_reservations WHERE status = 'in_house' AND checked_out_at IS NULL AND credit_limit_cents IS NOT NULL");
  const overLimit = [];
  for (const stay of inHouse) {
    const balance = folioTotals(await loadFolio(tx, stay.id)).balance;
    if (balance > Number(stay.credit_limit_cents)) overLimit.push(`${stay.id} (${stay.guest_name}) NPR ${(balance / 100).toFixed(2)} over limit NPR ${(Number(stay.credit_limit_cents) / 100).toFixed(2)}`);
  }
  return {
    pendingArrivals: arrivals.map((a) => `${a.id} ${a.guest_name} · room ${a.room_number}`),
    dueOuts: dueOuts.map((d) => `${d.id} ${d.guest_name} · room ${d.room_number} · due ${d.departure_date}`),
    openRestaurantOrders: Number(openOrders.n), unverifiedPayments: Number(unverified.n), otaConflicts: Number(otaConflicts.n), overCreditLimit: overLimit,
  };
}

export async function runNightAudit(tx, actor, requestKey, today, { force = false, reason = '' } = {}) {
  const previous = await tx.get('SELECT business_date FROM hotel_night_audits WHERE business_date = ?', [today]);
  if (previous && !force) fail(`The night audit for ${today} has already run. Re-run it (with a reason) to post nights for late check-ins; posted nights are never duplicated.`);
  if (previous && !reason) fail('Enter the reason for re-running the night audit.', 400);
  const checklist = await auditChecklist(tx, today);
  const inHouse = await tx.all("SELECT b.*, r.room_number FROM hotel_reservations b JOIN hotel_rooms r ON r.id = b.room_id WHERE b.property_id = 'main' AND b.status = 'in_house' AND b.checked_out_at IS NULL ORDER BY b.id");
  // The open business day is required only when a night is actually posted.
  const day = await tx.get("SELECT id FROM business_days WHERE status = 'open' ORDER BY id DESC LIMIT 1").catch(() => null);
  let posted = 0;
  for (const stay of inHouse) posted += await postDueNights(tx, stay, actor, today);

  const missed = await tx.all(`SELECT b.*, r.room_number FROM hotel_reservations b JOIN hotel_rooms r ON r.id = b.room_id
    WHERE b.property_id = 'main' AND b.status = 'confirmed' AND b.arrival_date < ?`, [today]);
  const noShows = []; const review = [];
  for (const row of missed) {
    if (row.booking_type === 'guaranteed') { review.push(`${row.id} (${row.guest_name}): guaranteed — post the no-show charge, then mark no-show`); continue; }
    const closed = await closeUnarrivedFolio(tx, row, actor, today, `${requestKey}:${row.id}`);
    if (closed.ok) {
      await tx.run("UPDATE hotel_reservations SET status = 'cancelled', no_show = 1, cancelled_at = CURRENT_TIMESTAMP WHERE id = ?", [row.id]);
      noShows.push(`${row.id} (${row.guest_name}, room ${row.room_number})`);
    } else review.push(`${row.id} (${row.guest_name}): deposit or charges on folio`);
  }

  // Room-night statistics for the date (definitions in lib/hotel/reports.js).
  const rooms = await tx.get("SELECT COUNT(*) AS n FROM hotel_rooms WHERE property_id = 'main' AND blocked = 0");
  const night = await tx.get(`SELECT COUNT(*) AS sold, COALESCE(SUM(net_cents), 0) AS net FROM hotel_folio_entries f
    WHERE f.source_type = 'ROOM' AND f.kind = 'charge' AND f.transfer_ref IS NULL AND f.service_date = ?
    AND NOT EXISTS (SELECT 1 FROM hotel_folio_entries x WHERE x.reversal_of = f.id AND x.category = 'adjustment')`, [today]);
  const sold = Number(night.sold);
  const available = Number(rooms.n);
  const revenue = Number(night.net);
  const summary = {
    date: today, businessDayId: day?.id || null,
    inHouse: inHouse.length, sellableRooms: available, roomsSold: sold,
    occupancyPercent: available ? Math.round((sold / available) * 1000) / 10 : 0,
    adr: sold ? Math.round(revenue / sold) / 100 : 0, revpar: available ? Math.round(revenue / available) / 100 : 0,
    roomNightsPosted: posted, roomRevenueToday: revenue / 100,
    overstays: inHouse.filter((stay) => stay.departure_date < today).length,
    noShows, needsReview: review, checklist,
    rerun: previous ? { by: actor.id, reason } : null,
  };
  if (previous) await tx.run('UPDATE hotel_night_audits SET summary_json = ?, run_by = ? WHERE business_date = ?', [JSON.stringify(summary), actor.id, today]);
  else await tx.run('INSERT INTO hotel_night_audits (business_date, run_by, summary_json) VALUES (?, ?, ?)', [today, actor.id, JSON.stringify(summary)]);
  return {
    id: today,
    message: `Night audit for ${today}${previous ? ' (re-run)' : ''}: ${posted} room night(s) posted, ${noShows.length} no-show(s)${review.length ? `, ${review.length} to review` : ''}.`,
  };
}
