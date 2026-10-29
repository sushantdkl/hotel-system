import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-guard.js';
import {
  updateReservation,
  checkInReservation,
  getReservationById,
  CANCEL_REASON,
  RESERVATION_STATUS,
} from '@/lib/leads.js';
import { checkTableConflict, parsePartySize } from '@/lib/reservation-conflicts.js';
import { isAdminLike } from '@/lib/roles.js';

async function requireFloorStaff(request) {
  const auth = await requireAuth(request, { roles: ['admin', 'waiter', 'cashier'], permission: 'reservations.access' });
  return auth.error ? null : auth.user;
}

/**
 * Waiter floor ops: assign table, check in, edit party/notes, cancel, no-show.
 * Cannot change date/time/phone (Host desk).
 */
export async function PATCH(request, { params }) {
  try {
    const user = await requireFloorStaff(request);
    if (!user) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const reservationId = Number(id);

    if (body.action === 'check_in') {
      const reservation = await checkInReservation(reservationId);
      if (!reservation) {
        return NextResponse.json({ error: 'Reservation not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true, reservation });
    }

    if (body.action === 'cancel') {
      const current = await getReservationById(reservationId);
      if (!current) {
        return NextResponse.json({ error: 'Reservation not found' }, { status: 404 });
      }
      // Waiter may cancel seated only when linked order is empty
      if (current.status === RESERVATION_STATUS.SEATED && current.order_id && user.role === 'waiter') {
        try {
          const { OrderRepository } = await import('@/lib/db/repositories/orders.js');
          const orderRepo = new OrderRepository();
          const order = await orderRepo.getById(current.order_id);
          if (order && Number(order.item_count || 0) > 0) {
            return NextResponse.json(
              {
                error:
                  'This seating already has ordered items. Ask a cashier or admin to cancel, or complete a Rs 0 bill with a reason.',
              },
              { status: 403 }
            );
          }
        } catch {
          /* proceed if lookup fails */
        }
      }
      const reservation = await updateReservation(reservationId, {
        status: RESERVATION_STATUS.CANCELLED,
        cancel_reason: body.cancel_reason || CANCEL_REASON.RESTAURANT,
      });
      if (!reservation) {
        return NextResponse.json({ error: 'Reservation not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true, reservation });
    }

    if (body.action === 'no_show') {
      const reservation = await updateReservation(reservationId, {
        status: RESERVATION_STATUS.NO_SHOW,
        cancel_reason: CANCEL_REASON.LATE_NO_SHOW,
      });
      if (!reservation) {
        return NextResponse.json({ error: 'Reservation not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true, reservation });
    }

    if (body.action === 'edit') {
      const updates = {};
      if (body.party_size !== undefined) updates.party_size = body.party_size;
      if (body.message !== undefined) updates.message = body.message;
      if (body.preferences !== undefined) updates.preferences = body.preferences;
      if (body.admin_notes !== undefined) updates.admin_notes = body.admin_notes;
      if (body.occasion !== undefined) updates.occasion = body.occasion;
      const reservation = await updateReservation(reservationId, updates);
      if (!reservation) {
        return NextResponse.json({ error: 'Reservation not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true, reservation });
    }

    if (body.action === 'assign_table' || body.table_id !== undefined) {
      const tableId = body.table_id ? Number(body.table_id) : null;
      if (!tableId) {
        return NextResponse.json({ error: 'Please choose a table.' }, { status: 400 });
      }

      const current = await getReservationById(reservationId);
      if (!current) {
        return NextResponse.json({ error: 'Reservation not found' }, { status: 404 });
      }
      if (!['new', 'confirmed', 'arrived', 'seated'].includes(current.status)) {
        return NextResponse.json(
          { error: 'Cannot assign a table to this reservation.' },
          { status: 400 }
        );
      }

      // Seated → use change table path via leads
      if (current.status === 'seated') {
        const { changeReservationTable } = await import('@/lib/leads.js');
        try {
          const reservation = await changeReservationTable(reservationId, tableId, {
            force: isAdminLike(user.role) && !!body.force,
          });
          return NextResponse.json({ success: true, reservation });
        } catch (err) {
          return NextResponse.json(
            {
              error: err.message || 'Could not change table',
              code: err.code,
              conflicts: err.conflicts,
              alternatives: err.alternatives,
            },
            { status: err.code === 'table_conflict' ? 409 : 400 }
          );
        }
      }

      const partySize = parsePartySize(current.guests, current.party_size);
      const conflict = await checkTableConflict({
        tableId,
        startDate: current.date,
        startTime: current.time,
        excludeReservationId: reservationId,
        partySize,
        preferences: current.preferences,
      });

      if (!conflict.ok && !(isAdminLike(user.role) && body.force)) {
        return NextResponse.json(
          {
            error: conflict.conflicts?.[0]?.message || 'Table is not available.',
            code: 'table_conflict',
            conflicts: conflict.conflicts,
            alternatives: conflict.alternatives,
          },
          { status: 409 }
        );
      }

      const reservation = await updateReservation(reservationId, {
        table_id: tableId,
        force: isAdminLike(user.role) && !!body.force,
      });

      return NextResponse.json({ success: true, reservation });
    }

    return NextResponse.json(
      { error: 'Unknown action. Use check_in, assign_table, edit, cancel, or no_show.' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Restaurant reservation PATCH:', error);
    return NextResponse.json(
      {
        error: error.message || 'Update failed',
        code: error.code,
        conflicts: error.conflicts,
        alternatives: error.alternatives,
      },
      { status: error.code === 'table_conflict' ? 409 : 400 }
    );
  }
}
