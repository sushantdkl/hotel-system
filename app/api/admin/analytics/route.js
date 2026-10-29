import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { resolvePeriodRange } from '@/lib/report-dates.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureColumn } from '@/lib/db/schema-helpers.js';
import { DEFAULT_FOOD_GROUP } from '@/lib/food-groups.js';
import { composeAnalytics, transactionReport } from '@/lib/analytics.js';
import { currentBusinessDay, businessDaySummary } from '@/lib/business-days.js';

/**
 * GET /api/admin/analytics
 * Restaurant Analytics dashboard data. Server-derived, void-excluded,
 * reconciles with the ledger. Read-only.
 *
 * Query: period=today|yesterday|last3|last7|last30|this_week|this_month|
 *        last_month|custom, startDate, endDate.
 */
export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'analytics.view' });
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const range = resolvePeriodRange(
      searchParams.get('period') || 'today',
      searchParams.get('startDate'),
      searchParams.get('endDate'),
      { calendarSystem: searchParams.get('calendarSystem') }
    );

    /*
     * No dimension filters here on purpose. This route used to parse
     * categoryId / paymentMethod / orderType and hand them to composeAnalytics,
     * which ignores them (`_filters`) — so a caller passing one silently got
     * unfiltered numbers. The Analytics page filters by period only; use
     * /api/admin/reports for the filterable surface.
     */

    const db = Database.getInstance();
    const activeDay = range.period === 'today' ? await currentBusinessDay(db) : null;
    const matchingDay = range.start === range.end
      ? await db.get(`SELECT * FROM business_days WHERE business_date = ? LIMIT 1`, [range.start]).catch(() => null)
      : null;
    const scopedDay = activeDay || matchingDay;
    const businessDayId = scopedDay?.id || null;
    const activeDaySummary = scopedDay ? await businessDaySummary(db, scopedDay) : null;
    if (scopedDay) {
      range.label = `${scopedDay.status === 'open' ? 'Current ' : ''}Business Day · ${scopedDay.business_date}`;
      range.businessDayId = scopedDay.id;
    }
    await ensureColumn(db, 'menu_categories', 'food_group', `TEXT DEFAULT '${DEFAULT_FOOD_GROUP}'`);
    if (searchParams.get('export') === 'transactions') {
      const transactions = await transactionReport(db, range, { exportAll: true, businessDayId });
      return NextResponse.json({ range, businessDay: scopedDay, transactions });
    }
    const data = await composeAnalytics(db, range, {}, {
      transactions: {
        page: Number(searchParams.get('transactionPage')) || 1,
        pageSize: Number(searchParams.get('transactionPageSize')) || 25,
      },
      businessDayId,
    });
    return NextResponse.json({ ...data, businessDay: scopedDay, businessDayMetrics: activeDaySummary ? {
      openingCash: activeDaySummary.store_session?.opening_cash ?? scopedDay.opening_cash,
      expectedCash: activeDaySummary.cash.expected_cash,
      sales: activeDaySummary.sales.billed_total,
      collections: activeDaySummary.collections.total_collected,
      sessionNumber: activeDaySummary.store_session?.session_number || null,
    } : null });
  } catch (error) {
    return handleRouteError(error, 'Failed to build analytics.');
  }
}
