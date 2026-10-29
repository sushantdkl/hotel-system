import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureHrmSchema, attendanceRegisterForDate, saveAttendanceRegister, attendanceHistory, todayNepal } from '@/lib/hrm.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'hrm.attendance.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureHrmSchema(db);
    const params = new URL(request.url).searchParams;
    if (params.get('view') === 'history') {
      const history = await attendanceHistory(db, {
        from: params.get('from'),
        to: params.get('to'),
        employeeId: params.get('employee_id'),
      });
      return NextResponse.json({ history });
    }
    const register = await attendanceRegisterForDate(db, params.get('date') || todayNepal());
    return NextResponse.json(register);
  } catch (error) {
    return handleRouteError(error, 'Failed to load attendance');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'hrm.attendance.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureHrmSchema(db);
    const register = await saveAttendanceRegister(db, await request.json(), auth.user?.id || null, auth.user?.role);
    return NextResponse.json({ message: 'Attendance saved.', ...register });
  } catch (error) {
    return handleRouteError(error, 'Failed to save attendance');
  }
}
