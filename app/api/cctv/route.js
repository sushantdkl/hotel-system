import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError, jsonError } from '@/lib/api-guard.js';
import { isAdminLike } from '@/lib/roles.js';
import { CCTV_ZONES, deleteCamera, listCameras, pushToMediaMtx, refreshCameraStatus, saveCamera, streamBaseUrl } from '@/lib/cctv.js';

export const dynamic = 'force-dynamic';

/** Cameras for the grid. `?setup=1` adds source URLs / ONVIF settings for admin and manager only. */
export async function GET(request) {
  try {
    const auth = await requireAuth(request, { permission: 'cctv.view' });
    if (auth.error) return auth.error;
    const setup = new URL(request.url).searchParams.get('setup') === '1' && isAdminLike(auth.user.role);
    return NextResponse.json({
      cameras: await listCameras(Database.getInstance(), { withSecrets: setup }),
      streamConfigured: Boolean(streamBaseUrl()),
      apiConfigured: Boolean(process.env.MEDIAMTX_API_URL),
      zones: CCTV_ZONES,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleRouteError(error, 'Could not load cameras.');
  }
}

/** Camera setup (admin / manager): save, delete, push, status. */
export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const body = await request.json();
    switch (body.action) {
      case 'save': return NextResponse.json(await saveCamera(db, body));
      case 'delete': return NextResponse.json(await deleteCamera(db, body.id));
      case 'push': return NextResponse.json(await pushToMediaMtx(db));
      case 'status': return NextResponse.json(await refreshCameraStatus(db));
      default: return jsonError('Unknown action.');
    }
  } catch (error) {
    return handleRouteError(error, 'Could not save camera settings.');
  }
}
