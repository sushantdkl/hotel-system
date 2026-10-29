import { ensureSqliteTable } from '@/lib/db/ensure-sqlite-table.js'
import { ensureColumn } from '@/lib/db/schema-helpers.js'

const CHANNELS = ['pos', 'website', 'qr']

function parseChannels(value) {
  try {
    const parsed = Array.isArray(value) ? value : JSON.parse(value || '[]')
    return parsed.filter((channel) => CHANNELS.includes(channel))
  } catch { return [] }
}

export async function ensureComboSchema(db) {
  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS menu_combos (
    id INTEGER PRIMARY KEY AUTOINCREMENT, menu_item_id INTEGER UNIQUE NOT NULL,
    channels TEXT NOT NULL DEFAULT '["pos","website","qr"]', is_active INTEGER DEFAULT 1,
    created_by INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE)`)
  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS menu_combo_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, combo_id INTEGER NOT NULL, component_menu_item_id INTEGER NOT NULL,
    variant_name TEXT, quantity INTEGER NOT NULL DEFAULT 1, display_order INTEGER DEFAULT 0,
    FOREIGN KEY (combo_id) REFERENCES menu_combos(id) ON DELETE CASCADE,
    FOREIGN KEY (component_menu_item_id) REFERENCES menu_items(id) ON DELETE RESTRICT)`)
  await ensureColumn(db, 'menu_items', 'is_combo', 'INTEGER DEFAULT 0').catch(() => {})
  await ensureColumn(db, 'kot_items', 'combo_units', 'INTEGER').catch(() => {})
  await ensureColumn(db, 'order_items', 'combo_snapshot', 'TEXT').catch(() => {})
  await ensureColumn(db, 'menu_combos', 'website_featured', 'INTEGER DEFAULT 0').catch(() => {})
}

export async function getComboComponents(db, menuItemId, { activeOnly = false } = {}) {
  await ensureComboSchema(db)
  const combo = await db.get(`SELECT * FROM menu_combos WHERE menu_item_id = ?${activeOnly ? ' AND is_active = 1' : ''}`, [Number(menuItemId)])
  if (!combo) return null
  const components = await db.all(`
    SELECT ci.*, mi.name, mi.base_price, mi.is_available,
           COALESCE(v.price, mi.base_price + COALESCE(v.price_modifier, 0), mi.base_price) AS component_price
      FROM menu_combo_items ci
      JOIN menu_items mi ON mi.id = ci.component_menu_item_id
      LEFT JOIN menu_item_variants v ON v.menu_item_id = ci.component_menu_item_id AND v.variant_name = ci.variant_name
     WHERE ci.combo_id = ? ORDER BY ci.display_order, ci.id`, [combo.id])
  return {
    ...combo,
    id: Number(combo.id),
    channels: parseChannels(combo.channels),
    is_active: Boolean(Number(combo.is_active)),
    website_featured: Boolean(Number(combo.website_featured)),
    components: components.map((row) => ({
      ...row,
      quantity: Number(row.quantity),
      component_price: Number(row.component_price || 0),
    })),
  }
}

export async function getCombosForMenuItems(db, menuItemIds = []) {
  await ensureComboSchema(db)
  const ids = [...new Set(menuItemIds.map(Number).filter(Boolean))]
  if (!ids.length) return new Map()
  const placeholders = ids.map(() => '?').join(',')
  const combos = await db.all(`SELECT * FROM menu_combos WHERE menu_item_id IN (${placeholders})`, ids)
  if (!combos.length) return new Map()
  const comboIds = combos.map((combo) => Number(combo.id))
  const componentPlaceholders = comboIds.map(() => '?').join(',')
  const rows = await db.all(`
    SELECT ci.*, mi.name, mi.base_price, mi.is_available,
           COALESCE(v.price, mi.base_price + COALESCE(v.price_modifier, 0), mi.base_price) AS component_price
      FROM menu_combo_items ci JOIN menu_items mi ON mi.id = ci.component_menu_item_id
      LEFT JOIN menu_item_variants v ON v.menu_item_id = ci.component_menu_item_id AND v.variant_name = ci.variant_name
     WHERE ci.combo_id IN (${componentPlaceholders}) ORDER BY ci.display_order, ci.id`, comboIds)
  const map = new Map()
  for (const combo of combos) {
    const components = rows.filter((row) => Number(row.combo_id) === Number(combo.id)).map((row) => ({ ...row, quantity: Number(row.quantity), component_price: Number(row.component_price || 0) }))
    map.set(Number(combo.menu_item_id), {
      id: Number(combo.id), channels: parseChannels(combo.channels), is_active: Boolean(Number(combo.is_active)),
      website_featured: Boolean(Number(combo.website_featured)), components,
      original_price: components.reduce((sum, row) => sum + row.component_price * row.quantity, 0),
    })
  }
  return map
}

