-- 009: widen the wastage reason vocabulary
--
-- wastage_log_reason_check (from 004) only allowed
--   burnt | expired | dropped | returned | other
-- The owner-facing reason list is
--   Expired, Burned, Spoiled, Returned, Preparation Error,
--   Customer Complaint, Spillage, Other
-- so logging "spoiled" or "preparation_error" failed with a 500 from a check
-- constraint violation — the UI could offer reasons the database refused.
--
-- The three legacy spellings stay permitted so existing rows remain valid and
-- nothing needs rewriting; the UI maps 'burnt' -> Burned and 'dropped' ->
-- Spillage for display only (components/inventory/wastage-modal.jsx).
--
-- SQLite (dev fallback) creates wastage_log without this constraint in
-- ensureRecipeTables(), so it needs no equivalent.

ALTER TABLE wastage_log DROP CONSTRAINT IF EXISTS wastage_log_reason_check;

ALTER TABLE wastage_log ADD CONSTRAINT wastage_log_reason_check
  CHECK (reason IN (
    'expired',
    'burned',
    'spoiled',
    'returned',
    'preparation_error',
    'customer_complaint',
    'spillage',
    'other',
    -- legacy values written before this migration
    'burnt',
    'dropped'
  ));
