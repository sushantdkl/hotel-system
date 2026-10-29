import { normalizePaymentMethod } from './payment-allocations.js';

const number = (value) => Number(value || 0);
const round2 = (value) => Math.round((number(value) + Number.EPSILON) * 100) / 100;

function paymentLabel(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (['owner_pocket', 'business_funding', 'funding'].includes(raw)) return 'Owner / Business Funding';
  const method = normalizePaymentMethod(raw);
  if (method === 'cash') return 'Cash';
  if (['credit', 'due', 'unpaid', 'payable'].includes(method)) return 'Credit';
  if (method) return 'Online';
  return null;
}

function itemSummary(items = []) {
  return items
    .filter((item) => String(item.status || '').toLowerCase() !== 'voided')
    .map((item) => {
      const quantity = number(item.quantity_received) || number(item.quantity) || number(item.quantity_ordered);
      const variant = item.variant_name ? ` (${item.variant_name})` : '';
      const unit = item.purchase_unit ? ` ${item.purchase_unit}` : '';
      return `${quantity || 0}${unit} × ${item.item_name || 'Item'}${variant}`;
    })
    .join(', ');
}

function sortNewest(events) {
  return events
    .filter((event) => event.at)
    .sort((a, b) => {
      const time = new Date(b.at).getTime() - new Date(a.at).getTime();
      return time || String(b.id).localeCompare(String(a.id));
    });
}

function customerLedgerTitle(row) {
  if (row.type === 'credit_sale') return 'Credit sale charged';
  if (row.type === 'credit_payment') return 'Credit payment received';
  if (row.type === 'refund') return 'Credit refund recorded';
  if (row.type === 'adjustment' && number(row.credit) > 0) return /write.?off|discount/i.test(row.note || '') ? 'Credit discount applied' : 'Credit reduced';
  if (row.type === 'adjustment' && number(row.debit) > 0) return /reversal/i.test(row.note || '') ? 'Credit reopened by reversal' : 'Credit increased';
  return String(row.type || 'Credit adjustment').replaceAll('_', ' ');
}

export function buildCustomerCreditTimeline({ customer = {}, bills = [], ledger = [] } = {}) {
  const events = [];

  if (customer.created_at) events.push({
    id: `customer-${customer.id || 'profile'}`,
    at: customer.created_at,
    kind: 'profile',
    title: 'Customer profile created',
    description: customer.name || 'Customer registered',
  });

  for (const bill of bills) events.push({
    id: `bill-${bill.id}`,
    at: bill.created_at,
    kind: 'bill',
    title: `${bill.was_credit ? 'Credit invoice' : 'Bill'} ${bill.bill_number || `#${bill.id}`} issued`,
    description: bill.order_number ? `For order ${bill.order_number}` : 'Customer bill created',
    amount: number(bill.grand_total),
    amountLabel: 'Bill total',
    balance: number(bill.outstanding_amount),
    balanceLabel: 'Outstanding',
    status: bill.payment_status || bill.status,
    billId: bill.id,
    actionLabel: 'View bill details',
  });

  // A single "Receive payment" that clears several bills writes one
  // credit_payment ledger row per bill (collectCustomerCredit walks the bills
  // oldest-first). Those rows share the external_ref that prefixes their
  // idempotency key, so we fold them back into one "payment received" event —
  // otherwise the timeline shows N lines and never the amount actually paid.
  const paymentBatches = new Map();
  for (const row of ledger) {
    if (row.type !== 'credit_payment') continue;
    const batchKey = row.idempotency_key ? String(row.idempotency_key).split(':')[0] : `solo-${row.id}`;
    if (!paymentBatches.has(batchKey)) paymentBatches.set(batchKey, []);
    paymentBatches.get(batchKey).push(row);
  }

  for (const row of ledger) {
    if (row.type === 'credit_payment') continue; // handled as batches below
    if (row.type === 'credit_sale') continue; // the bill card is the same financial event
    const increasesDue = number(row.debit) > 0;
    const amount = increasesDue ? number(row.debit) : number(row.credit);
    events.push({
      id: `customer-ledger-${row.id}`,
      at: row.created_at,
      effectiveDate: row.due_date || null,
      effectiveLabel: row.due_date ? 'Due date' : null,
      kind: row.type === 'adjustment' ? 'adjustment' : 'credit',
      tone: increasesDue ? 'charge' : 'payment',
      title: customerLedgerTitle(row),
      description: row.note || row.reference || (row.invoice ? `Invoice ${row.invoice}` : 'Customer credit ledger entry'),
      amount,
      amountLabel: increasesDue ? 'Added to credit due' : 'Reduced credit due',
      balance: number(row.running_balance),
      balanceLabel: 'Credit balance',
      meta: [row.invoice, paymentLabel(row.payment_method), row.recorded_by ? `By ${row.recorded_by}` : null].filter(Boolean),
      billId: row.bill_id || null,
    });
  }

  for (const [batchKey, rows] of paymentBatches) {
    const sorted = [...rows].sort((a, b) => (new Date(a.created_at) - new Date(b.created_at)) || (number(a.id) - number(b.id)));
    const last = sorted[sorted.length - 1];
    const total = round2(sorted.reduce((sum, r) => sum + number(r.credit), 0));
    const invoices = [...new Set(sorted.map((r) => r.invoice).filter(Boolean))];
    const multi = sorted.length > 1;
    events.push({
      id: `customer-payment-batch-${batchKey}`,
      at: last.created_at,
      kind: 'payment',
      tone: 'payment',
      title: 'Credit payment received',
      description: multi
        ? `Cleared ${invoices.length || sorted.length} bill${(invoices.length || sorted.length) === 1 ? '' : 's'}${invoices.length ? ` · ${invoices.join(', ')}` : ''}`
        : (last.note || (last.invoice ? `Paid against ${last.invoice}` : 'Customer payment recorded')),
      amount: total,
      amountLabel: 'Amount paid',
      balance: number(last.running_balance),
      balanceLabel: 'Credit balance',
      meta: [
        multi ? `${sorted.length} bills settled` : last.invoice,
        paymentLabel(last.payment_method),
        last.recorded_by ? `By ${last.recorded_by}` : null,
      ].filter(Boolean),
      allocations: sorted.map((row) => ({
        id: `customer-payment-allocation-${row.id}`,
        billId: row.bill_id || null,
        label: row.invoice || `Bill #${row.bill_id}`,
        amount: number(row.credit),
      })),
    });
  }

  return sortNewest(events);
}

