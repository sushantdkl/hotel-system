export const HOTEL_UPGRADE_COLUMNS = [
  ['hotel_properties', 'room_tax_bps', 'INTEGER NOT NULL DEFAULT 0'],
  ['hotel_reservations', 'room_tax_bps', 'INTEGER NOT NULL DEFAULT 0'],
  ['hotel_reservations', 'checked_out_at', 'TIMESTAMP'],
  ['hotel_reservations', 'guest_id', 'TEXT'],
  ['hotel_reservations', 'group_id', 'TEXT'],
  ['hotel_reservations', 'nightly_rates_json', 'TEXT'],
  ['hotel_reservations', 'no_show', 'INTEGER NOT NULL DEFAULT 0'],
  ['hotel_reservations', 'precheckin_token', 'TEXT'],
  ['hotel_reservations', 'precheckin_at', 'TEXT'],
  ['hotel_reservations', 'eta', 'TEXT'],
];
// Added after the housekeeping table exists (see ensureHotelSchema).
export const HOTEL_LATE_COLUMNS = [
  ['hotel_housekeeping_tasks', 'assigned_to', 'INTEGER'],
];

// Room categories. Mirrors migrations/085_room_categories.sql.
export const HOTEL_CATEGORY_SCHEMA = `
CREATE TABLE IF NOT EXISTS hotel_room_types (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, base_rate_cents BIGINT NOT NULL DEFAULT 0 CHECK (base_rate_cents >= 0),
  capacity INTEGER NOT NULL DEFAULT 2 CHECK (capacity BETWEEN 1 AND 20), beds TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
  amenities TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

// OTA sync. Mirrors migrations/082_ota_sync.sql.
export const HOTEL_OTA_SCHEMA = `
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
`;

// Maintenance tickets. Mirrors migrations/081_operations.sql.
export const HOTEL_OPERATIONS_SCHEMA = `
CREATE TABLE IF NOT EXISTS hotel_maintenance_tickets (
  id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES hotel_rooms(id), title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '', priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'urgent')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
  blocked_room INTEGER NOT NULL DEFAULT 0 CHECK (blocked_room IN (0, 1)), photo_mime TEXT, photo_base64 TEXT,
  reported_by INTEGER REFERENCES users(id) ON DELETE SET NULL, assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolution_note TEXT, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, resolved_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_hotel_tickets_status ON hotel_maintenance_tickets(status, created_at);
