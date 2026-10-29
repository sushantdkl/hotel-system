import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { readListParams, resolveOrderBy, buildSearch, paginateQuery } from '@/lib/paginate.js';
import { ensureOrderColumns } from '@/lib/online-orders.js';
import { ensureColumn } from '@/lib/db/schema-helpers.js';
import { ensurePromotionSchema } from '@/lib/promotions.js';
import { ensureBillCorrectionsSchema } from '@/lib/bill-corrections.js';

const ORDER_COLUMNS = `
  o.*,
  COALESCE(
    b.grand_total,
    (SELECT COALESCE(SUM(oi.subtotal), 0) FROM order_items oi
     WHERE oi.order_id = o.id AND COALESCE(oi.status,'') NOT IN ('voided','cancelled')) - COALESCE(o.discount_amount, 0) + COALESCE(o.delivery_fee, 0)
  ) as total,
  b.subtotal,
  b.tax,
  b.discount_amount,
  b.service_charge,
  COALESCE(b.delivery_fee, o.delivery_fee, 0) AS delivery_fee,
  b.bill_number,
  b.id as bill_id,
  b.status as bill_status,
  b.paid_at,
  COALESCE(b.payment_status, 'unpaid') as payment_status,
  COALESCE(bc.refund_amount, b.refunded_amount, 0) AS refunded_amount,
  COALESCE(bc.void_amount, 0) AS voided_amount,
  CASE
    WHEN LOWER(COALESCE(b.status, '')) IN ('void', 'voided', 'cancelled', 'canceled') OR COALESCE(bc.void_amount, 0) > 0 THEN 'voided'
    WHEN COALESCE(bc.refund_amount, b.refunded_amount, 0) >= COALESCE(b.grand_total, 0) AND COALESCE(b.grand_total, 0) > 0 THEN 'refunded'
    WHEN COALESCE(bc.refund_amount, b.refunded_amount, 0) > 0 THEN 'partially_refunded'
    ELSE o.status
  END AS financial_status,
  CASE
    WHEN LOWER(COALESCE(b.status, '')) IN ('void', 'voided', 'cancelled', 'canceled') OR COALESCE(bc.void_amount, 0) > 0 THEN 'voided'
    WHEN COALESCE(bc.refund_amount, b.refunded_amount, 0) >= COALESCE(b.grand_total, 0) AND COALESCE(b.grand_total, 0) > 0 THEN 'refunded'
    WHEN COALESCE(bc.refund_amount, b.refunded_amount, 0) > 0 THEN 'partially_refunded'
    ELSE COALESCE(b.payment_status, 'unpaid')
  END AS financial_payment_status,
  COALESCE(b.outstanding_amount, 0) as outstanding_amount,
  COALESCE(b.grand_total, 0) - COALESCE(b.outstanding_amount, 0) as amount_paid,
  (SELECT COUNT(oi.id) FROM order_items oi
   WHERE oi.order_id = o.id AND COALESCE(oi.status,'') NOT IN ('voided','cancelled')) as item_count
`;

const ORDER_FROM = `orders o LEFT JOIN bills b ON b.order_id = o.id AND b.id = (
  SELECT MAX(b2.id) FROM bills b2 WHERE b2.order_id = o.id
)
LEFT JOIN (
  SELECT bill_id,
         COALESCE(SUM(CASE WHEN type='refund' THEN amount WHEN type='refund_reversal' THEN -amount ELSE 0 END),0) AS refund_amount,
         COALESCE(SUM(CASE WHEN type='void' THEN amount ELSE 0 END),0) AS void_amount
  FROM bill_corrections GROUP BY bill_id
) bc ON bc.bill_id=b.id`;

const FINANCIAL_STATUS = `CASE
  WHEN LOWER(COALESCE(b.status, '')) IN ('void', 'voided', 'cancelled', 'canceled') OR COALESCE(bc.void_amount, 0) > 0 THEN 'voided'
  WHEN COALESCE(bc.refund_amount, b.refunded_amount, 0) >= COALESCE(b.grand_total, 0) AND COALESCE(b.grand_total, 0) > 0 THEN 'refunded'
  WHEN COALESCE(bc.refund_amount, b.refunded_amount, 0) > 0 THEN 'partially_refunded'
  ELSE o.status END`;

/** Sortable columns, by design an allowlist — the key arrives in the URL. */
const ORDER_SORTS = {
  created_at: 'o.created_at',
  order_number: 'o.order_number',
  status: 'o.status',
  financial_status: FINANCIAL_STATUS,
  order_type: 'o.order_type',
  table_number: 'o.table_number',
  customer_name: 'o.customer_name',
  total: 'b.grand_total',
};

