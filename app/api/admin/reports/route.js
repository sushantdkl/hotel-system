import { cashClosingPolicy } from '@/lib/cash-closing-policy.js';
import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { resolvePeriodRange } from '@/lib/report-dates.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import {
  allowedReportTabs, buildReport, ensureReportSchema, getFilterOptions,
  dateKey, FILTER_UNAVAILABLE_REASON, REPORT_TABS, supportedFilters, parseReportTablePaging,
} from '@/lib/reports.js';
import { currentBusinessDay } from '@/lib/business-days.js';
import { isPermissionAllowedSync } from '@/lib/permissions.js';
import { permissionRole } from '@/lib/roles.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'reports.view' });
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const requested = (searchParams.get('tab') || 'overview').toLowerCase();
    // Enforced server-side, not by hiding tabs in the UI: /cashier/reports
    // re-exports the admin page, so a cashier can craft any tab= they like.
    const allowedTabs = allowedReportTabs(auth.user?.role, (key) => isPermissionAllowedSync(permissionRole(auth.user), key));
    if (!allowedTabs.length) {
      return NextResponse.json({ error: 'No individual reports have been enabled for this role.' }, { status: 403 });
    }
    if (!allowedTabs.includes(requested) && REPORT_TABS.includes(requested)) {
      return NextResponse.json(
        { error: 'This report has not been enabled for your role.' },
        { status: 403 }
      );
    }
    const tab = allowedTabs.includes(requested) ? requested : allowedTabs[0];

    const range = resolvePeriodRange(
      // Default matches the page's own default: today, not a trailing week.
      searchParams.get('period') || 'today',
      searchParams.get('startDate'),
      searchParams.get('endDate'),
      { calendarSystem: searchParams.get('calendarSystem') }
    );

    const tablePaging = parseReportTablePaging(searchParams);
    const filters = {
      calendarSystem: searchParams.get('calendarSystem') === 'BS' ? 'BS' : 'AD',
      businessDayId: Number(searchParams.get('businessDayId')) || null,
      employeeId: Number(searchParams.get('employeeId')) || null,
      paymentMethod: searchParams.get('paymentMethod') || null,
      orderType: searchParams.get('orderType') || null,
      search: (searchParams.get('search') || '').trim() || null,
      // export=1 lifts the detail-table cap so a download is the complete set,
      // not the first page the screen happened to show.
      /*
        * A cashier cannot open the Finance tab, which is where the drawer cards
        * (money position, cash in/out, counted cash, QR split) live for an
        * admin. They are the figures a cashier needs most at close, so the
        * Sales tab carries them for anyone whose role has no Finance tab. The
        * role check stays server-side: /cashier/reports re-exports the admin
        * page, so the client cannot be trusted to ask honestly.
        */
      drawerCards: !allowedTabs.includes('finance') && cashClosingPolicy(auth.user).expectedCashVisible,
      exportAll: searchParams.get('export') === '1',
      detailLimit: Number(searchParams.get('detail_limit')) || null,
      tablePages: tablePaging.tablePages,
      tablePageSizes: tablePaging.tablePageSizes,
    };

    const db = Database.getInstance();
    // Every optional table/column this engine reads lives in one place next to
    // the queries, so direct callers (tests, jobs, the probe script) get the
    // same preparation this route does.
    await ensureReportSchema(db);
    /*
     * "Today" means the CURRENT BUSINESS DAY, not the calendar date — the same
     * rule /api/admin/analytics already applies.
     *
     * Without this the two screens answered different questions and disagreed
     * on the owner's headline number: Reports summed every bill whose
     * created_at fell inside the Nepal calendar day, while Analytics summed the
     * bills stamped with the open business day's id. A shift that runs past
     * midnight, or a day opened late, puts bills on one side and not the other
     * — which is exactly the gap seen between Reports > Sales and Analytics >
     * Sales & Money on the same afternoon.
     *
     * The business day is an operator-declared boundary, so it outranks the
     * clock (see billDateColumn() in lib/report-scope.js). An explicitly chosen
     * businessDayId still wins over this, and when no day is open the calendar
     * range stands as the only thing left to report on.
     */
    let autoBusinessDay = false;
    if (!filters.businessDayId && range.period === 'today') {
      const activeDay = await currentBusinessDay(db);
      if (activeDay) {
        filters.businessDayId = activeDay.id;
        autoBusinessDay = true;
      }
    }
    if (filters.businessDayId) {
      const day = await db.get('SELECT id,business_date,status,opened_at,closed_at FROM business_days WHERE id=?', [filters.businessDayId]);
      if (!day) return NextResponse.json({ error: 'Business day not found.' }, { status: 404 });
      range.start = dateKey(day.business_date);
      range.end = range.start;
      range.period = 'business_day';
      range.label = `Business Day · ${range.start}${day.status === 'open' ? ' · Open' : ''}`;
      range.businessDayId = day.id;
      // Say which boundary is in force, so the figures are readable: the day
      // was inferred from the open business day rather than picked by hand.
      if (autoBusinessDay) range.label = `Current Business Day · ${range.start}`;
    }
    const [data, options] = await Promise.all([
      buildReport(db, tab, range, filters),
      searchParams.get('withOptions') === '1' ? getFilterOptions(db) : Promise.resolve(null),
    ]);

    return NextResponse.json({
      tab,
      range,
      filters,
      allowedTabs,
      // The UI disables filters this tab cannot honour, rather than offering a
      // control that changes nothing.
      supportedFilters: supportedFilters(tab),
      filterUnavailableReason: FILTER_UNAVAILABLE_REASON[tab] || null,
      ...data,
      ...(options ? { options } : {}),
    });
  } catch (error) {
    return handleRouteError(error, 'Failed to build the report.');
  }
}
