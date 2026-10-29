import { formatSittingDuration } from '@/lib/time-utils.js';
/**
 * Build a thermal-receipt payload from order/bill detail shapes so admin
 * pages can call printFinalBill instead of window.print()-ing the whole UI.
 */

import { latestReopenChanges } from '@/lib/reopen-diff.js';

function activeItems(items = []) {
  return (items || []).filter((i) => !['voided', 'cancelled'].includes(String(i.status || '').toLowerCase()));
}

function mapItems(items = []) {
  return activeItems(items).map((i) => ({
    item_name: i.item_name || i.name || i.menu_item_name || 'Item',
    quantity: Number(i.quantity || 0),
    price: Number(i.price ?? i.unitPrice ?? i.unit_price ?? 0),
    subtotal: Number(i.subtotal ?? i.total ?? 0),
    variant_name: i.variant_name || i.variant || null,
  }));
}

function mapPayments(payments = []) {
  return (payments || []).map((p) => ({
    method: p.payment_method || p.method || 'cash',
    amount: Number(p.amount || 0),
    provider: p.provider || null,
    reference: p.reference_number || p.reference || null,
  }));
}

/** Receipt from /api/admin/orders/:id payload. */
export function receiptFromOrderDetail({ order, items = [], payments = [], activity = [], settings = {} }) {
  if (!order) return null;
  const changes = latestReopenChanges(activity);
  const settled = (activity || []).find((a) => a.event === 'reopen_settled' || a.event === 'reopen_refund_settled');
  const nv = settled?.newValue || {};
  const grand = Number(order.bill_grand_total ?? order.total_amount ?? 0);
  const outstanding = Number(order.outstanding_amount ?? 0);
  return {
    bill_number: order.bill_number || `ORD-${order.order_number || order.id}`,
    order_number: order.order_number,
    table_number: order.table_number || null,
    items: mapItems(nv.refundDue > 0 && nv.originalItems?.length ? nv.originalItems : items),
    subtotal: Number(order.bill_subtotal ?? grand),
    discount: Number(order.bill_discount ?? 0),
    discount_label: order.bill_discount_reason || (order.bill_promotion_code ? 'Offer' : 'Discount'),
    promotion_code: order.bill_promotion_code || null,
    tax: Number(order.bill_tax ?? 0),
    tax_percent: null,
    service_charge: Number(order.bill_service_charge ?? 0),
    service_charge_percent: null,
    delivery_fee: Number(order.bill_delivery_fee ?? order.delivery_fee ?? 0),
    grand_total: grand,
    allocations: mapPayments(payments),
    outstanding,
    change: 0,
    payment_status: outstanding > 0.009 ? (payments.length ? 'partially_paid' : 'unpaid') : 'paid',
    customer_name: order.customer_name || '',
    customer_phone: order.customer_phone || '',
    processed_by: '',
    sitting_duration: order.table_number && order.paid_at ? formatSittingDuration(order.created_at, order.paid_at) : null,
    processed_at: order.paid_at || order.updated_at || order.created_at,
    restaurant_name: settings.restaurant_name || 'Raithane Daure Chulo',
    restaurant_address: settings.restaurant_address || '',
    restaurant_phone: settings.restaurant_phone || '',
    vat_number: settings.vat_number || '',
    pan_number: settings.pan_number || '',
    receipt_footer: settings.receipt_footer || '',
    printer_settings: settings,
    reopened: Boolean(changes),
    item_changes: changes,
    prior_payments: nv.priorPayments || [],
    new_payments: nv.newPayments || [],
    already_paid: Number(nv.alreadyPaid || 0),
    due: Number(nv.due || 0),
    refund_due: Number(nv.refundDue || 0),
  };
}

/** Receipt from getBillDetail /api/admin/bills/:id payload. */
export function receiptFromBillDetail(bill, settings = {}) {
  if (!bill) return null;
  const changes = latestReopenChanges(bill.activity);
  const settled = (bill.activity || []).find((a) => a.event === 'reopen_settled' || a.event === 'reopen_refund_settled');
  const nv = settled?.newValue || {};
  const payments = bill.allocations?.length ? bill.allocations : bill.payments;
  return {
    bill_number: bill.billNumber,
    order_number: bill.orderNumber,
    table_number: bill.legacy?.tableNumber || null,
    items: mapItems(nv.refundDue > 0 && nv.originalItems?.length ? nv.originalItems : bill.items),
    subtotal: Number(bill.totals?.subtotal || 0),
    discount: Number(bill.totals?.discount || 0),
    discount_label: bill.promotion?.name || bill.discountLabel || 'Discount',
    promotion_code: bill.promotion?.code || null,
    tax: Number(bill.totals?.tax || 0),
    tax_percent: null,
    service_charge: Number(bill.totals?.serviceCharge || 0),
    service_charge_percent: null,
    delivery_fee: Number(bill.totals?.deliveryFee || 0),
    grand_total: Number(bill.totals?.grandTotal || 0),
    allocations: mapPayments(payments),
    outstanding: Number(bill.totals?.balance || 0),
    change: 0,
    payment_status: bill.paymentStatus === 'partial' ? 'partially_paid' : (bill.paymentStatus || 'paid'),
    customer_name: bill.customer?.name || '',
    customer_phone: bill.customer?.phone || '',
    processed_by: bill.legacy?.cashierName || '',
    sitting_duration: bill.legacy?.tableId && bill.paidAt ? formatSittingDuration(bill.openedAt, bill.paidAt) : null,
    processed_at: bill.paidAt || bill.createdAt,
    restaurant_name: settings.restaurant_name || 'Raithane Daure Chulo',
    restaurant_address: settings.restaurant_address || '',
    restaurant_phone: settings.restaurant_phone || '',
    vat_number: settings.vat_number || '',
    pan_number: settings.pan_number || '',
    receipt_footer: settings.receipt_footer || '',
    printer_settings: settings,
    reopened: Boolean(changes),
    item_changes: changes,
    prior_payments: nv.priorPayments || [],
    new_payments: nv.newPayments || [],
    already_paid: Number(nv.alreadyPaid || 0),
    due: Number(nv.due || 0),
    refund_due: Number(nv.refundDue || 0),
  };
}
