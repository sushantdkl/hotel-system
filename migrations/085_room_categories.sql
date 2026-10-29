-- Room categories (name, default price, capacity, beds, amenities).
-- Keep in sync with HOTEL_CATEGORY_SCHEMA in lib/hotel/folio-schema.js.
CREATE TABLE IF NOT EXISTS hotel_room_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  base_rate_cents BIGINT NOT NULL DEFAULT 0 CHECK (base_rate_cents >= 0),
  capacity INTEGER NOT NULL DEFAULT 2 CHECK (capacity BETWEEN 1 AND 20),
  beds TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  amenities TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
