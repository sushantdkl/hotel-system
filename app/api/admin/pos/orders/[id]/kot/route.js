import { NextResponse } from 'next/server';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import Database from '@/lib/db/index.js';
import { issueKot, getOrderWorkspace } from '@/lib/kot-service.js';

/**
 * Save & print KOT: persist a new immutable ticket containing only the currently
 * unsent quantities. Idempotent on `idempotency_key` so a double-click / retry
 * cannot create two identical KOTs.
 */
export async function POST(request, context) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'waiter', 'cashier'], permission: 'kots.create' });
    if (auth.error) return auth.error;
    const { id } = await context.params;
    const orderId = parseInt(id, 10);
    if (!Number.isFinite(orderId)) return NextResponse.json({ error: 'Invalid order.' }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const idempotencyKey = String(body.idempotency_key || '').trim().slice(0, 100) || null;

    const db = Database.getInstance();
    const { kot, idempotent } = await issueKot(db, {
      orderId,
      actor: auth.user,
      idempotencyKey,
      orderNotes: body.order_notes ?? null,
    });

    const workspace = await getOrderWorkspace(db, orderId);
    return NextResponse.json({ success: true, idempotent: !!idempotent, kot, workspace }, { status: idempotent ? 200 : 201 });
  } catch (error) {
    if (error?.status && error.status < 500) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return handleRouteError(error, 'Could not save the kitchen ticket.');
  }
}
