/**
 * Hotel, restaurant-hotel and departmental reports, all computed from stored
 * records (folio rows, reservations, journals, bills), never from screens.
 *
 * KPI definitions (room-night based):
 * - Room night sold (date d): a posted ROOM folio charge with service date d
 *   that was not reversed (transfers do not count twice: only the original row).
 * - Rooms available (date d): all rooms minus rooms out of order on d. For
 *   today the current blocks are used; for past dates a room counts as out of
 *   order while a maintenance ticket that blocked it was open (created on or
 *   before d, resolved after d). Blocks set without a ticket are not dated.
 * - Room revenue: net (tax-exclusive) ROOM charges less the meal-plan package
 *   part (that is F&B entitlement, not room revenue) and less reversals. This
 *   equals what the ledger credits to 4030 for those nights.
 * - Occupancy % = sold / available x 100 over the range (sums of room nights).
 * - ADR = room revenue / rooms sold. RevPAR = room revenue / rooms available
 *   (= ADR x occupancy).
 * - ALOS = room nights of stays departing in the range / those stays.
 * - Lead time = arrival date - booking date, averaged over bookings made in range.
 * - Cancellation % = cancellations (not no-shows) / reservations made in range.
 *   No-show % = no-shows / arrivals due in range.
 * Operational counts and ledger revenue can differ legitimately: the ledger
 * books a night on its posting date, KPIs on the night's service date.
 */
import { ensureHotelSchema } from './schema.js';
import { folioTotals, splitPackage } from './folio-math.js';
import { FOLIO_SOURCES } from './folios.js';
import { foodGroupSql, foodGroupLabel } from '../food-groups.js';
import { toCsv } from '../csv.js';
import { hotelBusinessDate } from './service.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '') && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const npr = (cents) => r2(Number(cents) / 100);
const dates = (from, to) => { const out = []; for (let t = Date.parse(from); t <= Date.parse(to); t += 86400000) out.push(new Date(t).toISOString().slice(0, 10)); return out; };
const pct = (a, b) => (b ? r2((a / b) * 100) : 0);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/** Income account -> department (configurable here; codes, never ids). */
export const DEPARTMENT_BY_ACCOUNT = {
  4030: 'ROOMS', 4045: 'ROOMS', 4010: 'FOOD_BEVERAGE', 4041: 'LAUNDRY', 4042: 'MINIBAR', 4043: 'TRANSPORT', 4040: 'OTHER_OPERATED', 4020: 'OTHER_INCOME',
};
export const DEPARTMENT_LABELS = { ROOMS: 'Rooms', FOOD_BEVERAGE: 'Food & beverage', BANQUETS: 'Banquets / events', LAUNDRY: 'Laundry', MINIBAR: 'Minibar', TRANSPORT: 'Transport', OTHER_OPERATED: 'Other operated departments', OTHER_INCOME: 'Other income' };

/** Room-night statistics per date, shared with the Business report and dashboards. */
export async function roomNightStats(db, from, to, { today = null } = {}) {
  // Room type is the room the night was posted for (room_number snapshot), not the current room.
  const rows = await db.all(`SELECT f.service_date, f.net_cents, f.tax_cents, f.package_cents, b.meal_plan, b.source, b.market_segment, COALESCE(pr.room_type, r.room_type) AS room_type
    FROM hotel_folio_entries f
    JOIN hotel_reservations b ON b.id = f.reservation_id JOIN hotel_rooms r ON r.id = b.room_id
    LEFT JOIN hotel_rooms pr ON pr.property_id = 'main' AND pr.room_number = f.room_number
    WHERE f.source_type = 'ROOM' AND f.kind = 'charge' AND f.transfer_ref IS NULL AND f.service_date BETWEEN ? AND ?
      AND NOT EXISTS (SELECT 1 FROM hotel_folio_entries x WHERE x.reversal_of = f.id AND x.category = 'adjustment')`, [from, to]);
  const totalRooms = Number((await db.get("SELECT COUNT(*) AS n FROM hotel_rooms WHERE property_id = 'main'")).n);
  const blockedNow = Number((await db.get("SELECT COUNT(*) AS n FROM hotel_rooms WHERE property_id = 'main' AND blocked = 1")).n);
  const tickets = await db.all('SELECT room_id, created_at, resolved_at FROM hotel_maintenance_tickets WHERE blocked_room = 1');
  const byDate = new Map(dates(from, to).map((d) => [d, { date: d, sold: 0, revenueCents: 0, available: totalRooms }]));
  for (const [d, row] of byDate) {
    if (today && d === today) row.available = totalRooms - blockedNow;
    else {
      const blocked = new Set(tickets.filter((t) => String(t.created_at).slice(0, 10) <= d && (!t.resolved_at || String(t.resolved_at).slice(0, 10) > d)).map((t) => t.room_id));
      row.available = totalRooms - blocked.size;
    }
  }
  const segments = { roomType: new Map(), plan: new Map(), source: new Map(), segment: new Map() };
  const addSeg = (map, key, cents) => { const s = map.get(key) || { key, sold: 0, revenue: 0 }; s.sold += 1; s.revenue += cents; map.set(key, s); };
  for (const row of rows) {
    const { roomNet } = splitPackage({ net: Number(row.net_cents), tax: Number(row.tax_cents), packageCents: Number(row.package_cents) });
    const day = byDate.get(row.service_date);
    if (day) { day.sold += 1; day.revenueCents += roomNet; }
    addSeg(segments.roomType, row.room_type, roomNet); addSeg(segments.plan, row.meal_plan, roomNet);
    addSeg(segments.source, row.source || 'Direct', roomNet); addSeg(segments.segment, row.market_segment || 'Unspecified', roomNet);
  }
  const daily = [...byDate.values()].map((d) => ({ date: d.date, available: d.available, sold: d.sold, occupancy: pct(d.sold, d.available), roomRevenue: npr(d.revenueCents), adr: d.sold ? npr(d.revenueCents / d.sold) : 0, revpar: d.available ? npr(d.revenueCents / d.available) : 0 }));
  const sold = daily.reduce((s, d) => s + d.sold, 0);
  const available = daily.reduce((s, d) => s + d.available, 0);
  const revenueCents = [...byDate.values()].reduce((s, d) => s + d.revenueCents, 0);
  const seg = (map) => [...map.values()].map((s) => ({ key: s.key, roomsSold: s.sold, roomRevenue: npr(s.revenue), adr: s.sold ? npr(s.revenue / s.sold) : 0, share: pct(s.revenue, revenueCents) })).sort((a, b) => b.roomRevenue - a.roomRevenue);
  return {
    daily, sold, available, roomRevenue: npr(revenueCents), occupancy: pct(sold, available), adr: sold ? npr(revenueCents / sold) : 0, revpar: available ? npr(revenueCents / available) : 0,
    byRoomType: seg(segments.roomType), byPlan: seg(segments.plan), bySource: seg(segments.source), bySegment: seg(segments.segment),
  };
}

