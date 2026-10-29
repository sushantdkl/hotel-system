/**
 * OTA / channel-manager sync.
 *
 * Inbound:
 *  - Webhook: POST /api/webhooks/ota/<channelId> with the channel's token
 *    (header `x-ota-token` or `?token=`). Body is the normalized event below;
 *    a channel manager (Channex, SiteMinder, ...) is mapped to it by a small
 *    adapter or its webhook transform:
 *      { event: 'new' | 'modified' | 'cancelled', external_id, room?: '101',
 *        room_type?: 'Deluxe', guest: { name, phone?, email? }, arrival, departure,
 *        guests?, total_amount?, prepaid? }
 *  - iCal: each room feed's import URL (Airbnb, Booking.com, ...) is fetched by
 *    "Sync now" or a cron call; every VEVENT becomes a booking for that room and
 *    events that disappear from the feed are cancelled.
 * Outbound: each room feed has a private iCal export (/api/ical/<token>) with
 * the room's booked nights, which the OTA imports to block availability.
 *
 * Anything that cannot be applied safely (no free room, guest already
 * checked in, money on the folio, unknown room) goes to the conflict queue for
 * a manager; nothing is overbooked silently.
 */
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { ensureHotelSchema } from './schema.js';
import { hotelDate, hotelTransaction, roomConflict } from './service.js';
import { resolveBookingGuest } from './guests.js';
import { loadRates, priceStay } from './rates.js';
import { FOLIO_BALANCE_SQL } from './folio-math.js';
import { unappliedDeposit } from './folios.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '') && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const token = () => randomBytes(24).toString('hex');
const nightsOf = (start, end) => Math.round((Date.parse(end) - Date.parse(start)) / 86400000);

/* ---------------------------------------------------------------- setup */

export async function saveChannel(db, data) {
  await ensureHotelSchema(db);
  const name = String(data?.name || '').trim().slice(0, 60);
  const pct = Number(data?.commissionPercent ?? 0);
  if (!name) fail('Enter the channel name.');
  if (!Number.isFinite(pct) || pct < 0 || pct > 50) fail('Commission must be between 0% and 50%.');
  if (data?.id) {
    const result = await db.run('UPDATE hotel_ota_channels SET name = ?, commission_bps = ?, active = ? WHERE id = ?', [name, Math.round(pct * 100), data.active === false ? 0 : 1, data.id]);
    if (!result.changes) fail('Channel not found.', 404);
    return { id: data.id, message: `${name} updated.` };
  }
  if (await db.get('SELECT id FROM hotel_ota_channels WHERE LOWER(name) = LOWER(?)', [name])) fail('A channel with that name already exists.', 409);
  const id = `ch_${randomUUID().slice(0, 8)}`;
  await db.run('INSERT INTO hotel_ota_channels (id, name, commission_bps, webhook_token) VALUES (?, ?, ?, ?)', [id, name, Math.round(pct * 100), token()]);
  return { id, message: `${name} added.` };
}

export async function rotateChannelToken(db, id) {
  const result = await db.run('UPDATE hotel_ota_channels SET webhook_token = ? WHERE id = ?', [token(), id]);
  if (!result.changes) fail('Channel not found.', 404);
  return { message: 'Webhook token replaced. Update it in the channel manager.' };
}

export async function saveFeed(db, { channelId, roomNumber, importUrl = '' }) {
  await ensureHotelSchema(db);
  const url = String(importUrl || '').trim();
  if (url && !/^https:\/\/[^\s]+$/i.test(url)) fail('The iCal import URL must start with https://.');
  const room = await db.get("SELECT id FROM hotel_rooms WHERE property_id = 'main' AND room_number = ?", [String(roomNumber || '')]);
  if (!room) fail('Room not found.', 404);
  if (!(await db.get('SELECT id FROM hotel_ota_channels WHERE id = ?', [channelId]))) fail('Channel not found.', 404);
  const existing = await db.get('SELECT id FROM hotel_ota_feeds WHERE channel_id = ? AND room_id = ?', [channelId, room.id]);
  if (existing) await db.run('UPDATE hotel_ota_feeds SET import_url = ?, last_error = NULL WHERE id = ?', [url, existing.id]);
  else await db.run('INSERT INTO hotel_ota_feeds (id, channel_id, room_id, import_url, export_token) VALUES (?, ?, ?, ?, ?)', [randomUUID(), channelId, room.id, url, token()]);
  return { message: `Calendar link saved for room ${roomNumber}.` };
}

