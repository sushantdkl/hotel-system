import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-guard.js';
import { getReservationById, updateReservation } from '@/lib/leads.js';

async function requireAdmin(request) {
  const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'host_desk.manage' });
  return auth.error ? null : auth.user;
}

export async function GET(request, { params }) {
  try {
    const user = await requireAdmin(request);
    if (!user) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { id } = await params;
    const reservation = await getReservationById(Number(id));
    if (!reservation) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ reservation });
  } catch (error) {
    console.error('Admin reservation GET:', error);
    return NextResponse.json({ error: 'Failed to load reservation' }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  try {
    const user = await requireAdmin(request);
    if (!user) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const updates = {};
    if (body.status !== undefined) updates.status = body.status;
    if (body.table_id !== undefined) updates.table_id = body.table_id;
    if (body.admin_notes !== undefined) updates.admin_notes = body.admin_notes;

    const reservation = await updateReservation(Number(id), updates);
    if (!reservation) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, reservation });
  } catch (error) {
    console.error('Admin reservation PATCH:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update' },
      { status: 500 }
    );
  }
}
