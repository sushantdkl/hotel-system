import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureStaffHrSchema, payrollAttendance } from '@/lib/staff-hr.js';

export const dynamic = 'force-dynamic';

/** Suggested pay per staff member from the month's attendance. Read-only. */
export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'payroll.view' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureStaffHrSchema(db);
    const month = new URL(request.url).searchParams.get('month');
    return NextResponse.json(await payrollAttendance(db, month), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleRouteError(error, 'Could not build the attendance payroll summary.');
  }
}
