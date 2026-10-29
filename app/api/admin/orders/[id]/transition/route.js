import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { transition } from '@/lib/online-orders.js';

/**
 * Admin online-order actions: accept | reject | ready | complete | cancel | refund.
 * Body: { action, reason?, payment_method?, amount?, wastage? }
 */
export async function POST(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'orders.update' });
    if (auth.error) return auth.error;

    const { id } = await params;
    const orderId = Number(id);
    if (!orderId) return NextResponse.json({ error: 'Invalid order id.' }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const db = Database.getInstance();

    const result = await transition(db, {
      orderId,
      action: String(body.action || ''),
      reason: body.reason,
      payment_method: body.payment_method,
      allocations: body.allocations,
      idempotency_key: body.idempotency_key,
      amount: body.amount,
      wastage: !!body.wastage,
      user: auth.user,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error?.status) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return handleRouteError(error, 'Could not update the order.');
  }
}
