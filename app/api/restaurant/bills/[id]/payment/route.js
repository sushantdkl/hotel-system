import { NextResponse } from 'next/server';
import { OrderRepository } from '@/lib/db/repositories/orders';
import Database from '@/lib/db/index';
import { resolveCustomerForSale } from '@/lib/customers.js';
import { calculateBillTotals, parseSettingsRates } from '@/lib/billing-totals.js';
import { completeReservationForOrder } from '@/lib/leads.js';
import { handleRouteError, requireAuth } from '@/lib/api-guard.js';
import { logger } from '@/lib/logger.js';
import { ensureAccountingSchema, postSaleJournal } from '@/lib/accounting.js';
import { businessDayIdForFinancialWork } from '@/lib/business-days.js';
import { normalizePaymentMethod } from '@/lib/payment-allocations.js';

const orderRepo = new OrderRepository();

/**
 * Process payment for an order — single DB transaction:
 * lock order → idempotent paid check → customer totals → bill+payment →
 * order complete → table release → reservation complete.
 */
export async function POST(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'bills.pay' });
    if (auth.error) return auth.error;
    const user = auth.user;

    const { id } = await params;
    const orderId = parseInt(id, 10);
    if (!Number.isFinite(orderId)) {
      return NextResponse.json({ error: 'Invalid order.' }, { status: 400 });
    }

    const body = await request.json();
    const {
      payment_method,
      amount_paid,
      discount_amount = 0,
      discount_reason = '',
      zero_reason = '',
      split_payments = null,
      customer_mode = 'walkin',
      customer_name = '',
      customer_phone = '',
      customer_address = '',
      idempotency_key = null,
    } = body;

    if (Number(discount_amount || 0) > 0) {
      const discountAuth = await requireAuth(request, { permission: 'bills.discount' });
      if (discountAuth.error) return discountAuth.error;
    }

    if (!payment_method && !split_payments) {
      return NextResponse.json({ error: 'Please choose a payment method.' }, { status: 400 });
    }
    const canonicalPaymentMethod = normalizePaymentMethod(payment_method || 'cash');
    const canonicalSplitPayments = Array.isArray(split_payments)
      ? split_payments.map((payment) => ({ ...payment, method: normalizePaymentMethod(payment.method) }))
      : null;

    const paid = Number(amount_paid);
    if (!Number.isFinite(paid) || paid < 0) {
      return NextResponse.json({ error: 'Please enter a valid payment amount.' }, { status: 400 });
    }

    await orderRepo.ensureCustomerIdColumn();
    const db = Database.getInstance();

    // Pre-load settings outside the hot lock (read-only)
    const settingsArray = await db.all('SELECT setting_key, setting_value FROM system_settings');
    const settings = {};
    settingsArray.forEach((row) => {
      settings[row.setting_key] = row.setting_value;
    });
    // Match cashier UI defaults when settings were never saved
    if (settings.vat_percentage == null || settings.vat_percentage === '') {
      settings.vat_percentage = '13';
    }
    if (settings.service_charge_percentage == null || settings.service_charge_percentage === '') {
      settings.service_charge_percentage = '10';
    }
    const { vatPercent, servicePercent } = parseSettingsRates(settings);

    // Seed the accounting schema outside the hot lock so the in-tx post is cheap.
    await ensureAccountingSchema(db);

    const result = await db.transaction(async (tx) => {
      // Lock the order row (Postgres); SQLite still serializes the write txn
      let order;
      if (db.driver === 'postgres') {
        order = await tx.get(`SELECT * FROM orders WHERE id = ? FOR UPDATE`, [orderId]);
      } else {
        order = await tx.get(`SELECT * FROM orders WHERE id = ?`, [orderId]);
      }
      if (!order) {
        const err = new Error('This order could not be found.');
        err.status = 404;
        throw err;
      }
      // An older order remains owned by its original business day. Financial
      // completion still requires a currently open drawer session.
      const businessDayId = await businessDayIdForFinancialWork(tx, 'orders', orderId);

      // Enrich with table number if missing
      if (order.table_id && !order.table_number) {
        const t = await tx.get(`SELECT table_number FROM tables WHERE id = ?`, [order.table_id]);
        order.table_number = t?.table_number;
      }

      const existingBill = await tx.get(
        `SELECT id, bill_number, status FROM bills WHERE order_id = ? AND status = ?`,
        [orderId, 'paid']
      );
      if (existingBill) {
        const err = new Error(`This order has already been paid. Bill #${existingBill.bill_number}`);
        err.status = 400;
        err.code = 'already_paid';
        err.bill_number = existingBill.bill_number;
        err.bill = existingBill;
        throw err;
      }

      if (order.status === 'completed' || order.status === 'cancelled') {
        const err = new Error('This order can no longer accept payment.');
        err.status = 400;
        throw err;
      }

      const itemsSum = await tx.get(
        `SELECT COALESCE(SUM(subtotal), 0) AS total
         FROM order_items
         WHERE order_id = ?
           AND COALESCE(status, '') NOT IN ('voided', 'cancelled')`,
        [orderId]
      );
      const subtotal = Number(itemsSum?.total) || 0;
      const totals = calculateBillTotals(subtotal, {
        discountAmount: discount_amount,
        vatPercent,
        servicePercent,
      });
      const tax_amount = totals.tax;
      const service_charge = totals.serviceCharge;
      const final_amount = totals.total;

      if (Math.abs(paid - final_amount) > 0.01) {
        const err = new Error('Payment amount does not match the bill total.');
        err.status = 400;
        err.code = 'amount_mismatch';
        err.expected = final_amount.toFixed(2);
        err.received = paid.toFixed(2);
        throw err;
      }

      const auditReason = String(zero_reason || discount_reason || '').trim();
      if (final_amount === 0 && !auditReason) {
        const err = new Error(
          'A reason is required to complete a Rs 0 bill (complimentary, guest left, mistaken order, etc.).'
        );
        err.status = 400;
        err.code = 'zero_reason_required';
        throw err;
      }

      if (final_amount === 0 && canonicalPaymentMethod === 'credit') {
        const err = new Error('Credit cannot be used for a Rs 0 bill.');
        err.status = 400;
        throw err;
      }

      let mode = customer_mode || (customer_phone ? 'customer' : 'walkin');
      let phone = customer_phone || order.customer_phone || '';
      let name = customer_name || order.customer_name || '';
      if (order.customer_id && !phone) {
        const c = await tx.get(`SELECT * FROM customers WHERE id = ?`, [order.customer_id]);
        if (c) {
          mode = 'customer';
          phone = c.phone || '';
          name = name || c.name || '';
        }
      }
      if (phone && mode === 'walkin' && order.customer_phone) {
        mode = 'customer';
        phone = order.customer_phone;
        name = name || order.customer_name || '';
      }

      const customerInfo = await resolveCustomerForSale(tx, {
        mode,
        phone,
        name,
        address: customer_address,
        amount: final_amount,
        recordSale: true,
      });

      const noteExtra =
        final_amount === 0
          ? `\nZero bill: ${auditReason}`
          : discount_reason
            ? `\nDiscount: ${discount_reason}`
            : '';

      const billData = {
        order_id: orderId,
        table_id: order.table_id,
        subtotal,
        tax_amount,
        tax_percent: vatPercent,
        service_charge,
        service_charge_percent: servicePercent,
        discount_amount,
        discount_reason: auditReason || discount_reason || null,
        final_amount,
        cashier_id: user.id,
        payment_method: canonicalSplitPayments ? 'split' : canonicalPaymentMethod,
        amount_paid: final_amount,
        split_payments: canonicalSplitPayments ? JSON.stringify(canonicalSplitPayments) : null,
        notes: [
          idempotency_key ? `idempotency:${idempotency_key}` : null,
          canonicalSplitPayments ? `split:${JSON.stringify(canonicalSplitPayments)}` : null,
        ]
          .filter(Boolean)
          .join('\n') || null,
        customer_name: customerInfo.customer_name,
        customer_phone: customerInfo.customer_phone,
        reference_number: `PAY-${Date.now()}`,
        business_day_id: businessDayId,
      };

      let bill;
      let payment;
      try {
        ({ bill, payment } = await orderRepo.createBillAndPayment(billData, tx));
      } catch (e) {
        // Unique paid-bill index race
        if (/unique|duplicate|idx_bills_one_paid/i.test(String(e?.message || e?.code || ''))) {
          const again = await tx.get(
            `SELECT id, bill_number FROM bills WHERE order_id = ? AND status = 'paid'`,
            [orderId]
          );
          const err = new Error(
            again
              ? `This order has already been paid. Bill #${again.bill_number}`
              : 'This order has already been paid.'
          );
          err.status = 400;
          err.code = 'already_paid';
          throw err;
        }
        throw e;
      }

      // Post the sale journal INSIDE the payment transaction: the bill, its
      // payment and its accounting either all commit or all roll back — the
      // journal can never silently go missing due to timing.
      const parts =
        Array.isArray(canonicalSplitPayments) && canonicalSplitPayments.length
          ? canonicalSplitPayments.map((p) => ({ method: p.method, amount: Number(p.amount) }))
          : [{ method: canonicalPaymentMethod, amount: final_amount }];
      await postSaleJournal(tx, {
        bill_id: bill.id,
        bill_number: bill.bill_number,
        parts,
        tax_amount,
        created_by: user.id,
        business_day_id: businessDayId,
      });

      await tx.run(
        `UPDATE orders
         SET customer_name = ?, customer_phone = ?, customer_id = COALESCE(?, customer_id),
             status = 'completed',
             notes = COALESCE(notes, '') || ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          customerInfo.customer_name,
          customerInfo.customer_phone,
          customerInfo.customer_id,
          noteExtra,
          orderId,
        ]
      );

      if (order.table_id) {
        await tx.run(
          `UPDATE tables
           SET status = 'available', current_order_id = NULL, waiter_id = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [order.table_id]
        );
      }

      await completeReservationForOrder(orderId, tx);

      const orderItems = await tx.all(
        `SELECT * FROM order_items WHERE order_id = ? AND COALESCE(status, '') NOT IN ('voided', 'cancelled')`,
        [orderId]
      );

      return {
        order,
        bill,
        payment,
        customerInfo,
        orderItems,
        subtotal,
        tax_amount,
        service_charge,
        final_amount,
        vatPercent,
        servicePercent,
        auditReason,
        billData,
      };
    });

    return NextResponse.json({
      success: true,
      payment: result.payment,
      bill: result.bill,
      customer: result.customerInfo,
      receipt: {
        order_id: result.order.id,
        order_number: result.order.order_number,
        bill_number: result.bill.bill_number,
        table_number: result.order.table_number,
        items: result.orderItems,
        subtotal: result.subtotal,
        tax_amount: result.tax_amount,
        tax: result.tax_amount,
        tax_percent: result.vatPercent,
        service_charge: result.service_charge,
        service_charge_percent: result.servicePercent,
        discount_amount,
        discount: discount_amount,
        discount_reason: result.auditReason || discount_reason,
        final_amount: result.final_amount,
        total: result.final_amount,
        amount_paid: result.final_amount,
        change: 0,
        payment_method: canonicalSplitPayments ? 'split' : canonicalPaymentMethod,
        split_payments: canonicalSplitPayments,
        customer_name: result.customerInfo.customer_name || '',
        customer_phone: result.customerInfo.customer_phone || '',
        processed_by: user.full_name,
        processed_at: new Date().toISOString(),
        restaurant_name: settings.restaurant_name || 'Restaurant',
        restaurant_address: settings.restaurant_address || '',
        zero_bill: result.final_amount === 0,
      },
    });
  } catch (error) {
    if (error?.status && error.status < 500) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          expected: error.expected,
          received: error.received,
          bill_number: error.bill_number,
        },
        { status: error.status }
      );
    }
    logger.error('payment_failed', { message: error?.message });
    return handleRouteError(error, 'We could not complete this payment. Please try again.');
  }
}
