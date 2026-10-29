-- Bridge the 037-043 migration-number collision between the production
-- Dim Sum Puri lineage and the newer feature lineage. Every operation is
-- additive/idempotent so existing operational and financial rows remain intact.

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
CREATE INDEX IF NOT EXISTS idx_permission_audit_created
  ON permission_audit(created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS waiter_requests (
  id SERIAL PRIMARY KEY,
  table_id INTEGER NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL DEFAULT 'service'
    CHECK (request_type IN ('service', 'order', 'bill', 'water')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'acknowledged', 'completed', 'cancelled')),
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  acknowledged_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMP,
  completed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  completed_at TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_waiter_requests_one_active_table
  ON waiter_requests(table_id) WHERE status IN ('pending', 'acknowledged');
CREATE INDEX IF NOT EXISTS idx_waiter_requests_active
  ON waiter_requests(status, requested_at);
CREATE INDEX IF NOT EXISTS idx_waiter_requests_history
  ON waiter_requests(requested_at DESC, id DESC);

ALTER TABLE kots ADD COLUMN IF NOT EXISTS void_reason TEXT;
ALTER TABLE kots ADD COLUMN IF NOT EXISTS voided_at TIMESTAMP;
ALTER TABLE kots ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
ALTER TABLE kots ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;
ALTER TABLE kots ADD COLUMN IF NOT EXISTS cancelled_by INTEGER;
ALTER TABLE kots ADD COLUMN IF NOT EXISTS previous_status TEXT;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS prep_started_at TIMESTAMP;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ready_at TIMESTAMP;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS prepared_by INTEGER;
CREATE INDEX IF NOT EXISTS idx_orders_ready_at ON orders(ready_at);
CREATE INDEX IF NOT EXISTS idx_orders_prepared_by ON orders(prepared_by);

CREATE TABLE IF NOT EXISTS salary_advances (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES users(id),
  amount DOUBLE PRECISION NOT NULL CHECK (amount > 0),
  advanced_on DATE NOT NULL DEFAULT CURRENT_DATE,
  method TEXT NOT NULL DEFAULT 'cash',
  note TEXT,
  given_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  business_day_id INTEGER REFERENCES business_days(id),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE salary_payments ADD COLUMN IF NOT EXISTS gross_amount DOUBLE PRECISION;
ALTER TABLE salary_payments ADD COLUMN IF NOT EXISTS advance_deduction DOUBLE PRECISION NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_salary_advances_employee_date
  ON salary_advances(employee_id, advanced_on DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_salary_advances_business_day
  ON salary_advances(business_day_id);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_distance_km NUMERIC(10,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_pricing_label TEXT;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(14,2) NOT NULL DEFAULT 0;

INSERT INTO system_settings (setting_key, setting_value) VALUES
  ('delivery_pricing_enabled', 'false'),
  ('delivery_pricing_mode', 'fixed'),
  ('delivery_fixed_fee', '0'),
  ('delivery_distance_bands', '[]'),
  ('delivery_per_km_rate', '0'),
  ('delivery_minimum_fee', '0'),
  ('delivery_max_distance_km', '0')
ON CONFLICT (setting_key) DO NOTHING;
