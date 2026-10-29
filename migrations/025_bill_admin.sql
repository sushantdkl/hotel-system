-- Admin bill management: non-destructive bill revisions and activity audit.
-- The original finalized bill, its payments and journals remain immutable;
-- changes are represented by revision/delta records and audited actions.

CREATE TABLE IF NOT EXISTS bill_revisions (
  id SERIAL PRIMARY KEY,
  bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open',
  reason TEXT,
  original_snapshot TEXT,
  delta_amount NUMERIC(14,2) DEFAULT 0,
  supplemental_bill_id INTEGER REFERENCES bills(id) ON DELETE SET NULL,
  refund_amount NUMERIC(14,2) DEFAULT 0,
  revised_snapshot TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  finalized_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  finalized_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bill_audit (
  id SERIAL PRIMARY KEY,
  bill_id INTEGER REFERENCES bills(id) ON DELETE CASCADE,
  revision_id INTEGER REFERENCES bill_revisions(id) ON DELETE SET NULL,
  event TEXT NOT NULL,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  previous_value TEXT,
  new_value TEXT,
  reason TEXT,
  ref TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_bill_revisions_open
  ON bill_revisions (bill_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_bill_revisions_bill
  ON bill_revisions (bill_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bill_audit_bill
  ON bill_audit (bill_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bill_audit_revision
  ON bill_audit (revision_id);
