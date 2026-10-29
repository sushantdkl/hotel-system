import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomerCreditTimeline, buildSupplierCreditTimeline } from '../../lib/credit-timeline.js';

test('customer timeline is newest-first, shows one bill instead of order noise and does not duplicate credit payments', () => {
  const events = buildCustomerCreditTimeline({
    customer: { id: 4, name: 'Maya', created_at: '2026-08-01 08:00:00' },
    orders: [{
      id: 9,
      order_number: 'ORD-9',
      order_type: 'dine_in',
      total: 850,
      status: 'served',
      created_at: '2026-08-02 10:00:00',
      items: [{ item_name: 'Chicken Momo', variant_name: 'Steam', quantity: 2, status: 'served' }],
    }],
    bills: [{
      id: 11,
      order_id: 9,
      order_number: 'ORD-9',
      bill_number: 'BILL-11',
      grand_total: 850,
      outstanding_amount: 350,
      was_credit: true,
      payment_status: 'partially_paid',
      created_at: '2026-08-02 10:15:00',
    }],
    ledger: [{
      id: 20,
      bill_id: 11,
      payment_id: 31,
      type: 'credit_payment',
      credit: 500,
      debit: 0,
      running_balance: 350,
      invoice: 'BILL-11',
      payment_method: 'cash',
      created_at: '2026-08-03 09:00:00',
    }],
    payments: [{
      id: 31,
      amount: 500,
      method: 'cash',
      bill_number: 'BILL-11',
      created_at: '2026-08-03 09:00:00',
    }],
  });

  assert.equal(events[0].title, 'Credit payment received');
  assert.equal(events.filter((event) => event.kind === 'payment').length, 1);
  assert.equal(events.some((event) => event.kind === 'order'), false);
  assert.equal(events.find((event) => event.id === 'bill-11').billId, 11);
  assert.equal(events.at(-1).title, 'Customer profile created');
});

test('one bulk collection across many bills folds into a single payment event', () => {
  const events = buildCustomerCreditTimeline({
    customer: { id: 5, name: 'Ram', created_at: '2026-08-01 08:00:00' },
    ledger: [
      { id: 40, bill_id: 11, payment_id: 51, type: 'credit_payment', credit: 300, debit: 0, running_balance: 700, invoice: 'BILL-1', payment_method: 'cash', idempotency_key: 'batch-abc:11:300:cash:0:ledger', created_at: '2026-08-05 09:00:00' },
      { id: 41, bill_id: 12, payment_id: 52, type: 'credit_payment', credit: 400, debit: 0, running_balance: 300, invoice: 'BILL-2', payment_method: 'cash', idempotency_key: 'batch-abc:12:400:cash:0:ledger', created_at: '2026-08-05 09:00:00' },
      { id: 42, bill_id: 13, payment_id: 53, type: 'credit_payment', credit: 300, debit: 0, running_balance: 0, invoice: 'BILL-3', payment_method: 'cash', idempotency_key: 'batch-abc:13:300:cash:0:ledger', created_at: '2026-08-05 09:00:00' },
    ],
    payments: [],
  });

  const paymentEvents = events.filter((event) => event.kind === 'payment');
  assert.equal(paymentEvents.length, 1);
  assert.equal(paymentEvents[0].amount, 1000);
  assert.equal(paymentEvents[0].balance, 0);
  assert.match(paymentEvents[0].description, /Cleared 3 bills · BILL-1, BILL-2, BILL-3/);
  assert.deepEqual(paymentEvents[0].allocations.map((row) => row.billId), [11, 12, 13]);
});

test('supplier timeline includes purchased items, invoice date and running payable', () => {
  const events = buildSupplierCreditTimeline({
    supplier: { id: 7, name: 'Fresh Foods', created_at: '2026-07-01 08:00:00' },
    purchases: [{
      id: 12,
      invoice_number: 'INV-12',
      invoice_date: '2026-07-10',
      created_at: '2026-07-10 11:30:00',
      total: 4200,
      status: 'received',
      items: [{ item_name: 'Flour', purchase_unit: 'kg', quantity_received: 20 }],
    }],
    ledger: [{
      journal_id: 45,
      source_type: 'expense',
      entry_date: '2026-07-10',
      created_at: '2026-07-10 11:31:00',
      credit: 4200,
      debit: 0,
      running_balance: 4200,
      memo: 'Credit purchase INV-12',
    }],
  });

  assert.equal(events.some((event) => event.title === 'Supplier credit charged'), false);
  const purchase = events.find((event) => event.id === 'purchase-12');
  assert.equal(purchase.effectiveDate, '2026-07-10');
  assert.match(purchase.description, /20 kg × Flour/);
  assert.equal(purchase.purchaseId, 12);
});

test('supplier bulk payment lists the invoices it covered FIFO', () => {
  const events = buildSupplierCreditTimeline({
    purchases: [
      { id: 1, invoice_number: 'SUP-1', invoice_date: '2026-07-01', created_at: '2026-07-01 09:00:00', total: 300, status: 'received', payment_method: 'credit' },
      { id: 2, invoice_number: 'SUP-2', invoice_date: '2026-07-02', created_at: '2026-07-02 09:00:00', total: 500, status: 'received', payment_method: 'credit' },
    ],
    ledger: [{ journal_id: 9, source_type: 'supplier_payment', entry_date: '2026-07-03', created_at: '2026-07-03 10:00:00', debit: 600, credit: 0, running_balance: 200 }],
  });
  const payment = events.find((event) => event.kind === 'payment');
  assert.equal(payment.amount, 600);
  assert.deepEqual(payment.allocations.map(({ purchaseId, amount }) => ({ purchaseId, amount })), [{ purchaseId: 1, amount: 300 }, { purchaseId: 2, amount: 300 }]);
});
