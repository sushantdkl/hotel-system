import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { voidSavingsDeposit } from '@/lib/savings.js';

export async function DELETE(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'savings.manage' });
    if (auth.error) return auth.error;
    const { id } = await params;
    const row = await voidSavingsDeposit(Database.getInstance(), Number(id), (await request.json()).reason, auth.user?.id);
    return NextResponse.json({ message: 'Savings deposit voided.', deposit: row });
  } catch (error) { return handleRouteError(error, 'Failed to void savings deposit.'); }
}
