import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { deleteGuestDocument, getGuestDocument } from '@/lib/hotel/guests.js';

export const dynamic = 'force-dynamic';

/** Private ID/KYC file. Never cached; only for staff with front-desk access. */
export async function GET(request, context) {
  try {
    const auth = await requireAuth(request, { permission: 'hotel.front_desk' });
    if (auth.error) return auth.error;
    const { id } = await context.params;
    const doc = await getGuestDocument(Database.getInstance(), id);
    return new NextResponse(doc.bytes, {
      headers: {
        'Content-Type': doc.mime,
        'Content-Disposition': `inline; filename="${doc.fileName.replace(/[^\w.\- ]/g, '_')}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return handleRouteError(error, 'Could not load this document.');
  }
}

export async function DELETE(request, context) {
  try {
    const auth = await requireAuth(request, { permission: 'hotel.front_desk' });
    if (auth.error) return auth.error;
    const { id } = await context.params;
    return NextResponse.json(await deleteGuestDocument(Database.getInstance(), auth.user, id));
  } catch (error) {
    return handleRouteError(error, 'Could not remove this document.');
  }
}
