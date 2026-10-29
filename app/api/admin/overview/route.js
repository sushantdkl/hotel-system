import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { combinedOverview } from '@/lib/overview.js';

export const dynamic = 'force-dynamic';

/** Owner/manager combined restaurant + hotel overview. */
export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    return NextResponse.json(await combinedOverview(Database.getInstance()), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleRouteError(error, 'Could not load the combined overview.');
  }
}
