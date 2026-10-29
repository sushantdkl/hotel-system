/**
 * Kitchen analytics + chef performance, derived from the order timing columns
 * (prep_started_at, ready_at, prepared_by) captured on the existing status
 * flow. No new order logic — read-only aggregation over today's orders.
 */

import { currentBusinessDay } from '@/lib/business-days.js';
import { columnExists } from '@/lib/db/schema-helpers.js';
import { parseDbDate } from '@/lib/time-utils.js';

/**
 * Hour-of-day in Asia/Kathmandu. `new Date('2026-08-24 19:30:00').getHours()`
 * reads a UTC-stored timestamp as server-local time, so on a UTC host the
 * busiest-hour histogram was shifted by 5h45m and on any other host it moved
 * with the deployment. parseDbDate applies the UTC rule; Intl applies Nepal.
 */
const nepalHourFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kathmandu',
  hour: '2-digit',
  hour12: false,
});
function nepalHour(value) {
  const d = parseDbDate(value);
  if (!d) return null;
  const hour = Number(nepalHourFormat.format(d));
  return Number.isFinite(hour) ? hour % 24 : null;
}

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
const minutes = (a, b) => {
  // parseDbDate, not `new Date`: bare SQLite timestamps are UTC, but an ISO
  // string with a Z is already absolute. Mixing the two parses skewed any
  // interval that spanned both formats by the server's UTC offset.
  const t1 = a ? (parseDbDate(a)?.getTime() ?? NaN) : NaN;
  const t2 = b ? (parseDbDate(b)?.getTime() ?? NaN) : NaN;
  if (!Number.isFinite(t1) || !Number.isFinite(t2) || t2 < t1) return null;
  return (t2 - t1) / 60000;
};

export async function kitchenAnalytics(db) {
  const activeBusinessDay = await currentBusinessDay(db);
  if (!activeBusinessDay) {
    return {
      orders_today: 0,
      ready_today: 0,
      active_now: 0,
      dishes_prepared_today: 0,
      avg_prep_minutes: 0,
      busiest_hour: null,
      by_hour: new Array(24).fill(0).map((count, hour) => ({ hour, count })),
      chefs: [],
      business_day_id: null,
    };
  }
  // Some production databases were created before migration 022. Analytics is
  // read-only and should still load (with unavailable prep metrics as zero),
  // instead of failing the entire page on a missing optional timing column.
  const [hasPrepStartedAt, hasReadyAt, hasPreparedBy] = await Promise.all([
    columnExists(db, 'orders', 'prep_started_at'),
    columnExists(db, 'orders', 'ready_at'),
    columnExists(db, 'orders', 'prepared_by'),
  ]);
  const rows = await db.all(
    `SELECT o.id, o.status, o.created_at,
            ${hasPrepStartedAt ? 'o.prep_started_at' : 'NULL'} AS prep_started_at,
            ${hasReadyAt ? 'o.ready_at' : 'NULL'} AS ready_at,
            ${hasPreparedBy ? 'o.prepared_by' : 'NULL'} AS prepared_by,
            u.full_name AS chef
     FROM orders o LEFT JOIN users u ON ${hasPreparedBy ? 'o.prepared_by = u.id' : '1 = 0'}
     WHERE o.business_day_id = ? AND COALESCE(o.status, '') <> 'cancelled'
     ORDER BY o.created_at`,
    [activeBusinessDay.id]
  );

  const itemRows = await db.all(
    `SELECT oi.order_id, SUM(oi.quantity) AS qty
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.business_day_id = ? AND COALESCE(o.status, '') <> 'cancelled'
       AND COALESCE(oi.status, '') NOT IN ('voided', 'cancelled')
     GROUP BY oi.order_id`,
    [activeBusinessDay.id]
  );
  const qtyByOrder = new Map(itemRows.map((r) => [r.order_id, Number(r.qty) || 0]));

  const prepTimes = [];
  const byHour = new Array(24).fill(0);
  const chefs = new Map();
  let readyCount = 0;
  let activeCount = 0;
  let dishesPrepared = 0;

  for (const o of rows) {
    const isReady = !!o.ready_at || ['ready', 'served', 'completed'].includes(String(o.status));
    const dishQty = qtyByOrder.get(o.id) || 0;
    if (isReady) {
      readyCount += 1;
      dishesPrepared += dishQty;
    }
    if (['pending', 'preparing'].includes(String(o.status))) activeCount += 1;

    const createdHour = nepalHour(o.created_at);
    if (createdHour != null) byHour[createdHour] += 1;

    const prep = minutes(o.prep_started_at || o.created_at, o.ready_at);
    if (prep != null) prepTimes.push(prep);

    if (o.prepared_by) {
      if (!chefs.has(o.prepared_by)) chefs.set(o.prepared_by, { name: o.chef || 'Unknown', prepared: 0, dishes: 0, times: [] });
      const c = chefs.get(o.prepared_by);
      c.prepared += 1;
      c.dishes += dishQty;
      if (prep != null) c.times.push(prep);
    }
  }

  const avg = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0);
  const busiestHour = byHour.reduce((best, n, h) => (n > byHour[best] ? h : best), 0);

  return {
    orders_today: rows.length,
    ready_today: readyCount,
    active_now: activeCount,
    dishes_prepared_today: dishesPrepared,
    avg_prep_minutes: round1(avg(prepTimes)),
    busiest_hour: byHour.some((n) => n > 0) ? busiestHour : null,
    by_hour: byHour.map((count, hour) => ({ hour, count })),
    chefs: Array.from(chefs.values())
      .map((c) => ({ name: c.name, prepared: c.prepared, dishes: c.dishes, avg_prep_minutes: round1(avg(c.times)) }))
      .sort((a, b) => b.prepared - a.prepared),
    business_day_id: activeBusinessDay.id,
  };
}
