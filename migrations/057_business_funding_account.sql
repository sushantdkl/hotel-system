-- Permanent owner-funded business wallet. Investments are capital, not income;
-- transfers into cash/bank only move assets and therefore never inflate profit.
INSERT INTO accounts (code, name, type, subtype, parent_id, is_active, is_system)
SELECT '1050', 'Business Funding', 'asset', 'business_funding',
       (SELECT id FROM accounts WHERE code = '1000'), 1, 1
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE code = '1050');

CREATE TABLE IF NOT EXISTS business_funding_transactions (
  id SERIAL PRIMARY KEY,
  transaction_date DATE NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('investment')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  journal_id INTEGER REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_business_funding_transactions_date
  ON business_funding_transactions(transaction_date, id);

