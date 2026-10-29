import test from 'node:test';
import assert from 'node:assert/strict';
import { customerLabel, stockLine, summarizeSales } from '../../lib/category-sales.js';

test('customer is the saved name, else walk-in / takeaway / delivery', () => {
  assert.equal(customerLabel({ customer_name: 'Ram Thapa', order_type: 'dine_in' }), 'Ram Thapa');
  assert.equal(customerLabel({ customer_name: 'Walk-in Customer', order_type: 'dine_in' }), 'Walk-in');
  assert.equal(customerLabel({ customer_name: '', order_type: 'takeaway' }), 'Takeaway');
  assert.equal(customerLabel({ customer_name: null, order_type: 'delivery' }), 'Delivery');
});

test('sales summary totals by item (with variant), customer and category', () => {
  const line = (bill_id, name, variant_name, category_name, quantity, revenue, customer_name, order_type = 'dine_in') =>
    ({ bill_id, name, variant_name, category_name, quantity, revenue, customer_name, order_type });
  const s = summarizeSales([
    line(1, 'Old Durbar', '60ml', 'Liquor', 2, 600, 'Ram'),
    line(1, 'Gorkha Beer', null, 'Beer', 1, 450, 'Ram'),
    line(2, 'Old Durbar', '60ml', 'Liquor', 1, 300, null, 'takeaway'),
    line(3, 'Old Durbar', '30ml', 'Liquor', 1, 160, 'Walk-in Customer'),
  ]);
  assert.deepEqual(s.totals, { quantity: 5, amount: 1510, bills: 3 });
  assert.deepEqual(s.items.map((r) => [r.name, r.variant, r.quantity, r.amount]),
    [['Old Durbar', '60ml', 3, 900], ['Gorkha Beer', null, 1, 450], ['Old Durbar', '30ml', 1, 160]]);
  assert.deepEqual(s.customers.map((r) => [r.name, r.bills, r.quantity, r.amount]),
    [['Ram', 1, 3, 1050], ['Takeaway', 1, 1, 300], ['Walk-in', 1, 1, 160]]);
  assert.deepEqual(s.categories.map((r) => [r.name, r.amount]), [['Liquor', 1060], ['Beer', 450]]);
});

test('stock line: opening + purchased − sold ± other = closing, from on-hand and the ledger', () => {
  // 750 ml bottles; 1,500 ml on hand now. In the period: +2 bottles bought, 900 ml sold,
  // 60 ml voided back, 30 ml spilled. After the period another 60 ml sold.
  const row = stockLine(
    { id: 7, name: 'Old Durbar', quantity: 1500, consumption_unit: 'ml', purchase_unit: 'bottle', conversion_factor: 750, cost_per_unit: 2 },
    [
      { change_type: 'purchase_receipt', in_period: 1500, after_period: 0, variance: 0 },
      { change_type: 'order_deduction', in_period: -900, after_period: -60, variance: 30 },
      { change_type: 'order_void', in_period: 60, after_period: 0, variance: 0 },
      { change_type: 'wastage', in_period: -30, after_period: 0, variance: 0 },
    ]
  );
  assert.equal(row.closing, 1560);
  assert.equal(row.opening, 1560 - (1500 - 900 + 60 - 30));
  assert.deepEqual([row.purchased, row.sold, row.returned, row.wastage, row.adjusted], [1500, 900, 60, 30, 0]);
  assert.equal(row.opening + row.purchased - row.sold + row.returned - row.wastage + row.adjusted, row.closing);
  assert.equal(row.oversold, 30);
  assert.equal(row.factor, 750);
  assert.equal(row.purchase_unit, 'bottle');
});
