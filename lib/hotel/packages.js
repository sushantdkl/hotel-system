/**
 * Meal plans / packages with real daily entitlement.
 *
 * A rate plan (hotel_rate_plans) has components (hotel_plan_components), e.g.
 * Half board = Breakfast NPR 800 per adult + Dinner NPR 1,200 per adult.
 *
 * Definitions (documented for reports and tests):
 * - Entitlement day: a component with timing `after_night` (breakfast) is
 *   available on each morning after a stayed night: arrival < date <= departure.
 *   `night_of` (dinner) is available on each stayed night: arrival <= date < departure.
 * - Daily allowance = adult_cents x adults + child_cents x children, per component.
 * - Accrual: each posted room night defers the package value of that night
 *   (sum of components x pax, capped at the night's total) from room revenue
 *   to 2160 Package Allowance Liability (see folios.js / splitPackage).
 * - Consumption: a restaurant or room-service bill charged to the room uses the
 *   remaining allowance for the bill's calendar date, outlet and time window.
 *   The covered part is settled with payment method `package` (Dr 2160), so the
 *   restaurant still recognizes its F&B revenue exactly once; only the overage
 *   reaches the guest folio.
 * - Breakage: at checkout the stay's unused accrual (accrued - consumed) moves
 *   from 2160 to 4045 Package Breakage Revenue (net) and 2020 tax. If more was
 *   consumed than accrued (early departure), the difference is taken back from
 *   room revenue (Dr 4030) so 2160 always clears to zero for the stay.
 */
import { randomUUID } from 'node:crypto';
import { postJournal } from '../accounting.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export const PLAN_CODES = ['ROOM_ONLY', 'BED_AND_BREAKFAST', 'HALF_BOARD', 'FULL_BOARD', 'CUSTOM'];
export const OUTLETS = ['restaurant', 'room_service'];
const isTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v || '');

export const kathmanduClock = (now = new Date()) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kathmandu', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
};

export async function planComponents(tx, planName) {
  if (!planName) return [];
  return tx.all(`SELECT c.* FROM hotel_plan_components c JOIN hotel_rate_plans p ON p.id = c.plan_id
    WHERE LOWER(p.name) = LOWER(?) ORDER BY c.sort_order, c.label`, [planName]);
}

export const pax = (booking) => ({ adults: Number(booking.adults ?? booking.guest_count ?? 1), children: Number(booking.children || 0) });
export const componentDaily = (component, booking) => {
  const { adults, children } = pax(booking);
  return Number(component.adult_cents) * adults + Number(component.child_cents) * children;
};

/** Package value deferred for one posted night. */
export async function nightPackageCents(tx, booking) {
  const components = await planComponents(tx, booking.meal_plan);
  return components.reduce((sum, c) => sum + componentDaily(c, booking), 0);
}

export function entitledOn(component, booking, date) {
  return component.timing === 'night_of'
    ? booking.arrival_date <= date && date < booking.departure_date
    : booking.arrival_date < date && date <= booking.departure_date;
}

/** Remaining allowance per component for a date / outlet / time. */
export async function packageAllowance(tx, booking, { date, time, outlet }) {
  const components = await planComponents(tx, booking.meal_plan);
  const used = await tx.all('SELECT component_id, COALESCE(SUM(amount_cents), 0) AS used FROM hotel_package_usage WHERE reservation_id = ? AND usage_date = ? AND reversed = 0 GROUP BY component_id', [booking.id, date]);
  const usedBy = new Map(used.map((row) => [row.component_id, Number(row.used)]));
  return components.map((c) => {
    const daily = componentDaily(c, booking);
    const reasons = [];
    if (!entitledOn(c, booking, date)) reasons.push('not included on this date');
    if (time && (time < c.start_time || time > c.end_time)) reasons.push(`served ${c.start_time}–${c.end_time}`);
    if (outlet && !String(c.outlets).split(',').includes(outlet)) reasons.push(`not valid for ${outlet.replace('_', ' ')}`);
    const remaining = Math.max(0, daily - (usedBy.get(c.id) || 0));
    return { id: c.id, label: c.label, daily, used: usedBy.get(c.id) || 0, remaining: reasons.length ? 0 : remaining, eligible: !reasons.length, reason: reasons.join('; ') };
  });
}

/**
 * Use the stay's allowance for (part of) a bill. Idempotent per bill and
 * component (source_key). Returns the covered cents.
 */
