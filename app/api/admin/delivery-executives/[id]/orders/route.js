import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { getExecutiveOrders } from '@/lib/delivery.js';

export async function GET(request, context) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'delivery.manage' });
    if (auth.error) return auth.error;
    const { id } = await context.params;
    const db = Database.getInstance();
    const orders = await getExecutiveOrders(db, parseInt(id, 10));
    return NextResponse.json({ orders });
  } catch (error) {
    return handleRouteError(error, 'Could not load orders for this executive.');
  }
}
