import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { enableRoomService } from '@/lib/hotel/room-service.js';

export const dynamic = 'force-dynamic';

/** Create room-service QR tables for every hotel room (hotel setup). */
export async function POST(request) {
  try {
    const auth = await requireAuth(request, { permission: 'hotel.setup' });
    if (auth.error) return auth.error;
    return NextResponse.json(await enableRoomService(Database.getInstance()));
  } catch (error) {
    return handleRouteError(error, 'Could not set up room service.');
  }
}