async function bookingKpis(db, from, to) {
  const made = await db.all('SELECT arrival_date, created_at, status, no_show, cancelled_at FROM hotel_reservations WHERE substr(CAST(created_at AS TEXT), 1, 10) BETWEEN ? AND ?', [from, to]);
  const due = await db.get("SELECT COUNT(*) AS n, SUM(CASE WHEN no_show = 1 THEN 1 ELSE 0 END) AS ns FROM hotel_reservations WHERE arrival_date BETWEEN ? AND ? AND booking_type <> 'waitlist'", [from, to]);
  const departed = await db.all('SELECT arrival_date, departure_date FROM hotel_reservations WHERE checked_out_at IS NOT NULL AND departure_date BETWEEN ? AND ?', [from, to]);
  const lead = made.map((m) => daysBetween(String(m.created_at).slice(0, 10), m.arrival_date)).filter((n) => n >= 0);
  const cancellations = made.filter((m) => m.status === 'cancelled' && !Number(m.no_show)).length;
  return {
    reservationsMade: made.length, cancellations, cancellationPercent: pct(cancellations, made.length),
    arrivalsDue: Number(due.n) || 0, noShows: Number(due.ns) || 0, noShowPercent: pct(Number(due.ns) || 0, Number(due.n) || 0),
    averageLeadDays: lead.length ? r2(lead.reduce((s, n) => s + n, 0) / lead.length) : 0,
    averageLengthOfStay: departed.length ? r2(departed.reduce((s, d) => s + daysBetween(d.arrival_date, d.departure_date), 0) / departed.length) : 0,
  };
}

/** Restaurant revenue split by guest type / outlet and food group, from bills (business-day dated). */
export async function fbAnalysis(db, from, to) {
  const billDate = "COALESCE(substr(CAST(bd.business_date AS TEXT), 1, 10), substr(CAST(bl.created_at AS TEXT), 1, 10))";
  const bills = await db.all(`SELECT bl.id, bl.grand_total, COALESCE(bl.vat_amount, bl.tax, 0) AS tax, COALESCE(bl.discount_amount, 0) AS discount, o.hotel_stay_id,
      CASE WHEN o.order_type = 'room_service' OR t.table_type = 'room_service' OR t.hotel_room_id IS NOT NULL THEN 'room_service' ELSE 'restaurant' END AS outlet,
      COALESCE(o.guest_count, 0) AS covers
    FROM bills bl JOIN orders o ON o.id = bl.order_id LEFT JOIN tables t ON t.id = o.table_id LEFT JOIN business_days bd ON bd.id = bl.business_day_id
    WHERE COALESCE(bl.status, '') NOT IN ('voided', 'cancelled') AND ${billDate} BETWEEN ? AND ?`, [from, to]).catch(async () => db.all(`SELECT bl.id, bl.grand_total, COALESCE(bl.vat_amount, bl.tax, 0) AS tax, COALESCE(bl.discount_amount, 0) AS discount, o.hotel_stay_id,
      CASE WHEN o.order_type = 'room_service' OR t.table_type = 'room_service' OR t.hotel_room_id IS NOT NULL THEN 'room_service' ELSE 'restaurant' END AS outlet, 0 AS covers
    FROM bills bl JOIN orders o ON o.id = bl.order_id LEFT JOIN tables t ON t.id = o.table_id LEFT JOIN business_days bd ON bd.id = bl.business_day_id
    WHERE COALESCE(bl.status, '') NOT IN ('voided', 'cancelled') AND ${billDate} BETWEEN ? AND ?`, [from, to]));
  const alloc = await db.all(`SELECT a.bill_id, a.method, SUM(a.amount) AS amount FROM bill_payment_allocations a WHERE a.method IN ('room', 'package') GROUP BY a.bill_id, a.method`).catch(() => []);
  const allocBy = new Map();
  for (const a of alloc) { const m = allocBy.get(Number(a.bill_id)) || {}; m[a.method] = Number(a.amount); allocBy.set(Number(a.bill_id), m); }
  const out = { walkIn: 0, inHouse: 0, roomService: 0, packageCovered: 0, packageOverage: 0, chargedToRoom: 0, bills: 0, covers: 0, discounts: 0, total: 0 };
  for (const b of bills) {
    const net = Number(b.grand_total) - Number(b.tax);
    out.total += net; out.bills += 1; out.covers += Number(b.covers) || 0; out.discounts += Number(b.discount) || 0;
    if (b.outlet === 'room_service') out.roomService += net; else if (b.hotel_stay_id) out.inHouse += net; else out.walkIn += net;
    const a = allocBy.get(Number(b.id));
    if (a?.package) { out.packageCovered += a.package; out.packageOverage += a.room || 0; }
    if (a?.room) out.chargedToRoom += a.room;
  }
  const groups = await db.all(`SELECT ${foodGroupSql('mc')} AS food_group, SUM(oi.subtotal) AS amount
    FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN bills bl ON bl.order_id = o.id LEFT JOIN business_days bd ON bd.id = bl.business_day_id
    LEFT JOIN menu_items mi ON mi.id = oi.menu_item_id LEFT JOIN menu_categories mc ON mc.id = mi.category_id
    WHERE COALESCE(bl.status, '') NOT IN ('voided', 'cancelled') AND COALESCE(oi.status, '') NOT IN ('cancelled', 'voided') AND ${billDate} BETWEEN ? AND ?
    GROUP BY 1`, [from, to]).catch(() => []);
  return {
    ...Object.fromEntries(Object.entries(out).map(([k, v]) => [k, k === 'bills' || k === 'covers' ? v : r2(v)])),
    averageCheck: out.bills ? r2(out.total / out.bills) : 0,
    byFoodGroup: groups.map((g) => ({ group: foodGroupLabel(g.food_group), amount: r2(g.amount) })).sort((a, b) => b.amount - a.amount),
  };
}

