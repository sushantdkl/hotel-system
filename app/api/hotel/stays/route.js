import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { listChargeableStays } from '@/lib/hotel/room-charges.js';

export const dynamic = 'force-dynamic';

/** In-house guests a restaurant bill can be charged to. */
export async function GET(request) {
  try {
    const auth = await requireAuth(request, { anyPermissions: ['pos.charge_to_room', 'hotel.view'] });
    if (auth.error) return auth.error;
    return NextResponse.json({ stays: await listChargeableStays(Database.getInstance()) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleRouteError(error, 'Could not load in-house guests.');
  }
}
