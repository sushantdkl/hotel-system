-- STEP 2 of 2 — Nepal-timezone backfill: apply the correction.
--
-- Run this ONLY after:
--   1. Step 1 has been run and `tz_backfill_cutoffs` is populated.
--   2. The code fix (lib/db/postgres.js, session TimeZone forced to UTC)
--      has been deployed and the app has been restarted.
--   3. You have a fresh backup of the database (pg_dump). This touches
--      every timestamp column across every operational table.
--
-- What this does, per table/column pair recorded as affected:
--   Adds 5 hours 45 minutes to every CURRENT_TIMESTAMP-defaulted timestamp
--   column, but ONLY for rows with id <= the cutoff captured in step 1 —
--   i.e. only rows written before the fix, under the old Nepal-labeled-as-UTC
--   convention. Rows written after the fix are already correct and are
--   never touched (their id is above the cutoff).
--
-- Safety:
--   - A full before-image of every touched row is copied into
--     tz_backfill_backup first, as JSONB, so any row can be restored.
--   - Idempotent: a table already marked applied_at is skipped, so running
--     this file twice does not double-shift anything.
--   - Everything runs in one transaction; if anything raises, the whole
--     thing rolls back.

BEGIN;

DO $$
DECLARE
  pending INTEGER;
BEGIN
  SELECT COUNT(*) INTO pending FROM tz_backfill_cutoffs WHERE applied_at IS NULL;
  IF pending = 0 THEN
    RAISE EXCEPTION 'Nothing to apply — either step 1 was not run, or this has already been applied.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS tz_backfill_backup (
  id             BIGSERIAL PRIMARY KEY,
  table_name     text NOT NULL,
  row_id         bigint NOT NULL,
  row_snapshot   jsonb NOT NULL,
  backed_up_at   timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tz_backfill_backup_lookup
  ON tz_backfill_backup (table_name, row_id);

DO $$
DECLARE
  cutoff RECORD;
  col RECORD;
  set_clauses text;
  affected integer;
BEGIN
  FOR cutoff IN
    SELECT table_name, cutoff_id FROM tz_backfill_cutoffs WHERE applied_at IS NULL
  LOOP
    -- Snapshot every row this table's step will touch, before changing it.
    EXECUTE format(
      'INSERT INTO tz_backfill_backup (table_name, row_id, row_snapshot)
       SELECT %L, id, to_jsonb(t) FROM %I t WHERE id <= %L',
      cutoff.table_name, cutoff.table_name, cutoff.cutoff_id
    );

    -- Build "col = col - INTERVAL '5:45', col2 = col2 - INTERVAL '5:45', ..."
    -- for every CURRENT_TIMESTAMP-defaulted timestamp column on this table.
    -- SUBTRACT: the broken session stored Nepal LOCAL wall-clock time as if it
    -- were UTC. local_time - 5:45 = true UTC. (An earlier version of this
    -- script had this backwards as `+`, which would have made a bad value
    -- worse instead of correcting it — verify with the id/created_at check
    -- before trusting any row this touches.)
    SELECT string_agg(
      format('%I = %I - INTERVAL ''5 hours 45 minutes''', column_name, column_name),
      ', '
    )
    INTO set_clauses
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = cutoff.table_name
      AND column_default ILIKE '%CURRENT_TIMESTAMP%'
      AND data_type IN ('timestamp without time zone', 'timestamp with time zone');

    IF set_clauses IS NOT NULL THEN
      EXECUTE format(
        'UPDATE %I SET %s WHERE id <= %L',
        cutoff.table_name, set_clauses, cutoff.cutoff_id
      );
      GET DIAGNOSTICS affected = ROW_COUNT;
      RAISE NOTICE '% : shifted % row(s)', cutoff.table_name, affected;
    END IF;

    UPDATE tz_backfill_cutoffs SET applied_at = CURRENT_TIMESTAMP WHERE table_name = cutoff.table_name;
  END LOOP;
END $$;

-- Verification: every cutoff row should now show an applied_at.
SELECT * FROM tz_backfill_cutoffs ORDER BY table_name;

COMMIT;

-- To restore a single row if something looks wrong afterwards:
--   SELECT row_snapshot FROM tz_backfill_backup
--   WHERE table_name = '...' AND row_id = ...
--   ORDER BY backed_up_at DESC LIMIT 1;
-- Cleanup once you've verified reports look right (keep the backup a while):
--   DROP TABLE tz_backfill_cutoffs;
--   DROP TABLE tz_backfill_backup;
