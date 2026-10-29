import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { gmDashboard } from '@/lib/hotel/gm-dashboard.js';

export const dynamic = 'force-dynamic';

/** Owner / general manager control center (Combined workspace). */
export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    return NextResponse.json(await gmDashboard(Database.getInstance()), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return handleRouteError(error, 'Could not load the control center.'); }
}
