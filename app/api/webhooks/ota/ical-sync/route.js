import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import Database from '@/lib/db/index.js';
import { handleRouteError, jsonError } from '@/lib/api-guard.js';
import { syncIcalFeeds } from '@/lib/hotel/ota.js';

export const dynamic = 'force-dynamic';

/** For an external cron: POST with header `x-sync-token: $OTA_SYNC_TOKEN`. Disabled when the env var is unset. */
export async function POST(request) {
  try {
    const expected = Buffer.from(process.env.OTA_SYNC_TOKEN || '');
    const given = Buffer.from(request.headers.get('x-sync-token') || '');
    if (!expected.length) return jsonError('Scheduled sync is not configured.', 404);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return jsonError('Invalid sync token.', 401);
    return NextResponse.json(await syncIcalFeeds(Database.getInstance()));
  } catch (error) {
    return handleRouteError(error, 'Calendar sync failed.');
  }
}
