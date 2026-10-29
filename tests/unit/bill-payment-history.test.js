import test from 'node:test';
import assert from 'node:assert/strict';
import { billPaymentHistory } from '../../lib/bill-payment-history.js';

test('payment history shows allocations instead of repeating their backing payment', () => {
  const payments = [{ id: 1, method: 'cash', amount: 790 }];
  const allocations = [{ id: 8, method: 'cash', amount: 790 }];
  assert.deepEqual(billPaymentHistory(payments, allocations), allocations);
});

test('payment history falls back to legacy payments and hides failed settlements', () => {
  const payments = [
    { id: 1, method: 'cash', amount: 790 },
    { id: 2, method: 'card', amount: 10, settlementStatus: 'failed' },
  ];
  assert.deepEqual(billPaymentHistory(payments, []), [payments[0]]);
});