function supplierLedgerTitle(row) {
  if (row.source_type === 'reversal') {
    return row.reversed_source_type === 'supplier_payment' ? 'Supplier payment reversed' : 'Supplier entry reversed';
  }
  if (row.source_type === 'supplier_payment') return 'Supplier payment posted';
  if (number(row.credit) > 0) return 'Supplier credit charged';
  if (number(row.debit) > 0) return 'Supplier payable reduced';
  return String(row.source_type || 'Payable adjustment').replaceAll('_', ' ');
}

export function buildSupplierCreditTimeline({ supplier = {}, purchases = [], ledger = [] } = {}) {
  const events = [];
  if (supplier.created_at) events.push({
    id: `supplier-${supplier.id || 'profile'}`,
    at: supplier.created_at,
    kind: 'profile',
    title: 'Supplier profile created',
    description: supplier.name || 'Supplier registered',
  });

  for (const purchase of purchases) events.push({
    id: `purchase-${purchase.id}`,
    at: purchase.created_at,
    effectiveDate: purchase.invoice_date || null,
    effectiveLabel: 'Invoice date',
    kind: purchase.status === 'voided' ? 'adjustment' : 'purchase',
    tone: purchase.status === 'voided' ? 'neutral' : 'charge',
    title: `${purchase.status === 'voided' ? 'Purchase voided' : 'Purchase received'} · ${purchase.invoice_number || `#${purchase.id}`}`,
    description: itemSummary(purchase.items) || purchase.notes || 'No item details recorded',
    amount: number(purchase.total),
    amountLabel: 'Purchase total',
    status: purchase.status,
    meta: [paymentLabel(purchase.payment_method), purchase.received_by_name ? `Received by ${purchase.received_by_name}` : null].filter(Boolean),
    purchaseId: purchase.id,
    actionLabel: 'View invoice details',
  });

  const creditPurchases = purchases
    .filter((purchase) => purchase.status !== 'voided' && ['credit', 'due', 'unpaid', 'payable'].includes(String(purchase.payment_method || '').toLowerCase()))
    .sort((a, b) => new Date(a.invoice_date || a.created_at) - new Date(b.invoice_date || b.created_at))
    .map((purchase) => ({ ...purchase, open: number(purchase.total) }));

  for (const row of ledger) {
    if (row.source_type !== 'supplier_payment' && row.source_type !== 'reversal') continue;
    const charged = number(row.credit) > 0;
    const paid = row.source_type === 'supplier_payment' ? number(row.debit) : 0;
    const paymentAt = new Date(row.created_at || `${row.entry_date}T23:59:59`).getTime();
    let remaining = paid;
    const allocations = [];
    for (const purchase of creditPurchases) {
      if (remaining <= 0.001) break;
      if (purchase.open <= 0.001) continue;
      if (new Date(purchase.created_at || `${purchase.invoice_date}T00:00:00`).getTime() > paymentAt) continue;
      const applied = Math.min(remaining, purchase.open);
      purchase.open = round2(purchase.open - applied);
      remaining = round2(remaining - applied);
      allocations.push({
        id: `supplier-payment-${row.journal_id}-purchase-${purchase.id}`,
        purchaseId: purchase.id,
        label: purchase.invoice_number || `Purchase #${purchase.id}`,
        amount: round2(applied),
      });
    }
    events.push({
      id: `supplier-ledger-${row.journal_id}-${row.source_type}-${row.debit}-${row.credit}`,
      at: row.created_at || `${row.entry_date}T00:00:00+05:45`,
      effectiveDate: row.entry_date,
      effectiveLabel: 'Ledger date',
      kind: row.source_type === 'supplier_payment' ? 'payment' : row.source_type === 'reversal' ? 'adjustment' : 'credit',
      tone: charged ? 'charge' : 'payment',
      title: supplierLedgerTitle(row),
      description: row.memo || 'Supplier payable ledger entry',
      amount: charged ? number(row.credit) : number(row.debit),
      amountLabel: charged ? 'Added to payable' : 'Reduced payable',
      balance: number(row.running_balance),
      balanceLabel: 'Payable balance',
      allocations,
    });
  }

  return sortNewest(events);
}
