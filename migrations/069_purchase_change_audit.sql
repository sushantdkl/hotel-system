CREATE TABLE IF NOT EXISTS purchase_change_audit (
  id SERIAL PRIMARY KEY,
  purchase_id INTEGER,
  action TEXT NOT NULL,
  effective_date DATE,
  business_day_id INTEGER REFERENCES business_days(id) ON DELETE SET NULL,
  performed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  before_data JSONB,
  after_data JSONB,
  note TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_purchase_change_audit_effective
  ON purchase_change_audit(effective_date, created_at);
