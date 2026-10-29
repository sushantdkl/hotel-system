-- Explicit, non-dynamic replacement for the step-2 backfill.
--
-- The earlier dynamic EXECUTE-based script marked every table "applied" in
-- tz_backfill_cutoffs without actually persisting the UPDATE for at least
-- bills/orders (verified directly: id=516's created_at was unchanged after
-- that script reported success). A plain literal UPDATE on the same row
-- worked immediately. So: no more dynamic SQL. Every statement below is
-- literal, uses the real column names (verified against information_schema),
-- and the real cutoff id already captured in tz_backfill_cutoffs. Each is
-- independent — run them one at a time or all together; a problem in one
-- does not hide or block the others, and each reports its own "UPDATE n"
-- row count so nothing is invisible this time.
--
-- Direction: SUBTRACT 5:45. The broken session stored Nepal LOCAL wall-clock
-- time as if it were UTC; local_time - 5:45 = true UTC.
--
-- Run each, check the row count looks sane for that table, then move on.

-- Backup first (safe to re-run; ON CONFLICT-free since it's just an insert of
-- current state before you touch anything further).
CREATE TABLE IF NOT EXISTS tz_backfill_backup_v2 (
  id BIGSERIAL PRIMARY KEY,
  table_name text NOT NULL,
  row_id bigint NOT NULL,
  row_snapshot jsonb NOT NULL,
  backed_up_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO tz_backfill_backup_v2 (table_name, row_id, row_snapshot)
SELECT 'bill_payment_allocations', id, to_jsonb(t) FROM bill_payment_allocations t WHERE id <= 634;
UPDATE bill_payment_allocations SET created_at = created_at - INTERVAL '5 hours 45 minutes' WHERE id <= 634;

INSERT INTO tz_backfill_backup_v2 (table_name, row_id, row_snapshot)
SELECT 'bill_payments', id, to_jsonb(t) FROM bill_payments t WHERE id <= 584;
UPDATE bill_payments SET created_at = created_at - INTERVAL '5 hours 45 minutes' WHERE id <= 584;

-- id=516 excluded: already manually corrected in the earlier single-row test
-- (subtracted once already) — subtracting again would break it a second time.
INSERT INTO tz_backfill_backup_v2 (table_name, row_id, row_snapshot)
SELECT 'bills', id, to_jsonb(t) FROM bills t WHERE id <= 597 AND id <> 516;
UPDATE bills SET created_at = created_at - INTERVAL '5 hours 45 minutes' WHERE id <= 597 AND id <> 516;

INSERT INTO tz_backfill_backup_v2 (table_name, row_id, row_snapshot)
SELECT 'business_day_sessions', id, to_jsonb(t) FROM business_day_sessions t WHERE id <= 18;
UPDATE business_day_sessions SET
  created_at = created_at - INTERVAL '5 hours 45 minutes',
  opened_at = opened_at - INTERVAL '5 hours 45 minutes',
  updated_at = updated_at - INTERVAL '5 hours 45 minutes'
WHERE id <= 18;

INSERT INTO tz_backfill_backup_v2 (table_name, row_id, row_snapshot)
SELECT 'business_days', id, to_jsonb(t) FROM business_days t WHERE id <= 16;
UPDATE business_days SET
  created_at = created_at - INTERVAL '5 hours 45 minutes',
  opened_at = opened_at - INTERVAL '5 hours 45 minutes',
  updated_at = updated_at - INTERVAL '5 hours 45 minutes'
WHERE id <= 16;

INSERT INTO tz_backfill_backup_v2 (table_name, row_id, row_snapshot)
SELECT 'customer_ledger', id, to_jsonb(t) FROM customer_ledger t WHERE id <= 67;
UPDATE customer_ledger SET created_at = created_at - INTERVAL '5 hours 45 minutes' WHERE id <= 67;

INSERT INTO tz_backfill_backup_v2 (table_name, row_id, row_snapshot)
SELECT 'drawer_sessions', id, to_jsonb(t) FROM drawer_sessions t WHERE id <= 18;
UPDATE drawer_sessions SET opened_at = opened_at - INTERVAL '5 hours 45 minutes' WHERE id <= 18;

INSERT INTO tz_backfill_backup_v2 (table_name, row_id, row_snapshot)
SELECT 'expenses', id, to_jsonb(t) FROM expenses t WHERE id <= 168;
UPDATE expenses SET
  created_at = created_at - INTERVAL '5 hours 45 minutes',
  updated_at = updated_at - INTERVAL '5 hours 45 minutes'
WHERE id <= 168;

INSERT INTO tz_backfill_backup_v2 (table_name, row_id, row_snapshot)
SELECT 'journal_entries', id, to_jsonb(t) FROM journal_entries t WHERE id <= 927;
UPDATE journal_entries SET created_at = created_at - INTERVAL '5 hours 45 minutes' WHERE id <= 927;

INSERT INTO tz_backfill_backup_v2 (table_name, row_id, row_snapshot)
SELECT 'kots', id, to_jsonb(t) FROM kots t WHERE id <= 942;
UPDATE kots SET printed_at = printed_at - INTERVAL '5 hours 45 minutes' WHERE id <= 942;

INSERT INTO tz_backfill_backup_v2 (table_name, row_id, row_snapshot)
SELECT 'orders', id, to_jsonb(t) FROM orders t WHERE id <= 619;
UPDATE orders SET
  created_at = created_at - INTERVAL '5 hours 45 minutes',
  updated_at = updated_at - INTERVAL '5 hours 45 minutes'
WHERE id <= 619;

INSERT INTO tz_backfill_backup_v2 (table_name, row_id, row_snapshot)
SELECT 'stock_movements', id, to_jsonb(t) FROM stock_movements t WHERE id <= 1309;
UPDATE stock_movements SET created_at = created_at - INTERVAL '5 hours 45 minutes' WHERE id <= 1309;

-- Spot-check: this should now read 2026-08-28 12:24:57 (already correct from
-- the earlier single-row test — this just confirms nothing here re-touches it
-- and breaks it again).
SELECT id, created_at FROM bills WHERE id = 516;
