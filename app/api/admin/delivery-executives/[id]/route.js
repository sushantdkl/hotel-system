import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { updateDeliveryExecutive } from '@/lib/delivery.js';

export async function PATCH(request, context) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'delivery.manage' });
    if (auth.error) return auth.error;
    const { id } = await context.params;
    const db = Database.getInstance();
    const body = await request.json();
    const executive = await updateDeliveryExecutive(db, parseInt(id, 10), body);
    return NextResponse.json({ message: 'Delivery executive updated.', executive });
  } catch (error) {
    return handleRouteError(error, 'Could not update delivery executive.');
  }
}
