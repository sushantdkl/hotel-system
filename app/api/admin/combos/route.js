import { NextResponse } from 'next/server'
import Database from '@/lib/db/index.js'
import { requireAuth, handleRouteError } from '@/lib/api-guard.js'
import { ensureComboSchema, getCombosForMenuItems } from '@/lib/combos.js'
import { ensureMenuVariantsSchema, getVariantsByMenuItemIds } from '@/lib/menu-variants.js'
import { setExclusiveWebsiteFeatured } from '@/lib/website-featured.js'

const allowedChannels = ['pos', 'website', 'qr']

function clean(body) {
  const name = String(body.name || '').trim().slice(0, 140)
  const price = Number(body.price)
  const categoryId = Number(body.category_id)
  const channels = (Array.isArray(body.channels) ? body.channels : []).filter((channel) => allowedChannels.includes(channel))
  const components = (Array.isArray(body.components) ? body.components : []).map((row) => ({ menu_item_id: Number(row.menu_item_id), variant_name: String(row.variant_name || '').trim().slice(0, 80) || null, quantity: Math.max(1, Math.min(99, parseInt(row.quantity, 10) || 1)) })).filter((row) => row.menu_item_id)
  if (!name) throw Object.assign(new Error('Combo name is required.'), { status: 400 })
  if (!(price > 0)) throw Object.assign(new Error('Enter a positive combo price.'), { status: 400 })
  if (!categoryId) throw Object.assign(new Error('Choose a menu category.'), { status: 400 })
  if (components.length < 2) throw Object.assign(new Error('A combo needs at least two component items.'), { status: 400 })
  if (!channels.length) throw Object.assign(new Error('Choose at least one sales channel.'), { status: 400 })
  return { name, price, categoryId, channels, components, description: String(body.description || '').trim().slice(0, 500), imageUrl: String(body.image_url || '').trim().slice(0, 1000) || null, active: body.is_active !== false, websiteFeatured: Boolean(body.website_featured) }
}

async function validateComponents(db, data) {
  const ids = [...new Set(data.components.map((row) => row.menu_item_id))]
  const placeholders = ids.map(() => '?').join(',')
  const rows = await db.all(`SELECT id, name, is_available, COALESCE(is_combo,0) AS is_combo FROM menu_items WHERE id IN (${placeholders})`, ids)
  if (rows.length !== ids.length) throw Object.assign(new Error('One of the selected component items no longer exists.'), { status: 400 })
  if (rows.some((row) => Number(row.is_combo))) throw Object.assign(new Error('A combo cannot contain another combo.'), { status: 400 })
  for (const component of data.components) {
    if (!component.variant_name) continue
    const variant = await db.get('SELECT id FROM menu_item_variants WHERE menu_item_id = ? AND variant_name = ?', [component.menu_item_id, component.variant_name])
    if (!variant) throw Object.assign(new Error('A selected component variation no longer exists.'), { status: 400 })
  }
}

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'combos.manage' })
    if (auth.error) return auth.error
    const db = Database.getInstance()
    await ensureComboSchema(db); await ensureMenuVariantsSchema(db)
    const [comboItems, categories, products] = await Promise.all([
      db.all(`SELECT mi.*, mc.name AS category_name FROM menu_items mi JOIN menu_combos c ON c.menu_item_id = mi.id LEFT JOIN menu_categories mc ON mc.id = mi.category_id ORDER BY mi.name`),
      db.all('SELECT id, name FROM menu_categories WHERE is_active = 1 ORDER BY name'),
      // Include unavailable items too — otherwise editing an old combo whose
      // component was paused leaves a blank dropdown and Save fails validation.
      db.all('SELECT id, name, category_id, base_price, is_available FROM menu_items WHERE COALESCE(is_combo,0) = 0 ORDER BY name'),
    ])
    const comboMap = await getCombosForMenuItems(db, comboItems.map((item) => item.id))
    const variants = await getVariantsByMenuItemIds(db, products.map((item) => item.id))
    return NextResponse.json({
      combos: comboItems.map((item) => ({ ...item, price: Number(item.base_price), combo: comboMap.get(Number(item.id)) })),
      categories,
      products: products.map((item) => ({ ...item, variants: variants.get(item.id) || [] })),
    })
  } catch (error) { return handleRouteError(error, 'Could not load combo packs.') }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'combos.manage' })
    if (auth.error) return auth.error
    const data = clean(await request.json())
    const db = Database.getInstance(); await ensureComboSchema(db); await ensureMenuVariantsSchema(db); await validateComponents(db, data)
    const id = await db.transaction(async (tx) => {
      const menu = await tx.run(`INSERT INTO menu_items (name, description, category_id, base_price, image_url, is_available, is_combo, preparation_time) VALUES (?, ?, ?, ?, ?, ?, 1, 15)`, [data.name, data.description || null, data.categoryId, data.price, data.imageUrl, data.active ? 1 : 0])
      const combo = await tx.run('INSERT INTO menu_combos (menu_item_id, channels, is_active, created_by) VALUES (?, ?, ?, ?)', [menu.lastInsertRowid, JSON.stringify(data.channels), data.active ? 1 : 0, auth.user.id])
      for (let index = 0; index < data.components.length; index += 1) {
        const row = data.components[index]
        await tx.run('INSERT INTO menu_combo_items (combo_id, component_menu_item_id, variant_name, quantity, display_order) VALUES (?, ?, ?, ?, ?)', [combo.lastInsertRowid, row.menu_item_id, row.variant_name, row.quantity, index])
      }
      return menu.lastInsertRowid
    })
    if (data.websiteFeatured) {
      await setExclusiveWebsiteFeatured(db, { kind: 'combo', id, featured: true })
    }
    return NextResponse.json({ message: 'Combo pack created.', id }, { status: 201 })
  } catch (error) { return handleRouteError(error, 'Could not create the combo pack.') }
}

export { clean, validateComponents }
