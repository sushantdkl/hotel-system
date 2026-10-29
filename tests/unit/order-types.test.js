import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizedOrderType, orderTypeLabel, normalizedOrderTypeSql } from '../../lib/order-types.js';

test('table-less counter and legacy orders normalize to takeaway', () => {
  assert.equal(normalizedOrderType({ order_type: 'counter', table_id: null, table_number: null }), 'takeaway');
  assert.equal(normalizedOrderType({ order_type: null, table_id: null, table_number: '' }), 'takeaway');
  assert.equal(orderTypeLabel({ order_type: 'counter' }), 'Takeaway');
});

test('table-linked orders normalize to dine in and delivery remains delivery', () => {
  assert.equal(normalizedOrderType({ order_type: 'counter', table_id: 4 }), 'dine_in');
  assert.equal(normalizedOrderType({ order_type: 'takeaway', table_number: 'T-06' }), 'dine_in');
  assert.equal(normalizedOrderType({ order_type: 'delivery', table_id: null }), 'delivery');
  assert.equal(orderTypeLabel({ order_type: 'delivery' }), 'Delivery');
});

test('report SQL uses the same table-less takeaway rule', () => {
  const sql = normalizedOrderTypeSql('o');
  assert.match(sql, /order_type/);
  assert.match(sql, /table_id IS NULL/);
  assert.match(sql, /table_number/);
  assert.match(sql, /'takeaway'/);
});
