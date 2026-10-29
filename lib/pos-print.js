/**
 * Admin POS thermal print layouts. Reuses the shared print window + @page CSS
 * from lib/print-receipt.js so KOT and bill share paper-size handling (58/80mm)
 * but keep DISTINCT templates. The KOT template never shows prices/tax/totals.
 *
 * Silent printing is NOT claimed — a normal browser opens the print dialog.
 */

import { openReceiptPrint, formatReceiptMoney } from '@/lib/print-receipt.js';
import { compactOrderNumber } from '@/lib/document-display.js';
import { formatNepalTime, formatNepalDate, formatNepalClock } from '@/lib/time-utils.js';
import { resolvePrinterSettings, settingEnabled, qtyAfterItem } from '@/lib/printer-settings.js';
import { paymentQrSvg } from '@/lib/payment-qr.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function fmtTime(iso) {
  return formatNepalTime(iso || new Date());
}

const RESTAURANT = 'Raithane Daure Chulo';

/**
 * Kitchen Order Ticket. Quantities are visually prominent; no prices.
 * @param {object} kot   KOT snapshot (from the POS API)
 * @param {object} opts  { size, reprint }
 */
export function printKot(kot, { size = '80', reprint = false, settings = {} } = {}) {
  const p = resolvePrinterSettings(settings);
  const isCancel = kot.kot_type === 'cancellation';
  const isReprint = reprint || kot.is_reprint || Number(kot.reprint_count || 0) > 0;
  const tag = isCancel ? 'CANCELLATION' : (kot.kot_type === 'additional' ? 'ADDITIONAL' : 'NEW');
  const dest = kot.order_type === 'delivery' ? 'DELIVERY'
    : kot.table_number ? `TABLE ${esc(kot.table_number)}` : 'TAKEAWAY';

  const after = qtyAfterItem(p.kot_qty_position);
  const rows = (kot.items || []).map((it) => {
    const qty = `<td style="width:22%;text-align:center;font-size:20px;font-weight:bold;">${esc(it.quantity)}×</td>`;
    const name = `<td style="width:78%;">
        <div style="font-weight:bold;${isCancel ? 'text-decoration:line-through;' : ''}">${esc(it.item_name)}</div>
        ${it.variant_name ? `<div class="r-sm">↳ ${esc(it.variant_name)}</div>` : ''}
        ${it.special_instructions ? `<div class="r-sm">» ${esc(it.special_instructions)}</div>` : ''}
      </td>`;
    return `<tr>${after ? `${name}${qty}` : `${qty}${name}`}</tr>`;
  }).join('');

  const body = `
    <div class="r-head">
      ${settingEnabled(p.kot_show_restaurant) ? `<div class="r-name">${esc(p.restaurant_name || RESTAURANT)}</div>` : ''}
      <div class="r-sm r-b">${esc(p.kot_title)}</div>
      ${isCancel ? '<div class="r-sm r-b">*** CANCELLATION ***</div>' : ''}
      ${isReprint ? '<div class="r-sm r-b">*** REPRINT ***</div>' : ''}
    </div>
    <div class="r-meta">
      ${settingEnabled(p.kot_show_destination) ? `<div style="font-size:16px;font-weight:800;text-align:center;margin-bottom:2px;">${dest}</div>` : ''}
      <div class="r-meta-row"><span class="l">${esc(p.kot_number_label)}</span><span class="v">${esc(kot.kot_number)}</span></div>
      ${settingEnabled(p.kot_show_sequence) ? `<div class="r-meta-row"><span class="l">${esc(p.kot_sequence_label)}</span><span class="v">#${esc(kot.sequence)} (${tag})</span></div>` : ''}
      ${settingEnabled(p.kot_show_order) ? `<div class="r-meta-row"><span class="l">${esc(p.kot_order_label)}</span><span class="v">${esc(compactOrderNumber(kot.order_number) || kot.order_id)}</span></div>` : ''}
      ${settingEnabled(p.kot_show_issued_by) ? `<div class="r-meta-row"><span class="l">By</span><span class="v">${esc(kot.issued_by_name || '—')}</span></div>` : ''}
      ${settingEnabled(p.kot_show_time) ? `<div class="r-meta-row"><span class="l">Time</span><span class="v">${esc(fmtTime(kot.printed_at))}</span></div>` : ''}
    </div>
    <table><tbody style="page-break-inside:auto;">${rows}</tbody></table>
    ${settingEnabled(p.kot_show_notes) && kot.order_notes ? `<div class="r-hr"></div><div class="r-sm"><b>${esc(p.kot_note_label)}:</b> ${esc(kot.order_notes)}</div>` : ''}
    <div class="r-foot">${p.kot_footer ? `${esc(p.kot_footer)}<br/>` : ''}${isReprint ? `Reprint #${esc(kot.reprint_count)} · ` : ''}${esc(fmtTime())}</div>
  `;
  return openReceiptPrint({ title: `KOT ${kot.kot_number}`, size, body, layout: 'kot' });
}

function money(n) {
  return formatReceiptMoney(n);
}

function billRows(items, settings = {}) {
  const p = resolvePrinterSettings(settings);
  const showRate = settingEnabled(p.bill_show_item_rate);
  const after = qtyAfterItem(p.bill_qty_position);
  return (items || []).map((it) => {
    const qty = `<td class="c-qty r-num">${esc(it.quantity)}</td>`;
    const name = `<td class="c-name">${esc(it.item_name)}</td>`;
    const rate = showRate ? `<td class="c-price r-num">${formatReceiptMoney(it.price)}</td>` : '';
    const amount = `<td class="c-total r-num">${formatReceiptMoney(it.subtotal ?? it.price * it.quantity)}</td>`;
    const lead = after ? `${name}${qty}` : `${qty}${name}`;
    const restCols = (showRate ? 2 : 1) + 1;
    const modifier = it.variant_name
      ? `<tr class="r-item-sub">${after
        ? `<td class="c-name r-mod">• ${esc(it.variant_name)}</td><td colspan="${restCols}"></td>`
        : `<td></td><td colspan="${restCols}" class="r-mod">• ${esc(it.variant_name)}</td>`}</tr>`
      : '';
    return `<tr>${lead}${rate}${amount}</tr>${modifier}`;
  }).join('');
}

function itemsTable(items, settings = {}) {
  const p = resolvePrinterSettings(settings);
  const showRate = settingEnabled(p.bill_show_item_rate);
  const after = qtyAfterItem(p.bill_qty_position);
  const qty = `<th class="c-qty">${esc(p.bill_qty_label)}</th>`;
  const name = `<th class="c-name">${esc(p.bill_item_label)}</th>`;
  const rate = showRate ? `<th class="c-price">${esc(p.bill_rate_label)}</th>` : '';
  const amount = `<th class="c-total">${esc(p.bill_amount_label)}</th>`;
  const lead = after ? `${name}${qty}` : `${qty}${name}`;
  return `<table>
    <thead><tr>${lead}${rate}${amount}</tr></thead>
    <tbody>${billRows(items, p)}</tbody>
  </table>`;
}

function totalsBlock({ subtotal, discount, discount_label, promotion_code, tax, tax_percent, service_charge, service_charge_percent, delivery_fee, grand_total }) {
  return `
    <div class="r-totals">
      <div class="r-row"><span>Subtotal</span><span class="r-num">${money(subtotal)}</span></div>
      ${Number(discount) > 0 ? `<div class="r-row"><span>${esc(discount_label || 'Discount')}${promotion_code ? ` (${esc(promotion_code)})` : ''}</span><span class="r-num">-${money(discount)}</span></div>` : ''}
      ${Number(service_charge) > 0 ? `<div class="r-row"><span>Service Charge${service_charge_percent ? ` (${service_charge_percent}%)` : ''}</span><span class="r-num">${money(service_charge)}</span></div>` : ''}
      ${Number(tax) > 0 ? `<div class="r-row"><span>VAT${tax_percent ? ` (${tax_percent}%)` : ''}</span><span class="r-num">${money(tax)}</span></div>` : ''}
      ${Number(delivery_fee) > 0 ? `<div class="r-row"><span>Delivery</span><span class="r-num">${money(delivery_fee)}</span></div>` : ''}
    </div>
    <div class="r-grand"><span>TOTAL</span><span class="r-num">${formatReceiptMoney(grand_total, { prefix: true })}</span></div>`;
}

/** Restaurant header — only prints configured lines, never empty labels. */
function headerBlock(receipt, settings = {}) {
  const p = resolvePrinterSettings(settings);
  const lines = [
    settingEnabled(p.bill_show_address) ? receipt.restaurant_address : '',
    [settingEnabled(p.bill_show_phone) ? receipt.restaurant_phone : '', settingEnabled(p.bill_show_pan) && receipt.pan_number ? `PAN: ${receipt.pan_number}` : '', settingEnabled(p.bill_show_vat) && receipt.vat_number ? `VAT: ${receipt.vat_number}` : '']
      .filter(Boolean).join(' · '),
  ].filter(Boolean);
  return `
    <div class="r-head">
      ${settingEnabled(p.bill_show_restaurant) ? `<div class="r-name">${esc((receipt.restaurant_name || RESTAURANT).toUpperCase())}</div>` : ''}
      ${lines.map((l) => `<span class="r-sm">${esc(l)}</span>`).join('')}
    </div>`;
}

/** Document-type banner. Never claims TAX INVOICE — this system only issues customer bills. */
function doctypeBlock(mainLabel, tags = []) {
  const tag = tags.filter(Boolean).join(' · ');
  return `<div class="r-doctype"><div class="r-b">${esc(mainLabel)}</div>${tag ? `<div class="r-tag">${esc(tag)}</div>` : ''}</div>`;
}

function metaRow(label, value) {
  return `<div class="r-meta-row"><span class="l">${esc(label)}</span><span class="v">${esc(value)}</span></div>`;
}
function metaFull(label, value) {
  return `<div class="r-meta-full"><span>${esc(label)}: </span><span class="r-b">${esc(value)}</span></div>`;
}

const payLabel = (m) => ({ cash: 'Cash', credit: 'Credit' }[m] || 'Online');

/** Payment section: reflects actual allocations/payment_status, never a visual guess. */
function paymentBlock(receipt) {
  const allocations = (receipt.allocations || []).filter((a) => Number(a.amount) > 0);
  const isSplit = allocations.length > 1;
  const isCreditOnly = allocations.length === 1 && allocations[0].method === 'credit';
  const rows = [];

  if (isCreditOnly) {
    rows.push(metaFull('Payment', 'CREDIT'));
    if (receipt.customer_name) rows.push(metaFull('Customer', receipt.customer_name));
    const due = Number(receipt.outstanding) > 0 ? receipt.outstanding : allocations[0].amount;
    rows.push(`<div class="r-row"><span class="r-b">Amount Due</span><span class="r-num r-b">${formatReceiptMoney(due, { prefix: true })}</span></div>`);
  } else if (allocations.length) {
    for (const a of allocations) {
      rows.push(isSplit
        ? `<div class="r-row"><span>${esc(payLabel(a.method))}</span><span class="r-num">${money(a.amount)}</span></div>`
        : metaFull('Payment', payLabel(a.method)));
    }
    if (isSplit) {
      const totalPaid = allocations.reduce((s, a) => s + Number(a.amount || 0), 0);
      rows.push(`<div class="r-row"><span class="r-b">Total Paid</span><span class="r-num r-b">${money(totalPaid)}</span></div>`);
    } else {
      const cashLeg = allocations.find((a) => a.method === 'cash' && Number(a.cash_tendered) > 0);
      if (cashLeg) {
        rows.push(`<div class="r-row"><span>Received</span><span class="r-num">${money(cashLeg.cash_tendered)}</span></div>`);
      }
    }
  } else if (receipt.payment_status === 'paid') {
    rows.push(metaFull('Payment', 'Recorded'));
  }

  if (Number(receipt.change) > 0) {
    rows.push(`<div class="r-row"><span>Change</span><span class="r-num">${money(receipt.change)}</span></div>`);
  }
  if (Number(receipt.outstanding) > 0 && !isCreditOnly) {
    rows.push(`<div class="r-row"><span class="r-b">Outstanding</span><span class="r-num r-b">${money(receipt.outstanding)}</span></div>`);
  }
  return rows.length ? `<div class="r-totals">${rows.join('')}</div>` : '';
}

function footerBlock(receipt, { pending = false, settings = {} } = {}) {
  const p = resolvePrinterSettings(settings);
  const custom = receipt.receipt_footer && receipt.receipt_footer.trim();
  if (pending) {
    return `<div class="r-foot">Please settle the bill at the counter.<br/><span class="r-xs">${esc(fmtTime())}</span></div>`;
  }
  const thanks = custom || p.bill_footer || 'Thank you for your visit!';
  return `<div class="r-foot"><div class="r-thanks">${esc(thanks)}</div><span class="r-xs">${esc(fmtTime())}</span></div>`;
}

/**
 * Scan-to-pay QR with the amount set. Prints only when switched on in Printer
 * settings and the uploaded payment QR is a merchant (EMVCo) code.
 */
function payQrBlock(enabled, p, amount) {
  const svg = settingEnabled(enabled) ? paymentQrSvg(p.payment_qr_payload, amount) : '';
  return svg
    ? `<div style="text-align:center;margin-top:6px;"><div style="width:40mm;max-width:80%;margin:0 auto;">${svg}</div><div class="r-sm r-b">Scan to pay ${formatReceiptMoney(amount, { prefix: true })}</div></div>`
    : '';
}

/** Proforma (unpaid) — pre-bill, visibly different from a paid receipt. */
export function printProforma(proforma, { size = '80', settings = {} } = {}) {
  const p = resolvePrinterSettings(settings);
  const w = proforma.workspace || proforma;
  const t = proforma.totals || {};
  const order = w.order || {};
  const isDelivery = order.order_type === 'delivery';
  const isTakeaway = !order.table_number && !isDelivery;

  const body = `
    ${headerBlock({
      restaurant_name: settings.restaurant_name || RESTAURANT,
      restaurant_address: settings.restaurant_address,
      restaurant_phone: settings.restaurant_phone,
      vat_number: settings.vat_number,
      pan_number: settings.pan_number,
    }, p)}
    ${doctypeBlock('PRE-BILL', ['PAYMENT PENDING'])}
    <div class="r-meta">
      ${metaRow(isTakeaway || isDelivery ? 'Type' : 'Table', isDelivery ? 'Delivery' : isTakeaway ? 'Takeaway' : (order.table_number || '—'))}
      ${order.order_number ? metaFull('Order', compactOrderNumber(order.order_number)) : ''}
      ${proforma.customer_name && proforma.customer_name !== 'Walk-in Customer' ? metaFull('Customer', proforma.customer_name) : ''}
      <div class="r-meta-row"><span class="l">Date</span><span class="v">${esc(formatNepalDate(new Date().toISOString()))}</span></div>
      <div class="r-meta-row"><span class="l">Time</span><span class="v">${esc(formatNepalClock(new Date().toISOString()))}</span></div>
    </div>
    ${itemsTable(w.items, p)}
    ${totalsBlock({ subtotal: t.subtotal, discount: t.discount, tax: t.tax, tax_percent: t.taxPercent, service_charge: t.serviceCharge, service_charge_percent: t.servicePercent, delivery_fee: t.deliveryFee, grand_total: t.total })}
    ${payQrBlock(p.prebill_show_payment_qr, p, t.total)}
    ${footerBlock({}, { pending: true, settings: p })}`;
  return openReceiptPrint({ title: 'Bill (unpaid)', size, body, layout: 'bill' });
}

/** Final customer bill (paid / partially paid). */
export function printFinalBill(receipt, { size = '80', reprint = false, settings = {} } = {}) {
  const p = resolvePrinterSettings({ ...(receipt.printer_settings || {}), ...settings });
  const statusLabel = { paid: 'PAID', partially_paid: 'PARTIALLY PAID', unpaid: 'UNPAID' }[receipt.payment_status] || String(receipt.payment_status || '').toUpperCase();

  // Reopened-bill change log + prior/new payment split, shown only when present.
  const ch = receipt.item_changes || null;
  const signMoney = (n) => formatReceiptMoney(n, { sign: true });
  const changeLine = (marker, name, qtyText, amount, strike = false) =>
    `<div class="r-row" style="font-size:10px;"><span>${marker} ${strike ? `<s>${esc(name)}</s>` : esc(name)} <b>${esc(qtyText)}</b></span><span class="r-num">${signMoney(amount)}</span></div>`;
  const changeRows = [];
  if (receipt.reopened && ch) {
    for (const r of ch.added || []) changeRows.push(changeLine('+', r.name, `×${r.toQty}`, r.deltaValue));
    for (const r of ch.changed || []) {
      const up = r.deltaQty > 0;
      changeRows.push(changeLine(up ? '+' : '−', r.name, `${r.fromQty}→${r.toQty}`, r.deltaValue));
    }
    for (const r of ch.removed || []) changeRows.push(changeLine('−', r.name, `×${r.fromQty}`, r.deltaValue, true));
  }
  const changeBlock = changeRows.length
    ? `<div class="r-totals"><div class="r-row"><span class="r-b">Changes after reopen</span><span></span></div>${changeRows.join('')}</div>`
    : '';

  const priorRows = (receipt.prior_payments || []).filter((p) => Number(p.amount) > 0)
    .map((p) => `<div class="r-row"><span>${esc(payLabel(p.method))}</span><span class="r-num">${money(p.amount)}</span></div>`).join('');
  const newRows = (receipt.new_payments || []).filter((p) => Number(p.amount) > 0)
    .map((p) => `<div class="r-row"><span>${esc(payLabel(p.method))}</span><span class="r-num">${money(p.amount)}</span></div>`).join('');
  const reopenPayBlock = receipt.reopened
    ? `<div class="r-totals">
        ${Number(receipt.already_paid) > 0 ? `<div class="r-row"><span class="r-b">Previously paid</span><span class="r-num r-b">${money(receipt.already_paid)}</span></div>${priorRows}` : ''}
        ${Number(receipt.due) > 0 ? `<div class="r-row"><span class="r-b">New payment</span><span class="r-num r-b">${money(receipt.due)}</span></div>${newRows}` : ''}
        ${Number(receipt.refund_due) > 0 ? `<div class="r-row"><span class="r-b">Refunded</span><span class="r-num r-b">${money(receipt.refund_due)}</span></div>` : ''}
      </div>`
    : '';

  const isDelivery = receipt.order_type === 'delivery';
  const isTakeaway = !receipt.table_number && !isDelivery;
  const docTags = settingEnabled(p.bill_show_not_tax_invoice) ? ['NOT A TAX INVOICE'] : [];
  if (receipt.reopened) docTags.push('REVISED');
  if (reprint) docTags.push('DUPLICATE COPY');
  if (receipt.payment_status !== 'paid') docTags.push(statusLabel);

  const body = `
    ${headerBlock(receipt, p)}
    ${doctypeBlock(p.bill_title, docTags)}
    <div class="r-meta">
      ${metaRow(p.bill_number_label, receipt.bill_number)}
      ${settingEnabled(p.bill_show_table) ? metaRow(isTakeaway || isDelivery ? 'Type' : 'Table', isDelivery ? 'Delivery' : isTakeaway ? 'Takeaway' : receipt.table_number) : ''}
      ${settingEnabled(p.bill_show_order) ? metaFull(p.bill_order_label, compactOrderNumber(receipt.order_number)) : ''}
      ${settingEnabled(p.bill_show_datetime) ? `<div class="r-meta-row"><span class="l">Date</span><span class="v">${esc(formatNepalDate(receipt.processed_at))}</span></div><div class="r-meta-row"><span class="l">Time</span><span class="v">${esc(formatNepalClock(receipt.processed_at))}</span></div>` : ''}
      ${settingEnabled(p.bill_show_cashier) && receipt.processed_by ? metaFull('Cashier', receipt.processed_by) : ''}
      ${settingEnabled(p.bill_show_customer) ? metaFull('Customer', receipt.customer_name || 'Walk-in') : ''}
    </div>
    ${itemsTable(receipt.items, p)}
    ${totalsBlock({ subtotal: receipt.subtotal, discount: receipt.discount, discount_label: receipt.discount_label, promotion_code: receipt.promotion_code, tax: receipt.tax, tax_percent: receipt.tax_percent, service_charge: receipt.service_charge, service_charge_percent: receipt.service_charge_percent, delivery_fee: receipt.delivery_fee, grand_total: receipt.grand_total })}
    ${changeBlock}
    ${reopenPayBlock}
    ${settingEnabled(p.bill_show_payment) ? paymentBlock(receipt) : ''}
    ${payQrBlock(p.bill_show_payment_qr, p, receipt.outstanding)}
    ${footerBlock({ ...receipt, receipt_footer: p.bill_footer }, { settings: p })}`;
  return openReceiptPrint({ title: `Bill ${receipt.bill_number}`, size, body, layout: 'bill' });
}

/**
 * Credit statement for a customer (accounts receivable) or supplier (accounts
 * payable) — the running ledger, not a single bill. Same thermal-receipt
 * infrastructure as everything else so it comes off the same printer.
 * @param {{ kind: 'customer'|'supplier', name: string, phone?: string, outstanding: number, lines: Array<{date:string,memo:string,debit:number,credit:number,balance:number}> }} statement
 */
export function printCreditStatement(statement, { size = '80', settings = {} } = {}) {
  const p = resolvePrinterSettings(settings);
  const statementSize = p.statement_paper_size || size || 'a4';
  const { kind, name, phone, outstanding, lines = [], mode = 'full' } = statement;
  const dueOnly = mode === 'due';
  const rows = lines.map((l) => dueOnly ? `
    <tr>
      <td class="c-name" style="width:62%">${esc(formatNepalDate(l.date))}<div class="r-mod">${esc(l.memo || '')}</div></td>
      <td class="c-total" style="width:38%">${money(Number(l.due ?? l.balance ?? 0))}</td>
    </tr>` : `
    <tr>
      <td class="c-name" style="width:34%">${esc(formatNepalDate(l.date))}<div class="r-mod">${esc(l.memo || '')}</div></td>
      <td class="c-price" style="width:22%">${Number(l.debit) > 0 ? money(l.debit) : ''}</td>
      <td class="c-price" style="width:22%">${Number(l.credit) > 0 ? money(l.credit) : ''}</td>
      <td class="c-total" style="width:22%">${money(l.balance)}</td>
    </tr>`).join('');

  const body = `
    ${headerBlock({
      restaurant_name: settings.restaurant_name || RESTAURANT,
      restaurant_address: settings.restaurant_address,
      restaurant_phone: settings.restaurant_phone,
      vat_number: settings.vat_number,
      pan_number: settings.pan_number,
    }, { ...p, bill_show_pan: p.statement_show_pan, bill_show_address: p.statement_show_address })}
    ${doctypeBlock(kind === 'supplier' ? p.statement_supplier_title : p.statement_customer_title, [
      ...(dueOnly ? ['AMOUNT DUE ONLY'] : []),
      ...(settingEnabled(p.statement_show_not_tax_invoice) ? ['NOT A TAX INVOICE'] : []),
    ])}
    <div class="r-meta">
      ${metaFull(kind === 'supplier' ? 'Supplier' : 'Customer', name || '—')}
      ${settingEnabled(p.statement_show_phone) && phone ? metaRow('Phone', phone) : ''}
      ${settingEnabled(p.statement_show_printed_at) ? `<div class="r-meta-row"><span class="l">Printed</span><span class="v">${esc(formatNepalDate(new Date().toISOString()))} ${esc(formatNepalClock(new Date().toISOString()))}</span></div>` : ''}
    </div>
    <div class="r-hr"></div>
    ${lines.length ? `<table><thead><tr>
        ${dueOnly
          ? `<th class="c-name" style="width:62%">${esc(p.statement_date_label)}</th>
             <th class="c-total" style="width:38%">Amount due</th>`
          : `<th class="c-name" style="width:34%">${esc(p.statement_date_label)}</th>
             <th class="c-price" style="width:22%">${esc(p.statement_debit_label)}</th>
             <th class="c-price" style="width:22%">${esc(p.statement_credit_label)}</th>
             <th class="c-total" style="width:22%">${esc(p.statement_balance_label)}</th>`}
      </tr></thead><tbody>${rows}</tbody></table>` : `<p class="r-sm" style="text-align:center;padding:4mm 0;">${dueOnly ? 'Nothing currently due.' : 'No transactions in this range.'}</p>`}
    <div class="r-grand"><span>${outstanding < 0 ? 'Credit balance' : 'Outstanding'}</span><span class="r-num">${money(Math.abs(outstanding))}</span></div>
    ${footerBlock({ receipt_footer: p.statement_footer }, { settings: p })}`;
  return openReceiptPrint({ title: `${kind === 'supplier' ? 'Supplier' : 'Customer'} statement — ${name || ''}`, size: statementSize, body, layout: 'bill' });
}
