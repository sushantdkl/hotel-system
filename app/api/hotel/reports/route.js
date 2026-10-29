import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { REPORT_LIST, reportCsv, runHotelReport } from '@/lib/hotel/reports.js';

export const dynamic = 'force-dynamic';

/** GET (no id): report list. GET ?id=&from=&to=[&format=csv]: one report from stored records. */
export async function GET(request) {
  try {
    const auth = await requireAuth(request, { permission: 'hotel.reports' });
    if (auth.error) return auth.error;
    const params = new URL(request.url).searchParams;
    if (!params.get('id')) return NextResponse.json({ reports: REPORT_LIST });
    const report = await runHotelReport(Database.getInstance(), params.get('id'), { from: params.get('from'), to: params.get('to') });
    if (params.get('format') === 'csv') {
      return new NextResponse(reportCsv(report), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="hotel-${report.id}-${report.from}-to-${report.to}.csv"`, 'Cache-Control': 'no-store' } });
    }
    return NextResponse.json(report, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return handleRouteError(error, 'Could not build the hotel report.'); }
}
