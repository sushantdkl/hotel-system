import { NextResponse } from 'next/server'
import Database from '@/lib/db/index.js'
import { checkRateLimit, clientIp } from '@/lib/rate-limit.js'
import { evaluatePromotion, resolveMenuLinesForPromotion } from '@/lib/promotions.js'
import { ensureMenuVariantsSchema } from '@/lib/menu-variants.js'

export async function POST(request) {
  const rl = await checkRateLimit({ key: `promotion_preview:${clientIp(request)}`, limit: 30, windowSeconds: 60 })
  if (!rl.ok) return NextResponse.json({ error: 'Please wait before checking another code.' }, { status: 429 })
  const body = await request.json().catch(() => ({}))
  const db = Database.getInstance()
  await ensureMenuVariantsSchema(db)
  const items = await resolveMenuLinesForPromotion(db, body.items)
  const promotion = await evaluatePromotion(db, { items, channel: body.channel === 'qr' ? 'qr' : 'website', couponCode: body.coupon_code })
  if (!promotion && body.coupon_code) return NextResponse.json({ error: 'This coupon is invalid or not eligible for this cart.' }, { status: 400 })
  return NextResponse.json({ promotion })
}
