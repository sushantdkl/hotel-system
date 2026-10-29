import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureAccountingSchema } from '@/lib/accounting.js';
import { listBankAccounts } from '@/lib/accounting-cash.js';
import {
  customerReceivables,
  receivableAgeing,
  customerArStatement,
  customerLedgerHistory,
  collectCustomerCredit,
  writeOffCustomerCredit,
  arAccountBalance,
  outstandingCreditBills,
  openCreditBillsWithItems,
  correctCustomerCreditPaymentMethod,
} from '@/lib/accounting-receivables.js';
import { collectCreditBalance, writeOffCreditBalance } from '@/lib/split-payments.js';

function newKey() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.random()}`;
}

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'customer_ledger.access' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureAccountingSchema(db);
    const q = new URL(request.url).searchParams;

    if (q.get('view') === 'history') {
      const history = await customerLedgerHistory(db, {
        from: q.get('from'), to: q.get('to'), status: q.get('status') || 'all', search: q.get('search'),
      });
      return NextResponse.json({ history });
    }

    // Itemised open credit bills for every customer (WhatsApp reminders).
    if (q.get('view') === 'open_bills') {
      return NextResponse.json({ bills: await openCreditBillsWithItems(db) });
    }

    const customerId = q.get('customer_id');
    if (customerId) {
      const [statement, bills] = await Promise.all([
        customerArStatement(db, customerId, { from: q.get('from'), to: q.get('to') }),
        outstandingCreditBills(db, customerId),
      ]);
      return NextResponse.json({ statement, bills });
    }

    const [receivables, ageing, ar_balance, banks] = await Promise.all([
      customerReceivables(db, { from: q.get('from'), to: q.get('to') }),
      receivableAgeing(db),
      arAccountBalance(db),
      listBankAccounts(db),
    ]);
    return NextResponse.json({ receivables, ageing, ar_balance, banks });
  } catch (error) {
    return handleRouteError(error, 'Failed to load accounts receivable');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'customer_ledger.access' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureAccountingSchema(db);
    const body = await request.json();
    const actorId = auth.user?.id || null;
    const actorRole = auth.user?.role || 'admin';
    const paymentAmount = Number(body.amount || 0);
    const discountAmount = Number(body.discount_amount || 0);
    if (body.action !== 'writeoff' && (paymentAmount < 0 || discountAmount < 0 || (!(paymentAmount > 0) && !(discountAmount > 0)))) {
      return NextResponse.json({ error: 'Enter a payment or discount amount.' }, { status: 400 });
    }
    const isCreditDiscount = body.action === 'writeoff' || discountAmount > 0;
    if (isCreditDiscount) {
      const discountAuth = await requireAuth(request, { permission: 'credit.writeoff' });
      if (discountAuth.error) return discountAuth.error;
    }
    if (discountAmount > 0) {
      if (!String(body.discount_reason || '').trim()) {
        return NextResponse.json({ error: 'A reason is required for the discount.' }, { status: 400 });
      }
      const target = body.bill_id
        ? await db.get('SELECT outstanding_amount AS due FROM bills WHERE id = ?', [body.bill_id])
        : await db.get('SELECT current_credit AS due FROM customers WHERE id = ?', [body.customer_id]);
      if (paymentAmount + discountAmount > Number(target?.due || 0) + 0.001) {
        return NextResponse.json({ error: 'Payment plus discount cannot exceed the outstanding balance.' }, { status: 400 });
      }
    }

    // A bill_id scopes the action to exactly that invoice (the order-detail
    // popup's "Pay"/"Discount") instead of FIFO-applying across every open
    // bill for the customer (the customer-level popup's action).
    if (body.bill_id) {
      if (body.action === 'writeoff') {
        const result = await writeOffCreditBalance(db, {
          billId: body.bill_id, amount: body.amount, reason: body.note, actorId, actorRole,
          allowCreditWriteOff: true,
          requestKey: body.external_ref || newKey(),
        });
        return NextResponse.json({ message: 'Discount / write-off recorded.', ...result }, { status: 201 });
      }
      const method = body.method || 'cash';
      const payment = paymentAmount > 0
        ? await collectCreditBalance(db, {
            billId: body.bill_id,
            allocations: [{
              method,
              amount: body.amount,
              cash_tendered: method === 'cash' ? body.amount : undefined,
              reference: body.reference || body.note || undefined,
              bank_account_id: body.bank_account_id || undefined,
              provider: body.provider || undefined,
            }],
            actorId, actorRole,
            requestKey: body.external_ref || newKey(),
          })
        : null;
      if (discountAmount > 0) {
        const discount = await writeOffCreditBalance(db, {
          billId: body.bill_id,
          amount: discountAmount,
          reason: body.discount_reason,
          actorId,
          actorRole,
          allowCreditWriteOff: true,
          requestKey: `${body.external_ref || newKey()}:discount`,
        });
        return NextResponse.json({ message: payment ? 'Customer payment and discount recorded.' : 'Customer discount recorded.', payment, discount, outstanding: discount.outstanding, status: discount.status }, { status: 201 });
      }
      return NextResponse.json({ message: 'Customer payment recorded.', ...payment }, { status: 201 });
    }

    if (body.action === 'writeoff') {
      const result = await writeOffCustomerCredit(db, { ...body, actorId, actorRole, allowCreditWriteOff: true });
      return NextResponse.json({ message: 'Discount / write-off recorded.', ...result }, { status: 201 });
    }
    const payment = paymentAmount > 0
      ? await collectCustomerCredit(db, { ...body, actorId, actorRole })
      : null;
    if (discountAmount > 0) {
      const discount = await writeOffCustomerCredit(db, {
        customer_id: body.customer_id,
        amount: discountAmount,
        reason: body.discount_reason,
        actorId,
        actorRole,
        allowCreditWriteOff: true,
        external_ref: `${body.external_ref || newKey()}:discount`,
      });
      return NextResponse.json({ message: payment ? 'Customer payment and discount recorded.' : 'Customer discount recorded.', payment, discount }, { status: 201 });
    }
    return NextResponse.json({ message: 'Customer payment recorded.', ...payment }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to record customer payment');
  }
}

export async function PATCH(request) {
  try {
    const auth = await requireAuth(request, { permission: 'credit.payment_method_correct' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureAccountingSchema(db);
    const body = await request.json();
    const result = await correctCustomerCreditPaymentMethod(db, {
      paymentId: body.payment_id,
      method: body.method,
      reason: body.reason,
      actorId: auth.user?.id || null,
      requestKey: body.external_ref || newKey(),
    });
    return NextResponse.json({ message: 'Payment method corrected.', ...result });
  } catch (error) {
    return handleRouteError(error, 'Failed to correct the payment method');
  }
}
