import { ensureSqliteTable } from '@/lib/db/ensure-sqlite-table.js'
import { ensureColumn } from '@/lib/db/schema-helpers.js'
import { isPromotionScheduledNow } from '@/lib/promotion-display.js'

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100
const validChannels = new Set(['pos', 'website', 'qr'])

function jsonArray(value, fallback = []) {
  if (Array.isArray(value)) return value
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

export function normalizePromotion(row, targets = []) {
  const scope = ['order', 'category', 'item'].includes(String(row.scope || ''))
    ? String(row.scope)
    : 'order'
  const targetIds = targets
    .filter((target) => Number(target.promotion_id) === Number(row.id))
    .filter((target) => !target.target_type || target.target_type === scope || scope === 'order')
    .map((target) => Number(target.target_id))
    .filter((id) => Number.isInteger(id) && id > 0)
  return {
    ...row,
    id: Number(row.id),
    scope,
    discount_value: Number(row.discount_value || 0),
    offer_type: row.offer_type || 'discount',
    buy_quantity: Math.max(1, Number(row.buy_quantity || 1)),
    reward_quantity: Math.max(1, Number(row.reward_quantity || 1)),
    reward_discount_percent: Math.max(0, Math.min(100, Number(row.reward_discount_percent ?? 100))),
    minimum_order_amount: Number(row.minimum_order_amount || 0),
    maximum_discount_amount: row.maximum_discount_amount == null || row.maximum_discount_amount === '' ? null : Number(row.maximum_discount_amount),
    auto_apply: Boolean(Number(row.auto_apply)),
    is_active: Boolean(Number(row.is_active)),
    daily_start_time: row.daily_start_time || null,
    daily_end_time: row.daily_end_time || null,
    usage_limit: row.usage_limit == null ? null : Number(row.usage_limit),
    per_customer_limit: row.per_customer_limit == null ? null : Number(row.per_customer_limit),
    stackable: Boolean(Number(row.stackable)),
    image_url: row.image_url || null,
    website_featured: Boolean(Number(row.website_featured)),
    days_of_week: jsonArray(row.days_of_week),
    channels: jsonArray(row.channels, ['pos', 'website', 'qr']).filter((channel) => validChannels.has(channel)),
    target_ids: targetIds,
  }
}

export async function ensurePromotionSchema(db) {
  await ensureSqliteTable(db, `
    CREATE TABLE IF NOT EXISTS promotions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, code TEXT, description TEXT,
      discount_type TEXT NOT NULL, discount_value REAL NOT NULL, scope TEXT NOT NULL,
      minimum_order_amount REAL DEFAULT 0, maximum_discount_amount REAL,
      starts_at DATETIME, ends_at DATETIME, days_of_week TEXT DEFAULT '[]',
      channels TEXT DEFAULT '["pos","website","qr"]', auto_apply INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1, created_by INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await ensureSqliteTable(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_promotions_code_unique ON promotions(UPPER(code)) WHERE code IS NOT NULL AND code <> ''`)
  await ensureSqliteTable(db, `
    CREATE TABLE IF NOT EXISTS promotion_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT, promotion_id INTEGER NOT NULL, target_type TEXT NOT NULL,
      target_id INTEGER NOT NULL, UNIQUE(promotion_id, target_type, target_id),
      FOREIGN KEY (promotion_id) REFERENCES promotions(id) ON DELETE CASCADE
    )
  `)
  await ensureSqliteTable(db, `
    CREATE TABLE IF NOT EXISTS promotion_redemptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, promotion_id INTEGER NOT NULL, order_id INTEGER, bill_id INTEGER,
      promotion_name TEXT NOT NULL, promotion_code TEXT, channel TEXT NOT NULL,
      discount_amount REAL NOT NULL, customer_phone TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await ensureColumn(db, 'orders', 'promotion_id', 'INTEGER')
  await ensureColumn(db, 'orders', 'promotion_code', 'TEXT')
  await ensureColumn(db, 'orders', 'promotion_channel', 'TEXT')
  await ensureColumn(db, 'orders', 'discount_amount', 'REAL DEFAULT 0')
  await ensureColumn(db, 'bills', 'promotion_id', 'INTEGER')
  await ensureColumn(db, 'bills', 'promotion_code', 'TEXT')
  await ensureColumn(db, 'promotions', 'offer_type', "TEXT DEFAULT 'discount'")
  await ensureColumn(db, 'promotions', 'buy_quantity', 'INTEGER DEFAULT 1')
  await ensureColumn(db, 'promotions', 'reward_quantity', 'INTEGER DEFAULT 1')
  await ensureColumn(db, 'promotions', 'reward_discount_percent', 'REAL DEFAULT 100')
  await ensureColumn(db, 'promotions', 'daily_start_time', 'TEXT')
  await ensureColumn(db, 'promotions', 'daily_end_time', 'TEXT')
  await ensureColumn(db, 'promotions', 'usage_limit', 'INTEGER')
  await ensureColumn(db, 'promotions', 'per_customer_limit', 'INTEGER')
  await ensureColumn(db, 'promotions', 'stackable', 'INTEGER DEFAULT 0')
  await ensureColumn(db, 'promotions', 'image_url', 'TEXT')
  await ensureColumn(db, 'promotions', 'website_featured', 'INTEGER DEFAULT 0')
}

/**
 * Active website-channel promotions. Public listings and checkout both respect
 * the configured schedule, so future and expired offers cannot be advertised.
 */
export async function listScheduledWebsitePromotions(
  db,
  { now = new Date(), forMarketing = false } = {},
) {
  await ensurePromotionSchema(db)
  const rows = await db.all('SELECT * FROM promotions WHERE is_active = 1 ORDER BY created_at DESC')
  if (!rows.length) return []
  const ids = rows.map((row) => Number(row.id))
  const placeholders = ids.map(() => '?').join(',')
  const targets = await db.all(`SELECT * FROM promotion_targets WHERE promotion_id IN (${placeholders})`, ids)
  return rows
    .map((row) => normalizePromotion(row, targets))
    .filter((promotion) => promotion.channels.includes('website') && (!forMarketing || isPromotionScheduledNow(promotion, now)))
}

/**
 * Active auto-apply offers used for % / Rs-off badges on menu cards.
 * Badges only show while the offer is redeemable now (same Nepal schedule as apply).
 */
export async function listBadgePromotions(db, { channel = 'website', now = new Date() } = {}) {
  if (!validChannels.has(channel)) return []
  await ensurePromotionSchema(db)
  const rows = await db.all(
    'SELECT * FROM promotions WHERE is_active = 1 AND auto_apply = 1 ORDER BY created_at DESC',
  )
  if (!rows.length) return []
  const ids = rows.map((row) => Number(row.id))
  const placeholders = ids.map(() => '?').join(',')
  const targets = await db.all(`SELECT * FROM promotion_targets WHERE promotion_id IN (${placeholders})`, ids)
  return rows
    .map((row) => normalizePromotion(row, targets))
    .filter((promotion) => promotion.channels.includes(channel) && isPromotionScheduledNow(promotion, now))
}

export async function resolveMenuLinesForPromotion(db, incoming = []) {
  const items = []
  for (const line of incoming) {
    const id = Number(line.menu_item_id || line.id)
    const quantity = Math.max(1, Math.min(50, parseInt(line.quantity, 10) || 1))
    if (!id) continue
    const item = await db.get('SELECT id, category_id, base_price, is_available FROM menu_items WHERE id = ?', [id])
    if (!item?.is_available) continue
    let price = Number(item.base_price)
    if (line.variant_name) {
      const variant = await db.get('SELECT price, price_modifier FROM menu_item_variants WHERE menu_item_id = ? AND variant_name = ?', [id, String(line.variant_name)])
      if (!variant) continue
      price = variant.price != null ? Number(variant.price) : price + Number(variant.price_modifier || 0)
    }
    items.push({ menu_item_id: id, category_id: item.category_id, price, quantity, subtotal: price * quantity })
  }
  return items
}

function isScheduledNow(promotion, now = new Date()) {
  return isPromotionScheduledNow(promotion, now)
}

/** True when this cart line is inside the offer's item/category target list. */
export function lineMatchesPromotion(promotion, item) {
  const scope = promotion?.scope || 'order'
  if (scope === 'order') return true
  const targets = new Set((promotion?.target_ids || []).map(Number).filter((id) => id > 0))
  if (!targets.size) return false
  const menuId = Number(item?.menu_item_id ?? item?.item_id ?? 0)
  const categoryId = Number(item?.category_id ?? 0)
  if (scope === 'item') return menuId > 0 && targets.has(menuId)
  if (scope === 'category') return categoryId > 0 && targets.has(categoryId)
  return false
}

/**
 * Spread an offer across only the lines it targets.
 * Item/category offers with no targets (misconfigured) give Rs 0 — never the whole bill.
 */
export function allocatePromotionLines(promotion, items = []) {
  const scope = promotion?.scope || 'order'
  const targets = new Set((promotion?.target_ids || []).map(Number).filter((id) => id > 0))
  if (scope !== 'order' && !targets.size) {
    return { discount: 0, eligibleSubtotal: 0, lines: (items || []).map((item, index) => ({
      index,
      menu_item_id: Number(item.menu_item_id ?? item.item_id ?? 0) || null,
      category_id: Number(item.category_id ?? 0) || null,
      quantity: Number(item.quantity || 0),
      subtotal: round2(Number(item.subtotal ?? Number(item.price || 0) * Number(item.quantity || 0))),
      eligible: false,
      line_discount: 0,
    })) }
  }

  const lines = (items || []).map((item, index) => {
    const subtotal = round2(Number(item.subtotal ?? Number(item.price || 0) * Number(item.quantity || 0)))
    const eligible = lineMatchesPromotion(promotion, item)
    return {
      index,
      menu_item_id: Number(item.menu_item_id ?? item.item_id ?? 0) || null,
      category_id: Number(item.category_id ?? 0) || null,
      order_item_id: item.order_item_id != null ? Number(item.order_item_id) : null,
      quantity: Number(item.quantity || 0),
      price: Number(item.price || 0),
      subtotal,
      eligible,
      line_discount: 0,
    }
  })

  const eligibleSubtotal = round2(lines.filter((line) => line.eligible).reduce((sum, line) => sum + line.subtotal, 0))
  if (eligibleSubtotal <= 0) return { discount: 0, eligibleSubtotal: 0, lines }

  let discount = 0
  if (promotion.offer_type === 'buy_x_get_y') {
    const eligible = lines
      .filter((line) => line.eligible)
      .map((line) => ({ quantity: Math.max(0, line.quantity), price: Math.max(0, line.price), index: line.index }))
      .filter((line) => line.quantity > 0)
    const totalQuantity = eligible.reduce((sum, line) => sum + line.quantity, 0)
    const buy = Math.max(1, Number(promotion.buy_quantity || 1))
    const reward = Math.max(1, Number(promotion.reward_quantity || 1))
    let rewardUnits = Math.floor(totalQuantity / (buy + reward)) * reward
    let rewardValue = 0
    const unitDiscount = new Map()
    for (const line of eligible.sort((a, b) => a.price - b.price)) {
      if (rewardUnits <= 0) break
      const used = Math.min(rewardUnits, line.quantity)
      const value = used * line.price * Number(promotion.reward_discount_percent ?? 100) / 100
      rewardValue += value
      unitDiscount.set(line.index, (unitDiscount.get(line.index) || 0) + value)
      rewardUnits -= used
    }
    discount = round2(Math.min(eligibleSubtotal, rewardValue))
    for (const line of lines) {
      if (unitDiscount.has(line.index)) line.line_discount = round2(unitDiscount.get(line.index))
    }
  } else {
    discount = promotion.discount_type === 'percent'
      ? eligibleSubtotal * Number(promotion.discount_value || 0) / 100
      : Number(promotion.discount_value || 0)
    if (promotion.maximum_discount_amount != null) discount = Math.min(discount, Number(promotion.maximum_discount_amount))
    discount = round2(Math.min(eligibleSubtotal, Math.max(0, discount)))
    // Spread proportionally across eligible lines so POS can show per-item savings.
    let remaining = discount
    const eligible = lines.filter((line) => line.eligible && line.subtotal > 0)
    eligible.forEach((line, idx) => {
      const share = idx === eligible.length - 1
        ? remaining
        : round2(discount * (line.subtotal / eligibleSubtotal))
      line.line_discount = Math.min(line.subtotal, Math.max(0, share))
      remaining = round2(remaining - line.line_discount)
    })
  }

  return { discount, eligibleSubtotal, lines }
}

export function calculatePromotionDiscount(promotion, items, orderSubtotal) {
  // orderSubtotal kept for call-site compatibility; discount is always from eligible lines only.
  void orderSubtotal
  return allocatePromotionLines(promotion, items).discount
}

export async function evaluatePromotion(db, { items = [], channel = 'pos', couponCode = '', customerPhone = '', now = new Date() } = {}) {
  await ensurePromotionSchema(db)
  const code = String(couponCode || '').trim().toUpperCase()
  const rows = code
    ? await db.all(`SELECT * FROM promotions WHERE is_active = 1 AND UPPER(COALESCE(code,'')) = ?`, [code])
    : await db.all(`SELECT * FROM promotions WHERE is_active = 1 AND auto_apply = 1`)
  if (!rows.length) return null
  const ids = rows.map((row) => Number(row.id))
  const placeholders = ids.map(() => '?').join(',')
  const targets = ids.length ? await db.all(`SELECT * FROM promotion_targets WHERE promotion_id IN (${placeholders})`, ids) : []
  let usage = []
  if (ids.length) {
    try {
      usage = await db.all(`
        SELECT pr.promotion_id, COUNT(*) AS uses
          FROM promotion_redemptions pr
          LEFT JOIN bills b ON b.id = pr.bill_id
         WHERE pr.promotion_id IN (${placeholders})
           AND (pr.bill_id IS NULL OR LOWER(COALESCE(b.status,'')) NOT IN ('void','voided','cancelled','canceled'))
         GROUP BY pr.promotion_id`, ids)
    } catch {
      usage = await db.all(`SELECT promotion_id, COUNT(*) AS uses FROM promotion_redemptions WHERE promotion_id IN (${placeholders}) GROUP BY promotion_id`, ids)
    }
  }
  const usageMap = new Map(usage.map((row) => [Number(row.promotion_id), Number(row.uses || 0)]))
  const phone = String(customerPhone || '').replace(/\s+/g, '')
  const customerUsage = phone && ids.length ? await db.all(`
    SELECT promotion_id, COUNT(*) AS uses FROM promotion_redemptions
     WHERE promotion_id IN (${placeholders}) AND customer_phone = ? GROUP BY promotion_id`, [...ids, phone]) : []
  const customerUsageMap = new Map(customerUsage.map((row) => [Number(row.promotion_id), Number(row.uses || 0)]))
  const subtotal = round2(items.reduce((sum, item) => sum + Number(item.subtotal ?? Number(item.price || 0) * Number(item.quantity || 0)), 0))
  const eligible = rows
    .map((row) => normalizePromotion(row, targets))
    // Item/category offers with no targets are misconfigured — never treat as whole-bill.
    .filter((promotion) => promotion.scope === 'order' || (promotion.target_ids || []).length > 0)
    .filter((promotion) => promotion.channels.includes(channel) && isScheduledNow(promotion, now) && subtotal >= promotion.minimum_order_amount)
    .filter((promotion) => promotion.usage_limit == null || (usageMap.get(promotion.id) || 0) < promotion.usage_limit)
    .filter((promotion) => !phone || promotion.per_customer_limit == null || (customerUsageMap.get(promotion.id) || 0) < promotion.per_customer_limit)
    .map((promotion) => {
      const allocated = allocatePromotionLines(promotion, items)
      return { promotion, discount: allocated.discount, eligibleSubtotal: allocated.eligibleSubtotal, lines: allocated.lines }
    })
    .filter((result) => result.discount > 0)
    .sort((a, b) => b.discount - a.discount)
  if (!eligible.length) return null
  const best = eligible[0]
  return {
    id: best.promotion.id,
    name: best.promotion.name,
    code: best.promotion.code || null,
    discount: best.discount,
    description: best.promotion.description || '',
    scope: best.promotion.scope,
    offer_type: best.promotion.offer_type,
    discount_type: best.promotion.discount_type,
    discount_value: best.promotion.discount_value,
    target_ids: best.promotion.target_ids || [],
    eligible_subtotal: best.eligibleSubtotal,
    lines: best.lines,
    subtotal,
  }
}

/** Recalculate the promotion already attached to an order/bill after edits or reopening. */
export async function recalculatePromotionById(db, { promotionId, items = [], channel = 'pos' } = {}) {
  const id = Number(promotionId || 0)
  if (!id) return null
  await ensurePromotionSchema(db)
  const row = await db.get('SELECT * FROM promotions WHERE id = ?', [id])
  if (!row) return null
  const targets = await db.all('SELECT * FROM promotion_targets WHERE promotion_id = ?', [id])
  const promotion = normalizePromotion(row, targets)
  if (promotion.scope !== 'order' && !(promotion.target_ids || []).length) return null
  const subtotal = round2(items.reduce((sum, item) => sum + Number(item.subtotal ?? Number(item.price || 0) * Number(item.quantity || 0)), 0))
  if (subtotal < promotion.minimum_order_amount) return null
  const allocated = allocatePromotionLines(promotion, items)
  if (!(allocated.discount > 0)) return null
  return {
    id,
    name: promotion.name,
    code: promotion.code || null,
    discount: allocated.discount,
    description: promotion.description || '',
    scope: promotion.scope,
    offer_type: promotion.offer_type,
    discount_type: promotion.discount_type,
    discount_value: promotion.discount_value,
    target_ids: promotion.target_ids || [],
    eligible_subtotal: allocated.eligibleSubtotal,
    lines: allocated.lines,
    channel,
    subtotal,
  }
}

export async function recordPromotionRedemption(db, { promotion, orderId = null, billId = null, channel, customerPhone = null }) {
  if (!promotion?.id || !(promotion.discount > 0)) return
  if (orderId) {
    const existing = await db.get('SELECT id FROM promotion_redemptions WHERE promotion_id = ? AND order_id = ? LIMIT 1', [promotion.id, orderId])
    if (existing) {
      if (billId) await db.run('UPDATE promotion_redemptions SET bill_id = COALESCE(bill_id, ?) WHERE id = ?', [billId, existing.id])
      return
    }
  }
  // Recheck limits inside the checkout transaction. Preview-time checks are
  // helpful UI, but cannot protect against two terminals redeeming the final
  // use concurrently or a POS checkout that identifies the customer later.
  const rule = await db.get('SELECT usage_limit, per_customer_limit FROM promotions WHERE id = ?', [promotion.id])
  if (rule?.usage_limit != null) {
    const total = await db.get('SELECT COUNT(*) AS uses FROM promotion_redemptions WHERE promotion_id = ?', [promotion.id])
    if (Number(total?.uses || 0) >= Number(rule.usage_limit)) {
      throw Object.assign(new Error('This offer has reached its total usage limit.'), { status: 409, code: 'promotion_limit_reached' })
    }
  }
  const normalizedPhone = String(customerPhone || '').replace(/\s+/g, '')
  if (normalizedPhone && rule?.per_customer_limit != null) {
    const customer = await db.get('SELECT COUNT(*) AS uses FROM promotion_redemptions WHERE promotion_id = ? AND customer_phone = ?', [promotion.id, normalizedPhone])
    if (Number(customer?.uses || 0) >= Number(rule.per_customer_limit)) {
      throw Object.assign(new Error('This customer has already used this offer the maximum number of times.'), { status: 409, code: 'promotion_customer_limit_reached' })
    }
  }
  await db.run(
    `INSERT INTO promotion_redemptions
      (promotion_id, order_id, bill_id, promotion_name, promotion_code, channel, discount_amount, customer_phone)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [promotion.id, orderId, billId, promotion.name, promotion.code || null, channel, promotion.discount, normalizedPhone || null]
  )
}
