import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { businessReport, businessReportCsv } from '@/lib/business-report.js';

export const dynamic = 'force-dynamic';

/** Restaurant / hotel / combined P&L and hotel KPIs. `format=csv` downloads it. */
export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    const params = new URL(request.url).searchParams;
    const report = await businessReport(Database.getInstance(), { from: params.get('from'), to: params.get('to') });
    if (params.get('format') === 'csv') {
      return new NextResponse(businessReportCsv(report), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="business-report-${report.from}-to-${report.to}.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    }
    return NextResponse.json(report, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleRouteError(error, 'Could not build the business report.');
  }
}
