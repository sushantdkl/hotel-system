import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'

import { calculatePromotionDiscount, ensurePromotionSchema, evaluatePromotion, listBadgePromotions, listScheduledWebsitePromotions, normalizePromotion, recalculatePromotionById, recordPromotionRedemption } from '../../lib/promotions.js'
import { promotionMenuBadgeLabel, sortCombosFirst } from '../../lib/promotion-display.js'

const items = [
  { menu_item_id: 1, category_id: 10, quantity: 2, price: 200, subtotal: 400 },
  { menu_item_id: 2, category_id: 20, quantity: 1, price: 300, subtotal: 300 },
]

test('menu offer labels show percent and rupee discounts and combos sort first', () => {
  assert.equal(promotionMenuBadgeLabel({ discount_type: 'percent', discount_value: 10 }), '10% off')
  assert.equal(promotionMenuBadgeLabel({ discount_type: 'fixed', discount_value: 75 }), 'Rs 75 off')
  const sorted = sortCombosFirst([{ id: 1, name: 'Momo' }, { id: 2, name: 'Family combo', combo: {} }])
  assert.equal(sorted[0].id, 2)
})

test('item/category offers with no targets never discount the whole bill', () => {
  assert.equal(calculatePromotionDiscount({ scope: 'item', discount_type: 'percent', discount_value: 50, target_ids: [] }, items, 700), 0)
  assert.equal(calculatePromotionDiscount({ scope: 'category', discount_type: 'fixed', discount_value: 500, target_ids: [] }, items, 700), 0)
})

test('category offer ignores items outside the selected categories', () => {
  const discount = calculatePromotionDiscount({ scope: 'category', discount_type: 'percent', discount_value: 10, target_ids: [10] }, items, 700)
  // Only the 400 in category 10 — not the full 700
  assert.equal(discount, 40)
})

test('order percentage offer respects its maximum discount', () => {
  const discount = calculatePromotionDiscount({ scope: 'order', discount_type: 'percent', discount_value: 20, maximum_discount_amount: 100, target_ids: [] }, items, 700)
  assert.equal(discount, 100)
})

test('category offer discounts only targeted menu value', () => {
  const discount = calculatePromotionDiscount({ scope: 'category', discount_type: 'percent', discount_value: 25, maximum_discount_amount: null, target_ids: [10] }, items, 700)
  assert.equal(discount, 100)
})

test('fixed item offer cannot exceed the eligible item subtotal', () => {
  const discount = calculatePromotionDiscount({ scope: 'item', discount_type: 'fixed', discount_value: 500, maximum_discount_amount: null, target_ids: [2] }, items, 700)
  assert.equal(discount, 300)
})

test('buy two get one free discounts the cheapest qualifying units', () => {
  const discount = calculatePromotionDiscount({
    offer_type: 'buy_x_get_y', scope: 'category', target_ids: [10],
    buy_quantity: 2, reward_quantity: 1, reward_discount_percent: 100,
  }, [
    { menu_item_id: 1, category_id: 10, quantity: 2, price: 200, subtotal: 400 },
    { menu_item_id: 3, category_id: 10, quantity: 1, price: 150, subtotal: 150 },
  ], 550)
  assert.equal(discount, 150)
})

test('database promotion JSON fields are normalized', () => {
  const result = normalizePromotion({ id: 4, channels: '["website"]', days_of_week: '["fri"]', auto_apply: 1, is_active: 1 }, [{ promotion_id: 4, target_id: 9 }])
  assert.deepEqual(result.channels, ['website'])
  assert.deepEqual(result.days_of_week, ['fri'])
  assert.deepEqual(result.target_ids, [9])
  assert.equal(result.auto_apply, true)
})

test('SQLite schema, eligibility lookup and redemption recording work together', async () => {
  const raw = new DatabaseSync(':memory:')
  raw.exec(`CREATE TABLE orders (id INTEGER PRIMARY KEY); CREATE TABLE bills (id INTEGER PRIMARY KEY);`)
  const db = {
    driver: 'sqlite',
    run: async (sql, params = []) => raw.prepare(sql).run(...params),
    get: async (sql, params = []) => raw.prepare(sql).get(...params),
    all: async (sql, params = []) => raw.prepare(sql).all(...params),
  }
  await ensurePromotionSchema(db)
  const inserted = await db.run(`INSERT INTO promotions
    (name, discount_type, discount_value, scope, minimum_order_amount, channels, auto_apply, is_active)
    VALUES (?, 'percent', 10, 'order', 500, '["website"]', 1, 1)`, ['Website ten'])
  const result = await evaluatePromotion(db, { channel: 'website', items: [{ subtotal: 800 }] })
  assert.equal(Number(result.id), Number(inserted.lastInsertRowid))
  assert.equal(result.discount, 80)
  await recordPromotionRedemption(db, { promotion: result, orderId: 12, channel: 'website' })
  const redemption = await db.get('SELECT * FROM promotion_redemptions')
  assert.equal(redemption.discount_amount, 80)
  await db.run('UPDATE promotions SET is_active = 0 WHERE id = ?', [inserted.lastInsertRowid])
  const historical = await recalculatePromotionById(db, { promotionId: inserted.lastInsertRowid, channel: 'website', items: [{ subtotal: 600 }] })
  assert.equal(historical.discount, 60)
  raw.close()
})

