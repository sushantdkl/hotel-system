import { NextResponse } from 'next/server'
import Database from '@/lib/db/index.js'
import { requireAuth, handleRouteError } from '@/lib/api-guard.js'
import { ensurePromotionSchema, normalizePromotion } from '@/lib/promotions.js'
import { setExclusiveWebsiteFeatured } from '@/lib/website-featured.js'

const allowed = { types: ['percent', 'fixed'], scopes: ['order', 'category', 'item'], channels: ['pos', 'website', 'qr'] }

function clean(data) {
  const name = String(data.name || '').trim().slice(0, 120)
  const code = String(data.code || '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 40) || null
  const discountType = allowed.types.includes(data.discount_type) ? data.discount_type : 'percent'
  const scope = allowed.scopes.includes(data.scope) ? data.scope : 'order'
  const offerType = data.offer_type === 'buy_x_get_y' ? 'buy_x_get_y' : 'discount'
  const discountValue = offerType === 'buy_x_get_y' ? 1 : Number(data.discount_value)
  const minimum = Math.max(0, Number(data.minimum_order_amount) || 0)
  const maximum = data.maximum_discount_amount === '' || data.maximum_discount_amount == null ? null : Math.max(0, Number(data.maximum_discount_amount) || 0)
  const channels = (Array.isArray(data.channels) ? data.channels : []).filter((value) => allowed.channels.includes(value))
  const days = (Array.isArray(data.days_of_week) ? data.days_of_week : []).filter((value) => ['sun','mon','tue','wed','thu','fri','sat'].includes(value))
  const targetIds = [...new Set((Array.isArray(data.target_ids) ? data.target_ids : []).map(Number).filter((id) => Number.isInteger(id) && id > 0))]
  if (!name) throw Object.assign(new Error('Offer name is required.'), { status: 400 })
  if (!(discountValue > 0) || (offerType === 'discount' && discountType === 'percent' && discountValue > 100)) throw Object.assign(new Error('Enter a valid discount value.'), { status: 400 })
  if (!channels.length) throw Object.assign(new Error('Choose at least one sales channel.'), { status: 400 })
  if (scope !== 'order' && !targetIds.length) throw Object.assign(new Error('Choose at least one target.'), { status: 400 })
  if (offerType === 'buy_x_get_y' && scope === 'order') throw Object.assign(new Error('Buy/get offers must target menu items or categories.'), { status: 400 })
  const positiveInteger = (value, fallback = 1) => Math.max(1, Math.min(99, parseInt(value, 10) || fallback))
  const nullableLimit = (value) => value === '' || value == null ? null : positiveInteger(value)
  return {
    name, code, description: String(data.description || '').trim().slice(0, 300), offerType, discountType, scope, discountValue,
    buyQuantity: positiveInteger(data.buy_quantity), rewardQuantity: positiveInteger(data.reward_quantity),
    rewardDiscountPercent: Math.max(1, Math.min(100, Number(data.reward_discount_percent) || 100)),
    minimum, maximum, channels, days, targetIds, startsAt: data.starts_at || null, endsAt: data.ends_at || null,
    dailyStartTime: data.daily_start_time || null, dailyEndTime: data.daily_end_time || null,
    usageLimit: nullableLimit(data.usage_limit), perCustomerLimit: nullableLimit(data.per_customer_limit),
    stackable: Boolean(data.stackable), autoApply: code ? false : Boolean(data.auto_apply), active: data.is_active !== false,
    imageUrl: String(data.image_url || '').trim().slice(0, 500) || null,
    websiteFeatured: Boolean(data.website_featured),
  }
}

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], anyPermissions: ['menu.view', 'promotions.manage'] })
    if (auth.error) return auth.error
    const db = Database.getInstance()
    await ensurePromotionSchema(db)
    const [rows, targets, categories, items, usage, history] = await Promise.all([
      db.all('SELECT * FROM promotions ORDER BY is_active DESC, created_at DESC'),
      db.all('SELECT * FROM promotion_targets'),
      db.all('SELECT id, name FROM menu_categories WHERE is_active = 1 ORDER BY name'),
      db.all('SELECT id, name, category_id FROM menu_items WHERE is_available = 1 ORDER BY name'),
      db.all(`SELECT pr.promotion_id, COUNT(*) AS uses, COALESCE(SUM(pr.discount_amount),0) AS saved
              FROM promotion_redemptions pr JOIN bills b ON b.id = pr.bill_id
              WHERE LOWER(COALESCE(b.status,'')) NOT IN ('void','voided','cancelled','canceled')
              GROUP BY pr.promotion_id`),
      db.all(`SELECT pr.id, pr.promotion_id, pr.promotion_name, pr.promotion_code, pr.channel,
                     pr.discount_amount, pr.customer_phone, pr.created_at, b.bill_number, o.order_number
                FROM promotion_redemptions pr
                LEFT JOIN bills b ON b.id = pr.bill_id
                LEFT JOIN orders o ON o.id = pr.order_id
               WHERE pr.bill_id IS NULL OR LOWER(COALESCE(b.status,'')) NOT IN ('void','voided','cancelled','canceled')
               ORDER BY pr.created_at DESC, pr.id DESC LIMIT 100`),
    ])
    const usageMap = new Map(usage.map((row) => [Number(row.promotion_id), row]))
    return NextResponse.json({ promotions: rows.map((row) => ({ ...normalizePromotion(row, targets), uses: Number(usageMap.get(Number(row.id))?.uses || 0), saved: Number(usageMap.get(Number(row.id))?.saved || 0) })), usage_history: history, categories, items })
  } catch (error) { return handleRouteError(error, 'Could not load offers.') }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'promotions.manage' })
    if (auth.error) return auth.error
    const data = clean(await request.json())
    const db = Database.getInstance()
    await ensurePromotionSchema(db)
    const result = await db.transaction(async (tx) => {
      const inserted = await tx.run(`INSERT INTO promotions
        (name, code, description, offer_type, discount_type, discount_value, scope, buy_quantity, reward_quantity, reward_discount_percent,
         minimum_order_amount, maximum_discount_amount, starts_at, ends_at, daily_start_time, daily_end_time, days_of_week, channels,
         usage_limit, per_customer_limit, stackable, auto_apply, is_active, created_by, image_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [data.name, data.code, data.description || null, data.offerType, data.discountType, data.discountValue, data.scope,
          data.buyQuantity, data.rewardQuantity, data.rewardDiscountPercent, data.minimum, data.maximum, data.startsAt, data.endsAt,
          data.dailyStartTime, data.dailyEndTime, JSON.stringify(data.days), JSON.stringify(data.channels), data.usageLimit,
          data.perCustomerLimit, data.stackable ? 1 : 0, data.autoApply ? 1 : 0, data.active ? 1 : 0, auth.user.id, data.imageUrl])
      for (const targetId of data.targetIds) await tx.run('INSERT INTO promotion_targets (promotion_id, target_type, target_id) VALUES (?, ?, ?)', [inserted.lastInsertRowid, data.scope, targetId])
      return inserted.lastInsertRowid
    })
    if (data.websiteFeatured) {
      await setExclusiveWebsiteFeatured(db, { kind: 'promo', id: result, featured: true })
    }
    return NextResponse.json({ message: 'Offer created.', id: result }, { status: 201 })
  } catch (error) { return handleRouteError(error, 'Could not create the offer.') }
}

export { clean }
