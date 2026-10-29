import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureAccountingSchema } from '@/lib/accounting.js';
import { trialBalance, profitAndLoss, balanceSheet, cashFlowStatement } from '@/lib/accounting-reports.js';

/** ?report=pnl|balance-sheet|trial-balance|cash-flow (&from&to). All derived from journals. */
export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'financial_reports.access' });
    if (auth.error) return auth.error;

    const db = Database.getInstance();
    await ensureAccountingSchema(db);
    const q = new URL(request.url).searchParams;
    const from = q.get('from') || null;
    const to = q.get('to') || null;
    const report = q.get('report') || 'pnl';

    if (report === 'pnl') return NextResponse.json({ report: await profitAndLoss(db, { from, to }) });
    if (report === 'balance-sheet') return NextResponse.json({ report: await balanceSheet(db, { to }) });
    if (report === 'trial-balance') return NextResponse.json({ report: await trialBalance(db, { to }) });
    if (report === 'cash-flow') return NextResponse.json({ report: await cashFlowStatement(db, { from, to }) });
    return NextResponse.json({ error: 'Unknown report' }, { status: 400 });
  } catch (error) {
    return handleRouteError(error, 'Failed to build report');
  }
}
