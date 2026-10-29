import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-guard.js';
import {
  listReservations,
  updateReservation,
  createReservation,
  getLeadsCounts,
  checkInReservation,
  markReservationViewed,
  processAutoNoShows,
  RESERVATION_STATUS,
  CANCEL_REASON,
} from '@/lib/leads.js';

async function requireAdmin(request) {
  const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'host_desk.manage' });
  return auth.error ? null : auth.user;
}

export async function GET(request) {
  try {
    const user = await requireAdmin(request);
    if (!user) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || undefined;
    const board = searchParams.get('board') || undefined;
    const date = searchParams.get('date') || undefined;
    const countsOnly = searchParams.get('counts') === 'true';
    const autoNoShow = searchParams.get('auto_noshow') === 'true';

    if (autoNoShow) {
      await processAutoNoShows();
    }

    if (countsOnly) {
      const counts = await getLeadsCounts();
      return NextResponse.json({ counts });
    }

    const reservations = await listReservations({ status, board, date });
    const counts = await getLeadsCounts();
    return NextResponse.json({ reservations, counts });
  } catch (error) {
    console.error('Admin reservations GET:', error);
    return NextResponse.json(
      { error: 'Failed to load reservations' },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const user = await requireAdmin(request);
    if (!user) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const body = await request.json();
    const reservation = await createReservation({
      ...body,
      source: body.source || 'phone',
      status: body.confirm ? RESERVATION_STATUS.CONFIRMED : RESERVATION_STATUS.NEW,
    });
    return NextResponse.json({ success: true, reservation }, { status: 201 });
  } catch (error) {
    console.error('Admin reservations POST:', error);
    const status = error.code === 'table_conflict' ? 409 : 400;
    return NextResponse.json(
      {
        error: error.message || 'Failed to create reservation',
        code: error.code,
        conflicts: error.conflicts,
        alternatives: error.alternatives,
      },
      { status }
    );
  }
}

export async function PATCH(request) {
  try {
    const user = await requireAdmin(request);
    if (!user) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const body = await request.json();
    const id = body.id;
    if (!id) {
      return NextResponse.json({ error: 'Missing reservation id' }, { status: 400 });
    }

    if (body.action === 'check_in') {
      const reservation = await checkInReservation(id);
      return NextResponse.json({ success: true, reservation });
    }

    if (body.action === 'mark_viewed') {
      await markReservationViewed(id);
      return NextResponse.json({ success: true });
    }

    const updates = { force: !!body.force };
    const fields = [
      'status', 'table_id', 'admin_notes', 'cancel_reason', 'name', 'phone',
      'date', 'time', 'guests', 'party_size', 'occasion', 'message',
      'preferences', 'is_vip', 'deposit_required', 'deposit_paid', 'deposit_amount',
      'expected_end_at',
    ];
    for (const f of fields) {
      if (body[f] !== undefined) updates[f] = body[f];
    }

    if (body.status === RESERVATION_STATUS.CANCELLED && !updates.cancel_reason) {
      updates.cancel_reason = body.cancel_reason || CANCEL_REASON.RESTAURANT;
    }
    if (body.status === RESERVATION_STATUS.NO_SHOW && !updates.cancel_reason) {
      updates.cancel_reason = CANCEL_REASON.LATE_NO_SHOW;
    }

    const reservation = await updateReservation(id, updates);
    if (!reservation) {
      return NextResponse.json({ error: 'Reservation not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, reservation });
  } catch (error) {
    console.error('Admin reservations PATCH:', error);
    const status = error.code === 'table_conflict' ? 409 : 400;
    return NextResponse.json(
      {
        error: error.message || 'Failed to update reservation',
        code: error.code,
        conflicts: error.conflicts,
        alternatives: error.alternatives,
      },
      { status }
    );
  }
}
