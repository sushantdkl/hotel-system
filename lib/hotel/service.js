/**
 * Hotel command bus (POST /api/hotel) and the front-office snapshot (GET).
 *
 * Domain: a reservation row (hotel_reservations) is one room's booking and,
 * after check-in, that room's stay. Several rows share a master reservation
 * (hotel_groups, group_id) for multi-room bookings. A room assignment change
 * is a room move (hotel_room_moves, immutable). Money lives on the stay's folio
 * (lib/hotel/folios.js), keyed by stay id, never by room number.
 *
 * Every write runs in one transaction that first locks the property row, so
 * availability checks and bookings cannot interleave (no double booking).
 */
import { createHash, randomUUID } from 'node:crypto';
import { ensureHotelSchema } from './schema.js';
import { closeUnarrivedFolio, FOLIO_SOURCES, loadStay, postedNightDates, MANUAL_CHARGE_SOURCES, PAYMENT_METHODS, prepareHotelAccounting, processCleaningCommand, processFolioCommand, unappliedDeposit } from './folios.js';
import { dueRoomNights, folioTotals, taxedAmount } from './folio-math.js';
import { isPermissionAllowedSync } from '../permissions.js';
import { ensureStaffHrSchema } from '../staff-hr.js';
import { resolveBookingGuest } from './guests.js';
import { loadRates, nightRate, priceStay, processRateCommand, stayDates } from './rates.js';
import { runNightAudit } from './night-audit.js';
import { assignTask, createCleaningTask, listTickets, reportIssue, requestStayover, setRoomFlag, updateTicket } from './operations.js';
import { deliverPending, ensureNotificationSchema } from '../notifications.js';
import { createPrecheckinLink } from './precheckin.js';
import { applyCategoryDefaults, listCategories, processCategoryCommand } from './categories.js';
import { permissionRole } from '../roles.js';
import { listPlanComponents, savePlanPackage, PLAN_CODES } from './packages.js';
import { consumeMinibar, createLaundry, listLaundry, listMinibarItems, saveMinibarItem, updateLaundry } from './guest-services.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const queues = new WeakMap();
export const hotelDate = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

/**
 * Hotel business date follows the restaurant Business Day. Normally it is the
 * Kathmandu calendar date. When the open business day started yesterday and
 * staff chose "Continue" for it today (stale_ack_date = today, the restaurant's
 * cross-midnight mechanism), hotel postings belong to that open day, exactly
 * like restaurant sales; night audit and closing then finish that date. An
 * open day from an earlier date that was not continued is stale, and postings
 * are refused (postingDay) just as restaurant activity is.
 */
export async function hotelBusinessDate(db, now = new Date()) {
  const calendar = hotelDate(now);
  try {
    const day = await db.get("SELECT business_date, stale_ack_date FROM business_days WHERE status = 'open' ORDER BY id DESC LIMIT 1");
    const open = day ? String(day.business_date).slice(0, 10) : null;
    if (open && open < calendar && day.stale_ack_date === calendar) return open;
  } catch { /* business days not installed yet */ }
  return calendar;
}
const text = (value, max = 100) => {
  const clean = typeof value === 'string' ? value.trim() : '';
  if (clean.length > max) fail(`A field exceeds its ${max}-character limit.`);
  return clean;
};
const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const integer = (value, min, max) => Number.isInteger(Number(value)) && Number(value) >= min && Number(value) <= max;
const cents = (value) => Math.round(Number(value) * 100);
const optionalInt = (value) => (value === '' || value == null ? null : Number(value));
const flag = (value) => value === true || value === 'on' || value === '1' || value === 1;
function positiveMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000 || Math.abs(amount * 100 - cents(amount)) > 0.000001) fail('Enter an amount greater than zero, up to NPR 1,000,000, with at most two decimal places.');
  return cents(amount);
}
function moneyOrNull(value) {
  if (value === '' || value == null) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100000000) fail('Enter a valid amount.');
  return cents(amount);
}
function taxBasisPoints(value) {
  if (value == null) return null;
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100 || Math.abs(rate * 100 - Math.round(rate * 100)) > 0.000001) fail('Enter a tax percentage from 0 to 100 with at most two decimal places.');
  return Math.round(rate * 100);
}

export const BOOKING_TYPES = ['tentative', 'confirmed', 'guaranteed', 'waitlist'];
export const MARKET_SEGMENTS = ['', 'Leisure', 'Corporate', 'Government', 'Group', 'Wedding / event', 'Travel agent', 'OTA', 'Long stay', 'Complimentary'];
export const MOVE_REASONS = ['Guest request', 'Maintenance issue', 'Noise complaint', 'Upgrade', 'Downgrade', 'Operational move', 'Room condition', 'Management decision'];
export const BOOKING_SOURCES = ['Direct', 'Walk-In', 'Phone', 'Website', 'Travel Agent', 'Corporate', 'Booking.com', 'Agoda', 'Expedia', 'Airbnb', 'MakeMyTrip', 'Other OTA'];

function reservationDetails(data) {
  return {
    adults: optionalInt(data.adults), children: optionalInt(data.children) ?? 0,
    bookingType: text(data.bookingType, 20) || 'confirmed', company: text(data.company, 100), agent: text(data.agent, 100),
    segment: text(data.segment, 40), guarantee: text(data.guarantee, 100), specialRequests: text(data.specialRequests, 500), notes: text(data.notes, 1000),
  };
}

