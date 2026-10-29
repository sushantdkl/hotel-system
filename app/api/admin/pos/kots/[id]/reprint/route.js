import { NextResponse } from 'next/server';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import Database from '@/lib/db/index.js';
import { reprintKot } from '@/lib/kot-service.js';

/** Reprint an existing KOT snapshot (marked REPRINT). Never creates a new KOT. */
export async function POST(request, context) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'waiter', 'cashier', 'kitchen'], permission: 'kots.reprint' });
    if (auth.error) return auth.error;
    const { id } = await context.params;
    const kotId = parseInt(id, 10);
    if (!Number.isFinite(kotId)) return NextResponse.json({ error: 'Invalid KOT.' }, { status: 400 });

    const db = Database.getInstance();
    const { kot } = await reprintKot(db, { kotId, actor: auth.user });
    return NextResponse.json({ success: true, kot });
  } catch (error) {
    return handleRouteError(error, 'Could not reprint the kitchen ticket.');
  }
}
