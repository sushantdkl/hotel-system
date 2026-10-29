/**
 * Configurable reservation timing (system_settings).
 */

import Database from '@/lib/db/index.js';

export const RESERVATION_SETTING_DEFAULTS = {
  reservation_hold_minutes: 30,
  reservation_grace_minutes: 20,
  reservation_dining_minutes: 90,
  reservation_cleaning_minutes: 10,
  reservation_auto_cancel_minutes: 20,
  reservation_min_lead_minutes: 60,
};

async function ensureSettingsTable(db) {
  if (db.driver === 'postgres') return;
  await db.run(`
    CREATE TABLE IF NOT EXISTS system_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      setting_key TEXT UNIQUE NOT NULL,
      setting_value TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

export async function getReservationSettings(db = Database.getInstance()) {
  await ensureSettingsTable(db);
  const keys = Object.keys(RESERVATION_SETTING_DEFAULTS);
  const rows = await db.all(
    `SELECT setting_key, setting_value FROM system_settings
     WHERE setting_key IN (${keys.map(() => '?').join(',')})`,
    keys
  );
  const map = Object.fromEntries((rows || []).map((r) => [r.setting_key, r.setting_value]));
  const out = {};
  for (const [k, def] of Object.entries(RESERVATION_SETTING_DEFAULTS)) {
    const n = parseInt(map[k], 10);
    out[k] = Number.isFinite(n) && n >= 0 ? n : def;
  }
  return out;
}

export async function ensureReservationSettingDefaults(db = Database.getInstance()) {
  await ensureSettingsTable(db);
  for (const [key, value] of Object.entries(RESERVATION_SETTING_DEFAULTS)) {
    await db.run(
      `INSERT INTO system_settings (setting_key, setting_value)
       VALUES (?, ?)
       ON CONFLICT (setting_key) DO NOTHING`,
      [key, String(value)]
    );
  }
}