test('daily Nepal-time windows and total usage limits are enforced', async () => {
  const raw = new DatabaseSync(':memory:')
  raw.exec(`CREATE TABLE orders (id INTEGER PRIMARY KEY); CREATE TABLE bills (id INTEGER PRIMARY KEY, status TEXT);`)
  const db = {
    driver: 'sqlite',
    run: async (sql, params = []) => raw.prepare(sql).run(...params),
    get: async (sql, params = []) => raw.prepare(sql).get(...params),
    all: async (sql, params = []) => raw.prepare(sql).all(...params),
  }
  await ensurePromotionSchema(db)
  const inserted = await db.run(`INSERT INTO promotions
    (name, discount_type, discount_value, scope, channels, auto_apply, is_active, daily_start_time, daily_end_time, usage_limit)
    VALUES ('Lunch', 'percent', 10, 'order', '["pos"]', 1, 1, '11:00', '13:00', 1)`)
  // 06:15 UTC = 12:00 Nepal — exclusive end means off at 12:00 for an 11–13 window? 
  // 11:00–13:00 NPT: 06:15 UTC = 12:00 NPT which is inside [11:00, 13:00).
  const lunch = await evaluatePromotion(db, { channel: 'pos', items: [{ subtotal: 500 }], now: new Date('2026-08-31T06:15:00Z') })
  assert.equal(lunch.discount, 50)
  await recordPromotionRedemption(db, { promotion: lunch, orderId: 1, channel: 'pos' })
  const exhausted = await evaluatePromotion(db, { channel: 'pos', items: [{ subtotal: 500 }], now: new Date('2026-08-31T06:15:00Z') })
  assert.equal(exhausted, null)
  const outside = await recalculatePromotionById(db, { promotionId: inserted.lastInsertRowid, channel: 'pos', items: [{ subtotal: 500 }] })
  assert.equal(outside.discount, 50)
  // Outside the daily window → evaluate returns null (POS-style apply path).
  const beforeOpen = await evaluatePromotion(db, { channel: 'pos', items: [{ subtotal: 500 }], now: new Date('2026-08-31T04:30:00Z') })
  assert.equal(beforeOpen, null)
  raw.close()
})

test('menu badges only show while the offer is inside its daily window', async () => {
  const raw = new DatabaseSync(':memory:')
  raw.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY); CREATE TABLE bills (id INTEGER PRIMARY KEY);')
  const db = {
    driver: 'sqlite',
    run: async (sql, params = []) => raw.prepare(sql).run(...params),
    get: async (sql, params = []) => raw.prepare(sql).get(...params),
    all: async (sql, params = []) => raw.prepare(sql).all(...params),
  }
  await ensurePromotionSchema(db)
  await db.run(`INSERT INTO promotions
    (name, discount_type, discount_value, scope, channels, auto_apply, is_active, daily_start_time, daily_end_time)
    VALUES ('Morning only', 'percent', 25, 'order', '["website","pos"]', 1, 1, '07:00', '12:00')`)
  // 01:30 UTC = 07:15 Nepal — inside window
  assert.equal((await listBadgePromotions(db, { channel: 'pos', now: new Date('2026-09-09T01:30:00Z') })).length, 1)
  // 06:30 UTC = 12:15 Nepal — exclusive end, badge hidden
  assert.equal((await listBadgePromotions(db, { channel: 'pos', now: new Date('2026-09-09T06:30:00Z') })).length, 0)
  // Website marketing list still returns active rows when forMarketing is false
  assert.equal((await listScheduledWebsitePromotions(db, { now: new Date('2026-09-09T06:30:00Z') })).length, 1)
  assert.equal((await listScheduledWebsitePromotions(db, { now: new Date('2026-09-09T06:30:00Z'), forMarketing: true })).length, 0)
  raw.close()
})
