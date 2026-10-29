-- 038: admin-configurable permission matrix for a curated set of sensitive
-- actions (cancel order/item/KOT, void/refund/reopen/discount a bill).
-- Rows are seeded lazily on first read/write by lib/permissions.js; an
-- absent row falls back to the hardcoded default for that role/key.

CREATE TABLE IF NOT EXISTS role_permissions (
  role TEXT NOT NULL,
  permission_key TEXT NOT NULL,
  allowed INTEGER NOT NULL DEFAULT 0,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (role, permission_key)
);

CREATE TABLE IF NOT EXISTS permission_audit (
  id SERIAL PRIMARY KEY,
  role TEXT NOT NULL,
  permission_key TEXT NOT NULL,
  previous_value INTEGER,
  new_value INTEGER NOT NULL,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_permission_audit_created ON permission_audit(created_at DESC, id DESC);