function normalizeAction(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('Send a valid hotel operation.');
  switch (data.type) {
    case 'property': return { type: data.type, name: text(data.name), taxBps: taxBasisPoints(data.taxPercent) };
    case 'room': case 'room_edit': return {
      type: data.type, roomId: text(data.roomId, 12), floor: Number(data.floor), roomType: text(data.roomType, 60), capacity: Number(data.capacity), rate: Number(data.rate), version: Number(data.version) || null,
      categoryId: text(data.categoryId, 60), rateGiven: data.rate !== '' && data.rate != null, capacityGiven: data.capacity !== '' && data.capacity != null,
    };
    case 'category': return {
      type: data.type, id: text(data.id, 60), name: text(data.name, 60), rate: Number(data.rate), capacity: Number(data.capacity),
      beds: text(data.beds, 60), description: text(data.description, 300), amenities: text(data.amenities, 300),
      applyToRooms: data.applyToRooms === true || data.applyToRooms === 'on',
    };
    case 'category_delete': return { type: data.type, id: text(data.id, 60) };
    case 'rooms_bulk': return { type: data.type, categoryId: text(data.categoryId, 60), floor: Number(data.floor), from: Number(data.from), to: Number(data.to), prefix: text(data.prefix, 4) };
    case 'room_status': return { type: data.type, roomId: text(data.roomId, 12), version: Number(data.version), cleaning: text(data.cleaning), blocked: Number(data.blocked), blockKind: text(data.blockKind, 20) || 'out_of_order', reason: text(data.reason, 200) };
    case 'book': return {
      type: data.type, guest: text(data.guest), phone: text(data.phone, 30), guestId: text(data.guestId, 20),
      roomIds: (Array.isArray(data.roomIds) ? data.roomIds : [data.roomId]).map((room) => text(room, 12)).filter(Boolean),
      start: text(data.start, 10), end: text(data.end, 10), guests: Number(data.guests), meal: text(data.meal, 60) || 'Room only', source: text(data.source, 30) || 'Direct',
      rate: data.rate === '' || data.rate == null ? null : Number(data.rate),
      groupId: text(data.groupId, 30), payer: text(data.payer, 20) || 'own', groupName: text(data.groupName, 100),
      ...reservationDetails(data),
    };
    case 'update_reservation': return { type: data.type, id: text(data.id, 60), ...reservationDetails(data), noPost: flag(data.noPost), creditLimitCents: moneyOrNull(data.creditLimit) };
    case 'booking_type': return { type: data.type, id: text(data.id, 60), bookingType: text(data.bookingType, 20) };
    case 'change_plan': return { type: data.type, id: text(data.id, 60), meal: text(data.meal, 60) };
    case 'move': return { type: data.type, id: text(data.id, 60), roomId: text(data.roomId, 12), reason: text(data.reason, 60), notes: text(data.notes, 500), rateDecision: text(data.rateDecision, 10) || 'keep' };
    case 'change_dates': return { type: data.type, id: text(data.id, 60), start: text(data.start, 10), end: text(data.end, 10) };
    case 'season': return { type: data.type, name: text(data.name, 60), start: text(data.start, 10), end: text(data.end, 10), roomType: text(data.roomType, 60), percent: Number(data.percent) };
    case 'plan': return { type: data.type, name: text(data.name, 60), supplement: Number(data.supplement || 0) };
    case 'plan_package': return { type: data.type, planId: text(data.planId, 60), planCode: text(data.planCode, 30), description: text(data.description, 200), components: Array.isArray(data.components) ? data.components.slice(0, 6) : [] };
    case 'season_delete': case 'plan_delete': return { type: data.type, id: text(data.id, 60) };
    case 'night_audit': return { type: data.type, force: flag(data.force), reason: text(data.reason, 300) };
    case 'precheckin_link': return { type: data.type, id: text(data.id, 60) };
    case 'assign_task': return { type: data.type, id: text(data.id, 60), userId: data.userId ? Number(data.userId) : null };
    case 'minibar': return { type: data.type, roomId: text(data.roomId, 12), itemId: text(data.itemId, 60), item: text(data.item, 60), quantity: Number(data.quantity), unitPrice: Number(data.unitPrice) };
    case 'minibar_item': return { type: data.type, name: text(data.name, 60), priceCents: moneyOrNull(data.price), inventoryItemId: optionalInt(data.inventoryItemId), parLevel: optionalInt(data.parLevel) ?? 2, active: data.active !== false };
    case 'laundry': return { type: data.type, roomId: text(data.roomId, 12), items: text(data.items, 300), pieces: Number(data.pieces), amountCents: moneyOrNull(data.amount) ?? -1, express: flag(data.express), notes: text(data.notes, 300) };
    case 'laundry_update': return { type: data.type, id: text(data.id, 20), status: text(data.status, 20) };
    case 'room_flag': return { type: data.type, roomId: text(data.roomId, 12), flag: text(data.flag, 10) };
    case 'stayover': return { type: data.type, roomId: text(data.roomId, 12), note: text(data.note, 200) };
    case 'report_issue': return { type: data.type, roomId: text(data.roomId, 12), title: text(data.title, 120), description: text(data.description, 1000), priority: text(data.priority, 10) || 'normal', blockRoom: flag(data.blockRoom), blockKind: text(data.blockKind, 20), until: text(data.until, 10) };
    case 'ticket_update': return { type: data.type, id: text(data.id, 20), status: text(data.status, 20), note: text(data.note, 500), userId: optionalInt(data.userId) };
    case 'refund': return { type: data.type, id: text(data.id, 60), method: text(data.method, 20), amountCents: positiveMoney(data.amount), revision: Number(data.revision), reason: text(data.reason, 200) || 'Guest credit balance returned' };
    case 'checkin': return { type: data.type, id: text(data.id, 60) };
    case 'cancel': case 'no_show': return { type: data.type, id: text(data.id, 60), reason: text(data.reason, 200) };
    case 'post_nights': case 'apply_deposit': return { type: data.type, id: text(data.id, 60) };
    case 'charge': return { type: data.type, id: text(data.id, 60), description: text(data.description, 120), amountCents: positiveMoney(data.amount), sourceType: text(data.sourceType, 20) || 'OTHER', quantity: integer(data.quantity ?? 1, 1, 100) ? Number(data.quantity ?? 1) : fail('Enter a quantity from 1 to 100.'), window: optionalInt(data.window) };
    case 'payment': return { type: data.type, id: text(data.id, 60), method: text(data.method, 20), amountCents: positiveMoney(data.amount), revision: Number(data.revision), window: optionalInt(data.window) || 1, account: text(data.account, 100) };
    case 'reverse': return { type: data.type, id: text(data.id, 60), entryId: Number(data.entryId), reason: text(data.reason, 200) };
    case 'adjust': return { type: data.type, id: text(data.id, 60), amountCents: positiveMoney(data.amount), sourceType: text(data.sourceType, 20) || 'OTHER', reason: text(data.reason, 200), window: optionalInt(data.window) || 1 };
    case 'transfer': return { type: data.type, id: text(data.id, 60), entryId: Number(data.entryId), targetId: text(data.targetId, 60), window: optionalInt(data.window) || 1, reason: text(data.reason, 200) };
    case 'window': return { type: data.type, id: text(data.id, 60), window: Number(data.window), payerType: text(data.payerType, 20), payerName: text(data.payerName, 100) };
    case 'route': return { type: data.type, id: text(data.id, 60), targetId: text(data.targetId, 60), window: optionalInt(data.window) || 1, sourceTypes: Array.isArray(data.sourceTypes) ? data.sourceTypes.map((t) => text(t, 20)) : [], clear: flag(data.clear) };
    case 'checkout': return { type: data.type, id: text(data.id, 60), revision: Number(data.revision) };
    case 'group_checkout': return { type: data.type, groupId: text(data.groupId, 30) };
    case 'clean': return { type: data.type, id: text(data.id, 60), version: Number(data.version) };
    default: return fail('This operation is not available in the live hotel yet.');
  }
}

const FOLIO_COMMANDS = ['post_nights', 'charge', 'payment', 'refund', 'checkout', 'reverse', 'adjust', 'transfer', 'window', 'route', 'apply_deposit'];
const COMMAND_PERMISSIONS = {
  book: 'hotel.front_desk', checkin: 'hotel.front_desk', cancel: 'hotel.front_desk', no_show: 'hotel.front_desk', move: 'hotel.front_desk', change_dates: 'hotel.front_desk',
  update_reservation: 'hotel.front_desk', booking_type: 'hotel.front_desk', change_plan: 'hotel.front_desk',
  post_nights: 'hotel.folios', charge: 'hotel.folios', payment: 'hotel.folios', refund: 'hotel.folios', checkout: 'hotel.folios', group_checkout: 'hotel.folios',
  apply_deposit: 'hotel.folios', window: 'hotel.folios', reverse: 'hotel.folio_adjust', adjust: 'hotel.folio_adjust', transfer: 'hotel.folio_transfer', route: 'hotel.folio_transfer',
  clean: 'hotel.housekeeping', night_audit: 'hotel.folios',
  assign_task: 'hotel.front_desk', precheckin_link: 'hotel.front_desk', minibar: ['hotel.housekeeping', 'hotel.folios'],
  laundry: ['hotel.laundry', 'hotel.folios'], laundry_update: ['hotel.laundry', 'hotel.folios'],
  room_flag: ['hotel.housekeeping', 'hotel.front_desk'], stayover: ['hotel.housekeeping', 'hotel.front_desk'],
  report_issue: ['hotel.housekeeping', 'hotel.maintenance', 'hotel.front_desk'], ticket_update: 'hotel.maintenance',
};
// Anything not listed (property, rooms, room status, rates, plans, minibar catalog) is hotel setup.
// A list means any one of those permissions is enough.
export const hotelCommandPermission = (type) => COMMAND_PERMISSIONS[type] || 'hotel.setup';
const mayRun = (role, type) => [].concat(hotelCommandPermission(type)).some((key) => isPermissionAllowedSync(role, key));

