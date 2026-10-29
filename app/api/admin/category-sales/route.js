import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { nepalOperationalRangeBounds, resolvePeriodRange } from '@/lib/report-dates.js';
import { currentBusinessDay } from '@/lib/business-days.js';
import { dateKey, ensureReportSchema } from '@/lib/reports.js';
import { categorySales, categoryStockCheck } from '@/lib/category-sales.js';

/** GET /api/admin/category-sales?categories=1,2&period=today — sales summary + stock check for chosen categories. */
export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'report.categories.view' });
    if (auth.error) return auth.error;
    const q = new URL(request.url).searchParams;
    const db = Database.getInstance();
    await ensureReportSchema(db);

    const categories = await db.all('SELECT id, name FROM menu_categories ORDER BY name');
    const categoryIds = String(q.get('categories') || '').split(',').map(Number).filter((id) => Number.isInteger(id) && id > 0);

    const range = resolvePeriodRange(q.get('period') || 'today', q.get('startDate'), q.get('endDate'), { calendarSystem: q.get('calendarSystem') });
    const filters = { businessDayId: Number(q.get('businessDayId')) || null };
    // Same rule as Reports: "today" is the open business day, not the calendar date.
    if (!filters.businessDayId && range.period === 'today') filters.businessDayId = (await currentBusinessDay(db))?.id || null;

    let bounds = nepalOperationalRangeBounds(db.driver, range.start, range.end);
    bounds = { start: bounds.start, end: bounds.endExclusive };
    if (filters.businessDayId) {
      const day = await db.get('SELECT id, business_date, status, opened_at, closed_at FROM business_days WHERE id = ?', [filters.businessDayId]);
      if (!day) return NextResponse.json({ error: 'Business day not found.' }, { status: 404 });
      range.start = dateKey(day.business_date);
      range.end = range.start;
      range.label = `Business Day · ${range.start}${day.status === 'open' ? ' · Open' : ''}`;
      // ponytail: an open day runs to "the far future" so everything recorded so far counts.
      bounds = { start: day.opened_at, end: day.closed_at || '9999-12-31 00:00:00' };
    }

    if (!categoryIds.length) return NextResponse.json({ categories, range, sales: null, stock: null });
    const [sales, stock] = await Promise.all([
      categorySales(db, range, filters, categoryIds),
      categoryStockCheck(db, bounds, categoryIds),
    ]);
    return NextResponse.json({ categories, range, sales, stock });
  } catch (error) {
    return handleRouteError(error, 'Could not build the category sales report.');
  }
}
