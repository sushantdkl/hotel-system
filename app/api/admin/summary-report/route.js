import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { resolvePeriodRange } from '@/lib/report-dates.js';
import { buildSummaryReport } from '@/lib/summary-report.js';

export async function GET(request) {
  try {
    const auth=await requireAuth(request,{roles:['admin','cashier'],permission:'summary.view'}); if(auth.error)return auth.error;
    const q=new URL(request.url).searchParams;
    const range=resolvePeriodRange(q.get('period')||'today',q.get('startDate'),q.get('endDate'),{calendarSystem:q.get('calendarSystem')});
    return NextResponse.json(await buildSummaryReport(Database.getInstance(),range));
  } catch(error){return handleRouteError(error,'Failed to build summary report.');}
}
