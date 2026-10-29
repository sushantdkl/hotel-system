import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureSplitPaymentSchema } from '@/lib/split-payments.js';

export async function GET(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'customer_ledger.access' });
    if (auth.error) return auth.error;
    const { id } = await params;
    const db = Database.getInstance();
    await ensureSplitPaymentSchema(db);

    const customer = await db.get(
      'SELECT id, name, phone, credit_limit, current_credit FROM customers WHERE id = ?',
      [id]
    );
    if (!customer) return NextResponse.json({ error: 'Customer not found.' }, { status: 404 });

    const rows = await db.all(
      `SELECT cl.*, b.bill_number, bp.payment_method, bp.provider,
              bp.reference_number, u.full_name AS recorded_by
       FROM customer_ledger cl
       LEFT JOIN bills b ON b.id = cl.bill_id
       LEFT JOIN bill_payments bp ON bp.id = cl.payment_id
       LEFT JOIN users u ON u.id = cl.created_by
       WHERE cl.customer_id = ?
       ORDER BY cl.created_at ASC, cl.id ASC`,
      [id]
    );

    let runningBalance = 0;
    const entries = (rows || []).map((row) => {
      runningBalance = Math.round((runningBalance + Number(row.debit || 0) - Number(row.credit || 0)) * 100) / 100;
      return {
        id: row.id,
        invoice: row.bill_number,
        type: row.entry_type,
        debit: Number(row.debit || 0),
        credit: Number(row.credit || 0),
        running_balance: runningBalance,
        due_date: row.due_date,
        payment_method: row.payment_method,
        provider: row.provider,
        reference: row.reference_number,
        note: row.note,
        recorded_by: row.recorded_by,
        created_at: row.created_at,
      };
    });

    return NextResponse.json({
      customer,
      summary: {
        original_credit: entries.reduce((sum, row) => sum + row.debit, 0),
        amount_paid: entries.reduce((sum, row) => sum + row.credit, 0),
        remaining_balance: runningBalance,
      },
      entries,
    });
  } catch (error) {
    return handleRouteError(error, 'Could not load the customer credit ledger.');
  }
}
