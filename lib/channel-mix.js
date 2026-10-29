/**
 * Sales and kitchen tickets split by channel — dine-in, takeaway, delivery.
 *
 * The document numbers now carry the channel (T-001 / TW-001 / D-001 for bills,
 * K-001 / K-TW-001 / K-D-001 for tickets, O-001 / O-TW-001 / O-D-001 for
 * orders — see lib/document-numbers.js). This is the reporting half of that:
 * the same three buckets, totalled, so the prefix on a printed docket can be
 * traced to a line in a report.
 *
 * Channels come from normalizedOrderType() / normalizedOrderTypeSql(), the
 * classifier every other report already groups by, and NOT from parsing the
 * prefix off the number. Parsing would silently drop every bill raised before
 * the prefixes existed; classifying from the order row covers old and new rows
 * alike, which is what keeps historical reports intact.
 */

import { nepalOperationalRangeBounds } from '@/lib/report-dates.js';
import { normalizedOrderTypeSql } from '@/lib/order-types.js';
import { countedBillSql } from '@/lib/report-scope.js';
import { CHANNEL_PREFIX } from '@/lib/document-numbers.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (row, key) => Number(row?.[key] ?? row?.[key.toLowerCase()] ?? 0);

/** Display order: the room first, then the two off-premise channels. */
export const CHANNELS = [
  ['dine_in', 'Dine-in'],
  ['takeaway', 'Takeaway'],
  ['delivery', 'Delivery'],
];

/**
 * A business day is an operator-declared boundary and outranks the clock, the
 * same rule the rest of reporting follows.
 */
function scope(db, range, businessDayId, alias, column) {
  if (businessDayId) return { sql: `${alias}.business_day_id = ?`, params: [businessDayId] };
  const { start, endExclusive } = nepalOperationalRangeBounds(db.driver, range.start, range.end);
  return { sql: `${alias}.${column} >= ? AND ${alias}.${column} < ?`, params: [start, endExclusive] };
}

export async function channelMix(db, range, businessDayId = null) {
  const billScope = scope(db, range, businessDayId, 'b', 'created_at');
  const kotScope = scope(db, range, businessDayId, 'k', 'printed_at');

  /*
   * A KOT carries its own table_id / table_number / order_type snapshot, which
   * is what makes a ticket classifiable after its order was edited. But older
   * tickets were written without that snapshot, and a NULL table reads as
   * "takeaway" — which dumped every historical dine-in ticket into the wrong
   * row. Fall back to the order's own values before classifying.
   */
  const kotChannelSql = `CASE
    WHEN LOWER(COALESCE(k.order_type, o.order_type, '')) = 'delivery' THEN 'delivery'
    WHEN COALESCE(k.table_id, o.table_id) IS NULL
     AND NULLIF(TRIM(COALESCE(k.table_number, o.table_number, '')), '') IS NULL THEN 'takeaway'
    ELSE 'dine_in'
  END`;

  const [billRows, kotRows] = await Promise.all([
    db.all(
      `SELECT ${normalizedOrderTypeSql('o')} AS channel,
              COUNT(DISTINCT b.id) AS bills,
              COALESCE(SUM(b.subtotal), 0) AS item_sales,
              COALESCE(SUM(b.discount_amount), 0) AS discounts,
              COALESCE(SUM(b.grand_total), 0) AS billed_total
       FROM bills b
       JOIN orders o ON o.id = b.order_id
       WHERE ${countedBillSql('b')} AND ${billScope.sql}
       GROUP BY ${normalizedOrderTypeSql('o')}`,
      billScope.params
    ).catch(() => []),
    db.all(
      `SELECT ${kotChannelSql} AS channel,
              COUNT(*) AS kots,
              SUM(CASE WHEN LOWER(COALESCE(k.status, '')) = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
       FROM kots k
       LEFT JOIN orders o ON o.id = k.order_id
       WHERE ${kotScope.sql}
       GROUP BY ${kotChannelSql}`,
      kotScope.params
    ).catch(() => []),
  ]);

  const billByChannel = new Map((billRows || []).map((r) => [String(r.channel ?? r.CHANNEL), r]));
  const kotByChannel = new Map((kotRows || []).map((r) => [String(r.channel ?? r.CHANNEL), r]));

  const rows = CHANNELS.map(([channel, label]) => {
    const bill = billByChannel.get(channel);
    const kot = kotByChannel.get(channel);
    const itemSales = round2(num(bill, 'item_sales'));
    const discounts = round2(num(bill, 'discounts'));
    return {
      channel,
      label,
      billPrefix: CHANNEL_PREFIX.bill[channel],
      kotPrefix: CHANNEL_PREFIX.kot[channel],
      orderPrefix: CHANNEL_PREFIX.order[channel],
      bills: num(bill, 'bills'),
      itemSales,
      discounts,
      netItemSales: round2(itemSales - discounts),
      billedTotal: round2(num(bill, 'billed_total')),
      kots: num(kot, 'kots'),
      cancelledKots: num(kot, 'cancelled'),
    };
  });

  const sum = (key) => round2(rows.reduce((s, r) => s + Number(r[key] || 0), 0));
  const totals = {
    bills: sum('bills'), itemSales: sum('itemSales'), discounts: sum('discounts'),
    netItemSales: sum('netItemSales'), billedTotal: sum('billedTotal'),
    kots: sum('kots'), cancelledKots: sum('cancelledKots'),
  };
  // Share of billed value, so a reader can see the mix without doing the sums.
  for (const row of rows) {
    row.share = totals.billedTotal ? round2((row.billedTotal / totals.billedTotal) * 100) : 0;
  }
  return { rows, totals };
}
