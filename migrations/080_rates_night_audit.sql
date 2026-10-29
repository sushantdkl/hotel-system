-- Seasons, rate plans, per-night rate snapshots, no-shows, night audit log,
-- and business unit on expense categories for segment P&L.
-- Keep in sync with HOTEL_RATES_SCHEMA in lib/hotel/folio-schema.js.
CREATE TABLE IF NOT EXISTS hotel_rate_seasons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  room_type TEXT NOT NULL DEFAULT '',
  adjust_bps INTEGER NOT NULL CHECK (adjust_bps BETWEEN -9000 AND 50000),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (end_date >= start_date)
);
CREATE TABLE IF NOT EXISTS hotel_rate_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  supplement_cents BIGINT NOT NULL DEFAULT 0 CHECK (supplement_cents >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS hotel_night_audits (
  business_date TEXT PRIMARY KEY,
  run_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  summary_json TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE hotel_reservations ADD COLUMN IF NOT EXISTS nightly_rates_json TEXT;
ALTER TABLE hotel_reservations ADD COLUMN IF NOT EXISTS no_show INTEGER NOT NULL DEFAULT 0;
ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS business_unit TEXT NOT NULL DEFAULT 'shared';
