-- Expenses UI uses purchase_date + notes; align live DBs.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS purchase_date TEXT;

-- Optional legacy stock table (admin stock API)
CREATE TABLE IF NOT EXISTS stock_items (
  id SERIAL PRIMARY KEY,
  item_name TEXT NOT NULL,
  category TEXT NOT NULL,
  quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
  unit TEXT NOT NULL,
  cost_per_unit DOUBLE PRECISION NOT NULL DEFAULT 0,
  supplier TEXT,
  purchase_date TEXT,
  expiry_date TEXT,
  min_stock_level DOUBLE PRECISION DEFAULT 10,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Backfill purchase_date from expense_date where empty
UPDATE expenses
SET purchase_date = expense_date::text
WHERE purchase_date IS NULL AND expense_date IS NOT NULL;
