import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-guard.js';
import { seatReservation } from '@/lib/leads.js';
import { isAdminLike } from '@/lib/roles.js';

async function requireStaff(request) {
  const auth = await requireAuth(request, { roles: ['admin', 'waiter', 'cashier'], permission: 'reservations.access' });
  return auth.error ? null : auth.user;
}

export async function POST(request, { params }) {
  try {
    const user = await requireStaff(request);
    if (!user) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { id } = await params;
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    // Waiters cannot force overrides or spoof waiter_id
    const waiterId = user.role === 'waiter' ? user.id : body.waiter_id || user.id;
    const force = isAdminLike(user.role) && !!body.force;
    const forceDeposit = isAdminLike(user.role) && !!body.force_deposit;
    const skipCheckin = isAdminLike(user.role) && !!body.skip_checkin;

    const result = await seatReservation(Number(id), {
      table_id: body.table_id || null,
      waiter_id: waiterId,
      force,
      force_deposit: forceDeposit,
      skip_checkin: skipCheckin || user.role === 'waiter',
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('Seat reservation error:', error);
    const msg = error?.message || 'Could not seat reservation.';
    const client =
      error.code === 'table_conflict' ||
      error.code === 'deposit_unpaid' ||
      msg.includes('Please') ||
      msg.includes('not found') ||
      msg.includes('already') ||
      msg.includes('Only') ||
      msg.includes('Deposit');
    return NextResponse.json(
      {
        error: msg,
        code: error.code,
        conflicts: error.conflicts,
        alternatives: error.alternatives,
      },
      { status: error.code === 'table_conflict' ? 409 : client ? 400 : 500 }
    );
  }
}
