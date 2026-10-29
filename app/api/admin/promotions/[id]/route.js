import { NextResponse } from 'next/server'
import Database from '@/lib/db/index.js'
import { requireAuth, handleRouteError } from '@/lib/api-guard.js'
import { ensurePromotionSchema } from '@/lib/promotions.js'
import { setExclusiveWebsiteFeatured } from '@/lib/website-featured.js'
import { clean } from '../route.js'

export async function PUT(request, context) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'promotions.manage' })
    if (auth.error) return auth.error
    const { id } = await context.params
    const promotionId = Number(id)
    if (!Number.isFinite(promotionId)) return NextResponse.json({ error: 'Invalid offer.' }, { status: 400 })

    const data = clean(await request.json())
    const db = Database.getInstance()
    await ensurePromotionSchema(db)

    const existing = await db.get('SELECT id, code FROM promotions WHERE id = ?', [promotionId])
    if (!existing) return NextResponse.json({ error: 'Offer not found.' }, { status: 404 })

    if (data.code) {
      const clash = await db.get(
        `SELECT id FROM promotions WHERE UPPER(code) = ? AND id <> ? LIMIT 1`,
        [data.code, promotionId]
      )
      if (clash) return NextResponse.json({ error: 'That coupon code is already used by another offer.' }, { status: 409 })
    }

    await db.transaction(async (tx) => {
      await tx.run(
        `UPDATE promotions SET
           name = ?, code = ?, description = ?, offer_type = ?, discount_type = ?, discount_value = ?, scope = ?,
           buy_quantity = ?, reward_quantity = ?, reward_discount_percent = ?,
           minimum_order_amount = ?, maximum_discount_amount = ?, starts_at = ?, ends_at = ?,
           daily_start_time = ?, daily_end_time = ?, days_of_week = ?, channels = ?,
           usage_limit = ?, per_customer_limit = ?, stackable = ?, auto_apply = ?, is_active = ?,
           image_url = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          data.name, data.code, data.description || null, data.offerType, data.discountType, data.discountValue, data.scope,
          data.buyQuantity, data.rewardQuantity, data.rewardDiscountPercent, data.minimum, data.maximum,
          data.startsAt, data.endsAt, data.dailyStartTime, data.dailyEndTime,
          JSON.stringify(data.days), JSON.stringify(data.channels), data.usageLimit, data.perCustomerLimit,
          data.stackable ? 1 : 0, data.autoApply ? 1 : 0, data.active ? 1 : 0, data.imageUrl, promotionId,
        ]
      )
      await tx.run('DELETE FROM promotion_targets WHERE promotion_id = ?', [promotionId])
      for (const targetId of data.targetIds) {
        await tx.run(
          'INSERT INTO promotion_targets (promotion_id, target_type, target_id) VALUES (?, ?, ?)',
          [promotionId, data.scope, targetId]
        )
      }
    })

    if (typeof data.websiteFeatured === 'boolean') {
      await setExclusiveWebsiteFeatured(db, { kind: 'promo', id: promotionId, featured: data.websiteFeatured })
    }

    return NextResponse.json({ message: 'Offer updated.' })
  } catch (error) {
    return handleRouteError(error, 'Could not update the offer.')
  }
}

export async function PATCH(request, context) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'promotions.manage' })
    if (auth.error) return auth.error
    const { id } = await context.params
    const body = await request.json()
    const db = Database.getInstance()
    await ensurePromotionSchema(db)

    if (typeof body.website_featured === 'boolean') {
      await setExclusiveWebsiteFeatured(db, { kind: 'promo', id: Number(id), featured: body.website_featured })
      return NextResponse.json({
        message: body.website_featured ? 'Set as website featured banner.' : 'Removed from featured banner.',
      })
    }

    if (typeof body.is_active !== 'boolean') return NextResponse.json({ error: 'Invalid status.' }, { status: 400 })
    await db.run('UPDATE promotions SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [body.is_active ? 1 : 0, Number(id)])
    return NextResponse.json({ message: body.is_active ? 'Offer activated.' : 'Offer paused.' })
  } catch (error) { return handleRouteError(error, 'Could not update the offer.') }
}

export async function DELETE(request, context) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'promotions.manage' })
    if (auth.error) return auth.error
    const { id } = await context.params
    const db = Database.getInstance()
    await ensurePromotionSchema(db)
    const used = await db.get('SELECT id FROM promotion_redemptions WHERE promotion_id = ? LIMIT 1', [Number(id)])
    if (used) return NextResponse.json({ error: 'This offer has usage history. Pause it instead of deleting it.' }, { status: 409 })
    await db.run('DELETE FROM promotions WHERE id = ?', [Number(id)])
    return NextResponse.json({ message: 'Offer deleted.' })
  } catch (error) { return handleRouteError(error, 'Could not delete the offer.') }
}
