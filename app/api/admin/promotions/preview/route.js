import { NextResponse } from 'next/server'
import Database from '@/lib/db/index.js'
import { requireAuth, handleRouteError } from '@/lib/api-guard.js'
import { ensurePromotionSchema, evaluatePromotion, resolveMenuLinesForPromotion } from '@/lib/promotions.js'
import { ensureMenuVariantsSchema } from '@/lib/menu-variants.js'

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'menu.view' })
    if (auth.error) return auth.error
    const body = await request.json().catch(() => ({}))
    const orderId = Number(body.order_id)
    const db = Database.getInstance()
    await ensurePromotionSchema(db)
    await ensureMenuVariantsSchema(db)
    const items = orderId
      ? await db.all(`SELECT oi.id AS order_item_id,
               COALESCE(oi.menu_item_id, oi.item_id) AS menu_item_id,
               mi.category_id, oi.quantity, oi.price, oi.subtotal
          FROM order_items oi
          LEFT JOIN menu_items mi ON COALESCE(oi.menu_item_id, oi.item_id) = mi.id
          WHERE oi.order_id = ? AND COALESCE(oi.status,'') NOT IN ('voided','cancelled')`, [orderId])
      : await resolveMenuLinesForPromotion(db, body.items)
    for (const line of body.items || []) {
      if (!line.is_custom) continue
      const price = Math.max(0, Number(line.price || 0)); const quantity = Math.max(1, Math.min(999, parseInt(line.quantity, 10) || 1))
      if (price > 0) items.push({ menu_item_id: null, category_id: null, price, quantity, subtotal: price * quantity })
    }
    if (!items.length) return NextResponse.json({ promotion: null })
    const promotion = await evaluatePromotion(db, { items, channel: 'pos', couponCode: body.coupon_code })
    if (!promotion && body.coupon_code) return NextResponse.json({ error: 'This coupon is invalid or not eligible for this bill.' }, { status: 400 })
    return NextResponse.json({ promotion })
  } catch (error) { return handleRouteError(error, 'Could not check this offer.') }
}