const ORDER_SEARCH_COLUMNS = ['o.order_number', 'o.table_number', 'o.customer_name', 'o.customer_phone', 'b.bill_number'];

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'order_desk.access' });
    if (auth.error) return auth.error;

    const db = Database.getInstance();
    await ensureOrderColumns(db);
    await ensurePromotionSchema(db);
    await ensureBillCorrectionsSchema(db);
    await ensureColumn(db, 'bills', 'payment_status', "TEXT DEFAULT 'unpaid'").catch(() => {});
    await ensureColumn(db, 'bills', 'outstanding_amount', 'REAL DEFAULT 0').catch(() => {});

    const { searchParams } = new URL(request.url);
    const { page, pageSize, exportAll, sort, dir, search } = readListParams(searchParams);

    const conditions = ['1=1'];
    const params = [];

    const status = searchParams.get('status');
    if (status && status !== 'all') {
      conditions.push(`${FINANCIAL_STATUS} = ?`);
      params.push(status);
    }
    const orderType = searchParams.get('order_type');
    if (orderType && orderType !== 'all') {
      conditions.push('o.order_type = ?');
      params.push(orderType);
    }
    const from = searchParams.get('from');
    if (from) {
      conditions.push("date(o.created_at, '+5 hours', '+45 minutes') >= date(?)");
      params.push(from);
    }
    const to = searchParams.get('to');
    if (to) {
      conditions.push("date(o.created_at, '+5 hours', '+45 minutes') <= date(?)");
      params.push(to);
    }

    const searchClause = buildSearch(search, ORDER_SEARCH_COLUMNS);
    if (searchClause.clause) {
      conditions.push(searchClause.clause);
      params.push(...searchClause.params);
    }

    const where = conditions.join(' AND ');

    const { rows, pagination } = await paginateQuery(db, {
      columns: ORDER_COLUMNS,
      from: ORDER_FROM,
      where,
      params,
      orderBy: resolveOrderBy(sort, dir, ORDER_SORTS, 'created_at', 'o.id'),
      page,
      pageSize,
      exportAll,
    });

    const summary = await db.get(
      `SELECT COUNT(*) AS orders,
              COALESCE(SUM(CASE WHEN LOWER(COALESCE(b.status,'')) NOT IN ('void','voided','cancelled','canceled') THEN b.grand_total ELSE 0 END), 0) AS gross_revenue,
              COALESCE(SUM(CASE WHEN LOWER(COALESCE(b.status,'')) NOT IN ('void','voided','cancelled','canceled') THEN COALESCE(bc.refund_amount,b.refunded_amount,0) ELSE 0 END), 0) AS refunds,
              COALESCE(SUM(CASE WHEN LOWER(COALESCE(b.status,'')) IN ('void','voided','cancelled','canceled') THEN COALESCE(NULLIF(bc.void_amount,0),b.grand_total,0) ELSE COALESCE(bc.void_amount,0) END), 0) AS voids,
              COALESCE(AVG(CASE WHEN LOWER(COALESCE(b.status,'')) NOT IN ('void','voided','cancelled','canceled') THEN b.grand_total-COALESCE(bc.refund_amount,b.refunded_amount,0) END), 0) AS average,
              SUM(CASE WHEN o.status = 'completed' THEN 1 ELSE 0 END) AS completed
       FROM ${ORDER_FROM} WHERE ${where}`,
      params
    );

    return NextResponse.json({
      orders: rows,
      pagination,
      summary: {
        orders: Number(summary?.orders || 0),
        grossRevenue: Number(summary?.gross_revenue || 0),
        refunds: Number(summary?.refunds || 0),
        voids: Number(summary?.voids || 0),
        revenue: Number(summary?.gross_revenue || 0) - Number(summary?.refunds || 0),
        average: Number(summary?.average || 0),
        completed: Number(summary?.completed || 0),
      },
    });
  } catch (error) {
    return handleRouteError(error, 'Failed to fetch orders');
  }
}

export async function PUT(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'orders.update' });
    if (auth.error) return auth.error;

    const data = await request.json();
    const db = Database.getInstance();

    await db.run(`
      UPDATE orders 
      SET status = ?
      WHERE id = ?
    `, [data.status, data.id]);

    return NextResponse.json({
      message: 'Order status updated successfully',
    });
  } catch (error) {
    return handleRouteError(error, 'Failed to update order');
  }
}
