import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePosItemInput } from '../../lib/pos-item-input.js';

test('custom POS items retain the operator-entered price when persisted', () => {
  assert.deepEqual(
    resolvePosItemInput({ item_name: '  Extra sauce  ', price: '75.50' }),
    { name: 'Extra sauce', price: 75.5 }
  );
});

test('catalog POS items always use the server-side menu price', () => {
  assert.deepEqual(
    resolvePosItemInput(
      { item_name: 'Fake name', price: 1 },
      { name: 'Momo', base_price: 240 }
    ),
    { name: 'Momo', price: 240 }
  );
});

test('custom POS items reject missing names and non-positive prices', () => {
  assert.throws(
    () => resolvePosItemInput({ item_name: ' ', price: 25 }),
    (error) => error.status === 400 && error.code === 'invalid_custom_item_name'
  );
  for (const price of ['', 0, -1, 'not-a-price']) {
    assert.throws(
      () => resolvePosItemInput({ item_name: 'Custom item', price }),
      (error) => error.status === 400 && error.code === 'invalid_custom_item_price'
    );
  }
});

