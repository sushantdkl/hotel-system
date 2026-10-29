import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureAccountingSchema } from '@/lib/accounting.js';
import { listCorrections } from '@/lib/accounting-corrections.js';
import {
  voidPaidBill,
  refundBill,
  listBillCorrections,
  getCorrectionJournalPreview,
  reverseCorrectionByJournal,
} from '@/lib/bill-corrections.js';
import { isPermissionAllowedSync } from '@/lib/permissions.js';
import { permissionRole } from '@/lib/roles.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'corrections.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureAccountingSchema(db);
    const q = new URL(request.url).searchParams;
    if (q.get('journal_id')) {
      return NextResponse.json(await getCorrectionJournalPreview(db, q.get('journal_id')));
    }
    const [corrections, billCorrections] = await Promise.all([
      listCorrections(db),
      listBillCorrections(db),
    ]);
    return NextResponse.json({
      corrections,
      bill_corrections: billCorrections,
    });
  } catch (error) {
    return handleRouteError(error, 'Failed to load corrections');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'corrections.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureAccountingSchema(db);
    const data = await request.json();
    const by = auth.user?.id || null;

    if (data.action === 'reverse') {
      const role = permissionRole(auth.user);
      const result = await reverseCorrectionByJournal(db, {
        journal_id: data.journal_id,
        reason: data.reason,
        restock: data.restock !== false,
        created_by: by,
        // Same purchase-void permissions as the Purchases page.
        allow_purchase_void: isPermissionAllowedSync(role, 'purchases.void'),
        allow_previous_day_purchase: isPermissionAllowedSync(role, 'purchases.void_previous_day'),
      });
      const messages = {
        void_bill: 'Bill, payments, customer credit and order were reversed.',
        void_purchase: 'Purchase, stock, expense and supplier balance were reversed.',
        void_expense: 'Expense and its ledger posting were reversed.',
        void_wastage: 'Wastage, stock and its linked expense were reversed.',
        reverse_credit_collection: 'Customer collection was reversed and the bill balance reopened.',
        reverse_credit_writeoff: 'Customer write-off was reversed and the bill balance reopened.',
        reverse_supplier_payment: 'Supplier payment and payable balance were reversed.',
        reverse_refund: 'Refund was reversed and the bill refund balance was restored.',
      };
      return NextResponse.json({
        message: messages[result.action] || 'Journal reversed.',
        ...result,
      }, { status: 201 });
    }
    if (data.action === 'void_bill') {
      const result = await voidPaidBill(db, {
        bill_id: data.bill_id,
        bill_number: data.bill_number,
        reason: data.reason,
        restock: data.restock !== false,
        created_by: by,
      });
      return NextResponse.json({ message: 'Bill voided.', ...result }, { status: 201 });
    }
    if (data.action === 'refund') {
      const result = await refundBill(db, {
        bill_id: data.bill_id,
        bill_number: data.bill_number,
        amount: data.amount,
        full: !!data.full,
        method: data.method || 'cash',
        reason: data.reason,
        created_by: by,
      });
      return NextResponse.json({ message: 'Refund posted.', ...result }, { status: 201 });
    }
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (error) {
    return handleRouteError(error, 'Failed to post correction');
  }
}
