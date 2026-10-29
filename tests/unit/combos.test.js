import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'

import { comboAvailableOn, createComboSnapshot, ensureComboSchema, expandComboItems, getCombosForMenuItems } from '../../lib/combos.js'

function memoryDb() {
  const raw = new DatabaseSync(':memory:')
  raw.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    CREATE TABLE menu_items (id INTEGER PRIMARY KEY, name TEXT, base_price REAL, is_available INTEGER DEFAULT 1);
    CREATE TABLE menu_item_variants (id INTEGER PRIMARY KEY, menu_item_id INTEGER, variant_name TEXT, price REAL, price_modifier REAL DEFAULT 0);
    CREATE TABLE kot_items (id INTEGER PRIMARY KEY);
  `)
  return {
    raw,
    db: {
      driver: 'sqlite',
      run: async (sql, params = []) => raw.prepare(sql).run(...params),
      get: async (sql, params = []) => raw.prepare(sql).get(...params),
      all: async (sql, params = []) => raw.prepare(sql).all(...params),
    },
  }
}

test('combo expands into its real component quantities and variants', async () => {
  const { raw, db } = memoryDb()
  await ensureComboSchema(db)
  raw.exec(`
    INSERT INTO menu_items VALUES (1, 'Meal Deal', 500, 1, 1);
    INSERT INTO menu_items VALUES (2, 'Momo', 220, 1, 0);
    INSERT INTO menu_items VALUES (3, 'Cold Drink', 100, 1, 0);
    INSERT INTO menu_item_variants (id, menu_item_id, variant_name, price) VALUES (1, 3, 'Large', 150);
    INSERT INTO menu_combos (id, menu_item_id, channels, is_active) VALUES (1, 1, '["pos","website"]', 1);
    INSERT INTO menu_combo_items (combo_id, component_menu_item_id, quantity, display_order) VALUES (1, 2, 2, 0);
    INSERT INTO menu_combo_items (combo_id, component_menu_item_id, variant_name, quantity, display_order) VALUES (1, 3, 'Large', 1, 1);
  `)
  const expanded = await expandComboItems(db, [{ menu_item_id: 1, item_name: 'Meal Deal', quantity: 3 }], { requireAvailable: true })
  assert.deepEqual(expanded.map((row) => [row.menu_item_id, row.variant_name, row.quantity]), [[2, null, 6], [3, 'Large', 3]])
  const combos = await getCombosForMenuItems(db, [1])
  assert.equal(combos.get(1).original_price, 590)
  assert.equal(comboAvailableOn(combos.get(1), 'pos'), true)
  assert.equal(comboAvailableOn(combos.get(1), 'qr'), false)
  raw.close()
})

test('ordering a combo fails clearly when a component is unavailable', async () => {
  const { raw, db } = memoryDb()
  await ensureComboSchema(db)
  raw.exec(`
    INSERT INTO menu_items VALUES (1, 'Meal Deal', 500, 1, 1);
    INSERT INTO menu_items VALUES (2, 'Momo', 220, 0, 0);
    INSERT INTO menu_combos (id, menu_item_id, channels, is_active) VALUES (1, 1, '["pos"]', 1);
    INSERT INTO menu_combo_items (combo_id, component_menu_item_id, quantity) VALUES (1, 2, 1);
  `)
  await assert.rejects(() => expandComboItems(db, [{ menu_item_id: 1, item_name: 'Meal Deal', quantity: 1 }], { requireAvailable: true }), /Momo.*unavailable/)
  raw.close()
})

test('saved combo snapshot survives later admin component edits', async () => {
  const { raw, db } = memoryDb()
  await ensureComboSchema(db)
  raw.exec(`
    INSERT INTO menu_items VALUES (1, 'Meal Deal', 500, 1, 1);
    INSERT INTO menu_items VALUES (2, 'Original Drink', 100, 1, 0);
    INSERT INTO menu_items VALUES (3, 'New Drink', 120, 1, 0);
    INSERT INTO menu_combos (id, menu_item_id, channels, is_active) VALUES (1, 1, '["pos"]', 1);
    INSERT INTO menu_combo_items (combo_id, component_menu_item_id, quantity) VALUES (1, 2, 1);
  `)
  const snapshot = await createComboSnapshot(db, { menu_item_id: 1, item_name: 'Meal Deal' }, { channel: 'pos' })
  raw.exec('DELETE FROM menu_combo_items; INSERT INTO menu_combo_items (combo_id, component_menu_item_id, quantity) VALUES (1, 3, 1);')
  const restored = await expandComboItems(db, [{ menu_item_id: 1, item_name: 'Meal Deal', quantity: 2, combo_snapshot: snapshot }])
  assert.deepEqual(restored.map((row) => [row.menu_item_id, row.quantity]), [[2, 2]])
  raw.close()
})
