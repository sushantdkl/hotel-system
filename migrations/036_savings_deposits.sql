INSERT INTO accounts (code, name, type, subtype, parent_id, is_active, is_system)
SELECT '1040', 'Savings & Deposits', 'asset', 'savings', id, 1, 1
FROM accounts WHERE code = '1000'
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS savings_deposits (
  id SERIAL PRIMARY KEY,
  deposit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  deposit_type TEXT NOT NULL DEFAULT 'bank',
  destination_name TEXT NOT NULL,
  source_account TEXT NOT NULL CHECK (source_account IN ('cash','online')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  reference_number TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','voided')),
  journal_id INTEGER REFERENCES journal_entries(id) ON DELETE SET NULL,
  business_day_id INTEGER REFERENCES business_days(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  voided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  voided_at TIMESTAMP,
  void_reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_savings_deposits_date ON savings_deposits(deposit_date DESC);
CREATE INDEX IF NOT EXISTS idx_savings_deposits_status ON savings_deposits(status);
