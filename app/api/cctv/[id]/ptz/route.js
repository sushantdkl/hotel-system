import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ptzNudge } from '@/lib/cctv.js';

export const dynamic = 'force-dynamic';

/** Nudge a PTZ camera: { direction: up|down|left|right|zoom_in|zoom_out }. */
export async function POST(request, context) {
  try {
    const auth = await requireAuth(request, { permission: 'cctv.ptz_control' });
    if (auth.error) return auth.error;
    const { id } = await context.params;
    const { direction } = await request.json();
    return NextResponse.json(await ptzNudge(Database.getInstance(), id, direction));
  } catch (error) {
    return handleRouteError(error, 'PTZ command failed.');
  }
}
