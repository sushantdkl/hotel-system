-- Preserve the production-only Dim Sum Puri safeguards when this newer
-- application lineage is used for fresh staging databases or future installs.

ALTER TABLE journal_lines
  ADD COLUMN IF NOT EXISTS reconciliation_id INTEGER
  REFERENCES bank_reconciliations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_journal_lines_reconciliation
  ON journal_lines(reconciliation_id);

ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS expiry_date DATE;
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS batch_number TEXT;
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS expiry_date DATE;
CREATE INDEX IF NOT EXISTS idx_inventory_items_expiry
  ON inventory_items(expiry_date) WHERE expiry_date IS NOT NULL;

ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS cost_price NUMERIC(14,2) DEFAULT 0;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS unit TEXT;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS cost NUMERIC(14,2);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'menu_items_cost_price_check'
  ) THEN
    ALTER TABLE menu_items
      ADD CONSTRAINT menu_items_cost_price_check CHECK (cost_price >= 0);
  END IF;
END $$;

-- The newer menu editor calls its direct per-item food-cost field `cost`.
-- Carry forward any value recorded by the production `cost_price` field.
UPDATE menu_items
SET cost = cost_price
WHERE cost IS NULL AND COALESCE(cost_price, 0) > 0;

ALTER TABLE business_days ADD COLUMN IF NOT EXISTS stale_ack_date DATE;

-- Normalize defaults without modifying any stored timestamps.
DO $$
DECLARE
  item RECORD;
BEGIN
  FOR item IN
    SELECT * FROM (VALUES
      ('business_days', 'opened_at'),
      ('business_days', 'created_at'),
      ('business_days', 'updated_at'),
      ('business_day_sessions', 'opened_at'),
      ('business_day_sessions', 'created_at'),
      ('business_day_sessions', 'updated_at'),
      ('business_day_audit', 'created_at'),
      ('drawer_sessions', 'opened_at'),
      ('drawer_sessions', 'created_at'),
      ('orders', 'created_at'),
      ('orders', 'updated_at'),
      ('order_items', 'created_at'),
      ('kots', 'printed_at'),
      ('kots', 'created_at'),
      ('kots', 'updated_at'),
      ('bills', 'created_at'),
      ('bill_payments', 'created_at'),
      ('bill_payment_allocations', 'created_at'),
      ('journal_entries', 'created_at'),
      ('expenses', 'created_at'),
      ('expenses', 'updated_at'),
      ('stock_movements', 'created_at'),
      ('wastage_log', 'created_at')
    ) AS desired(table_name, column_name)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = item.table_name
        AND column_name = item.column_name
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ALTER COLUMN %I SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE ''Asia/Kathmandu'')',
        item.table_name,
        item.column_name
      );
    END IF;
  END LOOP;
END $$;

-- These updates affect only known legacy placeholders and incomplete legacy
-- cancellation metadata; no transaction, menu price or accounting row is removed.
UPDATE menu_items
SET image_url = NULL
WHERE image_url LIKE '/uploads/menu/%.svg';

UPDATE orders
SET cancel_reason = 'Legacy cancellation: no reason was recorded.'
WHERE status = 'cancelled'
  AND (cancel_reason IS NULL OR TRIM(cancel_reason) = '');
