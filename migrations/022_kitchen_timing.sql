-- 022: kitchen timing + attribution.
-- Capture when an order starts cooking, when it's ready, and who prepared it,
-- so preparation timers, kitchen analytics and chef performance can be derived
-- from the existing order status flow (no new order logic).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS prep_started_at TIMESTAMP;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ready_at TIMESTAMP;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS prepared_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_ready_at ON orders(ready_at);
CREATE INDEX IF NOT EXISTS idx_orders_prepared_by ON orders(prepared_by);
