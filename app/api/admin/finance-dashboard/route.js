import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureAccountingSchema } from '@/lib/accounting.js';
import { financeDashboard } from '@/lib/accounting-dashboard.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'finance_dashboard.access' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureAccountingSchema(db);
    return NextResponse.json(await financeDashboard(db));
  } catch (error) {
    return handleRouteError(error, 'Failed to load finance dashboard');
  }
}
