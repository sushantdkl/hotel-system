import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError, jsonError } from '@/lib/api-guard.js';
import { addGuestDocument, getGuest } from '@/lib/hotel/guests.js';

export const dynamic = 'force-dynamic';

export async function GET(request, context) {
  try {
    const auth = await requireAuth(request, { permission: 'hotel.front_desk' });
    if (auth.error) return auth.error;
    const { id } = await context.params;
    return NextResponse.json({ guest: await getGuest(Database.getInstance(), id) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleRouteError(error, 'Could not load this guest.');
  }
}

/** Upload one ID/KYC document (multipart: file, label). */
export async function POST(request, context) {
  try {
    const auth = await requireAuth(request, { permission: 'hotel.front_desk' });
    if (auth.error) return auth.error;
    const { id } = await context.params;
    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') return jsonError('Choose a file to upload.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    return NextResponse.json(await addGuestDocument(Database.getInstance(), auth.user, id, {
      label: String(form.get('label') || ''), fileName: file.name, mime: file.type, bytes,
    }), { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Could not upload this document.');
  }
}
