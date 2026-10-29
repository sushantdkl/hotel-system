import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { handleRouteError } from '@/lib/api-guard.js';
import { exportIcs } from '@/lib/hotel/ota.js';

export const dynamic = 'force-dynamic';

/** Private per-room availability feed for OTAs to import. The token is the secret. */
export async function GET(request, context) {
  try {
    const { token } = await context.params;
    const ics = await exportIcs(Database.getInstance(), String(token).replace(/\.ics$/i, ''));
    return new NextResponse(ics, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleRouteError(error, 'Calendar not available.');
  }
}
