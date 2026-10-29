import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-guard.js';
import { listReservations, processAutoNoShows } from '@/lib/leads.js';

async function requireFloorStaff(request) {
  const auth = await requireAuth(request, { roles: ['admin', 'waiter', 'cashier'], permission: 'reservations.access' });
  return auth.error ? null : auth.user;
}

/** Floor list: today / upcoming active reservations (no cancel/edit tooling). */
export async function GET(request) {
  try {
    const user = await requireFloorStaff(request);
    if (!user) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    try {
      await processAutoNoShows();
    } catch {
      /* ignore */
    }

    const { searchParams } = new URL(request.url);
    const boardParam = searchParams.get('board') || 'ops';
    const board =
      boardParam === 'upcoming'
        ? 'upcoming'
        : boardParam === 'today'
          ? 'today'
          : boardParam === 'history'
            ? 'history'
            : 'ops';

    const reservations = await listReservations({ board });

    // Show all statuses for floor ops (new / confirmed / seated / cancelled / etc.)
    return NextResponse.json({ reservations: reservations || [] });
  } catch (error) {
    console.error('Restaurant reservations GET:', error);
    return NextResponse.json({ error: 'Failed to load reservations' }, { status: 500 });
  }
}
