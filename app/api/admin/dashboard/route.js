import { cashSafePayload, assertCashClosingAllowed } from '@/lib/cash-closing-policy.js';
import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import {
  nepalDateString,
  formatNepalDateTime,
  nepalOperationalRangeBounds,
  nepalDateSql,
} from '@/lib/report-dates.js';
import { countedBillSql, openBillSql, paymentBucketSql, settledPaymentSql } from '@/lib/report-scope.js';
import { requireAuth } from '@/lib/api-guard.js';
import { dateKey } from '@/lib/reports.js';
import { FEATURES } from '@/lib/deployment.js';
import { currentBusinessDay, businessDaySummary } from '@/lib/business-days.js';
import { orderTypeLabel } from '@/lib/order-types.js';

const COST_RATIO = 0.6; // flat food-cost heuristic until recipe-cost rollup is wired
// Excludes empty shell orders (created, never got an item, abandoned mid-flow) —
// those aren't operationally "active," just orphaned rows that would otherwise
// sit on this count forever.
const LIVE_ORDER = `status IN ('pending','confirmed','preparing','cooking','ready','dining','served','awaiting_payment')
  AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = orders.id AND COALESCE(oi.status,'') NOT IN ('voided','cancelled'))`;

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'dashboard.view' });
    if (auth.error) return auth.error;
    const respond = (value, options) => NextResponse.json(cashSafePayload(value, auth.user), options);

    const db = Database.getInstance();
    const activeBusinessDay = await currentBusinessDay(db);
    const activeDaySummary = activeBusinessDay ? await businessDaySummary(db, activeBusinessDay) : null;
    const today = nepalDateString(new Date());
    const yCursor = new Date(`${today}T12:00:00+05:45`);
    yCursor.setDate(yCursor.getDate() - 1);
    const yesterday = nepalDateString(yCursor);
    const wCursor = new Date(`${today}T12:00:00+05:45`);
    wCursor.setDate(wCursor.getDate() - 6);
    const weekStart = nepalDateString(wCursor);

    // Driver-aware Nepal-day windows: PostgreSQL stores Nepal wall clocks,
    // while the local SQLite fallback stores UTC wall clocks.
    const legacyBounds = (start, end = start) => {
      const bounds = nepalOperationalRangeBounds(db.driver, start, end);
      return { startUtc: bounds.start, endUtcExclusive: bounds.endExclusive };
    };
    const tB = legacyBounds(today);
    const yB = legacyBounds(yesterday);
    const wB = legacyBounds(weekStart, today);
    const nd = (col) => nepalDateSql(col);
    const inDay = (col) => `${col} >= ? AND ${col} < ?`;
    const activeDayId = activeBusinessDay?.id || null;
    const dayScope = (dateColumn, businessColumn) => activeDayId
      ? { sql: `${businessColumn} = ?`, params: [activeDayId] }
      : { sql: inDay(dateColumn), params: [tB.startUtc, tB.endUtcExclusive] };
    const orderDay = dayScope('created_at', 'business_day_id');
    const orderDayO = dayScope('o.created_at', 'o.business_day_id');
    const billDay = dayScope('created_at', 'business_day_id');
    const paymentDay = dayScope('created_at', 'business_day_id');
    const kotPrintedDay = dayScope('k.printed_at', 'k.business_day_id');
    const kotCompletedDay = dayScope('k.completed_at', 'k.business_day_id');
    const refundDay = dayScope('created_at', 'business_day_id');

    const [
      todaySalesRow,
      yesterdaySalesRow,
      todayOrdersRow,
      yesterdayOrdersRow,
      paidBillsToday,
      activeOrdersRow,
      openBillsRow,
      reopenedBillsRow,
      creditOutstandingRow,
      occupiedRow,
      diningRow,
      totalTablesRow,
      floorOpenRow,
      lowStockItems,
      pendingTickets,
      unpaidBills,
      soonReservations,
      recentOrders,
      liveOrders,
      recentKots,
      completedTickets,
      checkedInReservations,
      recentMovements,
      dailyBills,
      topItemsToday,
      bestEmployeeToday,
      busiestTableToday,
      paymentMixRows,
      hourlyRows,
      refundsTodayRow,
      discountsTodayRow,
    ] = await Promise.all([
      db.get(`SELECT COALESCE(SUM(amount), 0) as total FROM bill_payments WHERE ${inDay('created_at')} AND ${settledPaymentSql('bill_payments')}`, [tB.startUtc, tB.endUtcExclusive]).catch(() => ({ total: 0 })),
      db.get(`SELECT COALESCE(SUM(amount), 0) as total FROM bill_payments WHERE ${inDay('created_at')} AND ${settledPaymentSql('bill_payments')}`, [yB.startUtc, yB.endUtcExclusive]).catch(() => ({ total: 0 })),
      db.get(`SELECT COUNT(*) as c FROM orders WHERE ${orderDay.sql} AND COALESCE(status,'') != 'cancelled'`, orderDay.params).catch(() => ({ c: 0 })),
      db.get(`SELECT COUNT(*) as c FROM orders WHERE ${inDay('created_at')} AND COALESCE(status,'') != 'cancelled'`, [yB.startUtc, yB.endUtcExclusive]).catch(() => ({ c: 0 })),
      db.get(
        `SELECT COUNT(*) as c, COALESCE(AVG(grand_total), 0) as avg_ticket, COALESCE(SUM(grand_total), 0) as revenue
         FROM bills WHERE ${billDay.sql} AND ${countedBillSql('bills')}`,
        billDay.params
      ).catch(() => ({ c: 0, avg_ticket: 0, revenue: 0 })),
      db.get(`SELECT COUNT(*) as c FROM orders WHERE ${LIVE_ORDER}`).catch(() => ({ c: 0 })),
      db.get(
        `SELECT COUNT(*) as c FROM bills WHERE ${openBillSql('bills')}`
      ).catch(() => ({ c: 0 })),
      db.get(`SELECT COUNT(*) as c FROM bills WHERE LOWER(COALESCE(status,'')) = 'reopened'`).catch(() => ({ c: 0 })),
      db.get(
        `SELECT COALESCE(SUM(outstanding_amount), 0) as total FROM bills WHERE COALESCE(outstanding_amount,0) > 0 AND ${billDay.sql}`,
        billDay.params
      ).catch(() => ({ total: 0 })),
      db.get(`SELECT COUNT(*) as c FROM tables WHERE status IN ('occupied','dining') AND COALESCE(is_active, 1) = 1`).catch(() => ({ c: 0 })),
      db.get(`SELECT COUNT(*) as c FROM tables WHERE status = 'dining' AND COALESCE(is_active, 1) = 1`).catch(() => ({ c: 0 })),
      db.get(`SELECT COUNT(*) as c FROM tables WHERE COALESCE(is_active, 1) = 1`).catch(() => ({ c: 0 })),
      db.get(`
        SELECT COALESCE(SUM(oi.subtotal), 0) as total
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        WHERE o.status IN ('pending','confirmed','preparing','cooking','ready','dining','served','awaiting_payment')
          AND COALESCE(oi.status,'') NOT IN ('voided','cancelled')
      `).catch(() => ({ total: 0 })),
      db.all(`
        SELECT item_name as name, quantity, unit, min_stock_level
        FROM inventory_items
        WHERE quantity <= COALESCE(min_stock_level, 0)
        ORDER BY (quantity - COALESCE(min_stock_level, 0)) ASC
        LIMIT 8
      `).catch(() => []),
      db.all(`
        SELECT k.id, k.status, k.printed_at, k.started_at, o.table_number, o.order_number
        FROM kots k
        JOIN orders o ON k.order_id = o.id
        WHERE k.status IN ('pending', 'preparing')
      `).catch(() => []),
      db.all(`
        SELECT b.id, b.bill_number, b.created_at, b.grand_total, o.table_number
        FROM bills b
        LEFT JOIN orders o ON b.order_id = o.id
        WHERE ${openBillSql('b')}
        ORDER BY b.created_at ASC
        LIMIT 8
      `).catch(() => []),
      FEATURES.reservations
        ? db.all(`
            SELECT id, name, phone, date, time, party_size, guests, status
            FROM reservations
            WHERE date = ? AND status IN ('new', 'confirmed')
          `, [today]).catch(() => [])
        : Promise.resolve([]),
      db.all(`
        SELECT id, order_number, table_number, order_type, status, created_at
        FROM orders
        WHERE ${orderDay.sql}
        ORDER BY created_at DESC
        LIMIT 20
      `, orderDay.params).catch(() => []),
      // Live open carts — always surface these so the board isn't empty overnight.
      db.all(`
        SELECT id, order_number, table_number, order_type, status, created_at, updated_at,
               (SELECT COALESCE(SUM(subtotal),0) FROM order_items oi
                WHERE oi.order_id = orders.id AND COALESCE(oi.status,'') NOT IN ('voided','cancelled')) AS amount
        FROM orders
        WHERE ${LIVE_ORDER}
        ORDER BY COALESCE(updated_at, created_at) DESC
        LIMIT 15
      `).catch(() => []),
      db.all(`
        SELECT k.id, k.kot_number, k.printed_at, o.table_number, o.order_number
        FROM kots k
        JOIN orders o ON k.order_id = o.id
        WHERE ${kotPrintedDay.sql}
          AND COALESCE(k.kot_type,'') != 'cancellation'
        ORDER BY k.printed_at DESC
        LIMIT 15
      `, kotPrintedDay.params).catch(() => []),
      db.all(`
        SELECT k.id, k.completed_at, o.table_number
        FROM kots k
        JOIN orders o ON k.order_id = o.id
        WHERE k.status = 'completed' AND ${kotCompletedDay.sql}
        ORDER BY k.completed_at DESC
        LIMIT 20
      `, kotCompletedDay.params).catch(() => []),
      FEATURES.reservations
        ? db.all(`
            SELECT id, name, checked_in_at
            FROM reservations
            WHERE checked_in_at IS NOT NULL AND ${inDay('checked_in_at')}
            ORDER BY checked_in_at DESC
            LIMIT 20
          `, [tB.startUtc, tB.endUtcExclusive]).catch(() => [])
        : Promise.resolve([]),
      db.all(`
        SELECT m.id, m.change_type, m.quantity_changed, m.created_at, im.item_name
        FROM stock_movements m
        LEFT JOIN inventory_items im ON m.inventory_item_id = im.id
        WHERE m.change_type IN ('manual_restock', 'purchase_receipt', 'wastage', 'adjustment', 'manual_adjustment', 'opening_balance')
          AND ${inDay('m.created_at')}
        ORDER BY m.created_at DESC
        LIMIT 20
      `, [tB.startUtc, tB.endUtcExclusive]).catch(() => []),
      db.all(`
        SELECT ${nd('created_at')} as d, COUNT(*) as orders, COALESCE(SUM(grand_total), 0) as revenue
        FROM bills
        WHERE ${inDay('created_at')}
          AND ${countedBillSql('bills')}
        GROUP BY ${nd('created_at')}
        ORDER BY d ASC
      `, [wB.startUtc, wB.endUtcExclusive]).catch(() => []),
      db.all(`
        SELECT COALESCE(oi.item_name, mi.name, 'Item') as name, SUM(oi.quantity) as qty,
               COALESCE(SUM(oi.subtotal), 0) as revenue
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        LEFT JOIN menu_items mi ON COALESCE(oi.menu_item_id, oi.item_id) = mi.id
        WHERE ${orderDayO.sql} AND COALESCE(oi.status, '') NOT IN ('voided', 'cancelled')
        GROUP BY COALESCE(oi.item_name, mi.name, 'Item')
        ORDER BY qty DESC
        LIMIT 8
      `, orderDayO.params).catch(() => []),
      db.get(`
        SELECT u.full_name as name, COUNT(*) as c
        FROM orders o
        JOIN users u ON o.waiter_id = u.id
        WHERE ${orderDayO.sql}
        GROUP BY u.full_name
        ORDER BY c DESC
        LIMIT 1
      `, orderDayO.params).catch(() => null),
      db.get(`
        SELECT table_number, COUNT(*) as c
        FROM orders
        WHERE ${orderDay.sql} AND table_number IS NOT NULL
        GROUP BY table_number
        ORDER BY c DESC
        LIMIT 1
      `, orderDay.params).catch(() => null),
      db.all(`
        SELECT ${paymentBucketSql("COALESCE(payment_method, 'other')")} as method, COALESCE(SUM(amount), 0) as total, COUNT(*) as c
        FROM bill_payments
        WHERE ${paymentDay.sql} AND ${settledPaymentSql('bill_payments')}
        GROUP BY ${paymentBucketSql("COALESCE(payment_method, 'other')")}
        ORDER BY total DESC
      `, paymentDay.params).catch(() => []),
      // Hour in Nepal time for hourly sales chart.
      db.driver === 'postgres'
        ? db.all(`
            SELECT EXTRACT(HOUR FROM created_at)::int as hour,
                   COUNT(*) as c, COALESCE(SUM(amount), 0) as total
            FROM bill_payments
            WHERE ${paymentDay.sql} AND ${settledPaymentSql('bill_payments')}
            GROUP BY 1 ORDER BY hour ASC
          `, paymentDay.params).catch(() => [])
        : db.all(`
            SELECT CAST(strftime('%H', datetime(created_at, '+5 hours', '+45 minutes')) AS INTEGER) as hour,
                   COUNT(*) as c, COALESCE(SUM(amount), 0) as total
            FROM bill_payments
            WHERE ${paymentDay.sql} AND ${settledPaymentSql('bill_payments')}
            GROUP BY hour ORDER BY hour ASC
          `, paymentDay.params).catch(() => []),
      db.get(`
        SELECT COALESCE(SUM(CASE WHEN type='refund' THEN amount WHEN type='refund_reversal' THEN -amount ELSE 0 END), 0) as total,
               SUM(CASE WHEN type='refund' THEN 1 WHEN type='refund_reversal' THEN -1 ELSE 0 END) as c
        FROM bill_corrections
        WHERE type IN ('refund','refund_reversal') AND ${refundDay.sql}
      `, refundDay.params).catch(() => ({ total: 0, c: 0 })),
      db.get(`
        SELECT COALESCE(SUM(discount_amount), 0) as total
        FROM bills
        WHERE ${billDay.sql}
          AND ${countedBillSql('bills')}
      `, billDay.params).catch(() => ({ total: 0 })),
    ]);

    let sales = n(todaySalesRow?.total);
    const prevSales = n(yesterdaySalesRow?.total);
    let orders = n(todayOrdersRow?.c);
    const prevOrders = n(yesterdayOrdersRow?.c);
    let avgTicket = n(paidBillsToday?.avg_ticket);
    let paidCount = n(paidBillsToday?.c);
    if (activeDaySummary) {
      sales = n(activeDaySummary.sales?.billed_total);
      orders = n(activeDaySummary.orders?.created);
      avgTicket = n(activeDaySummary.sales?.average_bill);
      paidCount = n(activeDaySummary.sales?.completed_bills);
    }
    const profit = sales - sales * COST_RATIO;
    const prevProfit = prevSales - prevSales * COST_RATIO;
    const occupiedTables = Math.max(n(occupiedRow?.c), n(diningRow?.c));
    const floorOpen = n(floorOpenRow?.total);

    const needsAttention = [];
    for (const item of lowStockItems || []) {
      const qty = n(item.quantity);
      const min = n(item.min_stock_level);
      needsAttention.push({
        type: qty <= 0 ? 'out_of_stock' : 'low_stock',
        text: qty <= 0
          ? `${item.name} is out of stock`
          : `${item.name} is low on stock (${qty} ${item.unit || ''} left)`,
      });
    }
    const now = Date.now();
    if (FEATURES.kitchenDisplay) {
      for (const t of pendingTickets || []) {
        const started = new Date(t.printed_at || t.started_at).getTime();
        if (!Number.isFinite(started)) continue;
        const minutes = Math.round((now - started) / 60000);
        if (minutes >= 15) {
          needsAttention.push({
            type: 'kitchen_delay',
            text: `Table ${t.table_number || t.order_number} has been waiting ${minutes} min on food`,
          });
        }
      }
    }
    for (const b of unpaidBills || []) {
      const minutes = Math.round((now - new Date(b.created_at).getTime()) / 60000);
      needsAttention.push({
        type: 'unpaid_bill',
        text: `Bill ${b.bill_number}${b.table_number ? ` (Table ${b.table_number})` : ''} is unpaid${minutes > 0 ? ` — ${minutes} min` : ''}`,
        href: '/admin/bills',
      });
    }
    if (n(reopenedBillsRow?.c) > 0) {
      needsAttention.push({
        type: 'reopened_bill',
        text: `${n(reopenedBillsRow?.c)} reopened bill${n(reopenedBillsRow?.c) === 1 ? '' : 's'} still open in POS`,
        href: '/admin/bills',
      });
    }
    if (n(creditOutstandingRow?.total) > 0.01) {
      needsAttention.push({
        type: 'credit_due',
        text: `Customer credit outstanding today: Rs ${n(creditOutstandingRow?.total).toFixed(0)}`,
        href: '/admin/bills',
      });
    }
    if (FEATURES.reservations) {
      for (const r of soonReservations || []) {
        const when = r.date && r.time ? new Date(`${r.date}T${r.time.length === 5 ? r.time + ':00' : r.time}`) : null;
        if (!when || Number.isNaN(when.getTime())) continue;
        const diffMin = Math.round((when.getTime() - now) / 60000);
        if (diffMin >= -5 && diffMin <= 30) {
          needsAttention.push({
            type: 'reservation_soon',
            text: diffMin <= 0
              ? `${r.name} (party of ${r.party_size || r.guests || '—'}) has arrived for their reservation`
              : `${r.name} (party of ${r.party_size || r.guests || '—'}) arrives in ${diffMin} min`,
          });
        }
      }
    }

    const activity = [];
    const seenOrderIds = new Set();
    for (const o of liveOrders || []) {
      seenOrderIds.add(o.id);
      const amt = n(o.amount);
      activity.push({
        type: 'order_created',
        text: `${o.table_number ? 'Open' : orderTypeLabel(o)} · ${o.order_number}${o.table_number ? ` · Table ${o.table_number}` : ''} · ${String(o.status || '').replace(/_/g, ' ')}${amt ? ` · Rs ${amt.toFixed(0)}` : ''}`,
        at: o.updated_at || o.created_at,
      });
    }
    for (const o of recentOrders || []) {
      if (seenOrderIds.has(o.id)) continue;
      activity.push({
        type: 'order_created',
        text: `Order ${o.order_number} ${o.status === 'completed' ? 'completed' : 'created'} · ${o.table_number ? `Table ${o.table_number}` : orderTypeLabel(o)}`,
        at: o.created_at,
      });
    }
    for (const k of recentKots || []) {
      activity.push({
        type: 'kitchen_ready',
        text: `KOT ${k.kot_number || k.id} sent · ${k.table_number ? `Table ${k.table_number}` : 'Takeaway'}`,
        at: k.printed_at || k.created_at,
      });
    }
    for (const k of completedTickets || []) {
      activity.push({ type: 'kitchen_ready', text: `Kitchen ticket ready for ${k.table_number ? `Table ${k.table_number}` : 'Takeaway'}`, at: k.completed_at });
    }
    for (const r of checkedInReservations || []) {
      activity.push({ type: 'reservation_checked_in', text: `${r.name} checked in`, at: r.checked_in_at });
    }
    for (const m of recentMovements || []) {
      const label =
        m.change_type === 'wastage'
          ? 'Wastage logged'
          : ['manual_restock', 'purchase_receipt', 'opening_balance'].includes(m.change_type)
            ? 'Stock restocked'
            : 'Stock adjusted';
      activity.push({ type: m.change_type, text: `${label}: ${m.item_name || 'item'} (${m.quantity_changed > 0 ? '+' : ''}${m.quantity_changed})`, at: m.created_at });
    }
    activity.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    const activityTrimmed = activity.slice(0, 20).map((a) => ({ ...a, atLabel: formatNepalDateTime(a.at) }));

    const byDate = new Map((dailyBills || []).map((r) => [dateKey(r.d), { revenue: n(r.revenue), orders: n(r.orders) }]));
    const revenueTrend = [];
    const orderVolume = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(`${today}T12:00:00+05:45`);
      d.setDate(d.getDate() - i);
      const dateStr = nepalDateString(d);
      const dayName = d.toLocaleDateString('en-US', { timeZone: 'Asia/Kathmandu', weekday: 'short' });
      const row = byDate.get(dateStr) || { revenue: 0, orders: 0 };
      revenueTrend.push({ day: dayName, date: dateStr, value: row.revenue });
      orderVolume.push({ day: dayName, date: dateStr, value: row.orders });
    }

    let paymentMix = (paymentMixRows || []).map((r) => ({
      method: r.method === 'digital' ? 'online' : r.method,
      total: n(r.total),
      count: n(r.c),
      pct: sales > 0 ? Math.round((n(r.total) / sales) * 100) : 0,
    }));
    if (activeDaySummary) {
      paymentMix = Object.entries(activeDaySummary.collections?.methods || {}).map(([method, total]) => ({
        method, total: n(total), count: 0, pct: sales > 0 ? Math.round((n(total) / sales) * 100) : 0,
      }));
    }

    const hourlySales = Array.from({ length: 24 }, (_, hour) => {
      const row = (hourlyRows || []).find((h) => n(h.hour) === hour);
      return { hour, label: `${String(hour).padStart(2, '0')}:00`, value: n(row?.total), orders: n(row?.c) };
    }).filter((h) => h.hour >= 7 && h.hour <= 22);

    let reservationSnapshot = null;
    if (FEATURES.reservations) {
      try {
        const [upcoming, waiting, cancelled] = await Promise.all([
          db.get(`SELECT COUNT(*) as c FROM reservations WHERE date = ? AND status IN ('new', 'confirmed')`, [today]),
          db.get(`SELECT COUNT(*) as c FROM reservations WHERE date = ? AND status = 'arrived'`, [today]),
          db.get(`SELECT COUNT(*) as c FROM reservations WHERE date = ? AND status = 'cancelled'`, [today]),
        ]);
        reservationSnapshot = { upcoming: n(upcoming?.c), waiting: n(waiting?.c), cancelled: n(cancelled?.c) };
      } catch {
        reservationSnapshot = null;
      }
    }

    let topItems = (topItemsToday || []).map((r) => ({
      name: r.name,
      qty: n(r.qty),
      revenue: n(r.revenue),
    }));
    if (activeDaySummary) {
      topItems = (activeDaySummary.operations?.top_items || []).map((row) => ({ name: row.name, qty: n(row.quantity), revenue: n(row.amount) }));
    }

    return respond({
      stats: {
        today: activeBusinessDay?.business_date || today,
        businessDay: activeBusinessDay ? {
          id: activeBusinessDay.id, businessDate: activeBusinessDay.business_date,
          openedAt: activeBusinessDay.opened_at, openingCash: n(activeBusinessDay.opening_cash),
          expectedCash: n(activeDaySummary?.cash?.expected_cash),
        } : null,
        kpis: {
          sales: { value: sales, prev: prevSales },
          orders: { value: orders, prev: prevOrders },
          profit: { value: profit, prev: prevProfit, note: 'Estimated (60% cost ratio)' },
          avgTicket: { value: avgTicket, paidBills: paidCount },
          occupiedTables: { value: occupiedTables, total: n(totalTablesRow?.c) },
          activeOrders: { value: n(activeOrdersRow?.c) },
          openBills: { value: n(openBillsRow?.c) },
          reopenedBills: { value: n(reopenedBillsRow?.c) },
          creditOutstanding: { value: n(creditOutstandingRow?.total) },
          floorOpen: { value: floorOpen },
          refundsToday: { value: activeDaySummary ? n(activeDaySummary.sales?.refunds) : n(refundsTodayRow?.total), count: activeDaySummary ? 0 : n(refundsTodayRow?.c) },
          discountsToday: { value: activeDaySummary ? n(activeDaySummary.sales?.discounts) : n(discountsTodayRow?.total) },
        },
        needsAttention: needsAttention.slice(0, 10),
        activity: activityTrimmed,
        revenueTrend,
        orderVolume,
        paymentMix,
        hourlySales,
        topItems,
        performance: {
          topItem: topItems[0] ? { name: topItems[0].name, qty: topItems[0].qty } : null,
          bestEmployee: bestEmployeeToday ? { name: bestEmployeeToday.name, orders: n(bestEmployeeToday.c) } : null,
          busiestTable: busiestTableToday ? { table: busiestTableToday.table_number, orders: n(busiestTableToday.c) } : null,
        },
        inventorySnapshot: (lowStockItems || []).map((i) => ({
          name: i.name,
          qty: n(i.quantity),
          unit: i.unit || '',
          status: n(i.quantity) <= 0 ? 'out' : 'low',
        })),
        reservations: reservationSnapshot,
      },
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    return respond({ error: 'Failed to fetch dashboard stats' }, { status: 500 });
  }
}
