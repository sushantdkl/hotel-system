import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { markRead, myNotifications } from '@/lib/notifications.js';

export const dynamic = 'force-dynamic';

/** Signed-in staff member's notifications. Every role. */
export async function GET(request) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    return NextResponse.json(await myNotifications(Database.getInstance(), auth.user.id), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleRouteError(error, 'Could not load notifications.');
  }
}

/** Mark one ({ id }) or all notifications read. */
export async function POST(request) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await markRead(Database.getInstance(), auth.user.id, body.id ?? null));
  } catch (error) {
    return handleRouteError(error, 'Could not update notifications.');
  }
}
