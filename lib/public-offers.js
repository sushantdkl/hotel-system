import Database from '@/lib/db/index.js'
import { ensurePromotionSchema, listScheduledWebsitePromotions } from '@/lib/promotions.js'
import { ensureComboSchema } from '@/lib/combos.js'
import { ensureWebsiteFeaturedSchema } from '@/lib/website-featured.js'
import { formatMenuPrice } from '@/lib/menu-format.js'
import { toPublicImageUrl } from '@/lib/public-image-url.js'

function moneyBadge(promo) {
  if (promo.offer_type === 'buy_x_get_y') {
    const free = Number(promo.reward_discount_percent) === 100
    return free
      ? `Buy ${promo.buy_quantity}, get ${promo.reward_quantity} free`
      : `Buy ${promo.buy_quantity}, get ${promo.reward_quantity} ${promo.reward_discount_percent}% off`
  }
  if (promo.discount_type === 'percent') return `${promo.discount_value}% off`
  return `${formatMenuPrice(promo.discount_value)} off`
}

function kindFor(promo) {
  if (promo.offer_type === 'buy_x_get_y') return 'offer'
  if (promo.daily_start_time || promo.daily_end_time) return 'happy_hour'
  return 'discount'
}

function kindLabel(kind) {
  if (kind === 'combo') return 'Combo'
  if (kind === 'happy_hour') return 'Happy hour'
  if (kind === 'offer') return 'Offer'
  return 'Discount'
}

/**
 * Active website-facing offers, discounts, happy-hour windows, and combo packs
 * for the marketing home page. Empty array → section stays hidden.
 * At most one card has `featured: true` for the hero banner.
 */
export async function getPublicWebsiteOffers() {
  const db = Database.getInstance()
  await ensurePromotionSchema(db)
  await ensureComboSchema(db)
  await ensureWebsiteFeaturedSchema(db)

  const promotions = await listScheduledWebsitePromotions(db, { forMarketing: true })
  const promoCards = promotions.map((promo) => {
    const kind = kindFor(promo)
    const window =
      promo.daily_start_time || promo.daily_end_time
        ? `${promo.daily_start_time || '00:00'}–${promo.daily_end_time || '23:59'}`
        : null
    return {
      key: `promo-${promo.id}`,
      kind,
      kindLabel: kindLabel(kind),
      id: promo.id,
      name: promo.name,
      description: promo.description || '',
      image_url: toPublicImageUrl(promo.image_url) || null,
      badge: moneyBadge(promo),
      code: promo.code || null,
      window,
      href: promo.code ? `/menu?coupon=${encodeURIComponent(promo.code)}` : '/menu',
      featured: Boolean(promo.website_featured),
    }
  })

  let comboCards = []
  try {
    const combos = await db.all(`
      SELECT mi.id, mi.name, mi.description, mi.image_url, mi.base_price AS price,
             mc.channels, mc.website_featured, c.name AS category_name
        FROM menu_items mi
        JOIN menu_combos mc ON mc.menu_item_id = mi.id
        LEFT JOIN menu_categories c ON c.id = mi.category_id
       WHERE COALESCE(mi.is_combo, 0) = 1
         AND COALESCE(mc.is_active, 0) = 1
         AND COALESCE(mi.is_available, 0) = 1
       ORDER BY mi.name
    `)
    comboCards = (combos || [])
      .filter((row) => {
        try {
          const channels = Array.isArray(row.channels) ? row.channels : JSON.parse(row.channels || '[]')
          return channels.includes('website')
        } catch {
          return false
        }
      })
      .map((row) => ({
        key: `combo-${row.id}`,
        kind: 'combo',
        kindLabel: 'Combo',
        id: Number(row.id),
        name: row.name,
        description: row.description || row.category_name || '',
        image_url: toPublicImageUrl(row.image_url) || null,
        badge: formatMenuPrice(row.price),
        code: null,
        window: null,
        href: '/menu?category=combos',
        featured: Boolean(Number(row.website_featured)),
      }))
  } catch {
    comboCards = []
  }

  // Featured first so the hero prefers the marked banner over list order.
  const all = [...promoCards, ...comboCards].sort((a, b) => Number(b.featured) - Number(a.featured))
  // Enforce single featured in case of legacy duplicates
  let seenFeatured = false
  return all.map((card) => {
    if (!card.featured) return card
    if (seenFeatured) return { ...card, featured: false }
    seenFeatured = true
    return card
  })
}
