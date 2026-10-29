-- Online-order workflow: order/payment status, reservation & fulfillment flags.
-- Idempotent; safe to re-run. Runtime code (lib/online-orders.js ensureOrderColumns)
-- also self-heals existing databases, so this is primarily for fresh installs.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'unpaid';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMP;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stock_consumed INTEGER DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stock_reserved INTEGER DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refunded_amount REAL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at);