/** Income by department from the ledger (authoritative). Room service is split out of F&B using bills. */
export async function departmentalRevenue(db, from, to) {
  const rows = await db.all(`SELECT a.code, a.name, COALESCE(SUM(l.credit), 0) - COALESCE(SUM(l.debit), 0) AS net FROM journal_lines l
    JOIN journal_entries e ON e.id = l.journal_id JOIN accounts a ON a.id = l.account_id
    WHERE a.type = 'income' AND e.entry_date >= ? AND e.entry_date <= ? GROUP BY a.code, a.name`, [from, to]);
  const depts = new Map();
  for (const row of rows) {
    const dept = DEPARTMENT_BY_ACCOUNT[row.code] || 'FOOD_BEVERAGE';
    const d = depts.get(dept) || { department: dept, label: DEPARTMENT_LABELS[dept], revenue: 0, accounts: [] };
    d.revenue += Number(row.net) || 0; d.accounts.push({ code: row.code, name: row.name, amount: r2(row.net) });
    depts.set(dept, d);
  }
  const list = [...depts.values()].map((d) => ({ ...d, revenue: r2(d.revenue) })).sort((a, b) => b.revenue - a.revenue);
  return { departments: list, total: r2(list.reduce((s, d) => s + d.revenue, 0)) };
}

const col = (key, label, type = 'text') => ({ key, label, type });

