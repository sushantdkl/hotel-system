import { ensureColumn } from '@/lib/db/schema-helpers.js'
import { ensurePromotionSchema } from '@/lib/promotions.js'
import { ensureComboSchema } from '@/lib/combos.js'

/** Ensure website_featured columns exist on promotions + menu_combos. */
export async function ensureWebsiteFeaturedSchema(db) {
  await ensurePromotionSchema(db)
  await ensureComboSchema(db)
  await ensureColumn(db, 'promotions', 'website_featured', 'INTEGER DEFAULT 0')
  await ensureColumn(db, 'menu_combos', 'website_featured', 'INTEGER DEFAULT 0')
}

/** Clear featured on every promo + combo (only one site-wide featured banner). */
export async function clearWebsiteFeatured(db) {
  await ensureWebsiteFeaturedSchema(db)
  await db.run('UPDATE promotions SET website_featured = 0 WHERE website_featured = 1')
  await db.run('UPDATE menu_combos SET website_featured = 0 WHERE website_featured = 1')
}

/**
 * Mark exactly one offer as the website hero banner.
 * @param {'promo'|'combo'} kind — promo = promotions.id, combo = menu_combos.menu_item_id
 */
export async function setExclusiveWebsiteFeatured(db, { kind, id, featured = true }) {
  await ensureWebsiteFeaturedSchema(db)
  const numericId = Number(id)
  if (!numericId) throw Object.assign(new Error('Invalid id.'), { status: 400 })

  if (!featured) {
    if (kind === 'promo') {
      await db.run('UPDATE promotions SET website_featured = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [numericId])
    } else {
      await db.run('UPDATE menu_combos SET website_featured = 0, updated_at = CURRENT_TIMESTAMP WHERE menu_item_id = ?', [numericId])
    }
    return
  }

  await clearWebsiteFeatured(db)
  if (kind === 'promo') {
    await db.run('UPDATE promotions SET website_featured = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [numericId])
  } else if (kind === 'combo') {
    await db.run('UPDATE menu_combos SET website_featured = 1, updated_at = CURRENT_TIMESTAMP WHERE menu_item_id = ?', [numericId])
  } else {
    throw Object.assign(new Error('Invalid featured kind.'), { status: 400 })
  }
}
