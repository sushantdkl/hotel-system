-- STEP 1 of 2 — Nepal-timezone backfill: capture cutoffs.
--
-- Background:
--   `SHOW timezone` on production returned 'Asia/Kathmandu', not 'UTC'.
--   Every write that used the literal SQL `CURRENT_TIMESTAMP` (which is all
--   of them — checked every INSERT/UPDATE in lib/) was rendered in that
--   session timezone before being stored in a `timestamp without time zone`
--   column. So every stored timestamp is actually Nepal wall-clock time,
--   mislabeled as if it were UTC — while every report query assumes it IS
--   UTC and shifts +5:45 to get Nepal time. That double-application of the
--   Nepal offset is what misfiled near-midnight rows onto the wrong
--   calendar day in reports.
--
--   The code fix (lib/db/postgres.js) forces new connections to session
--   timezone UTC, so rows written AFTER that fix is deployed are correct.
--   Rows written BEFORE it are still off by 5 hours 45 minutes and need a
--   one-time correction (step 2).
--
-- What this step does:
--   Records, per table, the highest `id` that exists RIGHT NOW — i.e.
--   before the timezone fix goes live. Step 2 will only touch rows at or
--   below that id, so anything inserted after the fix (already correct)
--   is never touched twice.
--
-- Run this BEFORE deploying/restarting the app with the timezone fix.
-- Do not skip ahead to step 2 without deploying the fix first — the cutoff
-- point is meaningless if new rows keep arriving under the old, broken
-- timezone.

BEGIN;

CREATE TABLE IF NOT EXISTS tz_backfill_cutoffs (
  table_name   text PRIMARY KEY,
  cutoff_id    bigint NOT NULL,
  captured_at  timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  applied_at   timestamp
);

DO $$
DECLARE
  r RECORD;
  max_id bigint;
BEGIN
  FOR r IN
    -- Every table with an `id` column and at least one timestamp column
    -- that defaults to CURRENT_TIMESTAMP (the ones affected by the session
    -- timezone). Driven by the live schema, not a static dump, so this
    -- stays correct even if columns were added after this script was written.
    SELECT DISTINCT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.columns pk
      ON pk.table_schema = c.table_schema
     AND pk.table_name = c.table_name
     AND pk.column_name = 'id'
    WHERE c.table_schema = 'public'
      AND c.column_default ILIKE '%CURRENT_TIMESTAMP%'
      AND c.data_type IN ('timestamp without time zone', 'timestamp with time zone')
  LOOP
    EXECUTE format('SELECT COALESCE(MAX(id), 0) FROM %I', r.table_name) INTO max_id;
    INSERT INTO tz_backfill_cutoffs (table_name, cutoff_id)
    VALUES (r.table_name, max_id)
    ON CONFLICT (table_name) DO UPDATE
      SET cutoff_id = EXCLUDED.cutoff_id, captured_at = CURRENT_TIMESTAMP, applied_at = NULL;
  END LOOP;
END $$;

-- Review before committing. Every table your reports read from should be
-- listed here (orders, bills, kots, expenses, bill_corrections,
-- bill_payments, bill_payment_allocations, business_days,
-- business_day_sessions, stock_movements, wastage_log, journal_entries,
-- customer_ledger, drawer_sessions, payment_settlements, ...).
SELECT * FROM tz_backfill_cutoffs ORDER BY table_name;

COMMIT;

-- Next: deploy the code fix and restart the app now. Only after that,
-- run step 2.