// An overdue in-house guest still holds their room after planned departure.
// Waitlisted bookings hold no room.
export async function roomConflict(tx, roomId, start, end, today, exceptId = null) {
  return tx.get(`SELECT id FROM hotel_reservations WHERE room_id = ? AND id <> ? AND status IN ('confirmed', 'in_house') AND checked_out_at IS NULL AND booking_type <> 'waitlist'
    AND (status = 'in_house' AND departure_date <= ? OR arrival_date < ? AND departure_date > ?) LIMIT 1`, [roomId, exceptId || '', today, end, start]);
}

async function audit(tx, actor, action, entityId, message, { reason = null, today = null, details = {} } = {}) {
  await tx.run("INSERT INTO hotel_audit_events (id, property_id, actor_id, action, entity_id, details, reason, business_date) VALUES (?, 'main', ?, ?, ?, ?, ?, ?)",
    [randomUUID(), actor.id, action, entityId, JSON.stringify({ message, ...details }), reason, today]);
}
async function ownerAlert(tx, actor, severity, title, message, link) {
  await tx.run('INSERT INTO owner_alerts (created_by, severity, category, title, message, link_label) VALUES (?, ?, ?, ?, ?, ?)', [actor.id, severity, 'Other', title, message, link || null]);
}

/** Price nights from `fromDate` for a room tariff with seasons + plan supplement. */
async function priceNights(tx, { room, start, end, meal }) {
  const rates = await loadRates(tx);
  const plan = rates.plans.find((p) => p.name.toLowerCase() === String(meal || '').toLowerCase());
  return priceStay({ baseCents: Number(room.nightly_rate_cents), roomType: room.room_type, start, end, seasons: rates.seasons, supplementCents: plan?.supplementCents || 0 });
}
const ratesMap = (booking) => { try { return booking.nightly_rates_json ? JSON.parse(booking.nightly_rates_json) : {}; } catch { return {}; } };

