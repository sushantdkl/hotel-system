import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensurePayrollSchema, getPerformance } from '@/lib/payroll.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'employee_performance.view' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensurePayrollSchema(db);
    return NextResponse.json({ performance: await getPerformance(db) });
  } catch (error) {
    return handleRouteError(error, 'Failed to load employee performance');
  }
}
