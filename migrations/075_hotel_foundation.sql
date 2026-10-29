-- Hotel foundation. Numbers 072-074 reserved for the restaurant parity port.

CREATE TABLE IF NOT EXISTS hotel_properties (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'Asia/Kathmandu',
  currency TEXT NOT NULL DEFAULT 'NPR', updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS hotel_rooms (
  id TEXT PRIMARY KEY, property_id TEXT NOT NULL REFERENCES hotel_properties(id),
  room_number TEXT NOT NULL, floor INTEGER NOT NULL CHECK (floor BETWEEN 0 AND 99),
  room_type TEXT NOT NULL, capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 20),
  nightly_rate_cents BIGINT NOT NULL CHECK (nightly_rate_cents >= 0),
  cleaning_status TEXT NOT NULL DEFAULT 'ready' CHECK (cleaning_status IN ('ready', 'dirty', 'cleaning', 'inspection')),
  blocked INTEGER NOT NULL DEFAULT 0 CHECK (blocked IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(property_id, room_number)
);
CREATE TABLE IF NOT EXISTS hotel_reservations (
  id TEXT PRIMARY KEY, property_id TEXT NOT NULL REFERENCES hotel_properties(id),
  room_id TEXT NOT NULL REFERENCES hotel_rooms(id), guest_name TEXT NOT NULL,
  guest_phone TEXT NOT NULL DEFAULT '', arrival_date TEXT NOT NULL, departure_date TEXT NOT NULL,
  guest_count INTEGER NOT NULL CHECK (guest_count BETWEEN 1 AND 20),
  source TEXT NOT NULL DEFAULT 'Direct', meal_plan TEXT NOT NULL DEFAULT 'Room only',
  nightly_rate_cents BIGINT NOT NULL CHECK (nightly_rate_cents >= 0),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'in_house', 'cancelled')),
  checked_in_at TIMESTAMP, cancelled_at TIMESTAMP,
  created_by INTEGER REFERENCES users(id), created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (departure_date > arrival_date)
);
CREATE INDEX IF NOT EXISTS idx_hotel_reservations_room_dates ON hotel_reservations(room_id, status, arrival_date, departure_date);
CREATE TABLE IF NOT EXISTS hotel_audit_events (
  id TEXT PRIMARY KEY, property_id TEXT NOT NULL REFERENCES hotel_properties(id),
  actor_id INTEGER REFERENCES users(id), action TEXT NOT NULL, entity_id TEXT NOT NULL,
  details TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS hotel_command_receipts (
  request_key TEXT PRIMARY KEY, actor_id INTEGER NOT NULL REFERENCES users(id),
  payload_hash TEXT NOT NULL, result_json TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO hotel_properties (id, name) VALUES ('main', 'Your hotel') ON CONFLICT(id) DO NOTHING;
