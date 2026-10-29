import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError, jsonError } from '@/lib/api-guard.js';
import { applyLeave, cancelLeave, clockIn, clockOut, ensureStaffHrSchema, staffMonth } from '@/lib/staff-hr.js';

export const dynamic = 'force-dynamic';

/** Signed-in staff member's own attendance, clock and leave. Every role. */
export async function GET(request) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureStaffHrSchema(db);
    const month = new URL(request.url).searchParams.get('month');
    return NextResponse.json({ user: { full_name: auth.user.full_name, role: auth.user.role }, ...(await staffMonth(db, auth.user.id, month)) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleRouteError(error, 'Could not load your attendance.');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureStaffHrSchema(db);
    const body = await request.json();
    switch (body?.action) {
      case 'clock_in': return NextResponse.json(await clockIn(db, auth.user));
      case 'clock_out': return NextResponse.json(await clockOut(db, auth.user, { note: body.note }));
      case 'apply_leave': return NextResponse.json(await applyLeave(db, auth.user, body));
      case 'cancel_leave': return NextResponse.json(await cancelLeave(db, auth.user, body.id));
      default: return jsonError('Unknown action.');
    }
  } catch (error) {
    return handleRouteError(error, 'Could not save this update.');
  }
}