export async function deleteFeed(db, id) {
  const result = await db.run('DELETE FROM hotel_ota_feeds WHERE id = ?', [id]);
  if (!result.changes) fail('Calendar link not found.', 404);
  return { message: 'Calendar link removed. Existing bookings are kept.' };
}

export async function otaOverview(db) {
  await ensureHotelSchema(db);
  const channels = await db.all('SELECT * FROM hotel_ota_channels ORDER BY name');
  const feeds = await db.all('SELECT f.*, r.room_number, c.name AS channel_name FROM hotel_ota_feeds f JOIN hotel_rooms r ON r.id = f.room_id JOIN hotel_ota_channels c ON c.id = f.channel_id ORDER BY c.name, r.room_number');
  const log = await db.all('SELECT l.*, c.name AS channel_name FROM hotel_ota_log l LEFT JOIN hotel_ota_channels c ON c.id = l.channel_id ORDER BY l.created_at DESC LIMIT 50');
  const conflicts = await db.all("SELECT k.*, c.name AS channel_name FROM hotel_ota_conflicts k JOIN hotel_ota_channels c ON c.id = k.channel_id WHERE k.status = 'open' ORDER BY k.created_at");
  const bookings = await db.all(`SELECT o.*, c.name AS channel_name FROM hotel_ota_bookings o JOIN hotel_ota_channels c ON c.id = o.channel_id ORDER BY o.updated_at DESC LIMIT 100`);
  return {
    channels: channels.map((c) => ({ id: c.id, name: c.name, commissionPercent: Number(c.commission_bps) / 100, token: c.webhook_token, active: Boolean(Number(c.active)) })),
    feeds: feeds.map((f) => ({ id: f.id, channelId: f.channel_id, channel: f.channel_name, room: f.room_number, importUrl: f.import_url, exportToken: f.export_token, lastSyncAt: f.last_sync_at, lastError: f.last_error })),
    log,
    conflicts: conflicts.map((k) => ({ id: k.id, channel: k.channel_name, externalId: k.external_id, reason: k.reason, event: JSON.parse(k.event_json), createdAt: k.created_at })),
    bookings: bookings.map((o) => ({ channel: o.channel_name, externalId: o.external_id, reservationId: o.reservation_id, status: o.status, total: Number(o.total_cents) / 100, commission: Number(o.commission_cents) / 100, prepaid: Boolean(Number(o.prepaid)) })),
  };
}

/* ---------------------------------------------------------------- events */

