import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { listHistoricalActivity } from '@/lib/historical-activity.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, {
      roles: ['admin', 'cashier'],
      permission: 'report.previous_day.view',
    });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const q = new URL(request.url).searchParams;
    const historicalActivity = await listHistoricalActivity(db, {
      from: q.get('from'),
      to: q.get('to'),
      limit: q.get('limit'),
    });
    return NextResponse.json(historicalActivity);
  } catch (error) {
    return handleRouteError(error, 'Failed to load previous-day activity');
  }
}
