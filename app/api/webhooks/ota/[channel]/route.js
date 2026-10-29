import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { handleRouteError } from '@/lib/api-guard.js';
import { receiveWebhook } from '@/lib/hotel/ota.js';

export const dynamic = 'force-dynamic';

/**
 * Channel manager / OTA booking webhook. Authenticated by the channel's token
 * (header `x-ota-token` or `?token=`), not a staff session. A conflict is still
 * a 200 (accepted into the conflict queue) so the sender does not retry forever.
 */
export async function POST(request, context) {
  try {
    const { channel } = await context.params;
    const token = request.headers.get('x-ota-token') || new URL(request.url).searchParams.get('token');
    const body = await request.json().catch(() => null);
    const result = await receiveWebhook(Database.getInstance(), channel, token, body);
    return NextResponse.json({ ok: result.outcome === 'ok', ...result });
  } catch (error) {
    return handleRouteError(error, 'Could not process this booking event.');
  }
}
