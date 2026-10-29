/**
 * Restaurant / hotel / combined business report for a date range.
 *
 * Profit & loss comes from the shared journal, like the financial reports:
 * - revenue: hotel income accounts (4030 rooms, 4040 services) vs every other
 *   income account (restaurant);
 * - expenses: an expense posting uses its category's business unit
 *   (expense_categories.business_unit); purchases and wastage are restaurant
 *   (kitchen stock); everything else (payroll, utilities without a tagged
 *   category, ...) is shared.
 * Hotel KPIs come from posted room nights in guest folios.
 */
import { ensureAccountingSchema } from './accounting.js';
import { ensureExpenseCategorySchema } from './expense-categories.js';
import { ensureHotelSchema } from './hotel/schema.js';
import { HOTEL_INCOME_CODES } from './overview.js';
import { toCsv } from './csv.js';
import { roomNightStats } from './hotel/reports.js';
import { hotelBusinessDate } from './hotel/service.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '') && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const days = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;

export async function businessReport(db, { from, to }) {
  if (!isDate(from) || !isDate(to) || to < from) fail('Choose a valid date range.');
  if (days(from, to) > 366) fail('Choose a range of up to one year.');
  await ensureAccountingSchema(db);
  await ensureExpenseCategorySchema(db);
  await ensureHotelSchema(db);

  const lines = await db.all(`
    SELECT e.entry_date AS date, a.code, a.name AS account_name, a.type, COALESCE(o.source_type, e.source_type) AS source_type,
           COALESCE(c.business_unit, 'shared') AS category_unit, x.category AS category_name,
           COALESCE(l.credit, 0) - COALESCE(l.debit, 0) AS net
    FROM journal_lines l
    JOIN journal_entries e ON e.id = l.journal_id
    JOIN accounts a ON a.id = l.account_id
    -- A reversal (void) is classified like the posting it reverses.
    LEFT JOIN journal_entries o ON e.source_type = 'reversal' AND o.id = e.source_id
    LEFT JOIN expenses x ON COALESCE(o.source_type, e.source_type) = 'expense' AND x.id = COALESCE(o.source_id, e.source_id)
    LEFT JOIN expense_categories c ON c.normalized_name = LOWER(TRIM(x.category))
    WHERE a.type IN ('income', 'expense') AND e.entry_date >= ? AND e.entry_date <= ?`, [from, to]);

  const seg = () => ({ revenue: 0, expenses: 0 });
  const pnl = { restaurant: seg(), hotel: seg(), shared: seg() };
  // Breakdown lines keyed by business + label: income by account, expenses by category (or account).
  const breakdown = { revenue: new Map(), expenses: new Map() };
  const addLine = (kind, business, label, amount) => {
    const key = `${business}|${label}`;
    const line = breakdown[kind].get(key) || { business, label, amount: 0 };
    line.amount += amount;
    breakdown[kind].set(key, line);
  };
  const daily = new Map();
  const day = (date) => {
    const key = String(date).slice(0, 10);
    if (!daily.has(key)) daily.set(key, { date: key, restaurantRevenue: 0, hotelRevenue: 0, expenses: 0, roomNights: 0, roomRevenue: 0 });
    return daily.get(key);
  };
  for (const row of lines) {
    const net = Number(row.net) || 0;
    if (row.type === 'income') {
      const unit = HOTEL_INCOME_CODES.includes(row.code) ? 'hotel' : 'restaurant';
      pnl[unit].revenue += net;
      day(row.date)[unit === 'hotel' ? 'hotelRevenue' : 'restaurantRevenue'] += net;
      addLine('revenue', unit, row.account_name, net);
    } else {
      const unit = row.source_type === 'expense' ? row.category_unit
        : ['purchase', 'wastage'].includes(row.source_type) ? 'restaurant' : 'shared';
      pnl[BUSINESS(unit)].expenses -= net;
      day(row.date).expenses -= net;
      addLine('expenses', BUSINESS(unit), (row.source_type === 'expense' && row.category_name) || row.account_name, -net);
    }
  }
  const segment = (s) => ({ revenue: round2(s.revenue), expenses: round2(s.expenses), net: round2(s.revenue - s.expenses) });
  const restaurant = segment(pnl.restaurant);
  const hotel = segment(pnl.hotel);
  const shared = segment(pnl.shared);
  const combined = segment({ revenue: pnl.restaurant.revenue + pnl.hotel.revenue, expenses: pnl.restaurant.expenses + pnl.hotel.expenses + pnl.shared.expenses });

  // Room-night KPIs share one definition with hotel reports (lib/hotel/reports.js).
  const stats = await roomNightStats(db, from, to, { today: await hotelBusinessDate(db) });
  for (const n of stats.daily) if (n.sold) Object.assign(day(n.date), { roomNights: n.sold, roomRevenue: n.roomRevenue });
  const available = stats.available;
  const sold = stats.sold;
  const roomRevenue = stats.roomRevenue;
  const noShows = await db.get("SELECT COUNT(*) AS n FROM hotel_reservations WHERE no_show = 1 AND arrival_date BETWEEN ? AND ?", [from, to]);
  // Commission owed to OTAs for stays arriving in the range (not posted to the ledger).
  const ota = await db.get(`SELECT COALESCE(SUM(o.commission_cents), 0) AS c, COUNT(*) AS n FROM hotel_ota_bookings o JOIN hotel_reservations r ON r.id = o.reservation_id
    WHERE o.status <> 'cancelled' AND r.status <> 'cancelled' AND r.arrival_date BETWEEN ? AND ?`, [from, to]);
  // Money actually received (net of refunds) per payment account. Credit sales,
  // room-charged bills and guest receivables are not money in hand, so they are excluded.
  const collectedRows = await db.all(`
    SELECT a.code, a.name, COALESCE(o.source_type, e.source_type) AS source_type, COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0) AS net
    FROM journal_lines l
    JOIN journal_entries e ON e.id = l.journal_id
    JOIN accounts a ON a.id = l.account_id
    LEFT JOIN journal_entries o ON e.source_type = 'reversal' AND o.id = e.source_id
    WHERE a.code IN ('1010', '1020', '1100', '1110', '1120', '1130', '1140')
      AND COALESCE(o.source_type, e.source_type) IN ('bill', 'refund', 'hotel_payment')
      AND e.entry_date >= ? AND e.entry_date <= ?
    GROUP BY a.code, a.name, COALESCE(o.source_type, e.source_type)`, [from, to]);
  const collections = new Map();
  for (const row of collectedRows) {
    const c = collections.get(row.code) || { method: row.name, restaurant: 0, hotel: 0 };
    c[row.source_type === 'hotel_payment' ? 'hotel' : 'restaurant'] += Number(row.net) || 0;
    collections.set(row.code, c);
  }
  // Settled restaurant bills in the range (a voided bill's reversal cancels it out).
  const bills = await db.get(`SELECT COUNT(DISTINCT e.source_id) AS n FROM journal_entries e
    WHERE e.source_type = 'bill' AND e.entry_date >= ? AND e.entry_date <= ?
      AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.source_type = 'reversal' AND r.source_id = e.id)`, [from, to]);
  const stays = await db.get(`SELECT
      SUM(CASE WHEN checked_in_at IS NOT NULL AND arrival_date BETWEEN ? AND ? THEN 1 ELSE 0 END) AS arrivals,
      SUM(CASE WHEN checked_out_at IS NOT NULL AND departure_date BETWEEN ? AND ? THEN 1 ELSE 0 END) AS departures
    FROM hotel_reservations`, [from, to, from, to]);
  const audits = await db.all('SELECT business_date, summary_json FROM hotel_night_audits WHERE business_date BETWEEN ? AND ? ORDER BY business_date DESC', [from, to]);

  return {
    from, to,
    pnl: { restaurant, hotel, shared, combined },
    hotelKpis: {
      roomNightsSold: sold,
      availableRoomNights: available,
      occupancyPercent: available ? round2((sold / available) * 100) : 0,
      roomRevenue: round2(roomRevenue),
      adr: sold ? round2(roomRevenue / sold) : 0,
      revpar: available ? round2(roomRevenue / available) : 0,
      noShows: Number(noShows.n),
      otaBookings: Number(ota.n),
      otaCommission: round2(Number(ota.c) / 100),
    },
    restaurantKpis: { bills: Number(bills?.n) || 0, avgBill: Number(bills?.n) ? round2(restaurant.revenue / Number(bills.n)) : 0 },
    stays: { checkIns: Number(stays?.arrivals) || 0, checkOuts: Number(stays?.departures) || 0 },
    revenueLines: sortedLines(breakdown.revenue),
    expenseLines: sortedLines(breakdown.expenses),
    collections: [...collections.values()].map((c) => ({ method: c.method, restaurant: round2(c.restaurant), hotel: round2(c.hotel), total: round2(c.restaurant + c.hotel) })).filter((c) => c.total || c.restaurant || c.hotel).sort((a, b) => b.total - a.total),
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({ ...d, restaurantRevenue: round2(d.restaurantRevenue), hotelRevenue: round2(d.hotelRevenue), expenses: round2(d.expenses), roomRevenue: round2(d.roomRevenue) })),
    audits: audits.map((a) => JSON.parse(a.summary_json)),
  };
}

