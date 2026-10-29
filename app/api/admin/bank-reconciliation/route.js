import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureAccountingSchema } from '@/lib/accounting.js';
import { listBankAccounts } from '@/lib/accounting-cash.js';
import { reconciliationView, toggleReconciled, finalizeReconciliation, reconciliationDashboard } from '@/lib/accounting-reconcile.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'bank_reconciliation.access' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureAccountingSchema(db);
    const bankAccountId = new URL(request.url).searchParams.get('bank_account_id');
    if (bankAccountId) return NextResponse.json(await reconciliationView(db, bankAccountId));
    const [dashboard, banks] = await Promise.all([reconciliationDashboard(db), listBankAccounts(db)]);
    return NextResponse.json({ dashboard, banks });
  } catch (error) {
    return handleRouteError(error, 'Failed to load reconciliation');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'bank_reconciliation.access' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureAccountingSchema(db);
    const data = await request.json();
    if (data.action === 'toggle') {
      return NextResponse.json(await toggleReconciled(db, data.line_id, data.reconciled));
    }
    if (data.action === 'finalize') {
      const result = await finalizeReconciliation(db, { ...data, created_by: auth.user?.id || null });
      return NextResponse.json({ message: 'Reconciliation recorded.', ...result }, { status: 201 });
    }
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (error) {
    return handleRouteError(error, 'Failed to update reconciliation');
  }
}
