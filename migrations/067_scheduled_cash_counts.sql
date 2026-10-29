-- 067: Daily blind cash counts required from cashiers at an administrator-set time.
CREATE TABLE IF NOT EXISTS scheduled_cash_counts (
  id SERIAL PRIMARY KEY,
  count_date DATE NOT NULL,
  scheduled_time TEXT NOT NULL,
  cashier_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  business_day_id INTEGER REFERENCES business_days(id) ON DELETE SET NULL,
  counted_cash NUMERIC(14,2) NOT NULL CHECK (counted_cash >= 0),
  expected_cash NUMERIC(14,2) NOT NULL,
  cash_difference NUMERIC(14,2) NOT NULL,
  denominations TEXT NOT NULL,
  expected_breakdown TEXT,
  submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (count_date, cashier_id)
);

CREATE INDEX IF NOT EXISTS idx_scheduled_cash_counts_date
  ON scheduled_cash_counts(count_date DESC, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_scheduled_cash_counts_cashier
  ON scheduled_cash_counts(cashier_id, count_date DESC);
