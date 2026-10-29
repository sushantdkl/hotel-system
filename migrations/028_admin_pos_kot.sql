-- Admin single-operator table → KOT → bill workflow.
-- Turns the existing kitchen-ticket `kots` table into an immutable production
-- record (snapshot + sequence + reprint + idempotency) and adds a POS audit log.
-- Reuses existing orders / order_items / bills / bill_payment_allocations schema.

-- Track how much of each order line has already been sent to the kitchen on a KOT.
-- Unsent quantity = quantity - sent_quantity (for non-voided lines).
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS sent_quantity INTEGER DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_name TEXT;

-- Immutable KOT header snapshot.
ALTER TABLE kots ADD COLUMN IF NOT EXISTS sequence INTEGER DEFAULT 1;
ALTER TABLE kots ADD COLUMN IF NOT EXISTS table_id INTEGER;
ALTER TABLE kots ADD COLUMN IF NOT EXISTS table_number TEXT;
ALTER TABLE kots ADD COLUMN IF NOT EXISTS order_type TEXT;
ALTER TABLE kots ADD COLUMN IF NOT EXISTS kot_type TEXT DEFAULT 'new';
ALTER TABLE kots ADD COLUMN IF NOT EXISTS issued_by INTEGER;
ALTER TABLE kots ADD COLUMN IF NOT EXISTS issued_by_name TEXT;
ALTER TABLE kots ADD COLUMN IF NOT EXISTS order_notes TEXT;
ALTER TABLE kots ADD COLUMN IF NOT EXISTS reprint_count INTEGER DEFAULT 0;
ALTER TABLE kots ADD COLUMN IF NOT EXISTS last_printed_at TIMESTAMP;
ALTER TABLE kots ADD COLUMN IF NOT EXISTS amends_kot_id INTEGER;
ALTER TABLE kots ADD COLUMN IF NOT EXISTS voided INTEGER DEFAULT 0;
ALTER TABLE kots ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_kots_idempotency_key ON kots(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kots_order_seq ON kots(order_id, sequence);

-- Immutable KOT line snapshot (name/variant/notes captured at issue time).
ALTER TABLE kot_items ADD COLUMN IF NOT EXISTS item_name TEXT;
ALTER TABLE kot_items ADD COLUMN IF NOT EXISTS variant_name TEXT;
ALTER TABLE kot_items ADD COLUMN IF NOT EXISTS is_cancellation INTEGER DEFAULT 0;

-- Append-only POS audit trail. Never deleted.
CREATE TABLE IF NOT EXISTS pos_audit_log (
  id SERIAL PRIMARY KEY,
  action TEXT NOT NULL,
  actor_id INTEGER,
  actor_name TEXT,
  order_id INTEGER,
  table_id INTEGER,
  kot_id INTEGER,
  bill_id INTEGER,
  reason TEXT,
  previous_value TEXT,
  new_value TEXT,
  detail TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pos_audit_order ON pos_audit_log(order_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pos_audit_action ON pos_audit_log(action, created_at);
