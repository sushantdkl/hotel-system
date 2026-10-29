-- 023: bill-level refund & void audit trail.
-- Voids/refunds never delete history: the sale journal is reversed (a contra
-- journal) and each action is recorded here, keyed to the bill, so over-refund
-- can be prevented and a full audit trail kept.
ALTER TABLE bills ADD COLUMN IF NOT EXISTS void_reason TEXT;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS voided_at TIMESTAMP;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC(14,2) DEFAULT 0;

CREATE TABLE IF NOT EXISTS bill_corrections (
  id SERIAL PRIMARY KEY,
  bill_id INTEGER REFERENCES bills(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('void', 'refund')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  reason TEXT,
  restocked INTEGER DEFAULT 0,
  journal_id INTEGER REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bill_corrections_bill ON bill_corrections(bill_id, type);
