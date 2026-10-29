-- Guest folios, ledger posting, immutable checkout statements and cleaning dispatch.
ALTER TABLE hotel_properties ADD COLUMN IF NOT EXISTS room_tax_bps INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hotel_reservations ADD COLUMN IF NOT EXISTS room_tax_bps INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hotel_reservations ADD COLUMN IF NOT EXISTS checked_out_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS hotel_folio_entries (
  id SERIAL PRIMARY KEY,
  reservation_id TEXT NOT NULL REFERENCES hotel_reservations(id),
  kind TEXT NOT NULL CHECK (kind IN ('charge', 'payment')),
  category TEXT NOT NULL CHECK (category IN ('room', 'service', 'payment')),
  description TEXT NOT NULL, service_date TEXT NOT NULL,
  net_cents BIGINT NOT NULL CHECK (net_cents >= 0), tax_cents BIGINT NOT NULL CHECK (tax_cents >= 0),
  amount_cents BIGINT NOT NULL CHECK (amount_cents = net_cents + tax_cents),
  payment_method TEXT CHECK (payment_method IN ('Cash', 'Online')),
  source_key TEXT NOT NULL UNIQUE,
  journal_id INTEGER REFERENCES journal_entries(id), business_day_id INTEGER REFERENCES business_days(id),
  created_by INTEGER NOT NULL REFERENCES users(id), created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
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

INSERT INTO accounts (code, name, type, subtype, parent_id, is_system) VALUES
('1320','Hotel Guest Receivables','asset','hotel_receivable',(SELECT id FROM accounts WHERE code='1000'),1),
('4030','Hotel Room Revenue','income','hotel_rooms',(SELECT id FROM accounts WHERE code='4000'),1),
('4040','Hotel Service Revenue','income','hotel_services',(SELECT id FROM accounts WHERE code='4000'),1)
ON CONFLICT(code) DO NOTHING;