`;

// Seasons, rate plans and the night audit log. Mirrors migrations/080_rates_night_audit.sql.
export const HOTEL_RATES_SCHEMA = `
CREATE TABLE IF NOT EXISTS hotel_rate_seasons (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
  room_type TEXT NOT NULL DEFAULT '', adjust_bps INTEGER NOT NULL CHECK (adjust_bps BETWEEN -9000 AND 50000),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, CHECK (end_date >= start_date)
);
CREATE TABLE IF NOT EXISTS hotel_rate_plans (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, supplement_cents BIGINT NOT NULL DEFAULT 0 CHECK (supplement_cents >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS hotel_night_audits (
  business_date TEXT PRIMARY KEY, run_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  summary_json TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

// Guest profiles and private ID/KYC files (stored in the database, never under
// public/). Mirrors migrations/079_hotel_front_desk.sql.
export const HOTEL_GUEST_SCHEMA = `
CREATE TABLE IF NOT EXISTS hotel_guests (
  id TEXT PRIMARY KEY, full_name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
  nationality TEXT NOT NULL DEFAULT '', id_type TEXT NOT NULL DEFAULT '', id_number TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '', vip INTEGER NOT NULL DEFAULT 0 CHECK (vip IN (0, 1)),
  blacklisted INTEGER NOT NULL DEFAULT 0 CHECK (blacklisted IN (0, 1)), notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_hotel_guests_phone ON hotel_guests(phone);
CREATE TABLE IF NOT EXISTS hotel_guest_documents (
  id TEXT PRIMARY KEY, guest_id TEXT NOT NULL REFERENCES hotel_guests(id) ON DELETE CASCADE,
  label TEXT NOT NULL, file_name TEXT NOT NULL, mime TEXT NOT NULL, size_bytes INTEGER NOT NULL, data_base64 TEXT NOT NULL,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_hotel_guest_documents_guest ON hotel_guest_documents(guest_id);
`;

export const HOTEL_FOLIO_SCHEMA = `
CREATE TABLE IF NOT EXISTS hotel_folio_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id TEXT NOT NULL REFERENCES hotel_reservations(id),
  kind TEXT NOT NULL CHECK (kind IN ('charge', 'payment', 'credit', 'refund')),
  category TEXT NOT NULL CHECK (category IN ('room', 'service', 'payment', 'deposit', 'adjustment', 'transfer')),
  description TEXT NOT NULL, service_date TEXT NOT NULL,
  net_cents BIGINT NOT NULL CHECK (net_cents >= 0), tax_cents BIGINT NOT NULL CHECK (tax_cents >= 0),
  amount_cents BIGINT NOT NULL CHECK (amount_cents = net_cents + tax_cents),
  payment_method TEXT CHECK (payment_method IN ('Cash', 'Online', 'Card', 'Bank', 'City Ledger')),
  source_key TEXT NOT NULL UNIQUE,
  journal_id INTEGER REFERENCES journal_entries(id), business_day_id INTEGER REFERENCES business_days(id),
  created_by INTEGER NOT NULL REFERENCES users(id), created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_type TEXT NOT NULL DEFAULT 'OTHER', source_id TEXT, room_number TEXT,
  quantity INTEGER NOT NULL DEFAULT 1, unit_cents BIGINT, discount_cents BIGINT NOT NULL DEFAULT 0,
  package_cents BIGINT NOT NULL DEFAULT 0, window_no INTEGER NOT NULL DEFAULT 1 CHECK (window_no BETWEEN 1 AND 4),
  reversal_of INTEGER, transfer_ref TEXT, reason TEXT, city_ledger_account TEXT
);
CREATE INDEX IF NOT EXISTS idx_hotel_folio_reservation ON hotel_folio_entries(reservation_id, id);
CREATE TABLE IF NOT EXISTS hotel_checkout_statements (
  reservation_id TEXT PRIMARY KEY REFERENCES hotel_reservations(id),
  statement_number TEXT NOT NULL UNIQUE, snapshot_json TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id), created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS hotel_housekeeping_tasks (
  id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES hotel_rooms(id),
  reservation_id TEXT UNIQUE REFERENCES hotel_reservations(id),
  status TEXT NOT NULL DEFAULT 'dirty' CHECK (status IN ('dirty', 'cleaning', 'inspection', 'ready')),
  priority TEXT NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Normal', 'High')),
  note TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  updated_by INTEGER REFERENCES users(id), created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hotel_one_open_cleaning ON hotel_housekeeping_tasks(room_id) WHERE status <> 'ready';
`;

// Columns every folio row had before migration 087 (SQLite rebuild copies these).
const FOLIO_V1_COLUMNS = ['id', 'reservation_id', 'kind', 'category', 'description', 'service_date', 'net_cents', 'tax_cents', 'amount_cents', 'payment_method', 'source_key', 'journal_id', 'business_day_id', 'created_by', 'created_at'];

/**
 * SQLite cannot change CHECK constraints in place. A folio table created before
 * migration 087 (charge/payment only) is rebuilt once with the wider checks;
 * rows and ids are copied unchanged, then legacy rows are labelled like 087.
 */
export async function upgradeFolioTable(db) {
  const row = await db.get("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'hotel_folio_entries'");
  if (!row) return;
  if (!String(row.sql).includes("'credit'")) {
    const create = HOTEL_FOLIO_SCHEMA.split(';')[0].replace('CREATE TABLE IF NOT EXISTS hotel_folio_entries', 'CREATE TABLE hotel_folio_entries_v2');
    await db.transaction(async (tx) => {
      await tx.run(create);
      await tx.run(`INSERT INTO hotel_folio_entries_v2 (${FOLIO_V1_COLUMNS.join(', ')}) SELECT ${FOLIO_V1_COLUMNS.join(', ')} FROM hotel_folio_entries`);
      await tx.run('DROP TABLE hotel_folio_entries');
      await tx.run('ALTER TABLE hotel_folio_entries_v2 RENAME TO hotel_folio_entries');
      await tx.run('CREATE INDEX IF NOT EXISTS idx_hotel_folio_reservation ON hotel_folio_entries(reservation_id, id)');
    });
  }
  await db.run("UPDATE hotel_folio_entries SET kind = 'refund', category = 'payment', source_type = 'REFUND' WHERE source_key LIKE 'refund:%' AND kind = 'charge'");
  await db.run("UPDATE hotel_folio_entries SET source_type = 'ROOM' WHERE category = 'room' AND source_type = 'OTHER'");
  await db.run("UPDATE hotel_folio_entries SET source_type = 'RESTAURANT', source_id = substr(source_key, 17) WHERE source_key LIKE 'restaurant-bill:%' AND source_type = 'OTHER'");
  await db.run("UPDATE hotel_folio_entries SET source_type = 'MINIBAR' WHERE description LIKE 'Minibar%' AND source_type = 'OTHER'");
  await db.run("UPDATE hotel_folio_entries SET source_type = 'PAYMENT' WHERE kind = 'payment' AND source_type = 'OTHER'");
}

export const PMS_CORE_COLUMNS = [
  ['hotel_reservations', 'adults', 'INTEGER'],
  ['hotel_reservations', 'children', 'INTEGER NOT NULL DEFAULT 0'],
  ['hotel_reservations', 'booking_type', "TEXT NOT NULL DEFAULT 'confirmed'"],
  ['hotel_reservations', 'company', "TEXT NOT NULL DEFAULT ''"],
  ['hotel_reservations', 'travel_agent', "TEXT NOT NULL DEFAULT ''"],
  ['hotel_reservations', 'market_segment', "TEXT NOT NULL DEFAULT ''"],
  ['hotel_reservations', 'guarantee', "TEXT NOT NULL DEFAULT ''"],
  ['hotel_reservations', 'special_requests', "TEXT NOT NULL DEFAULT ''"],
  ['hotel_reservations', 'notes', "TEXT NOT NULL DEFAULT ''"],
  ['hotel_reservations', 'no_post', 'INTEGER NOT NULL DEFAULT 0'],
  ['hotel_reservations', 'credit_limit_cents', 'BIGINT'],
  ['hotel_rooms', 'block_kind', "TEXT NOT NULL DEFAULT 'out_of_order'"],
  ['hotel_rooms', 'hk_flag', "TEXT NOT NULL DEFAULT ''"],
];

// Mirrors the new tables and indexes of migrations/087_pms_core.sql.
export const PMS_CORE_SCHEMA = `
CREATE UNIQUE INDEX IF NOT EXISTS ux_hotel_folio_reversal ON hotel_folio_entries(reversal_of) WHERE reversal_of IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hotel_folio_source ON hotel_folio_entries(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_hotel_folio_service_date ON hotel_folio_entries(service_date, category);
CREATE INDEX IF NOT EXISTS idx_hotel_folio_business_day ON hotel_folio_entries(business_day_id);
CREATE INDEX IF NOT EXISTS idx_hotel_reservations_arrival ON hotel_reservations(status, arrival_date);
CREATE INDEX IF NOT EXISTS idx_hotel_reservations_departure ON hotel_reservations(status, departure_date);
CREATE INDEX IF NOT EXISTS idx_hotel_reservations_guest ON hotel_reservations(guest_id);
CREATE INDEX IF NOT EXISTS idx_hotel_reservations_group ON hotel_reservations(group_id);
CREATE TABLE IF NOT EXISTS hotel_groups (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, primary_guest_id TEXT REFERENCES hotel_guests(id),
  master_reservation_id TEXT REFERENCES hotel_reservations(id),
  payer_mode TEXT NOT NULL DEFAULT 'individual' CHECK (payer_mode IN ('master', 'individual', 'mixed')),
  company TEXT NOT NULL DEFAULT '', created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS hotel_room_moves (
  id TEXT PRIMARY KEY, reservation_id TEXT NOT NULL REFERENCES hotel_reservations(id),
  from_room_id TEXT NOT NULL REFERENCES hotel_rooms(id), to_room_id TEXT NOT NULL REFERENCES hotel_rooms(id),
  from_room_number TEXT NOT NULL, to_room_number TEXT NOT NULL, reason TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
  rate_decision TEXT NOT NULL CHECK (rate_decision IN ('keep', 'new')), old_rate_cents BIGINT NOT NULL, new_rate_cents BIGINT NOT NULL,
  business_date TEXT NOT NULL, moved_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_hotel_room_moves_reservation ON hotel_room_moves(reservation_id);
CREATE INDEX IF NOT EXISTS idx_hotel_room_moves_date ON hotel_room_moves(business_date);
CREATE TABLE IF NOT EXISTS hotel_folio_windows (
  reservation_id TEXT NOT NULL REFERENCES hotel_reservations(id), window_no INTEGER NOT NULL CHECK (window_no BETWEEN 1 AND 4),
  payer_type TEXT NOT NULL DEFAULT 'guest' CHECK (payer_type IN ('guest', 'company', 'agent', 'master')),
  payer_name TEXT NOT NULL DEFAULT '', PRIMARY KEY (reservation_id, window_no)
);
CREATE TABLE IF NOT EXISTS hotel_routing_rules (
  id TEXT PRIMARY KEY, reservation_id TEXT NOT NULL REFERENCES hotel_reservations(id), source_types TEXT NOT NULL DEFAULT '*',
  target_reservation_id TEXT NOT NULL REFERENCES hotel_reservations(id), target_window INTEGER NOT NULL DEFAULT 1 CHECK (target_window BETWEEN 1 AND 4),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)), created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_hotel_routing_source ON hotel_routing_rules(reservation_id, active);
CREATE TABLE IF NOT EXISTS hotel_deposit_applications (
  id TEXT PRIMARY KEY, reservation_id TEXT NOT NULL REFERENCES hotel_reservations(id), amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  journal_id INTEGER REFERENCES journal_entries(id), business_day_id INTEGER REFERENCES business_days(id), source_key TEXT NOT NULL UNIQUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_hotel_deposit_app_reservation ON hotel_deposit_applications(reservation_id);
`;
