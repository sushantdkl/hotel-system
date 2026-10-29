import Database from '@/lib/db/index.js'

export const DEFAULT_ONLINE_ORDER_MINIMUM = 500

export function parseOnlineOrderMinimum(value, fallback = DEFAULT_ONLINE_ORDER_MINIMUM) {
  if (value === null || value === undefined || value === '') return fallback
  const amount = Number(value)
  return Number.isFinite(amount) && amount >= 0 ? amount : fallback
}

export async function loadOnlineOrderMinimum(db = Database.getInstance()) {
  try {
    const row = await db.get(
      `SELECT setting_value FROM system_settings WHERE setting_key = ? LIMIT 1`,
      ['online_order_minimum_amount']
    )
    return parseOnlineOrderMinimum(row?.setting_value)
  } catch {
    return DEFAULT_ONLINE_ORDER_MINIMUM
  }
}
