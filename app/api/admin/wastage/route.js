import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureRecipeTables, listWastage, logWastage } from '@/lib/recipes.js';
import { readListParams } from '@/lib/paginate.js';

/**
 * KPIs and charts for the whole log, aggregated in SQL.
 *
 * Every group here is bounded by something small — one row per day, per item,
 * per reason, per employee — never by the number of wastage entries, so this
 * stays cheap however long the log gets. The page then buckets the daily series
 * into today / 7 / 30 days and months, which avoids writing dialect-specific
 * date arithmetic for each window.
 */
async function buildSummary(db) {
  const [daily, byItem, byReason, byEmployee, unlinked] = await Promise.all([
    db.all(
      `SELECT date(w.created_at, '+5 hours', '+45 minutes') AS day, COALESCE(SUM(w.total_cost), 0) AS total, COALESCE(SUM(w.quantity), 0) AS quantity, COUNT(*) AS entries
       FROM wastage_log w WHERE LOWER(COALESCE(w.status,'active'))<>'voided'
       GROUP BY date(w.created_at, '+5 hours', '+45 minutes') ORDER BY day`
    ),
    db.all(
      `SELECT COALESCE(im.item_name, r.name, mi.name, 'Unknown item') AS label,
              COALESCE(SUM(w.total_cost), 0) AS total, COALESCE(SUM(w.quantity), 0) AS quantity, COUNT(*) AS entries
       FROM wastage_log w
       LEFT JOIN inventory_items im ON w.raw_material_id = im.id
       LEFT JOIN recipes r ON w.recipe_id = r.id
       LEFT JOIN menu_items mi ON w.menu_item_id = mi.id
       WHERE LOWER(COALESCE(w.status,'active'))<>'voided'
       GROUP BY COALESCE(im.item_name, r.name, mi.name, 'Unknown item') ORDER BY quantity DESC, total DESC`
    ),
    db.all(
      `SELECT w.reason AS label, COALESCE(SUM(w.total_cost), 0) AS total, COALESCE(SUM(w.quantity), 0) AS quantity, COUNT(*) AS entries
       FROM wastage_log w WHERE LOWER(COALESCE(w.status,'active'))<>'voided' GROUP BY w.reason ORDER BY entries DESC, total DESC`
    ),
    db.all(
      `SELECT e.full_name AS label, COALESCE(SUM(w.total_cost), 0) AS total, COALESCE(SUM(w.quantity), 0) AS quantity, COUNT(*) AS entries
       FROM wastage_log w JOIN users e ON w.employee_id = e.id
       WHERE LOWER(COALESCE(w.status,'active'))<>'voided'
       GROUP BY e.full_name ORDER BY entries DESC, total DESC`
    ),
    // Entries that cost something but never booked an expense — the thing the
    // page's attention bar is warning about.
    db.get(
      `SELECT COUNT(*) AS n FROM wastage_log w
       LEFT JOIN expenses x ON x.source_type = 'wastage' AND x.source_id = w.id
       WHERE LOWER(COALESCE(w.status,'active'))<>'voided' AND COALESCE(w.total_cost, 0) > 0 AND x.id IS NULL`
    ),
  ]);

  const group = (rows) =>
    (rows || []).map((r) => ({ label: r.label, total: Number(r.total || 0), quantity: Number(r.quantity || 0), entries: Number(r.entries || 0) }));

  const series = (daily || []).map((r) => ({
    date: String(r.day || '').slice(0, 10),
    total: Number(r.total || 0),
    quantity: Number(r.quantity || 0),
    entries: Number(r.entries || 0),
  }));

  // Rolling windows are bucketed here rather than in the page: reading the clock
  // during render is impure, and the server is the honest place to own "today".
  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const windowFor = (days) => {
    const cutoff = now - days * DAY_MS;
    const bucket = series.filter((d) => new Date(`${d.date}T00:00:00`).getTime() >= cutoff);
    return {
      cost: bucket.reduce((s, d) => s + d.total, 0),
      quantity: bucket.reduce((s, d) => s + d.quantity, 0),
      entries: bucket.reduce((s, d) => s + d.entries, 0),
    };
  };

  return {
    daily: series,
    windows: { today: windowFor(1), week: windowFor(7), month: windowFor(30) },
    byItem: group(byItem),
    byReason: group(byReason),
    byEmployee: group(byEmployee),
    unlinked: Number(unlinked?.n || 0),
  };
}

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'kitchen', 'waiter', 'cashier'], permission: 'wastage.manage' });
    if (auth.error) return auth.error;

    const db = Database.getInstance();
    await ensureRecipeTables(db);

    const { searchParams } = new URL(request.url);
    const { rows, pagination } = await listWastage(db, {
      ...readListParams(searchParams),
      reason: searchParams.get('reason'),
      from: searchParams.get('from'),
      to: searchParams.get('to'),
    });

    return NextResponse.json({ entries: rows, pagination, summary: await buildSummary(db) });
  } catch (error) {
    return handleRouteError(error, 'Failed to load wastage log');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'kitchen', 'waiter', 'cashier'], permission: 'wastage.manage' });
    if (auth.error) return auth.error;

    const data = await request.json();
    const db = Database.getInstance();
    await ensureRecipeTables(db);

    // employee/shift/photo_url are optional context; photo_url comes from
    // POST /api/uploads/receipts, the same uploader expenses already use.
    const result = await logWastage(db, {
      ...data,
      logged_by: auth.user?.id || data.logged_by || null,
      employee_id: data.employee_id || null,
      shift: data.shift || null,
      photo_url: data.photo_url || null,
    });

    return NextResponse.json({ message: 'Wastage logged successfully', ...result }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to log wastage');
  }
}
