import test from 'node:test';
import assert from 'node:assert/strict';

import { formatReceiptMoney, normalizeSize, RECEIPT_SIZES } from '../../lib/print-receipt.js';

test('formatReceiptMoney groups thousands with two decimals, no prefix by default', () => {
  assert.equal(formatReceiptMoney(1045), '1,045.00');
  assert.equal(formatReceiptMoney(1005.5), '1,005.50');
});

test('formatReceiptMoney keeps large totals aligned (grouping survives 6-digit amounts)', () => {
  assert.equal(formatReceiptMoney(123456), '1,23,456.00');
});

test('formatReceiptMoney prefix option prints Rs. only when asked', () => {
  assert.equal(formatReceiptMoney(1005, { prefix: true }), 'Rs. 1,005.00');
  assert.equal(formatReceiptMoney(1005), '1,005.00');
});

test('formatReceiptMoney sign option marks deltas without doubling on positives', () => {
  assert.equal(formatReceiptMoney(180, { sign: true }), '+180.00');
  assert.equal(formatReceiptMoney(-180, { sign: true }), '−180.00');
  assert.equal(formatReceiptMoney(0, { sign: true }), '0.00');
});

test('formatReceiptMoney treats missing/invalid input as zero, never NaN', () => {
  assert.equal(formatReceiptMoney(undefined), '0.00');
  assert.equal(formatReceiptMoney(null), '0.00');
  assert.equal(formatReceiptMoney('not-a-number'), '0.00');
});

test('normalizeSize falls back to 80mm for unknown sizes', () => {
  assert.equal(normalizeSize('80mm'), '80');
  assert.equal(normalizeSize('58'), '58');
  assert.equal(normalizeSize('112'), '80');
  assert.equal(normalizeSize(), '80');
});

test('58mm and 80mm both define a full type scale', () => {
  for (const key of ['58', '80']) {
    const c = RECEIPT_SIZES[key];
    assert.ok(c.base > 0 && c.name > c.base && c.total > c.base);
  }
});
