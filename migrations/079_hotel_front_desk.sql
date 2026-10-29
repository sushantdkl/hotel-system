-- Guest profiles, private ID/KYC documents, group bookings.
-- Keep in sync with HOTEL_GUEST_SCHEMA in lib/hotel/folio-schema.js.
CREATE TABLE IF NOT EXISTS hotel_guests (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  nationality TEXT NOT NULL DEFAULT '',
  id_type TEXT NOT NULL DEFAULT '',
  id_number TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  vip INTEGER NOT NULL DEFAULT 0 CHECK (vip IN (0, 1)),
  blacklisted INTEGER NOT NULL DEFAULT 0 CHECK (blacklisted IN (0, 1)),
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_hotel_guests_phone ON hotel_guests(phone);
CREATE TABLE IF NOT EXISTS hotel_guest_documents (
  id TEXT PRIMARY KEY,
  guest_id TEXT NOT NULL REFERENCES hotel_guests(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  data_base64 TEXT NOT NULL,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_hotel_guest_documents_guest ON hotel_guest_documents(guest_id);
ALTER TABLE hotel_reservations ADD COLUMN IF NOT EXISTS guest_id TEXT REFERENCES hotel_guests(id);
ALTER TABLE hotel_reservations ADD COLUMN IF NOT EXISTS group_id TEXT;