const sortedLines = (map) => [...map.values()].map((l) => ({ ...l, amount: round2(l.amount) })).filter((l) => l.amount).sort((a, b) => b.amount - a.amount);

const BUSINESS = (unit) => (['restaurant', 'hotel'].includes(unit) ? unit : 'shared');

const CSV_HEADERS = ['Section', 'Item', 'Revenue', 'Expenses', 'Net or value', 'Restaurant revenue', 'Hotel revenue', 'Room nights', 'Room revenue'];

export function businessReportCsv(report) {
  const k = report.hotelKpis;
  const rows = [
    ...[['Restaurant', report.pnl.restaurant], ['Hotel', report.pnl.hotel], ['Shared (unallocated)', report.pnl.shared], ['Combined', report.pnl.combined]]
      .map(([item, s]) => ({ Section: 'Profit & loss', Item: item, Revenue: s.revenue, Expenses: s.expenses, 'Net or value': s.net })),
    ...[['Occupancy %', k.occupancyPercent], ['ADR', k.adr], ['RevPAR', k.revpar], ['Room nights sold', k.roomNightsSold], ['Available room nights', k.availableRoomNights], ['Room revenue', k.roomRevenue], ['No-shows', k.noShows], ['OTA bookings', k.otaBookings], ['OTA commission', k.otaCommission]]
      .map(([item, value]) => ({ Section: 'Hotel KPI', Item: item, 'Net or value': value })),
    ...(report.revenueLines || []).map((l) => ({ Section: `Revenue · ${l.business}`, Item: l.label, Revenue: l.amount })),
    ...(report.expenseLines || []).map((l) => ({ Section: `Expenses · ${l.business}`, Item: l.label, Expenses: l.amount })),
    ...(report.collections || []).map((c) => ({ Section: 'Money collected', Item: c.method, 'Restaurant revenue': c.restaurant, 'Hotel revenue': c.hotel, 'Net or value': c.total })),
    ...report.daily.map((d) => ({ Section: 'Daily', Item: d.date, 'Restaurant revenue': d.restaurantRevenue, 'Hotel revenue': d.hotelRevenue, 'Room nights': d.roomNights, 'Room revenue': d.roomRevenue })),
  ];
  return toCsv(CSV_HEADERS, rows);
}
