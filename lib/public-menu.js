import { MenuRepository } from '@/lib/db/repositories/menu.js'
import { formatMenuPrice } from '@/lib/menu-format.js'
import Database from '@/lib/db/index.js'
import { loadDeliveryPricing } from '@/lib/delivery-pricing.js'
import { comboAvailableOn, getCombosForMenuItems } from '@/lib/combos.js'
import { toPublicImageUrl } from '@/lib/public-image-url.js'
import { listBadgePromotions } from '@/lib/promotions.js'
import {
  findPromotionForProduct,
  promotionMenuBadgeLabel,
  sortCombosFirst,
} from '@/lib/promotion-display.js'

export { formatMenuPrice }

export async function getPublicDeliveryPricing() {
  return loadDeliveryPricing(Database.getInstance())
}

function slugify(name, id) {
  const base = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return base || `category-${id}`
}

function mapDiet(item) {
  if (item.is_vegetarian === 1 || item.is_vegetarian === true || item.is_veg === 1) {
    return 'veg'
  }
  return 'nonveg'
}

function mapImage(url) {
  return toPublicImageUrl(url)
}

/**
 * Build the public /menu payload from the same menu_items + menu_categories
 * tables the admin panel uses. Only available items in active categories.
 * Combos are pinned in a top "Combos" section; offer badges match POS style.
 */
export async function getPublicMenuCategories({ channel = 'website' } = {}) {
  const menuRepo = new MenuRepository()
  const db = menuRepo.db

  let categories = []
  let items = []

  try {
    categories = await menuRepo.getCategories()
  } catch (e) {
    console.error('getPublicMenuCategories categories:', e)
    categories = []
  }

  try {
    items = await menuRepo.getAllItems({ available: true })
  } catch (e) {
    console.error('getPublicMenuCategories items:', e)
    items = []
  }

  // Attach variants (e.g. Boiled/Fried) so the public menu shows their prices.
  const variantsByItem = new Map()
  try {
    const rows = await db.all(`
      SELECT v.menu_item_id, v.variant_name, v.price, v.price_modifier, v.is_default, mi.base_price
      FROM menu_item_variants v
      JOIN menu_items mi ON mi.id = v.menu_item_id
      WHERE mi.is_available = 1
      ORDER BY v.is_default DESC, COALESCE(v.price, mi.base_price + v.price_modifier)
    `)
    for (const r of rows || []) {
      const key = r.menu_item_id
      if (!variantsByItem.has(key)) variantsByItem.set(key, [])
      variantsByItem.get(key).push({
        name: r.variant_name,
        price: r.price != null ? Number(r.price) : Number(r.base_price) + Number(r.price_modifier || 0),
      })
    }
  } catch (e) {
    console.error('getPublicMenuCategories variants:', e)
  }

  let combosByItem = new Map()
  try {
    combosByItem = await getCombosForMenuItems(db, items.map((item) => item.item_id || item.id))
  } catch (e) {
    console.error('getPublicMenuCategories combos:', e)
  }

  let badgePromos = []
  try {
    badgePromos = await listBadgePromotions(db, { channel })
  } catch (e) {
    console.error('getPublicMenuCategories offers:', e)
  }

  const byCategoryId = new Map()
  const comboItems = []
  const comboSeen = new Set()

  for (const item of items) {
    const itemId = item.item_id || item.id
    const combo = combosByItem.get(Number(itemId))
    if (combo && !comboAvailableOn(combo, channel)) continue
    const cid = item.category_id
    if (!byCategoryId.has(cid)) byCategoryId.set(cid, [])
    const price = Number(item.price ?? item.base_price) || 0
    const categoryId = Number(cid) || 0
    const offer = findPromotionForProduct(badgePromos, { id: itemId, category_id: categoryId })
    const mapped = {
      id: String(itemId),
      category_id: categoryId,
      name: item.item_name || item.name,
      description: item.description || '',
      price,
      diet: mapDiet(item),
      image: mapImage(item.image_url),
      variants: variantsByItem.get(itemId) || [],
      chefRecommend: false,
      isCombo: Boolean(combo),
      offerBadge: promotionMenuBadgeLabel(offer),
      offerName: offer?.name || null,
      combo: combo
        ? {
            originalPrice: Number(combo.original_price || 0),
            savings: Math.max(0, Number(combo.original_price || 0) - price),
            components: combo.components.map((component) => ({
              id: Number(component.component_menu_item_id),
              name: component.name,
              variant: component.variant_name || null,
              quantity: Number(component.quantity),
            })),
          }
        : null,
    }
    if (mapped.isCombo && !comboSeen.has(mapped.id)) {
      comboSeen.add(mapped.id)
      comboItems.push(mapped)
    } else if (!mapped.isCombo) {
      byCategoryId.get(cid).push(mapped)
    }
  }

  const foodCategories = categories
    .map((cat) => {
      const list = sortCombosFirst(byCategoryId.get(cat.id) || [])
      if (list.length === 0) return null
      return {
        id: slugify(cat.name, cat.id),
        title: cat.name,
        subtitle: cat.description || 'From our kitchen',
        items: list,
      }
    })
    .filter(Boolean)

  if (!comboItems.length) return foodCategories

  return [
    {
      id: 'combos',
      title: 'Combos',
      subtitle: 'Bundles at a better price',
      items: sortCombosFirst(comboItems),
    },
    ...foodCategories,
  ]
}
