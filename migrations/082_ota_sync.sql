-- OTA / channel manager sync: channels, per-room iCal feeds, OTA bookings,
-- sync log and conflict queue. Keep in sync with HOTEL_OTA_SCHEMA in
-- lib/hotel/folio-schema.js.
CREATE TABLE IF NOT EXISTS hotel_ota_channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  commission_bps INTEGER NOT NULL DEFAULT 0 CHECK (commission_bps BETWEEN 0 AND 5000),
  webhook_token TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS hotel_ota_feeds (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES hotel_ota_channels(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES hotel_rooms(id),
  import_url TEXT NOT NULL DEFAULT '',
  export_token TEXT NOT NULL UNIQUE,
  last_sync_at TIMESTAMP,
  last_error TEXT,
  UNIQUE (channel_id, room_id)
);
CREATE TABLE IF NOT EXISTS hotel_ota_bookings (
  channel_id TEXT NOT NULL REFERENCES hotel_ota_channels(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  reservation_id TEXT REFERENCES hotel_reservations(id),
  status TEXT NOT NULL,
  total_cents BIGINT NOT NULL DEFAULT 0,
  commission_cents BIGINT NOT NULL DEFAULT 0,
  prepaid INTEGER NOT NULL DEFAULT 0 CHECK (prepaid IN (0, 1)),
  payload_json TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (channel_id, external_id)
);
CREATE TABLE IF NOT EXISTS hotel_ota_log (
  id TEXT PRIMARY KEY,
  channel_id TEXT REFERENCES hotel_ota_channels(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('webhook', 'ical')),
  outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'conflict', 'error', 'ignored')),
  external_id TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_hotel_ota_log_created ON hotel_ota_log(created_at);
CREATE TABLE IF NOT EXISTS hotel_ota_conflicts (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES hotel_ota_channels(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  event_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolution TEXT,
  resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_hotel_ota_conflicts_status ON hotel_ota_conflicts(status, created_at);
