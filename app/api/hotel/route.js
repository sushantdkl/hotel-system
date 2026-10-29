import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { hotelSnapshot, runHotelCommand } from '@/lib/hotel/service.js';

export const dynamic = 'force-dynamic';
export async function GET(request) {
  try {
    const auth = await requireAuth(request, { permission: 'hotel.view' });
    if (auth.error) return auth.error;
    return NextResponse.json({ state: await hotelSnapshot(Database.getInstance()) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return handleRouteError(error, 'Could not load hotel records.'); }
}
export async function POST(request) {
  try {
    const auth = await requireAuth(request, { permission: 'hotel.view' });
    if (auth.error) return auth.error;
    const body = await request.json();
    const result = await runHotelCommand(Database.getInstance(), body, auth.user, request.headers.get('idempotency-key'));
    return NextResponse.json(result);
  } catch (error) { return handleRouteError(error, 'Could not save this hotel update.'); }
}