/** Report registry: id -> { title, build(db, range) -> { columns, rows, summary? } }. */
export const HOTEL_REPORTS = {
  arrivals: { title: 'Arrivals', group: 'Front office', build: async (db, { from, to }) => ({
    columns: [col('date', 'Arrival', 'date'), col('id', 'Reservation'), col('guest', 'Guest'), col('room', 'Room'), col('roomType', 'Room type'), col('nights', 'Nights', 'number'), col('pax', 'Adults/children'), col('plan', 'Plan'), col('source', 'Source'), col('status', 'Status')],
    rows: (await db.all(`SELECT b.*, r.room_number, r.room_type FROM hotel_reservations b JOIN hotel_rooms r ON r.id = b.room_id WHERE b.arrival_date BETWEEN ? AND ? AND (b.status <> 'cancelled' OR b.no_show = 1) ORDER BY b.arrival_date, r.room_number`, [from, to]))
      .map((b) => ({ date: b.arrival_date, id: b.id, guest: b.guest_name, room: b.room_number, roomType: b.room_type, nights: daysBetween(b.arrival_date, b.departure_date), pax: `${b.adults ?? b.guest_count}/${b.children || 0}`, plan: b.meal_plan, source: b.source, status: b.no_show ? 'No-show' : b.checked_out_at ? 'Checked out' : b.status === 'in_house' ? 'In house' : b.booking_type })),
  }) },
  departures: { title: 'Departures', group: 'Front office', build: async (db, { from, to }) => ({
    columns: [col('date', 'Departure', 'date'), col('id', 'Reservation'), col('guest', 'Guest'), col('room', 'Room'), col('status', 'Status'), col('checkedOut', 'Checked out at')],
    rows: (await db.all(`SELECT b.*, r.room_number FROM hotel_reservations b JOIN hotel_rooms r ON r.id = b.room_id WHERE b.departure_date BETWEEN ? AND ? AND b.status <> 'cancelled' ORDER BY b.departure_date, r.room_number`, [from, to]))
      .map((b) => ({ date: b.departure_date, id: b.id, guest: b.guest_name, room: b.room_number, status: b.checked_out_at ? 'Checked out' : b.status === 'in_house' ? 'In house' : 'Not arrived', checkedOut: b.checked_out_at || '' })),
  }) },
  in_house: { title: 'In-house guests', group: 'Front office', build: async (db) => {
    const rows = await db.all("SELECT b.*, r.room_number FROM hotel_reservations b JOIN hotel_rooms r ON r.id = b.room_id WHERE b.status = 'in_house' AND b.checked_out_at IS NULL ORDER BY r.room_number");
    const out = [];
    for (const b of rows) out.push({ room: b.room_number, id: b.id, guest: b.guest_name, arrival: b.arrival_date, departure: b.departure_date, pax: `${b.adults ?? b.guest_count}/${b.children || 0}`, plan: b.meal_plan, company: b.company, balance: npr(folioTotals(await db.all('SELECT * FROM hotel_folio_entries WHERE reservation_id = ?', [b.id])).balance) });
    return { columns: [col('room', 'Room'), col('id', 'Stay'), col('guest', 'Guest'), col('arrival', 'Arrival', 'date'), col('departure', 'Departure', 'date'), col('pax', 'Adults/children'), col('plan', 'Plan'), col('company', 'Company'), col('balance', 'Folio balance', 'money')], rows: out };
  } },
  reservations: { title: 'Reservations made', group: 'Front office', build: async (db, { from, to }) => ({
    columns: [col('created', 'Booked on'), col('id', 'Reservation'), col('guest', 'Guest'), col('room', 'Room'), col('arrival', 'Arrival', 'date'), col('departure', 'Departure', 'date'), col('type', 'Status'), col('source', 'Source'), col('segment', 'Segment'), col('agent', 'Agent'), col('company', 'Company')],
    rows: (await db.all(`SELECT b.*, r.room_number FROM hotel_reservations b JOIN hotel_rooms r ON r.id = b.room_id WHERE substr(CAST(b.created_at AS TEXT), 1, 10) BETWEEN ? AND ? ORDER BY b.created_at`, [from, to]))
      .map((b) => ({ created: String(b.created_at).slice(0, 16), id: b.id, guest: b.guest_name, room: b.room_number, arrival: b.arrival_date, departure: b.departure_date, type: b.status === 'cancelled' ? (b.no_show ? 'No-show' : 'Cancelled') : b.booking_type, source: b.source, segment: b.market_segment, agent: b.travel_agent, company: b.company })),
  }) },
  cancellations: { title: 'Cancellations', group: 'Front office', build: async (db, { from, to }) => ({
    columns: [col('date', 'Cancelled'), col('id', 'Reservation'), col('guest', 'Guest'), col('arrival', 'Arrival', 'date'), col('source', 'Source')],
    rows: (await db.all(`SELECT * FROM hotel_reservations WHERE status = 'cancelled' AND no_show = 0 AND substr(CAST(cancelled_at AS TEXT), 1, 10) BETWEEN ? AND ? ORDER BY cancelled_at`, [from, to]))
      .map((b) => ({ date: String(b.cancelled_at).slice(0, 16), id: b.id, guest: b.guest_name, arrival: b.arrival_date, source: b.source })),
  }) },
  no_shows: { title: 'No-shows', group: 'Front office', build: async (db, { from, to }) => ({
    columns: [col('arrival', 'Arrival', 'date'), col('id', 'Reservation'), col('guest', 'Guest'), col('type', 'Guarantee'), col('source', 'Source')],
    rows: (await db.all('SELECT * FROM hotel_reservations WHERE no_show = 1 AND arrival_date BETWEEN ? AND ? ORDER BY arrival_date', [from, to])).map((b) => ({ arrival: b.arrival_date, id: b.id, guest: b.guest_name, type: b.booking_type, source: b.source })),
  }) },
  room_moves: { title: 'Room moves', group: 'Front office', build: async (db, { from, to }) => ({
    columns: [col('date', 'Date', 'date'), col('stay', 'Stay'), col('guest', 'Guest'), col('from', 'From'), col('to', 'To'), col('reason', 'Reason'), col('rate', 'Rate'), col('by', 'Moved by'), col('notes', 'Notes')],
    rows: (await db.all('SELECT m.*, b.guest_name, u.full_name FROM hotel_room_moves m JOIN hotel_reservations b ON b.id = m.reservation_id LEFT JOIN users u ON u.id = m.moved_by WHERE m.business_date BETWEEN ? AND ? ORDER BY m.created_at', [from, to]))
      .map((m) => ({ date: m.business_date, stay: m.reservation_id, guest: m.guest_name, from: m.from_room_number, to: m.to_room_number, reason: m.reason, rate: m.rate_decision === 'keep' ? 'Kept' : `New (${npr(m.new_rate_cents)})`, by: m.full_name, notes: m.notes })),
  }) },
  stay_changes: { title: 'Extensions, early departures and late checkouts', group: 'Front office', build: async (db, { from, to }) => {
    const changes = await db.all("SELECT e.created_at, e.entity_id, e.details, u.full_name FROM hotel_audit_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.action = 'change_dates' AND substr(CAST(e.created_at AS TEXT), 1, 10) BETWEEN ? AND ? ORDER BY e.created_at", [from, to]);
    const outs = await db.all("SELECT s.reservation_id, s.snapshot_json FROM hotel_checkout_statements s WHERE substr(CAST(s.created_at AS TEXT), 1, 10) BETWEEN ? AND ?", [from, to]);
    const rows = changes.map((c) => ({ date: String(c.created_at).slice(0, 10), stay: c.entity_id, kind: 'Dates changed', detail: JSON.parse(c.details).message, by: c.full_name }));
    for (const o of outs) {
      const s = JSON.parse(o.snapshot_json);
      if (s.departure < s.plannedDeparture) rows.push({ date: s.departure, stay: s.reservationId, kind: 'Early departure', detail: `Left ${s.departure}, booked to ${s.plannedDeparture}`, by: '' });
      if (s.departure > s.plannedDeparture) rows.push({ date: s.departure, stay: s.reservationId, kind: 'Late checkout / overstay', detail: `Left ${s.departure}, booked to ${s.plannedDeparture}`, by: '' });
    }
    return { columns: [col('date', 'Date', 'date'), col('stay', 'Stay'), col('kind', 'Type'), col('detail', 'Detail'), col('by', 'By')], rows: rows.sort((a, b) => a.date.localeCompare(b.date)) };
  } },
  availability: { title: 'Room availability', group: 'Rooms', build: async (db, { from, to }) => {
    const rooms = Number((await db.get("SELECT COUNT(*) AS n FROM hotel_rooms WHERE property_id = 'main' AND blocked = 0")).n);
    const res = await db.all("SELECT arrival_date, departure_date FROM hotel_reservations WHERE status IN ('confirmed', 'in_house') AND checked_out_at IS NULL AND booking_type <> 'waitlist' AND arrival_date <= ? AND departure_date > ?", [to, from]);
    return { columns: [col('date', 'Date', 'date'), col('sellable', 'Sellable rooms', 'number'), col('reserved', 'Reserved / occupied', 'number'), col('free', 'Available', 'number'), col('occupancy', 'Forecast occupancy %', 'number')],
      rows: dates(from, to).map((d) => { const n = res.filter((r) => r.arrival_date <= d && r.departure_date > d).length; return { date: d, sellable: rooms, reserved: n, free: Math.max(0, rooms - n), occupancy: pct(n, rooms) }; }) };
  } },
  occupancy: { title: 'Occupancy, ADR and RevPAR', group: 'Rooms', build: async (db, range) => {
    const s = await roomNightStats(db, range.from, range.to, { today: range.today });
    return { columns: [col('date', 'Date', 'date'), col('available', 'Rooms available', 'number'), col('sold', 'Rooms sold', 'number'), col('occupancy', 'Occupancy %', 'number'), col('roomRevenue', 'Room revenue', 'money'), col('adr', 'ADR', 'money'), col('revpar', 'RevPAR', 'money')],
      rows: s.daily, summary: { roomsSold: s.sold, roomsAvailable: s.available, occupancy: s.occupancy, roomRevenue: s.roomRevenue, adr: s.adr, revpar: s.revpar, ...(await bookingKpis(db, range.from, range.to)) } };
  } },
  room_status: { title: 'Room status', group: 'Rooms', build: async (db) => {
    const rooms = await db.all("SELECT r.*, (SELECT b.guest_name FROM hotel_reservations b WHERE b.room_id = r.id AND b.status = 'in_house' AND b.checked_out_at IS NULL LIMIT 1) AS guest FROM hotel_rooms r WHERE r.property_id = 'main' ORDER BY r.floor, r.room_number");
    const hk = { ready: 'Inspected', inspection: 'Clean (inspect)', cleaning: 'Cleaning', dirty: 'Dirty' };
    return { columns: [col('room', 'Room'), col('floor', 'Floor', 'number'), col('type', 'Type'), col('occupancy', 'Occupancy'), col('housekeeping', 'Housekeeping'), col('flag', 'Flag'), col('guest', 'Guest')],
      rows: rooms.map((r) => ({ room: r.room_number, floor: Number(r.floor), type: r.room_type, occupancy: r.blocked ? (r.block_kind === 'out_of_service' ? 'Out of service' : 'Out of order') : r.guest ? 'Occupied' : 'Vacant', housekeeping: hk[r.cleaning_status], flag: r.hk_flag === 'dnd' ? 'Do not disturb' : r.hk_flag === 'pickup' ? 'Pickup' : '', guest: r.guest || '' })) };
  } },
  housekeeping: { title: 'Housekeeping turnaround', group: 'Rooms', build: async (db, { from, to }) => {
    const rows = await db.all("SELECT t.*, r.room_number, u.full_name FROM hotel_housekeeping_tasks t JOIN hotel_rooms r ON r.id = t.room_id LEFT JOIN users u ON u.id = t.assigned_to WHERE substr(CAST(t.created_at AS TEXT), 1, 10) BETWEEN ? AND ? ORDER BY t.created_at", [from, to]);
    const minutes = (a, b) => (a && b ? Math.round((Date.parse(String(b).replace(' ', 'T') + 'Z') - Date.parse(String(a).replace(' ', 'T') + 'Z')) / 60000) : null);
    const out = rows.map((t) => ({ created: String(t.created_at).slice(0, 16), room: t.room_number, type: t.task_type || 'checkout', priority: t.priority, status: t.status, assignee: t.full_name || 'Unassigned', turnaround: minutes(t.created_at, t.completed_at), cleaning: minutes(t.started_at, t.completed_at) }));
    const done = out.filter((t) => t.turnaround != null);
    return { columns: [col('created', 'Created'), col('room', 'Room'), col('type', 'Task'), col('priority', 'Priority'), col('status', 'Status'), col('assignee', 'Assigned'), col('turnaround', 'Turnaround (min)', 'number'), col('cleaning', 'Cleaning time (min)', 'number')], rows: out,
      summary: { tasks: out.length, completed: done.length, averageTurnaroundMinutes: done.length ? Math.round(done.reduce((s, t) => s + t.turnaround, 0) / done.length) : 0 } };
  } },
  maintenance: { title: 'Maintenance and out-of-order rooms', group: 'Rooms', build: async (db, { from, to }) => ({
    columns: [col('created', 'Opened'), col('id', 'Ticket'), col('room', 'Room'), col('title', 'Issue'), col('priority', 'Priority'), col('status', 'Status'), col('blocked', 'Room blocked'), col('resolved', 'Resolved')],
    rows: (await db.all("SELECT t.*, r.room_number FROM hotel_maintenance_tickets t JOIN hotel_rooms r ON r.id = t.room_id WHERE substr(CAST(t.created_at AS TEXT), 1, 10) BETWEEN ? AND ? OR t.status NOT IN ('resolved', 'closed') ORDER BY t.created_at", [from, to]))
      .map((t) => ({ created: String(t.created_at).slice(0, 16), id: t.id, room: t.room_number, title: t.title, priority: t.priority, status: t.status, blocked: Number(t.blocked_room) ? (t.block_kind === 'out_of_service' ? 'Out of service' : 'Out of order') : '', resolved: t.resolved_at ? String(t.resolved_at).slice(0, 16) : '' })),
  }) },
  revenue_segments: { title: 'Room revenue by room type, plan, source and segment', group: 'Revenue', build: async (db, range) => {
    const s = await roomNightStats(db, range.from, range.to, { today: range.today });
    const rows = [];
    for (const [dimension, list] of [['Room type', s.byRoomType], ['Rate plan', s.byPlan], ['Source', s.bySource], ['Market segment', s.bySegment]]) for (const x of list) rows.push({ dimension, key: x.key, roomsSold: x.roomsSold, roomRevenue: x.roomRevenue, adr: x.adr, share: x.share });
    return { columns: [col('dimension', 'Dimension'), col('key', 'Value'), col('roomsSold', 'Rooms sold', 'number'), col('roomRevenue', 'Room revenue', 'money'), col('adr', 'ADR', 'money'), col('share', 'Share %', 'number')], rows };
  } },
  departmental: { title: 'Departmental revenue (ledger)', group: 'Revenue', build: async (db, { from, to }) => {
    const d = await departmentalRevenue(db, from, to);
    const fb = await fbAnalysis(db, from, to);
    const rows = [];
    for (const dept of d.departments) for (const a of dept.accounts) rows.push({ department: dept.label, account: `${a.code} ${a.name}`, amount: a.amount });
    return { columns: [col('department', 'Department'), col('account', 'Account'), col('amount', 'Revenue', 'money')], rows, summary: { total: d.total, ...Object.fromEntries(d.departments.map((x) => [x.label, x.revenue])), roomServiceWithinFB: fb.roomService } };
  } },
  fb_hotel: { title: 'Restaurant revenue by guest type', group: 'Revenue', build: async (db, { from, to }) => {
    const fb = await fbAnalysis(db, from, to);
    return { columns: [col('line', 'Measure'), col('amount', 'Amount (ex. tax)', 'money')],
      rows: [['Walk-in restaurant', fb.walkIn], ['In-house guests in restaurant', fb.inHouse], ['Room service', fb.roomService], ['Total F&B (ex. tax)', fb.total], ['Charged to room (overage)', fb.chargedToRoom], ['Covered by meal plans', fb.packageCovered], ['Discounts', fb.discounts], ['Average check', fb.averageCheck], ...fb.byFoodGroup.map((g) => [`Items: ${g.group}`, g.amount])].map(([line, amount]) => ({ line, amount })),
      summary: { bills: fb.bills, covers: fb.covers } };
  } },
  deposits: { title: 'Guest deposits', group: 'Finance', build: async (db, { from, to }) => {
    const rows = await db.all(`SELECT f.service_date, f.reservation_id, b.guest_name, f.kind, f.amount_cents, f.payment_method FROM hotel_folio_entries f JOIN hotel_reservations b ON b.id = f.reservation_id
      WHERE f.category = 'deposit' AND f.service_date BETWEEN ? AND ? ORDER BY f.service_date`, [from, to]);
    const apps = await db.all('SELECT a.*, b.guest_name FROM hotel_deposit_applications a JOIN hotel_reservations b ON b.id = a.reservation_id WHERE substr(CAST(a.created_at AS TEXT), 1, 10) BETWEEN ? AND ?', [from, to]);
    const held = await db.get("SELECT COALESCE(SUM(l.credit - l.debit), 0) AS c FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = '2150'");
    return { columns: [col('date', 'Date', 'date'), col('stay', 'Stay'), col('guest', 'Guest'), col('movement', 'Movement'), col('amount', 'Amount', 'money'), col('method', 'Method')],
      rows: [...rows.map((r) => ({ date: r.service_date, stay: r.reservation_id, guest: r.guest_name, movement: r.kind === 'payment' ? 'Deposit received' : 'Deposit refunded', amount: npr(r.amount_cents), method: r.payment_method })),
        ...apps.map((a) => ({ date: String(a.created_at).slice(0, 10), stay: a.reservation_id, guest: a.guest_name, movement: 'Applied to bill', amount: npr(a.amount_cents), method: '' }))].sort((a, b) => a.date.localeCompare(b.date)),
      summary: { depositLiabilityNow: r2(held.c) } };
  } },
  outstanding: { title: 'Outstanding folios (guest ledger)', group: 'Finance', build: async (db) => {
    const stays = await db.all("SELECT b.*, r.room_number FROM hotel_reservations b JOIN hotel_rooms r ON r.id = b.room_id WHERE (b.status IN ('in_house', 'confirmed') AND b.checked_out_at IS NULL) ORDER BY r.room_number");
    const rows = [];
    for (const b of stays) {
      const t = folioTotals(await db.all('SELECT * FROM hotel_folio_entries WHERE reservation_id = ?', [b.id]));
      if (t.balance !== 0 || t.deposits) rows.push({ stay: b.id, guest: b.guest_name, room: b.room_number, status: b.status === 'in_house' ? 'In house' : 'Arriving', charges: npr(t.charges - t.credits), payments: npr(t.payments - t.refunds), balance: npr(t.balance), limit: b.credit_limit_cents == null ? '' : npr(b.credit_limit_cents) });
    }
    const ledger = await db.get("SELECT COALESCE(SUM(l.debit - l.credit), 0) AS c FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = '1320'");
    return { columns: [col('stay', 'Stay'), col('guest', 'Guest'), col('room', 'Room'), col('status', 'Status'), col('charges', 'Charges', 'money'), col('payments', 'Paid', 'money'), col('balance', 'Balance', 'money'), col('limit', 'Credit limit', 'money')], rows,
      summary: { guestReceivableLedger1320: r2(ledger.c), openFolioBalances: r2(rows.reduce((s, r) => s + r.balance, 0)) } };
  } },
  city_ledger: { title: 'Corporate / travel-agent ledger (city ledger)', group: 'Finance', build: async (db, { from, to }) => {
    const rows = await db.all(`SELECT f.service_date, f.city_ledger_account, f.reservation_id, b.guest_name, f.amount_cents FROM hotel_folio_entries f JOIN hotel_reservations b ON b.id = f.reservation_id
      WHERE f.payment_method = 'City Ledger' AND f.service_date BETWEEN ? AND ? ORDER BY f.city_ledger_account, f.service_date`, [from, to]);
    const bal = await db.get("SELECT COALESCE(SUM(l.debit - l.credit), 0) AS c FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = '1330'");
    return { columns: [col('account', 'Account'), col('date', 'Date', 'date'), col('stay', 'Stay'), col('guest', 'Guest'), col('amount', 'Billed', 'money')], rows: rows.map((r) => ({ account: r.city_ledger_account, date: r.service_date, stay: r.reservation_id, guest: r.guest_name, amount: npr(r.amount_cents) })), summary: { cityLedgerBalance1330: r2(bal.c) } };
  } },
  ota_ledger: { title: 'OTA ledger', group: 'Finance', build: async (db, { from, to }) => ({
    columns: [col('channel', 'Channel'), col('external', 'OTA booking'), col('stay', 'Stay'), col('arrival', 'Arrival', 'date'), col('status', 'Status'), col('total', 'Total', 'money'), col('commission', 'Commission', 'money'), col('prepaid', 'Prepaid')],
    rows: (await db.all('SELECT o.*, c.name, r.arrival_date FROM hotel_ota_bookings o JOIN hotel_ota_channels c ON c.id = o.channel_id LEFT JOIN hotel_reservations r ON r.id = o.reservation_id WHERE r.arrival_date BETWEEN ? AND ? ORDER BY r.arrival_date', [from, to]))
      .map((o) => ({ channel: o.name, external: o.external_id, stay: o.reservation_id, arrival: o.arrival_date, status: o.status, total: npr(o.total_cents), commission: npr(o.commission_cents), prepaid: Number(o.prepaid) ? 'Yes' : 'No' })),
  }) },
  payments: { title: 'Hotel payment summary', group: 'Finance', build: async (db, { from, to }) => {
    const rows = await db.all(`SELECT payment_method, kind, category, COUNT(*) AS n, SUM(amount_cents) AS c FROM hotel_folio_entries WHERE kind IN ('payment', 'refund') AND service_date BETWEEN ? AND ? GROUP BY payment_method, kind, category ORDER BY payment_method`, [from, to]);
    return { columns: [col('method', 'Method'), col('type', 'Type'), col('count', 'Count', 'number'), col('amount', 'Amount', 'money')],
      rows: rows.map((r) => ({ method: r.payment_method, type: `${r.kind === 'refund' ? 'Refund' : 'Received'}${r.category === 'deposit' ? ' (deposit)' : ''}`, count: Number(r.n), amount: npr(r.kind === 'refund' ? -r.c : r.c) })) };
  } },
  packages: { title: 'Meal plan / package performance', group: 'Finance', build: async (db, { from, to }) => {
    const accrued = await db.all(`SELECT b.meal_plan, COUNT(*) AS nights, SUM(f.package_cents) AS c FROM hotel_folio_entries f JOIN hotel_reservations b ON b.id = f.reservation_id
      WHERE f.source_type = 'ROOM' AND f.kind = 'charge' AND f.package_cents > 0 AND f.service_date BETWEEN ? AND ? GROUP BY b.meal_plan`, [from, to]);
    const used = await db.all(`SELECT b.meal_plan, u.component_label, SUM(u.amount_cents) AS c FROM hotel_package_usage u JOIN hotel_reservations b ON b.id = u.reservation_id
      WHERE u.reversed = 0 AND u.usage_date BETWEEN ? AND ? GROUP BY b.meal_plan, u.component_label`, [from, to]);
    const breakage = await db.all(`SELECT b.meal_plan, SUM(s.breakage_cents) AS c FROM hotel_package_settlements s JOIN hotel_reservations b ON b.id = s.reservation_id
      WHERE substr(CAST(s.created_at AS TEXT), 1, 10) BETWEEN ? AND ? GROUP BY b.meal_plan`, [from, to]);
    const overage = await db.get(`SELECT COALESCE(SUM(a.amount), 0) AS c FROM bill_payment_allocations a WHERE a.method = 'room' AND a.bill_id IN (SELECT bill_id FROM hotel_package_usage WHERE reversed = 0 AND usage_date BETWEEN ? AND ?)`, [from, to]).catch(() => ({ c: 0 }));
    const plans = new Set([...accrued, ...used, ...breakage].map((r) => r.meal_plan));
    const rows = [...plans].map((plan) => {
      const a = accrued.find((r) => r.meal_plan === plan); const b = breakage.find((r) => r.meal_plan === plan);
      const consumed = used.filter((u) => u.meal_plan === plan).reduce((s, u) => s + Number(u.c), 0);
      return { plan, nights: Number(a?.nights || 0), entitlement: npr(a?.c || 0), consumed: npr(consumed), unused: npr(Number(b?.c || 0)), detail: used.filter((u) => u.meal_plan === plan).map((u) => `${u.component_label} ${npr(u.c)}`).join(', ') };
    });
    return { columns: [col('plan', 'Plan'), col('nights', 'Package nights', 'number'), col('entitlement', 'Entitlement accrued', 'money'), col('consumed', 'Consumed', 'money'), col('unused', 'Unused at checkout (breakage)', 'money'), col('detail', 'By meal')], rows, summary: { overageChargedToRooms: r2(overage.c) } };
  } },
  guest_spend: { title: 'Guest spend (Guest 360)', group: 'Finance', build: async (db, { from, to }) => {
    const stays = await db.all("SELECT b.id, b.guest_id, b.guest_name FROM hotel_reservations b WHERE b.arrival_date <= ? AND b.departure_date >= ? AND b.status <> 'cancelled'", [to, from]);
    const byGuest = new Map();
    for (const s of stays) {
      const rows = await db.all("SELECT source_type, kind, amount_cents, net_cents, transfer_ref, reversal_of, category FROM hotel_folio_entries WHERE reservation_id = ? AND kind IN ('charge', 'credit')", [s.id]);
      const g = byGuest.get(s.guest_id || s.id) || { guest: s.guest_name, stays: 0, room: 0, restaurant: 0, roomService: 0, laundry: 0, minibar: 0, other: 0, packageMeals: 0 };
      g.stays += 1;
      for (const r of rows) {
        if (r.category === 'transfer') continue; // a transfer moves a charge; it is not new spend
        const sign = r.kind === 'credit' ? -1 : 1;
        const amt = sign * Number(r.amount_cents);
        const key = { ROOM: 'room', EARLY_CHECKIN: 'room', LATE_CHECKOUT: 'room', EXTRA_BED: 'room', RESTAURANT: 'restaurant', ROOM_SERVICE: 'roomService', LAUNDRY: 'laundry', MINIBAR: 'minibar' }[r.source_type] || 'other';
        g[key] += amt;
      }
      g.packageMeals += Number((await db.get('SELECT COALESCE(SUM(amount_cents), 0) AS c FROM hotel_package_usage WHERE reservation_id = ? AND reversed = 0', [s.id])).c);
      byGuest.set(s.guest_id || s.id, g);
    }
    const rows = [...byGuest.values()].map((g) => ({ ...g, room: npr(g.room), restaurant: npr(g.restaurant), roomService: npr(g.roomService), laundry: npr(g.laundry), minibar: npr(g.minibar), other: npr(g.other), packageMeals: npr(g.packageMeals), total: npr(g.room + g.restaurant + g.roomService + g.laundry + g.minibar + g.other) })).sort((a, b) => b.total - a.total);
    return { columns: [col('guest', 'Guest'), col('stays', 'Stays', 'number'), col('room', 'Room', 'money'), col('restaurant', 'Restaurant', 'money'), col('roomService', 'Room service', 'money'), col('laundry', 'Laundry', 'money'), col('minibar', 'Minibar', 'money'), col('other', 'Other', 'money'), col('packageMeals', 'Meals in plan', 'money'), col('total', 'Total (gross)', 'money')], rows };
  } },
  night_audit: { title: 'Night audit history', group: 'Finance', build: async (db, { from, to }) => ({
    columns: [col('date', 'Date', 'date'), col('posted', 'Nights posted', 'number'), col('sold', 'Rooms sold', 'number'), col('occupancy', 'Occupancy %', 'number'), col('adr', 'ADR', 'money'), col('revpar', 'RevPAR', 'money'), col('revenue', 'Room revenue', 'money'), col('noShows', 'No-shows', 'number'), col('review', 'Needs review')],
    rows: (await db.all('SELECT business_date, summary_json FROM hotel_night_audits WHERE business_date BETWEEN ? AND ? ORDER BY business_date', [from, to])).map((a) => {
      const s = JSON.parse(a.summary_json);
      return { date: a.business_date, posted: s.roomNightsPosted, sold: s.roomsSold ?? s.inHouse, occupancy: s.occupancyPercent, adr: s.adr ?? 0, revpar: s.revpar ?? 0, revenue: s.roomRevenueToday, noShows: (s.noShows || []).length, review: (s.needsReview || []).join('; ') };
    }),
  }) },
};

export const REPORT_LIST = Object.entries(HOTEL_REPORTS).map(([id, r]) => ({ id, title: r.title, group: r.group }));

export async function runHotelReport(db, id, { from, to }) {
  const report = HOTEL_REPORTS[id];
  if (!report) fail('Unknown report.', 404);
  if (!isDate(from) || !isDate(to) || to < from) fail('Choose a valid date range.');
  if (dates(from, to).length > 366) fail('Choose a range of up to one year.');
  await ensureHotelSchema(db);
  const today = await hotelBusinessDate(db);
  const result = await report.build(db, { from, to, today });
  return { id, title: report.title, from, to, ...result };
}

export function reportCsv(report) {
  const labels = report.columns.map((c) => c.label);
  const rows = report.rows.map((row) => Object.fromEntries(report.columns.map((c) => [c.label, row[c.key] ?? ''])));
  return toCsv(labels, rows);
}

export { FOLIO_SOURCES };
