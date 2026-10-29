/**
 * Seasons and rate plans. A booking snapshots one price per night
 * (`hotel_reservations.nightly_rates_json`, date -> cents) so later changes to
 * seasons, plans or room tariffs never re-price an existing stay. Nights added
 * by an extension fall back to the booking's `nightly_rate_cents`.
 *
 * Night price = room tariff adjusted by the matching season (percent), plus the
 * rate plan's per-night supplement (e.g. breakfast).
 */
import { randomUUID } from 'node:crypto';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '') && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
export const DEFAULT_PLANS = [{ name: 'Room only', supplementCents: 0 }, { name: 'Breakfast included', supplementCents: 0 }];

export function stayDates(start, end) {
  const out = [];
  for (let t = Date.parse(`${start}T00:00:00Z`); t < Date.parse(`${end}T00:00:00Z`); t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** The season for one night: a room-type-specific season beats an all-rooms one; then the latest start wins. */
export function seasonFor(seasons, date, roomType) {
  return seasons
    .filter((s) => s.start <= date && s.end >= date && (!s.roomType || s.roomType === roomType))
    .sort((a, b) => Number(Boolean(b.roomType)) - Number(Boolean(a.roomType)) || b.start.localeCompare(a.start))[0] || null;
}

/** [{ date, cents }] for each night of a stay. */
export function priceStay({ baseCents, roomType, start, end, seasons = [], supplementCents = 0 }) {
  return stayDates(start, end).map((date) => {
    const season = seasonFor(seasons, date, roomType);
    const adjusted = season ? Math.round(baseCents * (10000 + season.adjustBps) / 10000) : baseCents;
    return { date, cents: Math.max(0, adjusted) + supplementCents };
  });
}

/** Price of one night for an existing booking. */
export function nightRate(booking, date) {
  try {
    const map = booking.nightly_rates_json ? JSON.parse(booking.nightly_rates_json) : null;
    if (map && map[date] != null) return Number(map[date]);
  } catch { /* fall back to the flat rate */ }
  return Number(booking.nightly_rate_cents);
}

export async function loadRates(tx) {
  const seasons = await tx.all('SELECT * FROM hotel_rate_seasons ORDER BY start_date, name');
  const plans = await tx.all('SELECT * FROM hotel_rate_plans ORDER BY name');
  return {
    seasons: seasons.map((s) => ({ id: s.id, name: s.name, start: s.start_date, end: s.end_date, roomType: s.room_type, adjustBps: Number(s.adjust_bps) })),
    plans: plans.length ? plans.map((p) => ({ id: p.id, name: p.name, supplementCents: Number(p.supplement_cents), planCode: p.plan_code || 'CUSTOM', description: p.description || '' })) : DEFAULT_PLANS,
  };
}

/** Setup commands: season, season_delete, plan, plan_delete. Runs inside the hotel transaction. */
export async function processRateCommand(tx, action) {
  if (action.type === 'season') {
    if (!action.name || action.name.length > 60) fail('Enter a season name (up to 60 characters).');
    if (!isDate(action.start) || !isDate(action.end) || action.end < action.start) fail('Choose valid season dates.');
    const pct = Number(action.percent);
    if (!Number.isFinite(pct) || pct < -90 || pct > 500) fail('Enter an adjustment from -90% to +500%.');
    const id = randomUUID();
    await tx.run('INSERT INTO hotel_rate_seasons (id, name, start_date, end_date, room_type, adjust_bps) VALUES (?, ?, ?, ?, ?, ?)',
      [id, action.name, action.start, action.end, action.roomType || '', Math.round(pct * 100)]);
    return { id, message: `Season ${action.name} saved. New bookings use it; existing bookings keep their prices.` };
  }
  if (action.type === 'plan') {
    if (!action.name || action.name.length > 60) fail('Enter a rate plan name (up to 60 characters).');
    const supplement = Number(action.supplement);
    if (!Number.isFinite(supplement) || supplement < 0 || supplement > 1000000) fail('Enter a valid per-night supplement.');
    const existing = await tx.get('SELECT id FROM hotel_rate_plans WHERE LOWER(name) = LOWER(?)', [action.name]);
    const id = existing?.id || randomUUID();
    if (existing) await tx.run('UPDATE hotel_rate_plans SET supplement_cents = ? WHERE id = ?', [Math.round(supplement * 100), id]);
    else await tx.run('INSERT INTO hotel_rate_plans (id, name, supplement_cents) VALUES (?, ?, ?)', [id, action.name, Math.round(supplement * 100)]);
    return { id, message: `Rate plan ${action.name} saved.` };
  }
  const table = action.type === 'season_delete' ? 'hotel_rate_seasons' : 'hotel_rate_plans';
  const result = await tx.run(`DELETE FROM ${table} WHERE id = ?`, [action.id]);
  if (!result.changes) fail('Not found.', 404);
  return { id: action.id, message: 'Removed. Existing bookings keep their prices.' };
}