/** Room move (reason, rate decision, history) and date changes for confirmed and in-house stays. */
async function changeStay(tx, action, actor, today, can) {
  const booking = await loadStay(tx, action.id);
  if (!booking) fail('Reservation not found.', 404);
  if (!['confirmed', 'in_house'].includes(booking.status) || booking.checked_out_at) fail('Only confirmed or in-house stays can be changed.', 409);
  const inHouse = booking.status === 'in_house';
  if (action.type === 'move') {
    if (!MOVE_REASONS.includes(action.reason)) fail('Choose the reason for the room move.');
    if (!['keep', 'new'].includes(action.rateDecision)) fail('Choose whether to keep the current rate or use the new room’s rate.');
    const target = await tx.get("SELECT * FROM hotel_rooms WHERE property_id = 'main' AND room_number = ?", [action.roomId]);
    if (!target) fail('Room not found.', 404);
    if (target.id === booking.room_id) fail('The guest is already in that room.');
    if (target.blocked) fail(`Room ${target.room_number} is out of ${target.block_kind === 'out_of_service' ? 'service' : 'order'}.`, 409);
    if (Number(target.capacity) < Number(booking.guest_count)) fail(`Room ${target.room_number} accommodates up to ${target.capacity} guests.`);
    if (inHouse && target.cleaning_status !== 'ready') fail(`Room ${target.room_number} must be inspected and ready before moving a guest in.`, 409);
    const from = inHouse ? today : booking.arrival_date;
    if (await roomConflict(tx, target.id, from, booking.departure_date, today, booking.id)) fail(`Room ${target.room_number} is not free for the rest of this stay.`, 409);
    const oldRoom = await tx.get('SELECT * FROM hotel_rooms WHERE id = ?', [booking.room_id]);
    const upgrade = Number(target.nightly_rate_cents) > Number(oldRoom.nightly_rate_cents);
    let newRate = Number(booking.nightly_rate_cents);
    let ratesJson = booking.nightly_rates_json;
    if (action.rateDecision === 'new') {
      // Nights already posted keep their price; remaining nights use the new room's tariff.
      const priced = await priceNights(tx, { room: target, start: from, end: booking.departure_date, meal: booking.meal_plan });
      const map = ratesMap(booking);
      for (const n of priced) map[n.date] = n.cents;
      ratesJson = JSON.stringify(map);
      newRate = priced[0]?.cents ?? Number(target.nightly_rate_cents);
    } else if (upgrade && target.room_type !== oldRoom.room_type) {
      if (!can('hotel.comp_upgrade')) fail('Keeping the rate on a higher-priced room is a complimentary upgrade. Ask a manager, or use the new room’s rate.', 403);
      await ownerAlert(tx, actor, 'low', `Complimentary upgrade: ${booking.guest_name}`, `${booking.id} moved ${oldRoom.room_number} (${oldRoom.room_type}) to ${target.room_number} (${target.room_type}) at the original rate. Reason: ${action.reason}.`, `Room ${target.room_number}`);
    }
    await tx.run('UPDATE hotel_reservations SET room_id = ?, nightly_rate_cents = ?, nightly_rates_json = ? WHERE id = ?', [target.id, newRate, ratesJson, booking.id]);
    await tx.run(`INSERT INTO hotel_room_moves (id, reservation_id, from_room_id, to_room_id, from_room_number, to_room_number, reason, notes, rate_decision, old_rate_cents, new_rate_cents, business_date, moved_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [randomUUID(), booking.id, oldRoom.id, target.id, oldRoom.room_number, target.room_number, action.reason, action.notes || '', action.rateDecision, Number(booking.nightly_rate_cents), newRate, today, actor.id]);
    // Move the room-service link (the restaurant table follows the stay, not the room).
    if (inHouse) {
      // The vacated room needs a turnover. No reservation link: checkout creates its own task later.
      await tx.run("UPDATE hotel_rooms SET cleaning_status = 'dirty', hk_flag = '', version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [booking.room_id]);
      await createCleaningTask(tx, { roomId: booking.room_id, note: `Room move: ${booking.guest_name} to ${target.room_number}`, actorId: actor.id, today, taskType: 'move' });
    }
    return { id: booking.id, message: `${booking.guest_name} moved from room ${booking.room_number} to ${target.room_number}. ${action.rateDecision === 'keep' ? 'The agreed rate is unchanged.' : `Remaining nights now NPR ${(newRate / 100).toFixed(2)} (first night).`} Folio, payments and restaurant charges stay with the guest.` };
  }
  const start = inHouse ? booking.arrival_date : (action.start || booking.arrival_date);
  const end = action.end;
  if (!isDate(start) || !isDate(end) || end <= start) fail('Choose a valid arrival and departure.');
  if (!inHouse && start < today) fail('Arrival cannot be in the past.');
  if (inHouse && end < today) fail('Departure cannot be before today.');
  if ((Date.parse(end) - Date.parse(start)) / 86400000 > 365) fail('Reservations may contain up to 365 nights.');
  const postedSet = await postedNightDates(tx, booking.id);
  const posted = { last: [...postedSet].sort().pop() || null };
  if (posted.last && end <= posted.last) fail(`Room nights are already posted through ${posted.last}. Departure must be after that.`, 409);
  if (await roomConflict(tx, booking.room_id, start, end, today, booking.id)) fail(`Room ${booking.room_number} is booked for some of those dates. Move the guest or choose other dates.`, 409);
  // Added nights of a tariff-priced stay use today's tariff, seasons and plan;
  // existing nights keep their price. A flat override rate (no per-night map)
  // stays flat for added nights.
  let ratesJson = booking.nightly_rates_json;
  if (ratesJson) {
    const map = ratesMap(booking);
    const room = await tx.get('SELECT * FROM hotel_rooms WHERE id = ?', [booking.room_id]);
    for (const n of await priceNights(tx, { room, start, end, meal: booking.meal_plan })) if (map[n.date] == null) map[n.date] = n.cents;
    ratesJson = JSON.stringify(map);
  }
  await tx.run('UPDATE hotel_reservations SET arrival_date = ?, departure_date = ?, nightly_rates_json = ? WHERE id = ?', [start, end, ratesJson, booking.id]);
  return { id: booking.id, message: `Stay ${booking.id} now runs ${start} to ${end}.` };
}

// Queue SQLite hotel transactions on this connection. PostgreSQL additionally
// serializes all hotel writes on the property row, including across workers.
export async function hotelTransaction(db, fn) {
  if (db.driver === 'postgres') return db.transaction(fn);
  const previous = queues.get(db) || Promise.resolve();
  const current = previous.catch(() => {}).then(() => db.transaction(fn));
  queues.set(db, current.catch(() => {}));
  return current;
}

const HISTORY_DAYS = 45;

/**
 * Front-office snapshot. Bounded: open reservations and stays, plus anything
 * that ended or was created in the last 45 days (older history is in reports
 * and guest profiles), so the payload does not grow with the hotel's age.
 */
export async function hotelSnapshot(db, now = new Date()) {
  await ensureHotelSchema(db);
  const today = await hotelBusinessDate(db, now);
  const since = new Date(Date.parse(today) - HISTORY_DAYS * 86400000).toISOString().slice(0, 10);
  const property = await db.get("SELECT * FROM hotel_properties WHERE id = 'main'");
  const rooms = await db.all("SELECT * FROM hotel_rooms WHERE property_id = 'main' ORDER BY floor, room_number");
  const bookings = await db.all(`SELECT b.*, r.room_number, r.room_type FROM hotel_reservations b JOIN hotel_rooms r ON r.id = b.room_id
    WHERE b.property_id = 'main' AND ((b.status IN ('confirmed', 'in_house') AND b.checked_out_at IS NULL) OR b.departure_date >= ?)
    ORDER BY b.arrival_date, b.created_at`, [since]);
  const ids = bookings.map((b) => b.id);
  const inList = ids.length ? ids.map(() => '?').join(',') : "''";
  const rates = await loadRates(db);
  const categories = await listCategories(db);
  const audits = await db.all('SELECT business_date, summary_json FROM hotel_night_audits ORDER BY business_date DESC LIMIT 7');
  const events = await db.all("SELECT action, details FROM hotel_audit_events WHERE property_id = 'main' ORDER BY created_at DESC, id DESC LIMIT 8");
  const folioRows = ids.length ? await db.all(`SELECT * FROM hotel_folio_entries WHERE reservation_id IN (${inList}) ORDER BY id`, ids) : [];
  const checkouts = ids.length ? await db.all(`SELECT reservation_id, snapshot_json FROM hotel_checkout_statements WHERE reservation_id IN (${inList})`, ids) : [];
  const windows = ids.length ? await db.all(`SELECT * FROM hotel_folio_windows WHERE reservation_id IN (${inList})`, ids) : [];
  const routes = ids.length ? await db.all(`SELECT x.*, r.room_number AS target_room FROM hotel_routing_rules x JOIN hotel_reservations t ON t.id = x.target_reservation_id JOIN hotel_rooms r ON r.id = t.room_id WHERE x.active = 1 AND x.reservation_id IN (${inList})`, ids) : [];
  const applications = ids.length ? await db.all(`SELECT reservation_id, SUM(amount_cents) AS c FROM hotel_deposit_applications WHERE reservation_id IN (${inList}) GROUP BY reservation_id`, ids) : [];
  const usage = ids.length ? await db.all(`SELECT * FROM hotel_package_usage WHERE reversed = 0 AND reservation_id IN (${inList}) ORDER BY usage_date, created_at`, ids) : [];
  const nightRows = ids.length ? await db.all("SELECT source_key FROM hotel_folio_entries WHERE kind = 'charge' AND source_key LIKE 'night:%' AND service_date >= ?", [since]) : [];
  const nightKeys = new Map();
  for (const r of nightRows) { const [, stayId, date] = String(r.source_key).split(':'); if (!nightKeys.has(stayId)) nightKeys.set(stayId, new Set()); nightKeys.get(stayId).add(date); }
  const moves = ids.length ? await db.all(`SELECT m.*, u.full_name AS moved_by_name FROM hotel_room_moves m LEFT JOIN users u ON u.id = m.moved_by WHERE m.reservation_id IN (${inList}) ORDER BY m.created_at`, ids) : [];
  const groups = await db.all('SELECT * FROM hotel_groups WHERE id IN (SELECT DISTINCT group_id FROM hotel_reservations WHERE group_id IS NOT NULL AND (checked_out_at IS NULL OR departure_date >= ?))', [since]);
  const statements = new Map(checkouts.map((row) => [row.reservation_id, JSON.parse(row.snapshot_json)]));
  const tasks = await db.all(`SELECT t.*, r.room_number, u.full_name AS updated_by_name, a.full_name AS assignee_name FROM hotel_housekeeping_tasks t JOIN hotel_rooms r ON r.id = t.room_id
    LEFT JOIN users u ON u.id = t.updated_by LEFT JOIN users a ON a.id = t.assigned_to WHERE t.status <> 'ready' OR t.completed_at >= ? ORDER BY t.created_at DESC, t.id`, [since]);
  const housekeepers = await db.all("SELECT id, full_name FROM users WHERE role = 'housekeeping' AND COALESCE(is_active, 1) = 1 ORDER BY full_name");
  const technicians = await db.all("SELECT id, full_name FROM users WHERE role = 'maintenance' AND COALESCE(is_active, 1) = 1 ORDER BY full_name");
  const tickets = await listTickets(db);
  const components = await listPlanComponents(db);
  const laundry = await listLaundry(db);
  const minibarItems = await listMinibarItems(db);
  const group = (rows, key) => rows.reduce((map, row) => { const list = map.get(row[key]) || []; list.push(row); map.set(row[key], list); return map; }, new Map());
  const folios = group(folioRows, 'reservation_id');
  const windowsBy = group(windows, 'reservation_id');
  const usageBy = group(usage, 'reservation_id');
  const movesBy = group(moves, 'reservation_id');
  const routesBy = new Map(routes.map((r) => [r.reservation_id, r]));
  const appliedBy = new Map(applications.map((a) => [a.reservation_id, Number(a.c)]));
  return {
    property: { name: property.name, timezone: property.timezone, currency: property.currency, roomTaxPercent: Number(property.room_tax_bps) / 100 },
    businessDate: today, historyDays: HISTORY_DAYS,
    seasons: rates.seasons, plans: rates.plans.map((p) => ({ ...p, components: components.filter((c) => c.planId === p.id) })), categories,
    planCodes: PLAN_CODES, bookingTypes: BOOKING_TYPES, segments: MARKET_SEGMENTS, moveReasons: MOVE_REASONS, sources: BOOKING_SOURCES,
    chargeSources: MANUAL_CHARGE_SOURCES.map((key) => ({ key, label: FOLIO_SOURCES[key].label })), paymentMethods: PAYMENT_METHODS,
    housekeepers: housekeepers.map((h) => ({ id: Number(h.id), name: h.full_name })), technicians: technicians.map((h) => ({ id: Number(h.id), name: h.full_name })), tickets, laundry, minibarItems,
    groups: groups.map((g) => ({ id: g.id, name: g.name, payerMode: g.payer_mode, masterId: g.master_reservation_id, company: g.company })),
    audits: audits.map((a) => JSON.parse(a.summary_json)),
    rooms: rooms.map((r) => ({ id: r.room_number, floor: Number(r.floor), type: r.room_type, capacity: Number(r.capacity), rate: Number(r.nightly_rate_cents) / 100, cleaning: r.cleaning_status, blocked: Boolean(r.blocked), blockKind: r.block_kind || 'out_of_order', hkFlag: r.hk_flag || '', version: Number(r.version) })),
    bookings: bookings.map((b) => {
      const entries = folios.get(b.id) || [];
      const totals = folioTotals(entries);
      const posted = nightKeys.get(b.id) || new Set();
      const dueNights = b.status === 'in_house' && !b.checked_out_at ? dueRoomNights(b.arrival_date, today).filter((date) => !posted.has(date)) : [];
      const taxed = (date) => taxedAmount(nightRate(b, date), Number(b.room_tax_bps)).total;
      const reversed = new Set(entries.filter((e) => e.reversal_of).map((e) => Number(e.reversal_of)));
      const mapEntry = (entry) => ({
        id: Number(entry.id), kind: entry.kind, category: entry.category, refund: entry.kind === 'refund', label: entry.description, amount: Number(entry.amount_cents) / 100, net: Number(entry.net_cents) / 100, tax: Number(entry.tax_cents) / 100,
        date: entry.service_date, method: entry.payment_method, journalId: entry.journal_id, sourceType: entry.source_type, sourceId: entry.source_id, window: Number(entry.window_no || 1),
        room: entry.room_number, reversalOf: entry.reversal_of ? Number(entry.reversal_of) : null, reversed: reversed.has(Number(entry.id)), transferRef: entry.transfer_ref, reason: entry.reason, quantity: Number(entry.quantity || 1), packageAmount: Number(entry.package_cents || 0) / 100,
      });
      const depositReceived = entries.filter((e) => e.category === 'deposit').reduce((s, e) => s + (e.kind === 'payment' ? 1 : -1) * Number(e.amount_cents), 0);
      const route = routesBy.get(b.id);
      return {
        id: b.id, guestId: b.guest_id, groupId: b.group_id, guest: b.guest_name, phone: b.guest_phone, initials: b.guest_name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase(), roomId: b.room_number, roomType: b.room_type,
        start: b.arrival_date, end: b.departure_date, guests: Number(b.guest_count), adults: Number(b.adults ?? b.guest_count), children: Number(b.children || 0),
        status: b.checked_out_at ? 'checked_out' : b.status, bookingType: b.booking_type || 'confirmed', source: b.source, meal: b.meal_plan, rate: Number(b.nightly_rate_cents) / 100, taxPercent: Number(b.room_tax_bps) / 100,
        company: b.company || '', agent: b.travel_agent || '', segment: b.market_segment || '', guarantee: b.guarantee || '', specialRequests: b.special_requests || '', notes: b.notes || '',
        noPost: Boolean(Number(b.no_post)), creditLimit: b.credit_limit_cents == null ? null : Number(b.credit_limit_cents) / 100,
        entries: entries.filter((entry) => entry.kind === 'charge' || entry.kind === 'credit').map(mapEntry),
        payments: entries.filter((entry) => entry.kind === 'payment' || entry.kind === 'refund').map(mapEntry),
        balance: totals.balance / 100, windowBalances: Object.fromEntries(Object.entries(totals.windows).map(([w, c]) => [w, c / 100])),
        windows: (windowsBy.get(b.id) || []).map((w) => ({ window: Number(w.window_no), payerType: w.payer_type, payerName: w.payer_name })),
        routing: route ? { targetId: route.target_reservation_id, targetRoom: route.target_room, window: Number(route.target_window), types: String(route.source_types).split(',') } : null,
        depositHeld: Math.max(0, depositReceived - (appliedBy.get(b.id) || 0)) / 100,
        packageUsage: (usageBy.get(b.id) || []).map((u) => ({ label: u.component_label, date: u.usage_date, outlet: u.outlet, bill: u.bill_number, billId: u.bill_id ? Number(u.bill_id) : null, amount: Number(u.amount_cents) / 100 })),
        moves: (movesBy.get(b.id) || []).map((m) => ({ from: m.from_room_number, to: m.to_room_number, reason: m.reason, notes: m.notes, rateDecision: m.rate_decision, date: m.business_date, by: m.moved_by_name })),
        folioRevision: entries.length, unpostedNights: dueNights, unpostedAmount: dueNights.reduce((sum, date) => sum + taxed(date), 0) / 100,
        precheckinToken: b.precheckin_token || null, precheckinAt: b.precheckin_at || null, eta: b.eta || null,
        stayValue: stayDates(b.arrival_date, b.departure_date).reduce((sum, date) => sum + taxed(date), 0) / 100,
        ratesVary: Boolean(b.nightly_rates_json) && new Set(Object.values(ratesMap(b))).size > 1, noShow: Boolean(Number(b.no_show)), statement: statements.get(b.id) || null,
      };
    }),
    tasks: tasks.map((task) => ({ id: task.id, roomId: task.room_number, status: task.status, taskType: task.task_type || 'checkout', assignee: task.assignee_name || 'Unassigned', assignedTo: task.assigned_to ? Number(task.assigned_to) : null, priority: task.priority, note: task.note, version: Number(task.version), updatedBy: task.updated_by_name, createdAt: task.created_at, startedAt: task.started_at, completedAt: task.completed_at })),
    activity: events.map((event) => JSON.parse(event.details).message),
  };
}

async function createBookings(tx, action, actor, today, can) {
  if (!isDate(action.start) || !isDate(action.end) || action.start < today || action.end <= action.start) fail('Enter a guest and valid arrival/departure dates.');
  if ((Date.parse(action.end) - Date.parse(action.start)) / 86400000 > 365) fail('Reservations may contain up to 365 nights.');
  if (!action.roomIds.length || action.roomIds.length > 10 || new Set(action.roomIds).size !== action.roomIds.length) fail('Choose between 1 and 10 different rooms.');
  if (action.rate !== null && (!Number.isFinite(action.rate) || action.rate < 0 || action.rate > 1000000)) fail('Enter a valid nightly rate.');
  if (!BOOKING_TYPES.includes(action.bookingType)) fail('Choose tentative, confirmed, guaranteed or waitlist.');
  if (action.segment && !MARKET_SEGMENTS.includes(action.segment)) fail('Choose a market segment.');
  if (!['own', 'master', 'master_rooms'].includes(action.payer)) fail('Choose who pays for the added room.');
  // Older clients send only `guests` (per room); newer ones send adults + children.
  const adults = action.adults ?? action.guests;
  const children = action.adults != null ? action.children ?? 0 : 0;
  if (!integer(adults, 1, 20) || !integer(children, 0, 19)) fail('Enter adults (1–20) and children (0–19).');
  const guests = adults + children;
  let group = null;
  if (action.groupId) {
    group = await tx.get('SELECT * FROM hotel_groups WHERE id = ?', [action.groupId]);
    if (!group) {
      // Adding a room to a single reservation turns it into a master reservation.
      const master = await loadStay(tx, action.groupId);
      if (!master || master.checked_out_at || !['confirmed', 'in_house'].includes(master.status)) fail('Master reservation not found or no longer open.', 404);
      const groupId = master.group_id || `GRP-${randomUUID().slice(0, 8).toUpperCase()}`;
      if (!master.group_id) {
        await tx.run('INSERT INTO hotel_groups (id, name, primary_guest_id, master_reservation_id, payer_mode, created_by) VALUES (?, ?, ?, ?, ?, ?)', [groupId, action.groupName || master.guest_name, master.guest_id, master.id, 'individual', actor.id]);
        await tx.run('UPDATE hotel_reservations SET group_id = ? WHERE id = ?', [groupId, master.id]);
      }
      group = await tx.get('SELECT * FROM hotel_groups WHERE id = ?', [groupId]);
    }
  }
  const master = group ? await loadStay(tx, group.master_reservation_id) : null;
  const guest = action.guestId || action.guest ? await resolveBookingGuest(tx, { guestId: action.guestId, guest: action.guest, phone: action.phone }) : master ? await resolveBookingGuest(tx, { guestId: master.guest_id }) : fail('Enter the guest name.');
  if (guest.blacklisted) fail(`${guest.name} is blacklisted. Review the guest profile before booking.`, 403);
  const property = await tx.get("SELECT room_tax_bps FROM hotel_properties WHERE id = 'main'");
  if (!group && action.roomIds.length > 1) {
    const groupId = `GRP-${randomUUID().slice(0, 8).toUpperCase()}`;
    await tx.run('INSERT INTO hotel_groups (id, name, primary_guest_id, payer_mode, company, created_by) VALUES (?, ?, ?, ?, ?, ?)', [groupId, action.groupName || guest.name, guest.id, action.payer === 'own' ? 'individual' : 'master', action.company || '', actor.id]);
    group = await tx.get('SELECT * FROM hotel_groups WHERE id = ?', [groupId]);
  }
  const rates = await loadRates(tx);
  const plan = rates.plans.find((p) => p.name.toLowerCase() === action.meal.toLowerCase());
  const ids = []; const overridden = [];
  for (const roomNumber of action.roomIds) {
    const room = await tx.get("SELECT * FROM hotel_rooms WHERE property_id = 'main' AND room_number = ?", [roomNumber]);
    if (!room) fail(`Room ${roomNumber} not found.`, 404);
    if (room.blocked) fail(`Room ${roomNumber} is out of order.`, 409);
    if (!integer(guests, 1, Number(room.capacity))) fail(`Room ${roomNumber} accommodates up to ${room.capacity} guests.`);
    if (action.bookingType !== 'waitlist' && await roomConflict(tx, room.id, action.start, action.end, today)) fail(`Room ${roomNumber} is unavailable for those dates. Refresh availability and choose another room.`, 409);
    // Seasons and the rate plan price each night; an override is one flat rate.
    const priced = action.rate === null ? priceStay({ baseCents: Number(room.nightly_rate_cents), roomType: room.room_type, start: action.start, end: action.end, seasons: rates.seasons, supplementCents: plan?.supplementCents || 0 }) : null;
    const rateCents = priced ? priced[0].cents : cents(action.rate);
    const ratesJson = priced ? JSON.stringify(Object.fromEntries(priced.map((n) => [n.date, n.cents]))) : null;
    if (action.rate !== null && rateCents !== Number(room.nightly_rate_cents)) overridden.push(`room ${roomNumber} from ${Number(room.nightly_rate_cents) / 100} to ${rateCents / 100}`);
    const bookingId = `HT-${randomUUID().slice(0, 8).toUpperCase()}`;
    await tx.run(`INSERT INTO hotel_reservations (id, property_id, room_id, guest_id, group_id, guest_name, guest_phone, arrival_date, departure_date, guest_count, adults, children, source, meal_plan, nightly_rate_cents, nightly_rates_json, room_tax_bps, created_by,
        booking_type, company, travel_agent, market_segment, guarantee, special_requests, notes)
      VALUES (?, 'main', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [bookingId, room.id, guest.id, group?.id || null, guest.name, guest.phone || action.phone, action.start, action.end, guests, adults, children, action.source, action.meal, rateCents, ratesJson, property.room_tax_bps, actor.id,
      action.bookingType, action.company || '', action.agent || '', action.segment || '', action.guarantee || '', action.specialRequests || '', action.notes || '']);
    ids.push(bookingId);
  }
  if (group && !group.master_reservation_id) await tx.run('UPDATE hotel_groups SET master_reservation_id = ? WHERE id = ?', [ids[0], group.id]);
  const masterId = group?.master_reservation_id || ids[0];
  if (group && action.payer !== 'own') {
    for (const id of ids.filter((x) => x !== masterId)) {
      await tx.run('INSERT INTO hotel_routing_rules (id, reservation_id, source_types, target_reservation_id, target_window, created_by) VALUES (?, ?, ?, ?, 1, ?)',
        [randomUUID(), id, action.payer === 'master_rooms' ? 'ROOM,EARLY_CHECKIN,LATE_CHECKOUT,EXTRA_BED' : '*', masterId, actor.id]);
    }
  }
  if (group) {
    // master: every other room routes everything to the master; individual: none routes; else mixed.
    const rows = await tx.all(`SELECT b.id, x.source_types FROM hotel_reservations b LEFT JOIN hotel_routing_rules x ON x.reservation_id = b.id AND x.active = 1
      WHERE b.group_id = ? AND b.id <> ? AND b.status <> 'cancelled'`, [group.id, masterId]);
    const mode = !rows.length || rows.every((r) => !r.source_types) ? 'individual' : rows.every((r) => r.source_types === '*') ? 'master' : 'mixed';
    await tx.run('UPDATE hotel_groups SET payer_mode = ? WHERE id = ?', [mode, group.id]);
  }
  if (overridden.length) {
    // High-risk: a tariff override needs permission, is audited and flags the owner.
    if (!can('hotel.rate_override')) fail('Your role cannot override room rates. Leave the rate empty to use the room tariff.', 403);
    await ownerAlert(tx, actor, 'medium', `Room rate override: ${guest.name}`, `Nightly rate changed on ${ids.join(', ')} (${action.start} to ${action.end}): ${overridden.join('; ')}.`, `Rooms ${action.roomIds.join(', ')}`);
    await audit(tx, actor, 'rate_override', ids[0], `Rate override on ${ids.join(', ')}: ${overridden.join('; ')}.`, { today });
  }
  const payerNote = group && action.payer !== 'own' ? ` Charges route to ${masterId}${action.payer === 'master_rooms' ? ' (room charges only)' : ''}.` : '';
  if (master) return { id: ids[0], message: `Room ${action.roomIds.join(', ')} added to ${group.id} for ${guest.name}.${payerNote}` };
  return { id: ids[0], message: (group ? `Group booking ${group.id} saved for ${guest.name}: ${ids.length} rooms.` : `Reservation ${ids[0]} saved for ${guest.name}.`) + payerNote };
}

async function reservationCommand(tx, action, actor, today, requestKey, can) {
  const booking = await loadStay(tx, action.id);
  if (!booking) fail('Reservation not found.', 404);
  if (action.type === 'update_reservation') {
    if (booking.checked_out_at || booking.status === 'cancelled') fail('This reservation is closed.', 409);
    const d = action;
    if (d.bookingType && !BOOKING_TYPES.includes(d.bookingType)) fail('Choose a valid booking status.');
    if (d.segment && !MARKET_SEGMENTS.includes(d.segment)) fail('Choose a market segment.');
    const adults = d.adults ?? Number(booking.adults ?? booking.guest_count);
    if (!integer(adults, 1, 20) || !integer(d.children, 0, 19)) fail('Enter adults (1–20) and children (0–19).');
    const room = await tx.get('SELECT capacity FROM hotel_rooms WHERE id = ?', [booking.room_id]);
    if (adults + d.children > Number(room.capacity)) fail(`Room ${booking.room_number} accommodates up to ${room.capacity} guests.`);
    if (d.creditLimitCents !== (booking.credit_limit_cents == null ? null : Number(booking.credit_limit_cents)) && !can('hotel.folio_adjust')) fail('Your role cannot change a folio credit limit.', 403);
    await tx.run(`UPDATE hotel_reservations SET adults = ?, children = ?, guest_count = ?, company = ?, travel_agent = ?, market_segment = ?, guarantee = ?, special_requests = ?, notes = ?, no_post = ?, credit_limit_cents = ?,
      booking_type = CASE WHEN status = 'confirmed' THEN ? ELSE booking_type END WHERE id = ?`,
    [adults, d.children, adults + d.children, d.company, d.agent, d.segment, d.guarantee, d.specialRequests, d.notes, d.noPost ? 1 : 0, d.creditLimitCents, d.bookingType || booking.booking_type, booking.id]);
    return { id: booking.id, message: `Reservation ${booking.id} updated.` };
  }
  if (action.type === 'booking_type') {
    if (booking.status !== 'confirmed') fail('Only a reservation that has not arrived can change status.', 409);
    if (!BOOKING_TYPES.includes(action.bookingType)) fail('Choose tentative, confirmed, guaranteed or waitlist.');
    if (booking.booking_type === 'waitlist' && action.bookingType !== 'waitlist' && await roomConflict(tx, booking.room_id, booking.arrival_date, booking.departure_date, today, booking.id)) fail(`Room ${booking.room_number} is taken for those dates. Move the waitlisted booking to a free room first.`, 409);
    await tx.run('UPDATE hotel_reservations SET booking_type = ? WHERE id = ?', [action.bookingType, booking.id]);
    return { id: booking.id, message: `Reservation ${booking.id} is now ${action.bookingType}.` };
  }
  if (action.type === 'change_plan') {
    if (!['confirmed', 'in_house'].includes(booking.status) || booking.checked_out_at) fail('Only open reservations can change rate plan.', 409);
    const rates = await loadRates(tx);
    const plan = rates.plans.find((p) => p.name.toLowerCase() === action.meal.toLowerCase());
    if (!plan) fail('Rate plan not found.', 404);
    const old = rates.plans.find((p) => p.name.toLowerCase() === String(booking.meal_plan).toLowerCase());
    const diff = (plan.supplementCents || 0) - (old?.supplementCents || 0);
    // Posted nights keep their price; unposted nights move by the supplement difference.
    const posted = await postedNightDates(tx, booking.id);
    const map = ratesMap(booking);
    for (const date of stayDates(booking.arrival_date, booking.departure_date)) if (!posted.has(date)) map[date] = Math.max(0, nightRate(booking, date) + diff);
    await tx.run('UPDATE hotel_reservations SET meal_plan = ?, nightly_rates_json = ? WHERE id = ?', [plan.name, JSON.stringify(map), booking.id]);
    return { id: booking.id, message: `${booking.guest_name} is now on ${plan.name}. Unposted nights repriced by NPR ${(diff / 100).toFixed(2)} per night.` };
  }
  if (action.type === 'checkin') {
    if (booking.status !== 'confirmed' || booking.checked_out_at) fail('Only a confirmed reservation can be changed with this action.', 409);
    if (booking.booking_type === 'waitlist') fail('A waitlisted booking holds no room. Confirm it on a free room first.', 409);
    if (booking.arrival_date > today || booking.departure_date <= today) fail('This reservation is not an eligible arrival for today.');
    if (booking.blocked || booking.cleaning_status !== 'ready') fail('The room must be inspected, ready and unblocked.', 409);
    const occupied = await tx.get("SELECT id FROM hotel_reservations WHERE room_id = ? AND status = 'in_house' AND checked_out_at IS NULL LIMIT 1", [booking.room_id]);
    if (occupied) fail('This room still has an in-house guest.', 409);
    await tx.run("UPDATE hotel_reservations SET status = 'in_house', checked_in_at = CURRENT_TIMESTAMP WHERE id = ?", [booking.id]);
    return { id: booking.id, message: `${booking.guest_name} checked into room ${booking.room_number}.` };
  }
  // cancel / no_show
  if (booking.status !== 'confirmed' || booking.checked_out_at) fail('Only a confirmed reservation can be changed with this action.', 409);
  if (action.type === 'no_show' && booking.arrival_date > today) fail('A reservation can be marked no-show on or after its arrival date.', 409);
  const closed = await closeUnarrivedFolio(tx, booking, actor, today, requestKey);
  if (!closed.ok) fail('This reservation has a deposit or charges. Refund the deposit or post a cancellation / no-show fee so the balance is zero, then cancel.', 409);
  await tx.run(`UPDATE hotel_reservations SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, no_show = ? WHERE id = ?`, [action.type === 'no_show' ? 1 : 0, booking.id]);
  await tx.run('UPDATE hotel_routing_rules SET active = 0 WHERE reservation_id = ? OR target_reservation_id = ?', [booking.id, booking.id]);
  return { id: booking.id, message: action.type === 'no_show' ? `Reservation ${booking.id} marked no-show.` : `Reservation ${booking.id} cancelled.` };
}

export async function runHotelCommand(db, data, actor, requestKey, now = new Date()) {
  // The permission cache is loaded by requireAuth in the route.
  const role = permissionRole(actor);
  if (!actor?.id || !mayRun(role, data?.type)) fail('Your role is not allowed to perform this hotel action.', 403);
  if (!/^[a-zA-Z0-9-]{16,100}$/.test(requestKey || '')) fail('A valid request key is required.');
  const action = normalizeAction(data);
  const can = (key) => isPermissionAllowedSync(role, key);
  const hash = createHash('sha256').update(JSON.stringify(action)).digest('hex');
  await ensureHotelSchema(db);
  const today = await hotelBusinessDate(db, now);
  if ([...FOLIO_COMMANDS, 'group_checkout', 'night_audit', 'minibar', 'laundry_update', 'cancel', 'no_show'].includes(action.type)) await prepareHotelAccounting(db);
  await ensureStaffHrSchema(db); // clock-ins decide who is on shift; owner_alerts for overrides
  await ensureNotificationSchema(db);
  try {
    return await hotelTransaction(db, async (tx) => {
      if (db.driver === 'postgres') await tx.get("SELECT id FROM hotel_properties WHERE id = 'main' FOR UPDATE");
      else await tx.run("UPDATE hotel_properties SET updated_at = updated_at WHERE id = 'main'");
      const receipt = await tx.get('SELECT * FROM hotel_command_receipts WHERE request_key = ?', [requestKey]);
      if (receipt) {
        if (Number(receipt.actor_id) !== Number(actor.id) || receipt.payload_hash !== hash) fail('This request key was already used for another operation.', 409);
        return JSON.parse(receipt.result_json);
      }
      let id = 'main'; let message;
      if (FOLIO_COMMANDS.includes(action.type)) {
        ({ id, message } = await processFolioCommand(tx, action, actor, requestKey, today, { may: can }));
      } else if (action.type === 'group_checkout') {
        const stays = await tx.all("SELECT id FROM hotel_reservations WHERE group_id = ? AND status = 'in_house' AND checked_out_at IS NULL ORDER BY CASE WHEN id = (SELECT master_reservation_id FROM hotel_groups WHERE id = ?) THEN 1 ELSE 0 END, id", [action.groupId, action.groupId]);
        if (!stays.length) fail('No in-house rooms in this group.', 409);
        for (const stay of stays) {
          const count = (await tx.get('SELECT COUNT(*) AS n FROM hotel_folio_entries WHERE reservation_id = ?', [stay.id])).n;
          await processFolioCommand(tx, { type: 'checkout', id: stay.id, revision: Number(count) }, actor, `${requestKey}:${stay.id}`, today, { may: can });
        }
        id = action.groupId; message = `${stays.length} room(s) of ${action.groupId} checked out together.`;
      } else if (['season', 'plan', 'season_delete', 'plan_delete'].includes(action.type)) {
        ({ id, message } = await processRateCommand(tx, action));
      } else if (action.type === 'plan_package') {
        ({ id, message } = await savePlanPackage(tx, action));
      } else if (action.type === 'precheckin_link') {
        ({ id, message } = await createPrecheckinLink(tx, action.id));
      } else if (action.type === 'assign_task') {
        ({ id, message } = await assignTask(tx, action, actor));
      } else if (action.type === 'report_issue') {
        ({ id, message } = await reportIssue(tx, { ...action, today, until: action.until || today }, actor));
      } else if (action.type === 'ticket_update') {
        ({ id, message } = await updateTicket(tx, action, actor, today));
      } else if (action.type === 'minibar') {
        ({ id, message } = await consumeMinibar(tx, action, actor, requestKey, today));
      } else if (action.type === 'minibar_item') {
        ({ id, message } = await saveMinibarItem(tx, action));
      } else if (action.type === 'laundry') {
        ({ id, message } = await createLaundry(tx, action, actor));
      } else if (action.type === 'laundry_update') {
        ({ id, message } = await updateLaundry(tx, action, actor, today));
      } else if (action.type === 'room_flag') {
        ({ id, message } = await setRoomFlag(tx, action, actor, today));
      } else if (action.type === 'stayover') {
        ({ id, message } = await requestStayover(tx, action, actor, today));
      } else if (action.type === 'night_audit') {
        ({ id, message } = await runNightAudit(tx, actor, requestKey, today, { force: action.force, reason: action.reason }));
      } else if (action.type === 'clean') {
        ({ id, message } = await processCleaningCommand(tx, action, actor));
      } else if (action.type === 'property') {
        if (!action.name) fail('Enter your hotel name.');
        if (action.taxBps !== null && !integer(action.taxBps, 0, 10000)) fail('Enter a tax percentage from 0 to 100 with at most two decimal places.');
        await tx.run("UPDATE hotel_properties SET name = ?, room_tax_bps = COALESCE(?, room_tax_bps), updated_at = CURRENT_TIMESTAMP WHERE id = 'main'", [action.name, action.taxBps]);
        message = 'Hotel details saved.';
      } else if (['category', 'category_delete', 'rooms_bulk'].includes(action.type)) {
        ({ id, message } = await processCategoryCommand(tx, action));
      } else if (action.type === 'room' || action.type === 'room_edit') {
        Object.assign(action, await applyCategoryDefaults(tx, action));
        if (!/^[a-zA-Z0-9-]{1,12}$/.test(action.roomId) || !action.roomType || !integer(action.floor, 0, 99) || !integer(action.capacity, 1, 20) || !Number.isFinite(action.rate) || action.rate < 0 || action.rate > 1000000) fail('Enter a room number, type, floor (0–99), capacity (1–20) and valid nightly rate.');
        const exists = await tx.get("SELECT * FROM hotel_rooms WHERE property_id = 'main' AND LOWER(room_number) = LOWER(?)", [action.roomId]);
        if (action.type === 'room_edit') {
          if (!exists) fail('Room not found.', 404);
          if (Number(exists.version) !== action.version) fail('This room changed. Refresh and try again.', 409);
          const tooMany = await tx.get("SELECT id FROM hotel_reservations WHERE room_id = ? AND status IN ('confirmed', 'in_house') AND checked_out_at IS NULL AND guest_count > ? LIMIT 1", [exists.id, action.capacity]);
          if (tooMany) fail('An existing reservation exceeds this capacity.', 409);
          id = exists.id;
          await tx.run('UPDATE hotel_rooms SET floor = ?, room_type = ?, capacity = ?, nightly_rate_cents = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [action.floor, action.roomType, action.capacity, cents(action.rate), id]);
          message = `Room ${action.roomId} details updated.`;
        } else {
          if (exists) fail('This room number already exists.', 409);
          id = randomUUID();
          await tx.run("INSERT INTO hotel_rooms (id, property_id, room_number, floor, room_type, capacity, nightly_rate_cents) VALUES (?, 'main', ?, ?, ?, ?, ?)", [id, action.roomId, action.floor, action.roomType, action.capacity, cents(action.rate)]);
          message = `Room ${action.roomId} added.`;
        }
      } else if (action.type === 'room_status') {
        const room = await tx.get("SELECT * FROM hotel_rooms WHERE property_id = 'main' AND room_number = ?", [action.roomId]);
        if (!room) fail('Room not found.', 404);
        if (Number(room.version) !== action.version) fail('This room changed. Refresh and try again.', 409);
        if (!['ready', 'dirty', 'cleaning', 'inspection'].includes(action.cleaning) || ![0, 1].includes(action.blocked)) fail('Choose a valid room status.');
        if (!['out_of_order', 'out_of_service'].includes(action.blockKind)) fail('Choose out of order or out of service.');
        const stays = await tx.get("SELECT id FROM hotel_reservations WHERE room_id = ? AND status = 'in_house' AND checked_out_at IS NULL LIMIT 1", [room.id]);
        if (stays) fail('An occupied room cannot be blocked or turned over here.', 409);
        const future = await tx.get("SELECT id FROM hotel_reservations WHERE room_id = ? AND status = 'confirmed' AND booking_type <> 'waitlist' AND departure_date > ? LIMIT 1", [room.id, today]);
        if (action.blocked && future) fail('This room has a reservation. Resolve it before blocking the room.', 409);
        const transitions = { ready: ['ready', 'dirty'], dirty: ['dirty', 'cleaning'], cleaning: ['cleaning', 'inspection'], inspection: ['inspection', 'ready', 'dirty'] };
        if (!transitions[room.cleaning_status].includes(action.cleaning)) fail('Follow the cleaning → inspection → ready sequence.');
        await tx.run('UPDATE hotel_rooms SET cleaning_status = ?, blocked = ?, block_kind = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [action.cleaning, action.blocked, action.blockKind, room.id]);
        const task = await tx.get("SELECT id FROM hotel_housekeeping_tasks WHERE room_id = ? AND status <> 'ready'", [room.id]);
        if (task) await tx.run("UPDATE hotel_housekeeping_tasks SET status = ?, version = version + 1, updated_by = ?, completed_at = CASE WHEN ? = 'ready' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id = ?", [action.cleaning, actor.id, action.cleaning, task.id]);
        else if (action.cleaning !== 'ready') await createCleaningTask(tx, { roomId: room.id, status: action.cleaning, note: 'Room readiness update', actorId: actor.id, today, taskType: 'readiness' });
        if (Boolean(room.blocked) !== Boolean(action.blocked)) await audit(tx, actor, 'room_status_override', room.id, `Room ${room.room_number} ${action.blocked ? `set ${action.blockKind.replace('_', ' ')}` : 'returned to service'}.`, { reason: action.reason || null, today });
        id = room.id; message = `Room ${room.room_number} status updated.`;
      } else if (action.type === 'book') {
        ({ id, message } = await createBookings(tx, action, actor, today, can));
      } else if (action.type === 'move' || action.type === 'change_dates') {
        ({ id, message } = await changeStay(tx, action, actor, today, can));
      } else {
        ({ id, message } = await reservationCommand(tx, action, actor, today, requestKey, can));
      }
      const result = { id, message };
      await audit(tx, actor, action.type, id, message, { reason: action.reason || null, today, details: { action } });
      await tx.run('INSERT INTO hotel_command_receipts (request_key, actor_id, payload_hash, result_json) VALUES (?, ?, ?, ?)', [requestKey, actor.id, hash, JSON.stringify(result)]);
      return result;
    }).then((result) => { void deliverPending(db); return result; });
  } catch (error) {
    if (error.code === 'SQLITE_BUSY' || error.code === '40001' || error.code === '40P01') fail('Another update is in progress. Retry this request.', 409);
    throw error;
  }
}

export { unappliedDeposit };
