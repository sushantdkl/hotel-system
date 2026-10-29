/** WhatsApp click-to-chat helpers (wa.me). Nepal (+977) is assumed for 10-digit local numbers. */

import { formatCurrency } from '@/lib/currency';
import { formatNepalDateTime } from '@/lib/report-dates.js';

const DEFAULT_COUNTRY_CODE = '977';

export const DEFAULT_CUSTOMER_MESSAGE = 'Hello {name}, thank you for visiting {restaurant}!';
export const DEFAULT_REMINDER_MESSAGE = 'Hello {name}, this is a friendly reminder from {restaurant}.';

export function whatsappNumber(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) digits = DEFAULT_COUNTRY_CODE + digits;
  return digits.length >= 11 ? digits : '';
}

/** Replaces {name}, {restaurant}, {amount}, {phone}, {bills}; unknown tokens are left untouched. */
export function fillTemplate(template, vars = {}) {
  return String(template || '').replace(/\{(name|restaurant|amount|phone|bills)\}/g, (_, key) => String(vars[key] ?? '')).trim();
}

/** With no usable number but a message, wa.me lets the sender pick the chat. */
export function whatsappLink(phone, message = '') {
  const number = whatsappNumber(phone);
  const text = message ? `?text=${encodeURIComponent(message)}` : '';
  if (!number) return text ? `https://wa.me/${text}` : '';
  return `https://wa.me/${number}${text}`;
}

export function openWhatsapp(phone, message = '') {
  const url = whatsappLink(phone, message);
  if (!url) return false;
  return Boolean(window.open(url, '_blank', 'noopener,noreferrer'));
}

const isActiveItem = (item) => !['voided', 'cancelled'].includes(String(item.status || '').toLowerCase());
const itemLine = (name, variant, quantity, total) =>
  `${Number(quantity || 0)} x ${name || 'Item'}${variant ? ` (${variant})` : ''} — ${formatCurrency(total || 0)}`;

/** Full itemised bill text from a getBillDetail (/api/admin/bills/:id) payload. */
export function billMessage(bill, restaurant = '') {
  const t = bill.totals || {};
  const lines = [
    restaurant ? `*${restaurant}*` : null,
    `Bill ${bill.billNumber} · ${formatNepalDateTime(bill.paidAt || bill.createdAt)}`,
    '',
    ...(bill.items || []).filter(isActiveItem).map((i) => itemLine(i.name, i.variant, i.quantity, i.total)),
    '',
    `Subtotal: ${formatCurrency(t.subtotal || 0)}`,
    t.discount > 0 && `${bill.discountLabel || 'Discount'}: -${formatCurrency(t.discount)}`,
    t.serviceCharge > 0 && `Service charge: ${formatCurrency(t.serviceCharge)}`,
    t.tax > 0 && `VAT: ${formatCurrency(t.tax)}`,
    t.deliveryFee > 0 && `Delivery: ${formatCurrency(t.deliveryFee)}`,
    `*Total: ${formatCurrency(t.grandTotal || 0)}*`,
    t.balance > 0.009 && `Paid: ${formatCurrency(t.paid || 0)}`,
    t.balance > 0.009 && `*Balance due: ${formatCurrency(t.balance)}*`,
    '',
    'Thank you!',
  ];
  return lines.filter((l) => typeof l === 'string').join('\n');
}

/** Unpaid credit bills with their items, for the {bills} template token. bills: openCreditBillsWithItems rows. */
export function creditBillsMessage(bills = []) {
  if (!bills.length) return '';
  const due = bills.reduce((sum, b) => sum + Number(b.outstanding_amount || 0), 0);
  const blocks = bills.map((b) => [
    `Bill ${b.bill_number} · ${formatNepalDateTime(b.created_at)} — due ${formatCurrency(b.outstanding_amount || 0)} of ${formatCurrency(b.grand_total || 0)}`,
    ...(b.items || []).map((i) => `   ${itemLine(i.item_name, i.variant_name, i.quantity, i.subtotal)}`),
  ].join('\n'));
  return ['*Unpaid bills*', ...blocks, `*Total due: ${formatCurrency(due)}*`].join('\n\n');
}
