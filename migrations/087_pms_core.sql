-- PMS core: traceable folio transactions (source, reversal, windows, transfers),
-- reservation detail, master (group) reservations, room-move history, routing
-- rules, deposit liability applications, room service status.
-- SQLite mirror: PMS_CORE_SCHEMA / upgradeFolioTable in lib/hotel/folio-schema.js.

-- Folio rows: four kinds. Balance = charge + refund - payment - credit.
ALTER TABLE hotel_folio_entries DROP CONSTRAINT IF EXISTS hotel_folio_entries_kind_check;
ALTER TABLE hotel_folio_entries DROP CONSTRAINT IF EXISTS hotel_folio_entries_category_check;
ALTER TABLE hotel_folio_entries DROP CONSTRAINT IF EXISTS hotel_folio_entries_payment_method_check;
ALTER TABLE hotel_folio_entries ADD CONSTRAINT hotel_folio_entries_kind_check CHECK (kind IN ('charge', 'payment', 'credit', 'refund'));
ALTER TABLE hotel_folio_entries ADD CONSTRAINT hotel_folio_entries_category_check CHECK (category IN ('room', 'service', 'payment', 'deposit', 'adjustment', 'transfer'));
ALTER TABLE hotel_folio_entries ADD CONSTRAINT hotel_folio_entries_payment_method_check CHECK (payment_method IN ('Cash', 'Online', 'Card', 'Bank', 'City Ledger'));
ALTER TABLE hotel_folio_entries ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'OTHER';
ALTER TABLE hotel_folio_entries ADD COLUMN IF NOT EXISTS source_id TEXT;
ALTER TABLE hotel_folio_entries ADD COLUMN IF NOT EXISTS room_number TEXT;
ALTER TABLE hotel_folio_entries ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;
ALTER TABLE hotel_folio_entries ADD COLUMN IF NOT EXISTS unit_cents BIGINT;
ALTER TABLE hotel_folio_entries ADD COLUMN IF NOT EXISTS discount_cents BIGINT NOT NULL DEFAULT 0;
ALTER TABLE hotel_folio_entries ADD COLUMN IF NOT EXISTS package_cents BIGINT NOT NULL DEFAULT 0;
ALTER TABLE hotel_folio_entries ADD COLUMN IF NOT EXISTS window_no INTEGER NOT NULL DEFAULT 1;
ALTER TABLE hotel_folio_entries ADD COLUMN IF NOT EXISTS reversal_of INTEGER REFERENCES hotel_folio_entries(id);
ALTER TABLE hotel_folio_entries ADD COLUMN IF NOT EXISTS transfer_ref TEXT;
ALTER TABLE hotel_folio_entries ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE hotel_folio_entries ADD COLUMN IF NOT EXISTS city_ledger_account TEXT;
ALTER TABLE hotel_folio_entries DROP CONSTRAINT IF EXISTS hotel_folio_entries_window_check;
ALTER TABLE hotel_folio_entries ADD CONSTRAINT hotel_folio_entries_window_check CHECK (window_no BETWEEN 1 AND 4);
CREATE UNIQUE INDEX IF NOT EXISTS ux_hotel_folio_reversal ON hotel_folio_entries(reversal_of) WHERE reversal_of IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hotel_folio_source ON hotel_folio_entries(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_hotel_folio_service_date ON hotel_folio_entries(service_date, category);
CREATE INDEX IF NOT EXISTS idx_hotel_folio_business_day ON hotel_folio_entries(business_day_id);

-- Legacy rows: refunds were stored as charges; label sources.
UPDATE hotel_folio_entries SET kind = 'refund', category = 'payment', source_type = 'REFUND' WHERE source_key LIKE 'refund:%' AND kind = 'charge';
UPDATE hotel_folio_entries SET source_type = 'ROOM' WHERE category = 'room' AND source_type = 'OTHER';
UPDATE hotel_folio_entries SET source_type = 'RESTAURANT', source_id = SUBSTRING(source_key FROM 17) WHERE source_key LIKE 'restaurant-bill:%' AND source_type = 'OTHER';
UPDATE hotel_folio_entries SET source_type = 'MINIBAR' WHERE description LIKE 'Minibar%' AND source_type = 'OTHER';
UPDATE hotel_folio_entries SET source_type = 'PAYMENT' WHERE kind = 'payment' AND source_type = 'OTHER';

-- Reservation detail.
ALTER TABLE hotel_reservations ADD COLUMN IF NOT EXISTS adults INTEGER;
ALTER TABLE hotel_reservations ADD COLUMN IF NOT EXISTS children INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hotel_reservations ADD COLUMN IF NOT EXISTS booking_type TEXT NOT NULL DEFAULT 'confirmed';
ALTER TABLE hotel_reservations ADD COLUMN IF NOT EXISTS company TEXT NOT NULL DEFAULT '';
ALTER TABLE hotel_reservations ADD COLUMN IF NOT EXISTS travel_agent TEXT NOT NULL DEFAULT '';
ALTER TABLE hotel_reservations ADD COLUMN IF NOT EXISTS market_segment TEXT NOT NULL DEFAULT '';
ALTER TABLE hotel_reservations ADD COLUMN IF NOT EXISTS guarantee TEXT NOT NULL DEFAULT '';
ALTER TABLE hotel_reservations ADD COLUMN IF NOT EXISTS special_requests TEXT NOT NULL DEFAULT '';
ALTER TABLE hotel_reservations ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';
ALTER TABLE hotel_reservations ADD COLUMN IF NOT EXISTS no_post INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hotel_reservations ADD COLUMN IF NOT EXISTS credit_limit_cents BIGINT;
UPDATE hotel_reservations SET adults = guest_count WHERE adults IS NULL;
CREATE INDEX IF NOT EXISTS idx_hotel_reservations_arrival ON hotel_reservations(status, arrival_date);
CREATE INDEX IF NOT EXISTS idx_hotel_reservations_departure ON hotel_reservations(status, departure_date);
CREATE INDEX IF NOT EXISTS idx_hotel_reservations_guest ON hotel_reservations(guest_id);
CREATE INDEX IF NOT EXISTS idx_hotel_reservations_group ON hotel_reservations(group_id);

-- Out of order (repair) vs out of service (short-term); DND / pickup flag.
ALTER TABLE hotel_rooms ADD COLUMN IF NOT EXISTS block_kind TEXT NOT NULL DEFAULT 'out_of_order';
ALTER TABLE hotel_rooms ADD COLUMN IF NOT EXISTS hk_flag TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS hotel_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  primary_guest_id TEXT REFERENCES hotel_guests(id),
  master_reservation_id TEXT REFERENCES hotel_reservations(id),
  payer_mode TEXT NOT NULL DEFAULT 'individual' CHECK (payer_mode IN ('master', 'individual', 'mixed')),
  company TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO hotel_groups (id, name, primary_guest_id, master_reservation_id, payer_mode)
SELECT g.group_id, MIN(g.guest_name), MIN(g.guest_id), MIN(g.id), 'individual'
FROM hotel_reservations g WHERE g.group_id IS NOT NULL GROUP BY g.group_id
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS hotel_room_moves (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL REFERENCES hotel_reservations(id),
  from_room_id TEXT NOT NULL REFERENCES hotel_rooms(id),
  to_room_id TEXT NOT NULL REFERENCES hotel_rooms(id),
  from_room_number TEXT NOT NULL,
  to_room_number TEXT NOT NULL,
  reason TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  rate_decision TEXT NOT NULL CHECK (rate_decision IN ('keep', 'new')),
  old_rate_cents BIGINT NOT NULL,
  new_rate_cents BIGINT NOT NULL,
  business_date TEXT NOT NULL,
  moved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_hotel_room_moves_reservation ON hotel_room_moves(reservation_id);
CREATE INDEX IF NOT EXISTS idx_hotel_room_moves_date ON hotel_room_moves(business_date);

CREATE TABLE IF NOT EXISTS hotel_folio_windows (
  reservation_id TEXT NOT NULL REFERENCES hotel_reservations(id),
  window_no INTEGER NOT NULL CHECK (window_no BETWEEN 1 AND 4),
  payer_type TEXT NOT NULL DEFAULT 'guest' CHECK (payer_type IN ('guest', 'company', 'agent', 'master')),
  payer_name TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (reservation_id, window_no)
);

CREATE TABLE IF NOT EXISTS hotel_routing_rules (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL REFERENCES hotel_reservations(id),
  source_types TEXT NOT NULL DEFAULT '*',
  target_reservation_id TEXT NOT NULL REFERENCES hotel_reservations(id),
  target_window INTEGER NOT NULL DEFAULT 1 CHECK (target_window BETWEEN 1 AND 4),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_hotel_routing_source ON hotel_routing_rules(reservation_id, active);

CREATE TABLE IF NOT EXISTS hotel_deposit_applications (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL REFERENCES hotel_reservations(id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  journal_id INTEGER REFERENCES journal_entries(id),
  business_day_id INTEGER REFERENCES business_days(id),
  source_key TEXT NOT NULL UNIQUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_hotel_deposit_app_reservation ON hotel_deposit_applications(reservation_id);

INSERT INTO accounts (code, name, type, subtype, parent_id, is_system) VALUES
('1330','Corporate & Agent Receivables','asset','city_ledger',(SELECT id FROM accounts WHERE code='1000'),1),
('2150','Guest Advance Deposits','liability','guest_deposits',(SELECT id FROM accounts WHERE code='2000'),1),
('2160','Package Allowance Liability','liability','package_allowance',(SELECT id FROM accounts WHERE code='2000'),1),
('4041','Laundry Revenue','income','hotel_laundry',(SELECT id FROM accounts WHERE code='4000'),1),
('4042','Minibar Revenue','income','hotel_minibar',(SELECT id FROM accounts WHERE code='4000'),1),
('4043','Transport Revenue','income','hotel_transport',(SELECT id FROM accounts WHERE code='4000'),1),
('4045','Package Breakage Revenue','income','hotel_package_breakage',(SELECT id FROM accounts WHERE code='4000'),1)
ON CONFLICT(code) DO NOTHING;
