import { NextResponse } from 'next/server'
import Database from '@/lib/db/index.js'
import { requireAuth, handleRouteError } from '@/lib/api-guard.js'
import { ensureComboSchema } from '@/lib/combos.js'
import { ensureMenuVariantsSchema } from '@/lib/menu-variants.js'
import { setExclusiveWebsiteFeatured } from '@/lib/website-featured.js'
import { clean, validateComponents } from '../route.js'

export async function PUT(request, context) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'combos.manage' }); if (auth.error) return auth.error
    const { id } = await context.params; const menuItemId = Number(id); const data = clean(await request.json())
    const db = Database.getInstance(); await ensureComboSchema(db); await ensureMenuVariantsSchema(db); await validateComponents(db, data)
    const combo = await db.get('SELECT id FROM menu_combos WHERE menu_item_id = ?', [menuItemId])
    if (!combo) return NextResponse.json({ error: 'Combo pack not found.' }, { status: 404 })
    await db.transaction(async (tx) => {
      await tx.run('UPDATE menu_items SET name=?, description=?, category_id=?, base_price=?, image_url=?, is_available=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', [data.name, data.description || null, data.categoryId, data.price, data.imageUrl, data.active ? 1 : 0, menuItemId])
      await tx.run('UPDATE menu_combos SET channels=?, is_active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', [JSON.stringify(data.channels), data.active ? 1 : 0, combo.id])
      await tx.run('DELETE FROM menu_combo_items WHERE combo_id = ?', [combo.id])
      for (let index = 0; index < data.components.length; index += 1) {
        const row = data.components[index]
        await tx.run('INSERT INTO menu_combo_items (combo_id, component_menu_item_id, variant_name, quantity, display_order) VALUES (?, ?, ?, ?, ?)', [combo.id, row.menu_item_id, row.variant_name, row.quantity, index])
      }
    })
    if (typeof data.websiteFeatured === 'boolean') {
      await setExclusiveWebsiteFeatured(db, { kind: 'combo', id: menuItemId, featured: data.websiteFeatured })
    }
    return NextResponse.json({ message: 'Combo pack updated.' })
  } catch (error) { return handleRouteError(error, 'Could not update the combo pack.') }
}

export async function PATCH(request, context) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'combos.manage' }); if (auth.error) return auth.error
    const { id } = await context.params; const body = await request.json()
    const db = Database.getInstance(); await ensureComboSchema(db)

    if (typeof body.website_featured === 'boolean') {
      await setExclusiveWebsiteFeatured(db, { kind: 'combo', id: Number(id), featured: body.website_featured })
      return NextResponse.json({
        message: body.website_featured ? 'Set as website featured banner.' : 'Removed from featured banner.',
      })
    }

    const active = Boolean(body.is_active)
    await db.transaction(async (tx) => { await tx.run('UPDATE menu_combos SET is_active=?, updated_at=CURRENT_TIMESTAMP WHERE menu_item_id=?', [active ? 1 : 0, Number(id)]); await tx.run('UPDATE menu_items SET is_available=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', [active ? 1 : 0, Number(id)]) })
    return NextResponse.json({ message: active ? 'Combo activated.' : 'Combo paused.' })
  } catch (error) { return handleRouteError(error, 'Could not change combo status.') }
}

export async function DELETE(request, context) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'combos.manage' }); if (auth.error) return auth.error
    const { id } = await context.params; const menuItemId = Number(id); const db = Database.getInstance(); await ensureComboSchema(db)
    const ordered = await db.get('SELECT id FROM order_items WHERE menu_item_id = ? LIMIT 1', [menuItemId])
    if (ordered) return NextResponse.json({ error: 'This combo has order history. Pause it instead of deleting it.' }, { status: 409 })
    await db.run('DELETE FROM menu_items WHERE id = ?', [menuItemId])
    return NextResponse.json({ message: 'Combo pack deleted.' })
  } catch (error) { return handleRouteError(error, 'Could not delete the combo pack.') }
}
