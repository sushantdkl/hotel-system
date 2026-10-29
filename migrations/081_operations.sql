-- Phase 6: maintenance and watchman roles, cleaning assignment, staff
-- notifications, maintenance tickets, security / gate log.
-- Keep the role list in sync with lib/roles.js and the tables with
-- HOTEL_OPERATIONS_SCHEMA (lib/hotel/folio-schema.js) and lib/notifications.js.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'manager', 'cashier', 'waiter', 'kitchen', 'receptionist', 'housekeeping', 'maintenance', 'watchman'));

ALTER TABLE hotel_housekeeping_tasks ADD COLUMN IF NOT EXISTS assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS staff_notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  read_at TIMESTAMP,
  delivered_at TIMESTAMP,
  delivery_error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_staff_notifications_user ON staff_notifications(user_id, read_at);

CREATE TABLE IF NOT EXISTS hotel_maintenance_tickets (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES hotel_rooms(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'urgent')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
  blocked_room INTEGER NOT NULL DEFAULT 0 CHECK (blocked_room IN (0, 1)),
  photo_mime TEXT,
  photo_base64 TEXT,
  reported_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolution_note TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_hotel_tickets_status ON hotel_maintenance_tickets(status, created_at);

CREATE TABLE IF NOT EXISTS security_log (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('visitor', 'vendor', 'vehicle', 'patrol', 'incident')),
  name TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT '',
  vehicle_no TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  in_at TEXT NOT NULL,
  out_at TEXT,
  logged_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_security_log_in ON security_log(in_at);
