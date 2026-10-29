export const PRINTER_DEFAULTS = {
  receipt_paper_size: '80',
  statement_paper_size: '80',
  bill_title: 'CUSTOMER BILL',
  bill_show_not_tax_invoice: true,
  bill_show_pan: true,
  bill_show_vat: true,
  bill_show_address: true,
  bill_show_phone: true,
  bill_show_customer: true,
  bill_show_restaurant: true,
  bill_show_table: true,
  bill_show_order: true,
  bill_show_datetime: true,
  bill_show_cashier: true,
  bill_show_payment: true,
  bill_show_item_rate: true,
  prebill_show_payment_qr: true,
  bill_show_payment_qr: true,
  bill_number_label: 'Bill',
  bill_order_label: 'Order',
  bill_qty_label: 'Qty',
  bill_item_label: 'Item',
  bill_qty_position: 'after',
  bill_rate_label: 'Rate',
  bill_amount_label: 'Amount',
  bill_footer: 'Thank you for your visit!',
  kot_title: 'KITCHEN ORDER TICKET',
  kot_show_restaurant: true,
  kot_show_issued_by: true,
  kot_show_time: true,
  kot_show_destination: true,
  kot_show_sequence: true,
  kot_show_order: true,
  kot_show_notes: true,
  kot_number_label: 'KOT',
  kot_order_label: 'Order',
  kot_sequence_label: 'Seq',
  kot_note_label: 'KOT note',
  kot_qty_position: 'after',
  kot_footer: '',
  statement_customer_title: 'CUSTOMER CREDIT STATEMENT',
  statement_supplier_title: 'SUPPLIER CREDIT STATEMENT',
  statement_show_not_tax_invoice: true,
  statement_show_pan: true,
  statement_show_address: true,
  statement_show_phone: true,
  statement_show_printed_at: true,
  statement_date_label: 'Date / Note',
  statement_debit_label: 'Debit',
  statement_credit_label: 'Credit',
  statement_balance_label: 'Balance',
  statement_footer: 'Please settle outstanding dues at your earliest convenience.',
  qr_title_prefix: 'Table',
  qr_instruction: 'Scan to view the menu & order',
  qr_show_url: false,
  qr_show_restaurant: true,
  qr_show_border: true,
  qr_print_size_mm: '110',
  qr_footer: '',
};

export function qtyAfterItem(value, fallback = 'after') {
  const raw = value == null || value === '' ? fallback : value;
  return String(raw).toLowerCase() === 'after';
}

export function settingEnabled(value, fallback = true) {
  if (value == null || value === '') return fallback;
  return value === true || value === 1 || String(value).toLowerCase() === 'true';
}

export function resolvePrinterSettings(settings = {}) {
  const merged = { ...PRINTER_DEFAULTS, ...(settings || {}) };
  if (!settings.bill_footer && settings.receipt_footer) merged.bill_footer = settings.receipt_footer;
  return merged;
}

export function printerSettingsPayload(settings = {}) {
  const merged = resolvePrinterSettings(settings);
  return Object.fromEntries(Object.keys(PRINTER_DEFAULTS).map((key) => [
    key,
    typeof merged[key] === 'boolean' ? String(merged[key]) : merged[key],
  ]));
}
