import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureSplitPaymentSchema } from '@/lib/split-payments.js';
import { openCreditBillsWithItems } from '@/lib/accounting-receivables.js';

/** Full customer profile: identity, credit, orders, bills, ledger, payments. */
export async function GET(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'customers.access' });
    if (auth.error) return auth.error;
    const { id } = await params;
    const customerId = parseInt(id, 10);
    if (!Number.isFinite(customerId)) {
      return NextResponse.json({ error: 'Invalid customer.' }, { status: 400 });
    }

    const db = Database.getInstance();
    await ensureSplitPaymentSchema(db);

    const customer = await db.get(
      `SELECT id, name, phone, email, address, credit_limit, current_credit,
              total_visits, total_spent, is_vip, is_blacklisted, notes, created_at
       FROM customers WHERE id = ?`,
      [customerId]
    );
    if (!customer) return NextResponse.json({ error: 'Customer not found.' }, { status: 404 });

    const [orders, bills, ledgerRows, payments] = await Promise.all([
      db.all(
        `SELECT o.id, o.order_number, o.order_type, o.status, o.table_number,
                o.created_at, o.updated_at,
                COALESCE(
                  (SELECT b.grand_total FROM bills b WHERE b.order_id = o.id ORDER BY b.id DESC LIMIT 1),
                  (SELECT COALESCE(SUM(oi.subtotal),0) FROM order_items oi
                   WHERE oi.order_id = o.id AND COALESCE(oi.status,'') NOT IN ('voided','cancelled'))
                ) AS total
         FROM orders o
         WHERE o.customer_id = ?
            OR (o.customer_phone IS NOT NULL AND o.customer_phone = ?)
         ORDER BY o.created_at DESC
         LIMIT 100`,
        [customerId, customer.phone || '']
      ).catch(() => []),
      db.all(
        `SELECT b.id, b.bill_number, b.grand_total, b.status, b.payment_status,
                b.outstanding_amount, b.created_at, b.paid_at, o.order_number, o.id AS order_id
         FROM bills b
         JOIN orders o ON o.id = b.order_id
         WHERE b.customer_id = ? OR o.customer_id = ?
         ORDER BY b.created_at DESC
         LIMIT 100`,
        [customerId, customerId]
      ).catch(() => []),
      db.all(
        `SELECT cl.*, b.bill_number, bp.payment_method, bp.provider, bp.reference_number,
                u.full_name AS recorded_by
         FROM customer_ledger cl
         LEFT JOIN bills b ON b.id = cl.bill_id
         LEFT JOIN bill_payments bp ON bp.id = cl.payment_id
         LEFT JOIN users u ON u.id = cl.created_by
         WHERE cl.customer_id = ?
         ORDER BY cl.created_at ASC, cl.id ASC`,
        [customerId]
      ).catch(() => []),
      db.all(
        `SELECT bp.id, bp.amount, bp.payment_method, bp.provider, bp.reference_number,
                bp.created_at, b.bill_number, b.id AS bill_id
         FROM bill_payments bp
         JOIN bills b ON b.id = bp.bill_id
         WHERE b.customer_id = ?
         ORDER BY bp.created_at DESC
         LIMIT 100`,
        [customerId]
      ).catch(() => []),
    ]);

    let running = 0;
    const ledger = (ledgerRows || []).map((row) => {
      running = Math.round((running + Number(row.debit || 0) - Number(row.credit || 0)) * 100) / 100;
      return {
        id: row.id,
        bill_id: row.bill_id,
        payment_id: row.payment_id,
        idempotency_key: row.idempotency_key,
        invoice: row.bill_number,
        type: row.entry_type,
        debit: Number(row.debit || 0),
        credit: Number(row.credit || 0),
        running_balance: running,
        due_date: row.due_date,
        payment_method: row.payment_method,
        provider: row.provider,
        reference: row.reference_number,
        note: row.note,
        recorded_by: row.recorded_by,
        created_at: row.created_at,
      };
    });

    const outstandingBills = (bills || []).filter(
      (b) => Number(b.outstanding_amount || 0) > 0.01 || String(b.payment_status || '') === 'partially_paid'
    );

    // A bill counts as "on credit" if it ever posted a credit_sale ledger entry,
    // regardless of whether it has since been paid off — the badge marks history, not current balance.
    const creditBillIds = new Set((ledgerRows || []).filter((r) => r.entry_type === 'credit_sale').map((r) => r.bill_id));
    const billsWithCredit = (bills || []).map((b) => ({ ...b, was_credit: creditBillIds.has(b.id) }));
    const creditOrderIds = new Set(billsWithCredit.filter((b) => b.was_credit).map((b) => b.order_id));
    const orderIds = (orders || []).map((order) => order.id).filter(Boolean);
    const orderItemRows = orderIds.length
      ? await db.all(
          `SELECT oi.order_id,COALESCE(oi.item_name,mi.name,'Item') AS item_name,
                  oi.variant_name,oi.quantity,oi.subtotal,oi.status,oi.created_at
           FROM order_items oi
           LEFT JOIN menu_items mi ON mi.id=COALESCE(oi.menu_item_id,oi.item_id)
           WHERE oi.order_id IN (${orderIds.map(() => '?').join(',')})
           ORDER BY oi.order_id,oi.id`,
          orderIds
        ).catch(() => [])
      : [];
    const itemsByOrder = new Map();
    for (const row of orderItemRows) {
      if (!itemsByOrder.has(row.order_id)) itemsByOrder.set(row.order_id, []);
      itemsByOrder.get(row.order_id).push({
        ...row,
        quantity: Number(row.quantity || 0),
        subtotal: Number(row.subtotal || 0),
      });
    }
    const ordersWithCredit = (orders || []).map((o) => ({
      ...o,
      was_credit: creditOrderIds.has(o.id),
      items: itemsByOrder.get(o.id) || [],
    }));

    return NextResponse.json({
      success: true,
      customer: {
        ...customer,
        credit_limit: Number(customer.credit_limit || 0),
        current_credit: Number(customer.current_credit || 0),
        total_visits: Number(customer.total_visits || 0),
        total_spent: Number(customer.total_spent || 0),
      },
      summary: {
        orders: (orders || []).length,
        bills: (bills || []).length,
        outstanding_credit: Number(customer.current_credit || 0),
        credit_limit: Number(customer.credit_limit || 0),
        available_credit: Math.max(0, Number(customer.credit_limit || 0) - Number(customer.current_credit || 0)),
        ledger_debits: ledger.reduce((s, r) => s + r.debit, 0),
        ledger_credits: ledger.reduce((s, r) => s + r.credit, 0),
        ledger_balance: running,
        outstanding_invoices: outstandingBills.length,
      },
      orders: ordersWithCredit,
      bills: billsWithCredit,
      outstanding_bills: outstandingBills,
      credit_bills: await openCreditBillsWithItems(db, customerId).catch(() => []),
      ledger,
      payments: (payments || []).map((p) => ({
        id: p.id,
        amount: Number(p.amount || 0),
        method: p.payment_method,
        provider: p.provider,
        reference: p.reference_number,
        bill_number: p.bill_number,
        bill_id: p.bill_id,
        created_at: p.created_at,
      })),
    });
  } catch (error) {
    return handleRouteError(error, 'Could not load the customer profile.');
  }
}