export async function createComboSnapshot(db, item, { channel = null, requireAvailable = true } = {}) {
  const menuId = Number(item?.menu_item_id || item?.item_id || item?.id || 0)
  if (!menuId) return null
  const combo = await getComboComponents(db, menuId, { activeOnly: false })
  if (!combo) return null
  if (requireAvailable && !combo.is_active) {
    throw Object.assign(new Error(`"${item?.item_name || item?.name || 'This combo'}" is currently paused.`), { status: 409, code: 'combo_unavailable' })
  }
  if (channel && !combo.channels.includes(channel)) {
    throw Object.assign(new Error('This combo is not available on this sales channel.'), { status: 409, code: 'combo_channel_unavailable' })
  }
  if (requireAvailable && combo.components.some((component) => Number(component.is_available) === 0)) {
    const component = combo.components.find((row) => Number(row.is_available) === 0)
    throw Object.assign(new Error(`No stock for this combo: "${component.name}" is unavailable.`), { status: 409, code: 'combo_component_unavailable' })
  }
  return JSON.stringify(combo.components.map((component) => ({
    menu_item_id: Number(component.component_menu_item_id),
    item_name: component.name,
    variant_name: component.variant_name || null,
    quantity: Number(component.quantity),
  })))
}

function readSnapshot(value) {
  if (!value) return null
  try {
    const rows = typeof value === 'string' ? JSON.parse(value) : value
    return Array.isArray(rows) && rows.length ? rows : null
  } catch { return null }
}

/** Replace combo sale lines with their real menu components for stock operations. */
export async function expandComboItems(db, items = [], { requireAvailable = false } = {}) {
  await ensureComboSchema(db)
  const map = await getCombosForMenuItems(db, items.map((item) => item.menu_item_id || item.item_id || item.id))
  const expanded = []
  for (const item of items) {
    const menuId = Number(item.menu_item_id || item.item_id || item.id || 0)
    const snapshot = readSnapshot(item.combo_snapshot)
    if (snapshot) {
      const comboQty = Math.max(0, Number(item.quantity || 0))
      for (const component of snapshot) {
        if (requireAvailable) {
          const live = await db.get('SELECT is_available FROM menu_items WHERE id = ?', [Number(component.menu_item_id)])
          if (!live || Number(live.is_available) === 0) {
            throw Object.assign(new Error(`No stock for this combo: "${component.item_name || 'a component'}" is unavailable.`), { status: 409, code: 'combo_component_unavailable' })
          }
        }
        expanded.push({
          menu_item_id: Number(component.menu_item_id), item_id: Number(component.menu_item_id),
          item_name: component.item_name, name: component.item_name,
          variant_name: component.variant_name || null,
          quantity: Number(component.quantity) * comboQty,
          combo_menu_item_id: menuId, combo_name: item.item_name || item.name || null,
        })
      }
      continue
    }
    const combo = map.get(menuId)
    if (!combo) { expanded.push(item); continue }
    if (!combo.is_active && requireAvailable) {
      throw Object.assign(new Error(`"${item.item_name || item.name || 'This combo'}" is currently paused.`), { status: 409, code: 'combo_unavailable' })
    }
    const comboQty = Math.max(0, Number(item.quantity || 0))
    for (const component of combo.components) {
      if (requireAvailable && Number(component.is_available) === 0) {
        throw Object.assign(new Error(`No stock for this combo: "${component.name}" is unavailable.`), { status: 409, code: 'combo_component_unavailable' })
      }
      expanded.push({
        menu_item_id: Number(component.component_menu_item_id),
        item_id: Number(component.component_menu_item_id),
        item_name: component.name,
        name: component.name,
        variant_name: component.variant_name || null,
        quantity: component.quantity * comboQty,
        combo_menu_item_id: menuId,
        combo_name: item.item_name || item.name || null,
      })
    }
  }
  return expanded
}

export function comboAvailableOn(combo, channel) {
  return Boolean(combo?.is_active && combo.channels?.includes(channel) && combo.components?.every((component) => Number(component.is_available) !== 0))
}
