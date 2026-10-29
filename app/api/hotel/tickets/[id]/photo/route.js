import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError, jsonError } from '@/lib/api-guard.js';
import { saveTicketPhoto, ticketPhoto } from '@/lib/hotel/operations.js';

export const dynamic = 'force-dynamic';
const ANY = ['hotel.housekeeping', 'hotel.maintenance', 'hotel.front_desk'];

export async function GET(request, context) {
  try {
    const auth = await requireAuth(request, { anyPermissions: ANY });
    if (auth.error) return auth.error;
    const { id } = await context.params;
    const photo = await ticketPhoto(Database.getInstance(), id);
    return new NextResponse(photo.bytes, { headers: { 'Content-Type': photo.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) {
    return handleRouteError(error, 'Could not load the photo.');
  }
}

/** Attach one damage photo (multipart field `file`). */
export async function POST(request, context) {
  try {
    const auth = await requireAuth(request, { anyPermissions: ANY });
    if (auth.error) return auth.error;
    const { id } = await context.params;
    const file = (await request.formData()).get('file');
    if (!file || typeof file.arrayBuffer !== 'function') return jsonError('Choose a photo.');
    return NextResponse.json(await saveTicketPhoto(Database.getInstance(), id, { mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }));
  } catch (error) {
    return handleRouteError(error, 'Could not attach the photo.');
  }
}
