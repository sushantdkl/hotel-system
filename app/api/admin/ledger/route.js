import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import {
  ensureAccountingSchema,
  listAccountsWithBalances,
  generalLedger,
  cashBook,
  bankBook,
  journalList,
} from '@/lib/accounting.js';
import { listDrawers, listBankAccounts } from '@/lib/accounting-cash.js';

/**
 * Read-only accounting views, all derived from journal_lines:
 *   ?view=meta      -> accounts, the Online bank account and cash drawers
 *   ?view=journal   -> journal entries with lines (&from&to&source_type)
 *   ?view=ledger    -> one account's ledger (&account_id&from&to)
 *   ?view=cashbook  -> Cash on Hand movements (&drawer_id&from&to)
 *   ?view=bankbook  -> Bank movements (&bank_account_id&from&to)
 */
export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'general_ledger.view' });
    if (auth.error) return auth.error;

    const db = Database.getInstance();
    await ensureAccountingSchema(db);
    const q = new URL(request.url).searchParams;
    const view = q.get('view') || 'meta';
    const from = q.get('from') || null;
    const to = q.get('to') || null;

    if (view === 'meta') {
      const [accounts, banks, drawers] = await Promise.all([
        listAccountsWithBalances(db),
        listBankAccounts(db),
        listDrawers(db),
      ]);
      return NextResponse.json({ accounts, banks, drawers, pending: [] });
    }
    if (view === 'journal') {
      return NextResponse.json({ journals: await journalList(db, { from, to, source_type: q.get('source_type') }) });
    }
    if (view === 'ledger') {
      const accountId = q.get('account_id');
      if (!accountId) return NextResponse.json({ error: 'account_id required' }, { status: 400 });
      return NextResponse.json({ lines: await generalLedger(db, { accountId, from, to }) });
    }
    if (view === 'cashbook') {
      return NextResponse.json({ lines: await cashBook(db, { drawerId: q.get('drawer_id'), from, to }) });
    }
    if (view === 'bankbook') {
      return NextResponse.json({ lines: await bankBook(db, { bankAccountId: q.get('bank_account_id'), from, to }) });
    }
    return NextResponse.json({ error: 'Unknown view' }, { status: 400 });
  } catch (error) {
    return handleRouteError(error, 'Failed to load ledger');
  }
}
