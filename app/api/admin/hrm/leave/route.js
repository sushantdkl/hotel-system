import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { clockedInNow, decideLeave, ensureStaffHrSchema, leaveQueue } from '@/lib/staff-hr.js';

export const dynamic = 'force-dynamic';

/** Leave approvals and who is clocked in. Who may decide which request: see canDecideLeave. */
export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'hrm.attendance.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureStaffHrSchema(db);
    const status = new URL(request.url).searchParams.get('status') || 'pending';
    const [requests, clockedIn] = await Promise.all([leaveQueue(db, auth.user, { status }), clockedInNow(db)]);
    return NextResponse.json({ requests, clockedIn }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleRouteError(error, 'Could not load leave requests.');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'hrm.attendance.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureStaffHrSchema(db);
    const body = await request.json();
    return NextResponse.json(await decideLeave(db, auth.user, body.id, body));
  } catch (error) {
    return handleRouteError(error, 'Could not save this decision.');
  }
}
