-- 041: compatibility migration for kitchen analytics on databases created
-- before its preparation-timing fields were introduced.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS prep_started_at TIMESTAMP;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ready_at TIMESTAMP;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS prepared_by INTEGER;

CREATE INDEX IF NOT EXISTS idx_orders_ready_at ON orders(ready_at);
CREATE INDEX IF NOT EXISTS idx_orders_prepared_by ON orders(prepared_by);
