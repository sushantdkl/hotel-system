import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError, jsonError } from '@/lib/api-guard.js';
import { ensurePermissionCache, isPermissionAllowedSync } from '@/lib/permissions.js';
import { deleteFeed, otaOverview, resolveConflict, rotateChannelToken, saveChannel, saveFeed, syncIcalFeeds } from '@/lib/hotel/ota.js';
import { permissionRole } from '@/lib/roles.js';

export const dynamic = 'force-dynamic';
const SETUP_ACTIONS = new Set(['channel', 'rotate', 'feed', 'feed_delete']);

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { anyPermissions: ['hotel.front_desk', 'hotel.setup'] });
    if (auth.error) return auth.error;
    const data = await otaOverview(Database.getInstance());
    // Webhook tokens are setup secrets.
    if (!isPermissionAllowedSync(permissionRole(auth.user), 'hotel.setup')) data.channels = data.channels.map((c) => ({ ...c, token: null }));
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleRouteError(error, 'Could not load channel sync.');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { anyPermissions: ['hotel.front_desk', 'hotel.setup'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const body = await request.json();
    await ensurePermissionCache(db);
    if (SETUP_ACTIONS.has(body.action) && !isPermissionAllowedSync(permissionRole(auth.user), 'hotel.setup')) return jsonError('Hotel setup permission is required.', 403);
    switch (body.action) {
      case 'channel': return NextResponse.json(await saveChannel(db, body));
      case 'rotate': return NextResponse.json(await rotateChannelToken(db, body.id));
      case 'feed': return NextResponse.json(await saveFeed(db, body));
      case 'feed_delete': return NextResponse.json(await deleteFeed(db, body.id));
      case 'sync': return NextResponse.json(await syncIcalFeeds(db));
      case 'conflict': return NextResponse.json(await resolveConflict(db, auth.user, body.id, { action: body.resolution, note: body.note }));
      default: return jsonError('Unknown action.');
    }
  } catch (error) {
    return handleRouteError(error, 'Could not save this channel update.');
  }
}