export async function consumePackage(tx, { booking, billId, billNumber, maxCents, date, time, outlet, actorId }) {
  if (!(maxCents > 0)) return 0;
  const existing = await tx.get('SELECT COALESCE(SUM(amount_cents), 0) AS c FROM hotel_package_usage WHERE bill_id = ? AND reversed = 0', [billId]);
  if (Number(existing.c) > 0) return Number(existing.c); // retried settlement
  let left = maxCents;
  for (const c of await packageAllowance(tx, booking, { date, time, outlet })) {
    if (left <= 0) break;
    const take = Math.min(left, c.remaining);
    if (take <= 0) continue;
    await tx.run(`INSERT INTO hotel_package_usage (id, reservation_id, component_id, component_label, usage_date, outlet, bill_id, bill_number, amount_cents, source_key, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [randomUUID(), booking.id, c.id, c.label, date, outlet, billId, billNumber || null, take, `pkg:${billId}:${c.id}`, actorId || null]);
    left -= take;
  }
  return maxCents - left;
}

/** Accrued (posted) vs consumed package value for a stay. */
export async function packagePosition(tx, reservationId) {
  const accrued = await tx.get('SELECT COALESCE(SUM(package_cents), 0) AS c FROM hotel_folio_entries WHERE reservation_id = ? AND kind = \'charge\'', [reservationId]);
  const reversedAccrual = await tx.get(`SELECT COALESCE(SUM(o.package_cents), 0) AS c FROM hotel_folio_entries r JOIN hotel_folio_entries o ON o.id = r.reversal_of
    WHERE r.reservation_id = ? AND r.kind = 'credit' AND r.category = 'adjustment'`, [reservationId]);
  const consumed = await tx.get('SELECT COALESCE(SUM(amount_cents), 0) AS c FROM hotel_package_usage WHERE reservation_id = ? AND reversed = 0', [reservationId]);
  return { accrued: Number(accrued.c) - Number(reversedAccrual.c), consumed: Number(consumed.c) };
}

/** Checkout / cancellation: clear the stay's 2160 balance. Idempotent per stay. */
export async function settlePackage(tx, { booking, actor, day, today }) {
  if (await tx.get('SELECT reservation_id FROM hotel_package_settlements WHERE reservation_id = ?', [booking.id])) return null;
  const { accrued, consumed } = await packagePosition(tx, booking.id);
  const diff = accrued - consumed;
  let journalId = null;
  if (diff !== 0) {
    const bps = Number(booking.room_tax_bps || 0);
    const amount = Math.abs(diff);
    const tax = Math.round(amount * bps / (10000 + bps));
    const lines = diff > 0
      ? [{ code: '2160', debit: amount / 100 }, { code: '4045', credit: (amount - tax) / 100 }, ...(tax ? [{ code: '2020', credit: tax / 100 }] : [])]
      : [{ code: '4030', debit: amount / 100, memo: 'Package consumed beyond posted nights' }, { code: '2160', credit: amount / 100 }];
    journalId = await postJournal(tx, {
      entry_date: today, source_type: 'hotel_package', source_id: null, external_ref: `hotel:package:${booking.id}`,
      memo: `${booking.id} · package ${diff > 0 ? 'breakage (unused allowance)' : 'over-consumption'}`, created_by: actor.id, business_day_id: day.id, lines,
    });
  }
  await tx.run('INSERT INTO hotel_package_settlements (reservation_id, accrued_cents, consumed_cents, breakage_cents, journal_id) VALUES (?, ?, ?, ?, ?)',
    [booking.id, accrued, consumed, diff, journalId]);
  return { accrued, consumed, breakage: diff };
}

/** Setup: replace a plan's code, description and components. */
export async function savePlanPackage(tx, { planId, planCode, description, components }) {
  const plan = await tx.get('SELECT * FROM hotel_rate_plans WHERE id = ?', [planId]);
  if (!plan) fail('Rate plan not found.', 404);
  if (!PLAN_CODES.includes(planCode)) fail('Choose a plan type.');
  if (!Array.isArray(components) || components.length > 6) fail('A plan can have up to 6 components.');
  const clean = components.map((c, index) => {
    const label = String(c.label || '').trim().slice(0, 40);
    const adult = Math.round(Number(c.adult) * 100);
    const child = Math.round(Number(c.child || 0) * 100);
    if (!label || !Number.isFinite(adult) || adult < 0 || adult > 10000000 || !Number.isFinite(child) || child < 0 || child > 10000000) fail('Each component needs a name and allowance amounts.');
    if (!['after_night', 'night_of'].includes(c.timing)) fail('Choose when each component is served.');
    if (!isTime(c.start || '00:00') || !isTime(c.end || '23:59')) fail('Enter serving times as HH:MM.');
    const outlets = [].concat(c.outlets || OUTLETS).filter((o) => OUTLETS.includes(o));
    if (!outlets.length) fail('Choose at least one outlet for each component.');
    return { label, adult, child, timing: c.timing, start: c.start || '00:00', end: c.end || '23:59', outlets: outlets.join(','), index };
  });
  await tx.run('UPDATE hotel_rate_plans SET plan_code = ?, description = ? WHERE id = ?', [planCode, String(description || '').slice(0, 200), planId]);
  await tx.run('DELETE FROM hotel_plan_components WHERE plan_id = ?', [planId]);
  for (const c of clean) {
    await tx.run('INSERT INTO hotel_plan_components (id, plan_id, label, adult_cents, child_cents, timing, start_time, end_time, outlets, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [randomUUID(), planId, c.label, c.adult, c.child, c.timing, c.start, c.end, c.outlets, c.index]);
  }
  return { id: planId, message: `${plan.name}: ${clean.length} package component(s) saved. Existing stays use the new allowance from tonight's posting.` };
}

export async function listPlanComponents(db) {
  const rows = await db.all('SELECT * FROM hotel_plan_components ORDER BY plan_id, sort_order');
  return rows.map((c) => ({ id: c.id, planId: c.plan_id, label: c.label, adult: Number(c.adult_cents) / 100, child: Number(c.child_cents) / 100, timing: c.timing, start: c.start_time, end: c.end_time, outlets: String(c.outlets).split(',') }));
}
