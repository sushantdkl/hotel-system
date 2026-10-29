import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import {
  advanceOutstanding,
  deleteAdvance,
  deletePayment,
  ensurePayrollSchema,
  listAdvances,
  listPayments,
  listPayrollOverview,
  recordAdvance,
  recordPayment,
} from '@/lib/payroll.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'payroll.view' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensurePayrollSchema(db);
    const params = new URL(request.url).searchParams;
    const employeeId = params.get('employee_id');
    if (employeeId) {
      const [payments, advances, outstanding] = await Promise.all([
        listPayments(db, employeeId),
        listAdvances(db, employeeId),
        advanceOutstanding(db, employeeId),
      ]);
      return NextResponse.json({ payments, advances, outstanding });
    }
    const [employees, advances, payments] = await Promise.all([
      listPayrollOverview(db),
      listAdvances(db),
      listPayments(db),
    ]);
    return NextResponse.json({ employees, advances, payments });
  } catch (error) {
    return handleRouteError(error, 'Failed to load payroll');
  }
}

export async function POST(request) {
  try {
    const data = await request.json();
    const isAdvance = data.type === 'advance';
    const auth = await requireAuth(request, isAdvance
      ? { roles: ['admin', 'cashier'], permission: 'payroll.advances.create' }
      : { roles: ['admin', 'cashier'], permission: 'payroll.payments.create' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensurePayrollSchema(db);
    if (isAdvance) {
      const advance = await recordAdvance(db, data, auth.user?.id || null);
      return NextResponse.json({ message: 'Salary advance recorded.', advance }, { status: 201 });
    }
    const payment = await recordPayment(db, data, auth.user?.id || null);
    return NextResponse.json({ message: 'Salary payment recorded.', payment }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to record payment');
  }
}

export async function DELETE(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'payroll.records.delete' });
    if (auth.error) return auth.error;
    const params = new URL(request.url).searchParams;
    const id = params.get('id');
    if (!id) return NextResponse.json({ error: 'Which payment should be removed?' }, { status: 400 });
    const db = Database.getInstance();
    await ensurePayrollSchema(db);
    if (params.get('type') === 'advance') {
      await deleteAdvance(db, id);
      return NextResponse.json({ message: 'Advance deleted.' });
    }
    await deletePayment(db, id);
    return NextResponse.json({ message: 'Payment deleted.' });
  } catch (error) {
    return handleRouteError(error, 'Failed to delete payment');
  }
}
