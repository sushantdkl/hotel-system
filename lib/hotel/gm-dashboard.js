/**
 * General manager / owner control center (the Combined workspace).
 *
 * Revenue and balances come from the ledger, so a restaurant bill charged to a
 * room counts once (as F&B in 4010); the folio movement is a receivable, not a
 * sale. Room KPIs use the room-night definitions in lib/hotel/reports.js. All
 * figures are computed with bounded queries for the date, never by loading
 * history into the browser.
 */
import { ensureAccountingSchema } from '../accounting.js';
import { ensureHotelSchema } from './schema.js';
import { hotelBusinessDate } from './service.js';
import { departmentalRevenue, fbAnalysis, roomNightStats } from './reports.js';
import { folioTotals } from './folio-math.js';
import { clockedInNow, ensureStaffHrSchema } from '../staff-hr.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const safe = async (promise, fallback) => { try { return await promise; } catch { return fallback; } };

async function balance(db, code, sign = 1) {
  const row = await db.get('SELECT COALESCE(SUM(l.debit - l.credit), 0) AS b FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = ?', [code]);
  return r2(sign * Number(row?.b || 0));
}

export async function gmDashboard(db, now = new Date()) {
  await ensureAccountingSchema(db);
  await ensureHotelSchema(db);
  await ensureStaffHrSchema(db);
  const today = await hotelBusinessDate(db, now);
  const monthStart = `${today.slice(0, 8)}01`;
  const count = async (sql, params = []) => Number((await safe(db.get(sql, params), { n: 0 }))?.n) || 0;

  // HOTEL
  const stats = await roomNightStats(db, today, today, { today });
  const month = await roomNightStats(db, monthStart, today, { today });
  const rooms = await db.all("SELECT room_number, cleaning_status, blocked, block_kind, hk_flag FROM hotel_rooms WHERE property_id = 'main'");
  const inHouse = await db.all("SELECT b.*, r.room_number, r.cleaning_status FROM hotel_reservations b JOIN hotel_rooms r ON r.id = b.room_id WHERE b.status = 'in_house' AND b.checked_out_at IS NULL");
  const arrivals = await db.all("SELECT b.*, r.room_number, r.cleaning_status, r.blocked FROM hotel_reservations b JOIN hotel_rooms r ON r.id = b.room_id WHERE b.status = 'confirmed' AND b.booking_type <> 'waitlist' AND b.arrival_date <= ?", [today]);
  let outstanding = 0; const overLimit = [];
  for (const stay of inHouse) {
    const t = folioTotals(await db.all('SELECT kind, category, amount_cents, net_cents, tax_cents, window_no FROM hotel_folio_entries WHERE reservation_id = ?', [stay.id]));
    outstanding += t.balance;
    if (stay.credit_limit_cents != null && t.balance > Number(stay.credit_limit_cents)) overLimit.push(`Room ${stay.room_number} ${stay.guest_name}: NPR ${r2(t.balance / 100)} over limit ${r2(Number(stay.credit_limit_cents) / 100)}`);
  }
  const sellable = rooms.filter((r) => !Number(r.blocked)).length;
  const hotel = {
    roomsTotal: rooms.length, roomsAvailable: sellable, roomsSold: inHouse.length,
    occupancy: sellable ? r2((inHouse.length / sellable) * 100) : 0,
    adr: stats.adr, revpar: stats.revpar, roomRevenueToday: stats.roomRevenue,
    monthOccupancy: month.occupancy, monthAdr: month.adr, monthRevpar: month.revpar,
    arrivals: arrivals.filter((a) => a.arrival_date === today).length, departures: inHouse.filter((s) => s.departure_date <= today).length,
    inHouseGuests: inHouse.reduce((s, b) => s + Number(b.adults ?? b.guest_count) + Number(b.children || 0), 0),
    noShowsPending: arrivals.filter((a) => a.arrival_date < today).length,
    dirtyRooms: rooms.filter((r) => r.cleaning_status !== 'ready' && !Number(r.blocked)).length,
    outOfOrder: rooms.filter((r) => Number(r.blocked)).length,
    outstandingFolios: r2(outstanding / 100),
  };

  // RESTAURANT (business-day dated bills; revenue ex. tax)
  const fb = await safe(fbAnalysis(db, today, today), null);
  const cancelledKots = await count("SELECT COUNT(*) AS n FROM kots WHERE cancelled_at IS NOT NULL AND substr(CAST(cancelled_at AS TEXT), 1, 10) = ?", [today]);
  const openTables = await count("SELECT COUNT(*) AS n FROM tables WHERE status IN ('occupied', 'dining') AND COALESCE(is_active, 1) = 1");
  const restaurant = fb ? { sales: fb.total, bills: fb.bills, covers: fb.covers, averageCheck: fb.averageCheck, walkIn: fb.walkIn, hotelGuests: fb.inHouse, roomService: fb.roomService, packageCovered: fb.packageCovered, discounts: fb.discounts, byFoodGroup: fb.byFoodGroup, cancelledKots, openTables } : null;

  // FINANCE (ledger)
  const deptToday = await departmentalRevenue(db, today, today);
  const deptMonth = await departmentalRevenue(db, monthStart, today);
  const expenses = async (from, to) => r2(Number((await db.get(`SELECT COALESCE(SUM(l.debit - l.credit), 0) AS e FROM journal_lines l JOIN journal_entries e ON e.id = l.journal_id JOIN accounts a ON a.id = l.account_id
    WHERE a.type = 'expense' AND e.entry_date >= ? AND e.entry_date <= ?`, [from, to])).e));
  const finance = {
    revenueToday: deptToday.total, revenueMonth: deptMonth.total, departmentsToday: deptToday.departments.map((d) => ({ label: d.label, revenue: d.revenue })), departmentsMonth: deptMonth.departments.map((d) => ({ label: d.label, revenue: d.revenue })),
    expensesToday: await expenses(today, today), expensesMonth: await expenses(monthStart, today),
    cash: await balance(db, '1010'), bank: await balance(db, '1020'),
    customerReceivables: await balance(db, '1300'), guestReceivables: await balance(db, '1320'), cityLedger: await balance(db, '1330'),
    guestDeposits: await balance(db, '2150', -1), packageLiability: await balance(db, '2160', -1), payables: await balance(db, '2010', -1),
    payrollMonth: r2(Number((await db.get(`SELECT COALESCE(SUM(l.debit - l.credit), 0) AS e FROM journal_lines l JOIN journal_entries e ON e.id = l.journal_id JOIN accounts a ON a.id = l.account_id WHERE a.code = '5030' AND e.entry_date >= ? AND e.entry_date <= ?`, [monthStart, today])).e)),
    inventoryValue: r2(Number((await safe(db.get('SELECT COALESCE(SUM(quantity * cost_per_unit), 0) AS v FROM inventory_items WHERE COALESCE(is_archived, 0) = 0 AND quantity > 0'), { v: 0 })).v)),
    unverifiedPayments: await count("SELECT COUNT(*) AS n FROM bill_payments WHERE verification_status = 'pending'"),
    lastCashDifference: r2((await safe(db.get("SELECT cash_difference FROM business_days WHERE status = 'closed' ORDER BY id DESC LIMIT 1"), null))?.cash_difference || 0),
  };

  // OPERATIONAL ALERTS: each { severity, area, text, link }
  const alerts = [];
  const push = (severity, area, text, link) => alerts.push({ severity, area, text, link });
  for (const a of arrivals) {
    if (a.arrival_date < today) push('high', 'Front desk', `No-show pending: ${a.guest_name} (${a.id}) was due ${a.arrival_date}`, '/admin/hotel/reservations');
    else {
      if (Number(a.blocked)) push('high', 'Rooms', `Arrival ${a.guest_name} is assigned to out-of-order room ${a.room_number}`, '/admin/hotel/rooms');
      else if (a.cleaning_status !== 'ready') push('medium', 'Housekeeping', `Room ${a.room_number} not ready for today's arrival ${a.guest_name}`, '/admin/hotel/housekeeping');
      if (a.eta && /^\d{2}:\d{2}$/.test(a.eta)) {
        const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
        if (a.eta < clock) push('low', 'Front desk', `Late arrival: ${a.guest_name} expected ${a.eta}`, '/admin/hotel');
      }
    }
  }
  for (const s of inHouse) if (s.departure_date < today) push('medium', 'Front desk', `Overstay: room ${s.room_number} ${s.guest_name} was due out ${s.departure_date}`, '/admin/hotel');
  for (const text of overLimit) push('high', 'Finance', `Folio over credit limit: ${text}`, '/admin/hotel/folios');
  const urgent = await safe(db.all("SELECT t.id, t.title, r.room_number FROM hotel_maintenance_tickets t JOIN hotel_rooms r ON r.id = t.room_id WHERE t.priority = 'urgent' AND t.status NOT IN ('resolved', 'closed')"), []);
  for (const t of urgent) push('high', 'Maintenance', `Urgent repair, room ${t.room_number}: ${t.title}`, '/admin/hotel/maintenance');
  if (hotel.outOfOrder && hotel.occupancy >= 85) push('medium', 'Rooms', `${hotel.outOfOrder} room(s) out of order while occupancy is ${hotel.occupancy}%`, '/admin/hotel/maintenance');
  const lowStock = await safe(db.all('SELECT COALESCE(item_name, name) AS name, quantity FROM inventory_items WHERE COALESCE(is_archived, 0) = 0 AND COALESCE(min_stock_level, min_stock, 0) > 0 AND quantity <= COALESCE(min_stock_level, min_stock, 0) ORDER BY quantity LIMIT 10'), []);
  for (const item of lowStock) push(Number(item.quantity) <= 0 ? 'high' : 'low', 'Inventory', `Low stock: ${item.name} (${r2(item.quantity)})`, '/admin/inventory');
  const bigDiscounts = await safe(db.all(`SELECT bill_number, discount_amount, grand_total FROM bills bl WHERE COALESCE(bl.discount_amount, 0) > 0 AND COALESCE(bl.discount_amount, 0) >= 0.2 * (COALESCE(bl.grand_total, 0) + COALESCE(bl.discount_amount, 0))
    AND bl.business_day_id = (SELECT id FROM business_days WHERE status = 'open' ORDER BY id DESC LIMIT 1)`), []);
  for (const b of bigDiscounts) push('medium', 'Restaurant', `High discount on bill ${b.bill_number}: NPR ${r2(b.discount_amount)}`, '/admin/bills');
  const hotelEvents = await safe(db.all("SELECT action, details FROM hotel_audit_events WHERE action IN ('rate_override', 'folio_refund', 'folio_adjustment', 'folio_reversal', 'room_status_override') AND (business_date = ? OR substr(CAST(created_at AS TEXT), 1, 10) = ?) ORDER BY created_at DESC LIMIT 10", [today, today]), []);
  for (const e of hotelEvents) push(e.action === 'rate_override' ? 'medium' : 'low', 'Controls', JSON.parse(e.details).message, '/admin/alerts');
  if (Math.abs(finance.lastCashDifference) >= 1) push(Math.abs(finance.lastCashDifference) >= 1000 ? 'high' : 'medium', 'Finance', `Last closing cash difference: NPR ${finance.lastCashDifference}`, '/admin/business-days');
  if (finance.unverifiedPayments) push('medium', 'Finance', `${finance.unverifiedPayments} payment(s) awaiting verification`, '/admin/settlements');
  const longTables = await safe(db.all(`SELECT table_number FROM orders WHERE status IN ('dining', 'served', 'awaiting_payment') AND table_number IS NOT NULL AND created_at < ?`, [new Date(now.getTime() - 4 * 3600000).toISOString().slice(0, 19).replace('T', ' ')]), []);
  if (longTables.length) push('low', 'Restaurant', `${longTables.length} table(s) open for over 4 hours (${longTables.slice(0, 5).map((t) => t.table_number).join(', ')})`, '/admin/table-management');
  const openOwnerAlerts = await count("SELECT COUNT(*) AS n FROM owner_alerts WHERE status = 'open'");
  const order = { high: 0, medium: 1, low: 2 };
  alerts.sort((a, b) => order[a.severity] - order[b.severity]);

  const onDuty = await safe(clockedInNow(db), []);
  return {
    date: today, monthStart, hotel, restaurant, finance,
    events: null, // no events/banquets module in this installation
    staff: { onDuty: onDuty.length, managerOnDuty: onDuty.some((row) => row.role === 'manager') },
    alerts, openOwnerAlerts,
  };
}