export function normalizeEvent(raw) {
  const e = raw && typeof raw === 'object' ? raw : {};
  const event = String(e.event || e.status || '').toLowerCase();
  const out = {
    event: event === 'cancel' ? 'cancelled' : event === 'modify' ? 'modified' : event,
    externalId: String(e.external_id ?? e.booking_id ?? '').trim().slice(0, 100),
    room: e.room == null ? '' : String(e.room).trim().slice(0, 12),
    roomType: String(e.room_type || '').trim().slice(0, 60),
    guest: String(e.guest?.name ?? e.guest_name ?? '').trim().slice(0, 100),
    phone: String(e.guest?.phone ?? '').trim().slice(0, 30),
    arrival: String(e.arrival || '').slice(0, 10),
    departure: String(e.departure || '').slice(0, 10),
    guests: Number(e.guests || 1),
    totalCents: e.total_amount == null || e.total_amount === '' ? null : Math.round(Number(e.total_amount) * 100),
    prepaid: e.prepaid === true || e.prepaid === 'true' || e.payment_collect === 'ota',
  };
  if (!['new', 'modified', 'cancelled'].includes(out.event)) fail('event must be new, modified or cancelled.');
  if (!out.externalId) fail('external_id is required.');
  if (out.event !== 'cancelled') {
    if (!isDate(out.arrival) || !isDate(out.departure) || out.departure <= out.arrival) fail('arrival and departure must be valid YYYY-MM-DD dates.');
    if (!Number.isInteger(out.guests) || out.guests < 1 || out.guests > 20) fail('guests must be 1 to 20.');
    if (out.totalCents !== null && (!Number.isFinite(out.totalCents) || out.totalCents < 0)) fail('total_amount must be a positive number.');
  }
  return out;
}

async function log(tx, channelId, source, outcome, externalId, message) {
  await tx.run('INSERT INTO hotel_ota_log (id, channel_id, source, outcome, external_id, message) VALUES (?, ?, ?, ?, ?, ?)', [randomUUID(), channelId, source, outcome, externalId || '', String(message).slice(0, 500)]);
}

async function conflict(tx, channel, ev, reason, source) {
  const open = await tx.get("SELECT id FROM hotel_ota_conflicts WHERE channel_id = ? AND external_id = ? AND status = 'open'", [channel.id, ev.externalId]);
  if (open) await tx.run('UPDATE hotel_ota_conflicts SET reason = ?, event_json = ? WHERE id = ?', [reason, JSON.stringify(ev), open.id]);
  else await tx.run('INSERT INTO hotel_ota_conflicts (id, channel_id, external_id, reason, event_json) VALUES (?, ?, ?, ?, ?)', [randomUUID(), channel.id, ev.externalId, reason, JSON.stringify(ev)]);
  await log(tx, channel.id, source, 'conflict', ev.externalId, reason);
  return { outcome: 'conflict', message: reason };
}

/** A free room for the stay: the requested one, else the first free room of the type. */
async function pickRoom(tx, ev, today, exceptId = null) {
  if (ev.room) {
    const room = await tx.get("SELECT * FROM hotel_rooms WHERE property_id = 'main' AND room_number = ?", [ev.room]);
    if (!room) return { error: `Room ${ev.room} does not exist in this hotel.` };
    if (room.blocked || Number(room.capacity) < ev.guests || await roomConflict(tx, room.id, ev.arrival, ev.departure, today, exceptId)) return { error: `Room ${ev.room} is not available for ${ev.arrival} to ${ev.departure}.` };
    return { room };
  }
  if (!ev.roomType) return { error: 'The booking names no room or room type. Map it to a room.' };
  const rooms = await tx.all("SELECT * FROM hotel_rooms WHERE property_id = 'main' AND LOWER(room_type) = LOWER(?) AND blocked = 0 AND capacity >= ? ORDER BY room_number", [ev.roomType, ev.guests]);
  if (!rooms.length) return { error: `No ${ev.roomType} rooms exist for ${ev.guests} guests.` };
  for (const room of rooms) if (!(await roomConflict(tx, room.id, ev.arrival, ev.departure, today, exceptId))) return { room };
  return { error: `Overbooking: no ${ev.roomType} room is free for ${ev.arrival} to ${ev.departure}.` };
}

// A cancellation is safe only with nothing owed or held: a zero balance and no
// unapplied advance deposit (that needs a refund or a fee at the front desk).
async function folioBalance(tx, reservationId) {
  const row = await tx.get(`SELECT COALESCE(SUM(${FOLIO_BALANCE_SQL}), 0) AS b FROM hotel_folio_entries WHERE reservation_id = ?`, [reservationId]);
  return Number(row.b) || (await unappliedDeposit(tx, reservationId));
}

