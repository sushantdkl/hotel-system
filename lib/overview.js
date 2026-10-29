/**
 * Combined restaurant + hotel overview for owners and managers.
 *
 * Money comes from the shared journal, so it agrees with the General Ledger
 * and financial reports: hotel revenue accounts (4030 rooms, 4040 services)
 * versus every other income account (restaurant). Expenses are shared and not
 * split by business yet.
 */
import { ensureAccountingSchema } from './accounting.js';
import { hotelSnapshot } from './hotel/service.js';
import { nepalDateString } from './report-dates.js';
import { clockedInNow, ensureStaffHrSchema } from './staff-hr.js';

// Hotel income accounts (rooms, services, laundry, minibar, transport, package breakage).
// Restaurant charges to a room stay in 4010: the folio only moves the receivable.
export const HOTEL_INCOME_CODES = ['4030', '4040', '4041', '4042', '4043', '4045'];

export async function ledgerTotals(db, from, to) {
  const rows = await db.all(
    `SELECT a.code, a.type, COALESCE(SUM(l.credit), 0) - COALESCE(SUM(l.debit), 0) AS net
     FROM journal_lines l
     JOIN journal_entries e ON e.id = l.journal_id
     JOIN accounts a ON a.id = l.account_id
     WHERE a.type IN ('income', 'expense') AND e.entry_date >= ? AND e.entry_date <= ?
     GROUP BY a.code, a.type`,
    [from, to]
  );
  const totals = { restaurant: 0, hotel: 0, rooms: 0, expenses: 0 };
  for (const row of rows) {
    const net = Number(row.net) || 0;
    if (row.type === 'expense') totals.expenses -= net;
    else if (HOTEL_INCOME_CODES.includes(row.code)) {
      totals.hotel += net;
      if (row.code === '4030') totals.rooms += net;
    } else totals.restaurant += net;
  }
  const round = (n) => Math.round(n * 100) / 100;
  return {
    restaurant: round(totals.restaurant),
    hotel: round(totals.hotel),
    hotelRooms: round(totals.rooms),
    revenue: round(totals.restaurant + totals.hotel),
    expenses: round(totals.expenses),
    net: round(totals.restaurant + totals.hotel - totals.expenses),
  };
}

export async function combinedOverview(db, now = new Date()) {
  await ensureAccountingSchema(db);
  await ensureStaffHrSchema(db);
  const today = nepalDateString(now);
  const monthStart = `${today.slice(0, 8)}01`;
  const count = (sql) => db.get(sql).then((row) => Number(row?.c) || 0).catch(() => 0);

  const [todayTotals, monthTotals, activeTables, totalTables, liveOrders, hotel, onDuty] = await Promise.all([
    ledgerTotals(db, today, today),
    ledgerTotals(db, monthStart, today),
    count(`SELECT COUNT(*) AS c FROM tables WHERE status IN ('occupied', 'dining') AND COALESCE(is_active, 1) = 1`),
    count('SELECT COUNT(*) AS c FROM tables WHERE COALESCE(is_active, 1) = 1'),
    count(`SELECT COUNT(*) AS c FROM orders WHERE status IN ('pending','confirmed','preparing','cooking','ready','dining','served','awaiting_payment')`),
    hotelSnapshot(db, now),
    clockedInNow(db),
  ]);

  const sellable = hotel.rooms.filter((room) => !room.blocked).length;
  const inHouse = hotel.bookings.filter((b) => b.status === 'in_house');
  const sum = (list) => list.reduce((total, entry) => total + entry.amount, 0);
  const balance = inHouse.reduce((total, b) => total + sum(b.entries) - sum(b.payments), 0);

  return {
    date: today,
    monthStart,
    today: todayTotals,
    month: monthTotals,
    restaurant: { activeTables, totalTables, liveOrders },
    staffOnDuty: onDuty.length,
    managerOnDuty: onDuty.some((row) => row.role === 'manager'),
    hotel: {
      rooms: hotel.rooms.length,
      sellable,
      occupied: inHouse.length,
      occupancy: sellable ? Math.round((inHouse.length / sellable) * 1000) / 10 : 0,
      arrivals: hotel.bookings.filter((b) => b.status === 'confirmed' && b.start === today).length,
      departures: inHouse.filter((b) => b.end <= today).length,
      dirty: hotel.rooms.filter((room) => room.cleaning !== 'ready').length,
      openBalance: Math.round(balance * 100) / 100,
    },
  };
}
