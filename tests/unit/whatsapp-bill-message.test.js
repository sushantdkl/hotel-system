import test from 'node:test';
import assert from 'node:assert/strict';
import { billMessage, creditBillsMessage, fillTemplate, whatsappLink } from '../../lib/whatsapp.js';

test('billMessage lists active items, totals and balance due', () => {
  const text = billMessage({
    billNumber: 'B-12',
    createdAt: '2026-10-10T10:00:00Z',
    items: [
      { name: 'Chicken Momo', variant: 'Steam', quantity: 2, total: 500 },
      { name: 'Coke', quantity: 1, total: 100, status: 'voided' },
    ],
    totals: { subtotal: 500, discount: 50, tax: 0, serviceCharge: 0, grandTotal: 450, paid: 200, balance: 250 },
  }, 'Raithane');
  assert.match(text, /^\*Raithane\*\nBill B-12/);
  assert.match(text, /2 x Chicken Momo \(Steam\) — Rs 500\.00/);
  assert.doesNotMatch(text, /Coke/);
  assert.match(text, /Discount: -Rs 50\.00/);
  assert.match(text, /\*Total: Rs 450\.00\*/);
  assert.match(text, /\*Balance due: Rs 250\.00\*/);
  assert.doesNotMatch(text, /VAT|Service charge/);
});

test('creditBillsMessage itemises each open bill and sums the due', () => {
  const text = creditBillsMessage([
    { bill_number: 'B-1', created_at: '2026-10-01T10:00:00Z', grand_total: 300, outstanding_amount: 300, items: [{ item_name: 'Thali', quantity: 1, subtotal: 300 }] },
    { bill_number: 'B-2', created_at: '2026-10-02T10:00:00Z', grand_total: 500, outstanding_amount: 200, items: [] },
  ]);
  assert.match(text, /Bill B-1 .* due Rs 300\.00 of Rs 300\.00\n {3}1 x Thali — Rs 300\.00/);
  assert.match(text, /due Rs 200\.00 of Rs 500\.00/);
  assert.match(text, /\*Total due: Rs 500\.00\*$/);
  assert.equal(creditBillsMessage([]), '');
});

test('{bills} fills in and an empty one leaves no trailing blank lines', () => {
  assert.equal(fillTemplate('Hi {name}\n\n{bills}', { name: 'Asha', bills: '' }), 'Hi Asha');
  assert.equal(fillTemplate('Hi {name}\n\n{bills}', { name: 'Asha', bills: 'X' }), 'Hi Asha\n\nX');
});

test('whatsappLink falls back to the chat picker without a number', () => {
  assert.equal(whatsappLink('9800000001', 'hi'), 'https://wa.me/9779800000001?text=hi');
  assert.equal(whatsappLink('', 'hi'), 'https://wa.me/?text=hi');
  assert.equal(whatsappLink('', ''), '');
});
