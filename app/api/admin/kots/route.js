import { NextResponse } from 'next/server';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import Database from '@/lib/db/index.js';
import { ensureKotProSchema } from '@/lib/kot-service.js';

// An original ticket auto-voids once every item on it is cancelled — but a
// dedicated "cancellation notice" ticket already tells that story to the
// kitchen. Showing both is a redundant duplicate, so the auto-voided original
// is hidden whenever a notice exists that amends it.
const HIDE_SUPERSEDED_ORIGINAL = `NOT (
  COALESCE(k.voided, 0) = 1
  AND k.void_reason = 'All items on this ticket were cancelled.'
  AND EXISTS (SELECT 1 FROM kots ck WHERE ck.amends_kot_id = k.id AND COALESCE(ck.kot_type, '') = 'cancellation')
)`;

function kotTabFilter(tab) {
  const cancelled = `(
    COALESCE(k.voided, 0) = 1
    OR COALESCE(k.status, '') = 'cancelled'
    OR COALESCE(k.kot_type, '') = 'cancellation'
    OR COALESCE(o.status, '') = 'cancelled'
  )`;
  const normal = `NOT ${cancelled}`;
  if (tab === 'completed') return `${normal} AND COALESCE(k.status, '') IN ('completed', 'ready')`;
  if (tab === 'cancelled') return cancelled;
  if (tab === 'all') return '1=1';
  return `${normal}
    AND COALESCE(k.status, 'pending') IN ('pending', 'preparing')
    AND COALESCE(o.status, '') NOT IN ('completed', 'cancelled')`;
}

/**
 * Admin KOT list — active, completed, cancelled, all.
 * Query: ?tab=active|completed|cancelled|all&page=1&pageSize=50&search=
 */
export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'waiter', 'cashier', 'kitchen'], permission: 'kot_history.access' });
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const tab = searchParams.get('tab') || 'active';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '50', 10)));
    const search = (searchParams.get('search') || '').trim();
    const offset = (page - 1) * pageSize;

    const db = Database.getInstance();
    await ensureKotProSchema(db);

    const where = [];
    const params = [];
    const dateWhere = [];
    const dateParams = [];
    const kotDate = db.driver === 'postgres'
      ? `COALESCE(k.cancelled_at, k.voided_at, k.printed_at)::date`
      : `date(COALESCE(k.cancelled_at, k.voided_at, k.printed_at), '+5 hours', '+45 minutes')`;
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    if (from) { dateWhere.push(`${kotDate} >= date(?)`); dateParams.push(from); }
    if (to) { dateWhere.push(`${kotDate} <= date(?)`); dateParams.push(to); }

    const effectiveTab = ['active', 'completed', 'cancelled', 'all'].includes(tab) ? tab : 'active';
    where.push(kotTabFilter(effectiveTab));
    where.push(HIDE_SUPERSEDED_ORIGINAL);
    where.push(...dateWhere);
    params.push(...dateParams);

    if (search) {
      where.push(`(
        COALESCE(k.kot_number, '') LIKE ? OR
        COALESCE(o.order_number, '') LIKE ? OR
        COALESCE(k.table_number, t.table_number, '') LIKE ? OR
        COALESCE(k.issued_by_name, '') LIKE ?
      )`);
      const q = `%${search}%`;
      params.push(q, q, q, q);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const counts = {};
    for (const key of ['active', 'completed', 'cancelled', 'all']) {
      const countWhere = [kotTabFilter(key), HIDE_SUPERSEDED_ORIGINAL, ...dateWhere];
      const countParams = [...dateParams];
      if (search) {
        countWhere.push(`(
          COALESCE(k.kot_number, '') LIKE ? OR
          COALESCE(o.order_number, '') LIKE ? OR
          COALESCE(k.table_number, t.table_number, '') LIKE ? OR
          COALESCE(k.issued_by_name, '') LIKE ?
        )`);
        const q = `%${search}%`;
        countParams.push(q, q, q, q);
      }
      const row = await db.get(
        `SELECT COUNT(*) AS c
         FROM kots k
         LEFT JOIN orders o ON k.order_id = o.id
         LEFT JOIN tables t ON COALESCE(k.table_id, o.table_id) = t.id
         WHERE ${countWhere.join(' AND ')}`,
        countParams
      );
      counts[key] = Number(row?.c || 0);
    }

    const countRow = await db.get(
      `SELECT COUNT(*) AS c
       FROM kots k
       LEFT JOIN orders o ON k.order_id = o.id
       LEFT JOIN tables t ON COALESCE(k.table_id, o.table_id) = t.id
       ${whereSql}`,
      params
    );

    const rows = await db.all(
      `SELECT
         k.*,
         k.id AS kot_id,
         COALESCE(k.kot_number, 'KOT-' || k.id) AS kot_number,
         CASE WHEN COALESCE(o.status, '') = 'cancelled' THEN 'cancelled' ELSE k.status END AS status,
         COALESCE(k.cancel_reason, k.void_reason, CASE WHEN COALESCE(o.status, '') = 'cancelled' THEN 'Order cancelled' END) AS cancel_reason,
         COALESCE(k.cancelled_at, k.voided_at) AS cancelled_at,
         o.order_number,
         (SELECT b.id FROM bills b WHERE b.order_id = o.id ORDER BY b.id DESC LIMIT 1) AS bill_id,
         o.status AS order_status,
         o.party_label,
         COALESCE(k.table_number, t.table_number, o.table_number) AS table_number,
         COALESCE(k.table_id, o.table_id) AS table_id,
         (
           SELECT COUNT(*) FROM kot_items ki WHERE ki.kot_id = k.id
         ) AS item_count,
         (
           SELECT COALESCE(SUM(ki.quantity), 0) FROM kot_items ki WHERE ki.kot_id = k.id
         ) AS total_qty
       FROM kots k
       LEFT JOIN orders o ON k.order_id = o.id
       LEFT JOIN tables t ON COALESCE(k.table_id, o.table_id) = t.id
       ${whereSql}
       ORDER BY k.printed_at DESC, k.id DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    // Attach items for the current page.
    const kotIds = rows.map((r) => r.kot_id || r.id);
    let itemsByKot = {};
    if (kotIds.length) {
      const ph = kotIds.map(() => '?').join(',');
      const items = await db.all(
        `SELECT * FROM kot_items WHERE kot_id IN (${ph}) ORDER BY id`,
        kotIds
      ).catch(() => []);
      for (const it of items) {
        if (!itemsByKot[it.kot_id]) itemsByKot[it.kot_id] = [];
        itemsByKot[it.kot_id].push(it);
      }
    }

    const kots = rows.map((r) => ({
      ...r,
      items: itemsByKot[r.kot_id || r.id] || [],
    }));

    return NextResponse.json({
      success: true,
      kots,
      pagination: {
        page,
        pageSize,
        total: Number(countRow?.c || 0),
        totalPages: Math.max(1, Math.ceil(Number(countRow?.c || 0) / pageSize)),
      },
      counts,
    });
  } catch (error) {
    return handleRouteError(error, 'Could not load KOTs.');
  }
}
