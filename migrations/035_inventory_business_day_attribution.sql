-- Attribute inventory movement metrics to Business Days without changing stock balances.

ALTER TABLE business_day_sessions
  ADD COLUMN IF NOT EXISTS opening_journal_id INTEGER REFERENCES journal_entries(id) ON DELETE SET NULL;

ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS business_day_id INTEGER REFERENCES business_days(id) ON DELETE RESTRICT;

ALTER TABLE wastage_log
  ADD COLUMN IF NOT EXISTS business_day_id INTEGER REFERENCES business_days(id) ON DELETE RESTRICT;

-- Order-linked stock deductions/restores inherit the order's business day.
UPDATE stock_movements sm
SET business_day_id = o.business_day_id
FROM orders o
WHERE sm.business_day_id IS NULL
  AND sm.change_type IN ('order_deduction', 'order_void')
  AND sm.reference_id IS NOT NULL
  AND sm.reference_id ~ '^\d+$'
  AND o.id = CAST(sm.reference_id AS INTEGER)
  AND o.business_day_id IS NOT NULL;

-- Legacy non-order movements are attributed to the closed historical business
-- day matching their Nepal calendar date. This is reporting attribution only.
UPDATE stock_movements sm
SET business_day_id = bd.id
FROM business_days bd
WHERE sm.business_day_id IS NULL
  AND bd.status = 'closed'
  AND bd.business_date = CAST((sm.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kathmandu') AS DATE);

UPDATE wastage_log w
SET business_day_id = bd.id
FROM business_days bd
WHERE w.business_day_id IS NULL
  AND bd.status = 'closed'
  AND bd.business_date = CAST((w.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kathmandu') AS DATE);

CREATE INDEX IF NOT EXISTS idx_stock_movements_business_day
  ON stock_movements(business_day_id, change_type);

CREATE INDEX IF NOT EXISTS idx_wastage_log_business_day
  ON wastage_log(business_day_id, reason);
