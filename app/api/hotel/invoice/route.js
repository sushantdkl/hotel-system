import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureHotelSchema } from '@/lib/hotel/schema.js';

export const dynamic = 'force-dynamic';

/**
 * POST { stayId } — records one print of the final invoice and returns the
 * frozen snapshot with its copy label: the first print is ORIGINAL, every
 * later print DUPLICATE (counter kept on the statement row).
 */
export async function POST(request) {
  try {
    const auth = await requireAuth(request, { permission: 'hotel.folios' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureHotelSchema(db);
    const { stayId } = await request.json();
    const row = await db.transaction(async (tx) => {
      const current = await tx.get('SELECT snapshot_json, print_count FROM hotel_checkout_statements WHERE reservation_id = ?', [String(stayId || '')]);
      if (!current) return null;
      await tx.run('UPDATE hotel_checkout_statements SET print_count = print_count + 1 WHERE reservation_id = ?', [String(stayId)]);
      return current;
    });
    if (!row) return NextResponse.json({ error: 'No final invoice for this stay.' }, { status: 404 });
    return NextResponse.json({ statement: JSON.parse(row.snapshot_json), copy: Number(row.print_count) === 0 ? 'ORIGINAL' : 'DUPLICATE' });
  } catch (error) { return handleRouteError(error, 'Could not print the invoice.'); }
}
