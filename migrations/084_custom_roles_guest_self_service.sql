-- Phase 9: custom staff roles, room-service QR tables, online check-in.
-- SQLite creates these on demand (lib/permissions.js, lib/hotel/room-service.js,
-- lib/hotel/folio-schema.js).
CREATE TABLE IF NOT EXISTS staff_custom_roles (
  role_key TEXT PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  base_role TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_role TEXT REFERENCES staff_custom_roles(role_key) ON DELETE SET NULL;

ALTER TABLE tables ADD COLUMN IF NOT EXISTS qr_token TEXT;
ALTER TABLE tables ADD COLUMN IF NOT EXISTS hotel_room_id TEXT REFERENCES hotel_rooms(id) ON DELETE SET NULL;

ALTER TABLE hotel_reservations ADD COLUMN IF NOT EXISTS precheckin_token TEXT UNIQUE;
ALTER TABLE hotel_reservations ADD COLUMN IF NOT EXISTS precheckin_at TEXT;
ALTER TABLE hotel_reservations ADD COLUMN IF NOT EXISTS eta TEXT;
