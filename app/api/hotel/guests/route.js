import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { listGuests, saveGuest } from '@/lib/hotel/guests.js';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { permission: 'hotel.front_desk' });
    if (auth.error) return auth.error;
    const q = new URL(request.url).searchParams.get('q') || '';
    return NextResponse.json({ guests: await listGuests(Database.getInstance(), q) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleRouteError(error, 'Could not load guests.');
  }
}

/** Create or update (with `id`) a guest profile. */
export async function POST(request) {
  try {
    const auth = await requireAuth(request, { permission: 'hotel.front_desk' });
    if (auth.error) return auth.error;
    return NextResponse.json(await saveGuest(Database.getInstance(), auth.user, await request.json()));
  } catch (error) {
    return handleRouteError(error, 'Could not save this guest.');
  }
}
