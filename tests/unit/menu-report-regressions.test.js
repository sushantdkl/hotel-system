import test from 'node:test';
import assert from 'node:assert/strict';

import { buildReport, getItemCostMap } from '@/lib/reports.js';
import { comparisonTables } from '@/lib/report-shape.js';

function costDb(recipeLine) {
  return {
    async all(sql) {
      if (sql.includes('SELECT id, base_price FROM menu_items')) return [{ id: 7, base_price: 300 }];
      if (sql.includes('SELECT r.menu_item_id AS menu_item_id')) return [{ menu_item_id: 7, yield_quantity: 1, raw_material_id: 9, component_recipe_id: null, ...recipeLine }];
      return [];
    },
  };
}

test('menu food cost normalizes an obvious legacy kg-to-gram scale error', async () => {
  const costs = await getItemCostMap(costDb({
    quantity: 500,
    cost_per_unit: 610,
    conversion_factor: 1000,
    purchase_unit: 'kg',
    consumption_unit: 'g',
    latest_purchase_unit_cost: null,
  }));

  assert.equal(costs.get(7).cost, 305);
  assert.equal(costs.get(7).normalizedLegacyUnits, true);
});

test('menu food cost does not divide a correctly stored per-gram rate twice', async () => {
  const costs = await getItemCostMap(costDb({
    quantity: 500,
    cost_per_unit: 0.61,
    conversion_factor: 1000,
    purchase_unit: 'kg',
    consumption_unit: 'g',
    latest_purchase_unit_cost: null,
  }));

  assert.equal(costs.get(7).cost, 305);
  assert.equal(costs.get(7).normalizedLegacyUnits, false);
});

test('recipe quantities entered in the purchase unit are converted before costing', async () => {
  const costs = await getItemCostMap(costDb({
    quantity: 0.5,
    recipe_unit: 'kg',
    cost_per_unit: 0.61,
    conversion_factor: 1000,
    purchase_unit: 'kg',
    consumption_unit: 'g',
    latest_purchase_unit_cost: null,
  }));

  assert.equal(costs.get(7).cost, 305);
});

test('menu report table contains sold items only', async () => {
  const db = {
    driver: 'sqlite',
    async all(sql) {
      if (sql.includes('SELECT id, base_price FROM menu_items')) return [{ id: 1, base_price: 100 }, { id: 2, base_price: 200 }];
      if (sql.includes('SELECT r.menu_item_id AS menu_item_id')) return [];
      if (sql.includes('SUM(oi.quantity) AS quantity')) return [
        { menu_item_id: 1, name: 'Old sold-item name', quantity: 1, revenue: 100 },
        { menu_item_id: 1, name: 'Sold item', quantity: 2, revenue: 200 },
      ];
      if (sql.includes('SELECT mi.id, mi.name, mi.base_price')) return [
        { id: 1, name: 'Sold item', base_price: 100, category_name: 'Food', food_group: 'food' },
        { id: 2, name: 'Unsold item', base_price: 200, category_name: 'Food', food_group: 'food' },
      ];
      return [];
    },
    async get() { return {}; },
  };

  const report = await buildReport(db, 'menu', { start: '2026-09-13', end: '2026-09-13' }, {});
  assert.deepEqual(report.table.rows.map((row) => row.name), ['Sold item']);
  assert.equal(report.table.rows[0].quantity, 3);
  assert.equal(report.table.rows[0].revenue, 300);
  assert.match(report.table.empty, /sold/i);
});

test('comparison renders both singular and plural report table contracts', () => {
  assert.deepEqual(comparisonTables({ table: { title: 'Menu Performance', rows: [] } }), [
    { id: 'detail', title: 'Menu Performance', rows: [] },
  ]);
  assert.equal(comparisonTables({ tables: [{ id: 'ledger' }] })[0].id, 'ledger');
});
