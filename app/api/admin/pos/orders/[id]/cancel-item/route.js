import { NextResponse } from 'next/server';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import Database from '@/lib/db/index.js';
import { cancelSentItem } from '@/lib/kot-service.js';

/** Cancel a sent (KOT-issued) item with a mandatory reason. Writes a cancellation KOT. */
export async function POST(request, context) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'waiter', 'cashier', 'kitchen'], permission: 'orders.cancel_item' });
    if (auth.error) return auth.error;
    const { id } = await context.params;
    const orderId = parseInt(id, 10);
    const body = await request.json();
    const orderItemId = parseInt(body.order_item_id, 10);
    if (!Number.isFinite(orderId) || !Number.isFinite(orderItemId)) {
      return NextResponse.json({ error: 'Invalid order or item.' }, { status: 400 });
    }

    const db = Database.getInstance();
    const out = await cancelSentItem(db, {
      orderId,
      orderItemId,
      quantity: body.quantity ?? null,
      reason: body.reason,
      prepared: body.prepared === true,
      actor: auth.user,
    });
    return NextResponse.json({ success: true, ...out });
  } catch (error) {
    if (error?.status && error.status < 500) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return handleRouteError(error, 'Could not cancel the item.');
  }
}