/** Apply one normalized event inside a hotel transaction. */
export async function applyOtaEvent(tx, channel, ev, { source = 'webhook', today = hotelDate() } = {}) {
  if (tx.driver === 'postgres') await tx.get("SELECT id FROM hotel_properties WHERE id = 'main' FOR UPDATE");
  const known = await tx.get('SELECT o.*, r.status AS res_status, r.checked_out_at FROM hotel_ota_bookings o LEFT JOIN hotel_reservations r ON r.id = o.reservation_id WHERE o.channel_id = ? AND o.external_id = ?', [channel.id, ev.externalId]);
  // Cancellations carry no amount: a cancelled booking keeps no total or commission.
  const commission = (total) => (total == null ? 0 : Math.round(total * Number(channel.commission_bps) / 10000));
  const record = async (reservationId, status) => {
    const values = [reservationId, status, ev.totalCents ?? 0, commission(ev.totalCents), ev.prepaid ? 1 : 0, JSON.stringify(ev)];
    if (known) await tx.run('UPDATE hotel_ota_bookings SET reservation_id = ?, status = ?, total_cents = ?, commission_cents = ?, prepaid = ?, payload_json = ?, updated_at = CURRENT_TIMESTAMP WHERE channel_id = ? AND external_id = ?', [...values, channel.id, ev.externalId]);
    else await tx.run('INSERT INTO hotel_ota_bookings (reservation_id, status, total_cents, commission_cents, prepaid, payload_json, channel_id, external_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [...values, channel.id, ev.externalId]);
  };
  const done = async (message) => { await log(tx, channel.id, source, 'ok', ev.externalId, message); return { outcome: 'ok', message }; };

  if (ev.event === 'cancelled') {
    if (!known?.reservation_id) return done('Cancellation for an unknown booking ignored.');
    if (known.res_status === 'cancelled') return done('Already cancelled.');
    if (known.res_status === 'in_house' || known.checked_out_at) return conflict(tx, channel, ev, `Cancelled by ${channel.name}, but the guest is already checked in. Review with the guest.`, source);
    if (await folioBalance(tx, known.reservation_id) !== 0) return conflict(tx, channel, ev, `Cancelled by ${channel.name}, but the folio has a deposit or charges. Refund or post a fee, then cancel.`, source);
    await tx.run("UPDATE hotel_reservations SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP WHERE id = ?", [known.reservation_id]);
    await record(known.reservation_id, 'cancelled');
    return done(`Reservation ${known.reservation_id} cancelled.`);
  }

  if (known?.reservation_id && known.res_status !== 'cancelled') {
    // Modification (or a repeated "new"): update dates/room of the existing stay.
    if (known.res_status !== 'confirmed') return conflict(tx, channel, ev, `Changed by ${channel.name}, but the stay is already ${known.checked_out_at ? 'checked out' : 'in house'}.`, source);
    const current = await tx.get('SELECT r.*, rm.room_number FROM hotel_reservations r JOIN hotel_rooms rm ON rm.id = r.room_id WHERE r.id = ?', [known.reservation_id]);
    const sameRoom = !ev.room || ev.room === current.room_number;
    let room = null;
    if (sameRoom && !(await roomConflict(tx, current.room_id, ev.arrival, ev.departure, today, current.id))) room = { id: current.room_id, room_number: current.room_number };
    else {
      const picked = await pickRoom(tx, { ...ev, roomType: ev.roomType || current.room_type }, today, current.id);
      if (picked.error) return conflict(tx, channel, ev, picked.error, source);
      room = picked.room;
    }
    const nightly = ev.totalCents === null ? Number(current.nightly_rate_cents) : Math.round(ev.totalCents / nightsOf(ev.arrival, ev.departure));
    await tx.run('UPDATE hotel_reservations SET room_id = ?, arrival_date = ?, departure_date = ?, guest_count = ?, nightly_rate_cents = ?, nightly_rates_json = NULL WHERE id = ?',
      [room.id, ev.arrival, ev.departure, ev.guests, nightly, current.id]);
    await record(current.id, 'confirmed');
    return done(`Reservation ${current.id} updated: room ${room.room_number}, ${ev.arrival} to ${ev.departure}.`);
  }

  if (ev.arrival < today) return conflict(tx, channel, ev, `Arrival ${ev.arrival} is in the past.`, source);
  const picked = await pickRoom(tx, ev, today);
  if (picked.error) return conflict(tx, channel, ev, picked.error, source);
  const room = picked.room;
  const guest = await resolveBookingGuest(tx, { guest: ev.guest || `${channel.name} guest`, phone: ev.phone });
  const property = await tx.get("SELECT room_tax_bps FROM hotel_properties WHERE id = 'main'");
  let nightly; let ratesJson = null;
  if (ev.totalCents !== null) nightly = Math.round(ev.totalCents / nightsOf(ev.arrival, ev.departure));
  else {
    const priced = priceStay({ baseCents: Number(room.nightly_rate_cents), roomType: room.room_type, start: ev.arrival, end: ev.departure, seasons: (await loadRates(tx)).seasons });
    nightly = priced[0].cents;
    ratesJson = JSON.stringify(Object.fromEntries(priced.map((n) => [n.date, n.cents])));
  }
  const id = `HT-${randomUUID().slice(0, 8).toUpperCase()}`;
  await tx.run(`INSERT INTO hotel_reservations (id, property_id, room_id, guest_id, guest_name, guest_phone, arrival_date, departure_date, guest_count, source, meal_plan, nightly_rate_cents, nightly_rates_json, room_tax_bps)
    VALUES (?, 'main', ?, ?, ?, ?, ?, ?, ?, ?, 'Room only', ?, ?, ?)`,
  [id, room.id, guest.id, guest.name, guest.phone || ev.phone, ev.arrival, ev.departure, ev.guests, channel.name, nightly, ratesJson, property.room_tax_bps]);
  await record(id, 'confirmed');
  await tx.run("UPDATE hotel_ota_conflicts SET status = 'resolved', resolution = 'Applied automatically', resolved_at = CURRENT_TIMESTAMP WHERE channel_id = ? AND external_id = ? AND status = 'open'", [channel.id, ev.externalId]);
  return done(`Reservation ${id} created in room ${room.room_number}${ev.prepaid ? ' (prepaid to OTA)' : ''}.`);
}

/** Webhook entry point: authenticate the channel token, normalize, apply. */
export async function receiveWebhook(db, channelId, providedToken, body) {
  await ensureHotelSchema(db);
  const channel = await db.get('SELECT * FROM hotel_ota_channels WHERE id = ?', [String(channelId || '')]);
  const expected = Buffer.from(String(channel?.webhook_token || ''));
  const given = Buffer.from(String(providedToken || ''));
  if (!channel || !expected.length || expected.length !== given.length || !timingSafeEqual(expected, given)) fail('Invalid channel or token.', 401);
  if (!channel.active) fail('This channel is paused.', 409);
  let ev;
  try { ev = normalizeEvent(body); } catch (error) {
    await log(db, channel.id, 'webhook', 'error', String(body?.external_id || ''), error.message);
    throw error;
  }
  return hotelTransaction(db, (tx) => applyOtaEvent(tx, channel, ev, { source: 'webhook' }));
}

export async function resolveConflict(db, actor, id, { action, note = '' }) {
  await ensureHotelSchema(db);
  const row = await db.get("SELECT k.*, c.commission_bps, c.name, c.id AS cid FROM hotel_ota_conflicts k JOIN hotel_ota_channels c ON c.id = k.channel_id WHERE k.id = ? AND k.status = 'open'", [id]);
  if (!row) fail('Conflict not found or already handled.', 404);
  if (action === 'dismiss') {
    await db.run("UPDATE hotel_ota_conflicts SET status = 'dismissed', resolution = ?, resolved_by = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?", [String(note).slice(0, 300) || 'Dismissed', actor.id, id]);
    return { message: 'Conflict dismissed.' };
  }
  if (action !== 'retry') fail('Choose retry or dismiss.');
  const channel = { id: row.cid, name: row.name, commission_bps: row.commission_bps };
  const ev = JSON.parse(row.event_json);
  const result = await hotelTransaction(db, (tx) => applyOtaEvent(tx, channel, ev, { source: 'webhook' }));
  if (result.outcome === 'ok') await db.run("UPDATE hotel_ota_conflicts SET status = 'resolved', resolution = ?, resolved_by = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?", [result.message, actor.id, id]);
  return { message: result.outcome === 'ok' ? `Applied: ${result.message}` : `Still blocked: ${result.message}` };
}

/* ---------------------------------------------------------------- iCal */

const unfold = (text) => String(text).replace(/\r?\n[ \t]/g, '');
const icsDate = (value) => {
  const m = /(\d{4})(\d{2})(\d{2})/.exec(value || '');
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

/** Minimal VEVENT parser: UID, DTSTART, DTEND (dates), SUMMARY. */
export function parseIcs(text) {
  const events = [];
  for (const block of unfold(text).split('BEGIN:VEVENT').slice(1)) {
    const body = block.split('END:VEVENT')[0];
    const field = (name) => {
      const line = body.split(/\r?\n/).find((l) => l.toUpperCase().startsWith(`${name}:`) || l.toUpperCase().startsWith(`${name};`));
      return line ? line.slice(line.indexOf(':') + 1).trim() : '';
    };
    const start = icsDate(field('DTSTART'));
    const end = icsDate(field('DTEND')) || (start ? new Date(Date.parse(`${start}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) : null);
    const uid = field('UID');
    if (uid && start && end && end > start) events.push({ uid, start, end, summary: field('SUMMARY').replace(/\\,/g, ',').slice(0, 100) });
  }
  return events;
}

/** Pull every room feed with an import URL. Never throws for one bad feed. */
export async function syncIcalFeeds(db, { fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  await ensureHotelSchema(db);
  const today = hotelDate(now);
  const feeds = await db.all("SELECT f.*, r.room_number, c.name AS channel_name, c.commission_bps, c.active FROM hotel_ota_feeds f JOIN hotel_rooms r ON r.id = f.room_id JOIN hotel_ota_channels c ON c.id = f.channel_id WHERE f.import_url <> ''");
  const summary = { feeds: 0, applied: 0, conflicts: 0, errors: 0 };
  for (const feed of feeds) {
    if (!Number(feed.active)) continue;
    summary.feeds += 1;
    const channel = { id: feed.channel_id, name: feed.channel_name, commission_bps: feed.commission_bps };
    try {
      const response = await fetchImpl(feed.import_url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`Calendar responded ${response.status}.`);
      const events = parseIcs(await response.text()).filter((e) => e.end > today);
      const seen = new Set();
      for (const e of events) {
        const externalId = `ical:${feed.room_number}:${e.uid}`.slice(0, 100);
        seen.add(externalId);
        const result = await hotelTransaction(db, async (tx) => {
          // Our own export echoed back by the OTA: same room, same dates, not from this feed.
          const echo = await tx.get(`SELECT b.id FROM hotel_reservations b WHERE b.room_id = ? AND b.arrival_date = ? AND b.departure_date = ? AND b.status IN ('confirmed', 'in_house')
            AND NOT EXISTS (SELECT 1 FROM hotel_ota_bookings o WHERE o.reservation_id = b.id AND o.channel_id = ? AND o.external_id = ?)`, [feed.room_id, e.start, e.end, feed.channel_id, externalId]);
          if (echo) return { outcome: 'ignored' };
          const known = await tx.get("SELECT o.status, r.arrival_date, r.departure_date FROM hotel_ota_bookings o JOIN hotel_reservations r ON r.id = o.reservation_id WHERE o.channel_id = ? AND o.external_id = ?", [feed.channel_id, externalId]);
          if (known && known.status !== 'cancelled' && known.arrival_date === e.start && known.departure_date === e.end) return { outcome: 'ignored' };
          return applyOtaEvent(tx, channel, { event: known ? 'modified' : 'new', externalId, room: feed.room_number, roomType: '', guest: e.summary && !/not available|reserved|blocked|closed/i.test(e.summary) ? e.summary : `${feed.channel_name} guest`, phone: '', arrival: e.start, departure: e.end, guests: 1, totalCents: null, prepaid: false }, { source: 'ical', today });
        });
        if (result.outcome === 'ok') summary.applied += 1;
        if (result.outcome === 'conflict') summary.conflicts += 1;
      }
      // Bookings that vanished from the feed were cancelled on the OTA.
      const active = await db.all("SELECT external_id FROM hotel_ota_bookings WHERE channel_id = ? AND status = 'confirmed' AND external_id LIKE ?", [feed.channel_id, `ical:${feed.room_number}:%`]);
      for (const row of active) {
        if (seen.has(row.external_id)) continue;
        const r = await hotelTransaction(db, (tx) => applyOtaEvent(tx, channel, { event: 'cancelled', externalId: row.external_id }, { source: 'ical', today }));
        if (r.outcome === 'conflict') summary.conflicts += 1; else summary.applied += 1;
      }
      await db.run('UPDATE hotel_ota_feeds SET last_sync_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = ?', [feed.id]);
    } catch (error) {
      summary.errors += 1;
      await db.run('UPDATE hotel_ota_feeds SET last_sync_at = CURRENT_TIMESTAMP, last_error = ? WHERE id = ?', [String(error.message).slice(0, 300), feed.id]);
      await log(db, feed.channel_id, 'ical', 'error', feed.room_number, `Room ${feed.room_number}: ${error.message}`);
    }
  }
  return { ...summary, message: `Synced ${summary.feeds} calendar(s): ${summary.applied} change(s), ${summary.conflicts} conflict(s), ${summary.errors} error(s).` };
}

const icsEscape = (v) => String(v).replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');

/** Private availability feed for one room: booked nights only, no guest data. */
export async function exportIcs(db, exportToken, now = new Date()) {
  await ensureHotelSchema(db);
  const feed = await db.get('SELECT f.room_id, r.room_number FROM hotel_ota_feeds f JOIN hotel_rooms r ON r.id = f.room_id WHERE f.export_token = ?', [String(exportToken || '')]);
  if (!feed) fail('Calendar not found.', 404);
  const today = hotelDate(now);
  const rows = await db.all(`SELECT id, arrival_date, departure_date FROM hotel_reservations WHERE room_id = ? AND status IN ('confirmed', 'in_house') AND checked_out_at IS NULL AND departure_date > ? ORDER BY arrival_date`, [feed.room_id, today]);
  const blocked = await db.get('SELECT blocked FROM hotel_rooms WHERE id = ?', [feed.room_id]);
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const day = (d) => d.replace(/-/g, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Hotel PMS//Availability//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsEscape(`Room ${feed.room_number}`)}`];
  for (const r of rows) lines.push('BEGIN:VEVENT', `UID:${r.id}@hotel-pms`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${day(r.arrival_date)}`, `DTEND;VALUE=DATE:${day(r.departure_date)}`, 'SUMMARY:Not available', 'END:VEVENT');
  if (Number(blocked?.blocked)) {
    const end = new Date(Date.parse(`${today}T00:00:00Z`) + 30 * 86400000).toISOString().slice(0, 10);
    lines.push('BEGIN:VEVENT', `UID:block-${feed.room_id}@hotel-pms`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${day(today)}`, `DTEND;VALUE=DATE:${day(end)}`, 'SUMMARY:Out of order', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}
