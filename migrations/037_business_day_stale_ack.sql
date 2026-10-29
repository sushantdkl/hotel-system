-- 037: acknowledgement flag for continuing a business day that has rolled past
-- the current Nepal calendar date without being closed.

ALTER TABLE business_days ADD COLUMN IF NOT EXISTS stale_ack_date DATE;
