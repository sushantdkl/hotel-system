import test from 'node:test';
import assert from 'node:assert/strict';

import { analyticsMenuRowKey } from '../../lib/analytics.js';

test('analytics sales rows remain unique when one menu item id has historical names', () => {
  const rows = [
    { menu_item_id: 37, item: 'Chicken Momo', category: 'Momo' },
    { menu_item_id: 37, item: 'Chicken Steam Momo', category: 'Momo' },
  ];

  const keys = rows.map(analyticsMenuRowKey);
  assert.equal(new Set(keys).size, rows.length);
});

test('analytics sales rows remain unique when unlinked snapshots share a category', () => {
  const rows = [
    { menu_item_id: null, item: 'Legacy Chowmein', category: 'Fast Food' },
    { menu_item_id: null, item: 'Legacy Thukpa', category: 'Fast Food' },
  ];

  const keys = rows.map(analyticsMenuRowKey);
  assert.equal(new Set(keys).size, rows.length);
});
