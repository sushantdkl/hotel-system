-- 018: money as NUMERIC, not floating point.
-- DOUBLE PRECISION drifts on accumulation; a ledger must be exact. The USING
-- casts preserve existing values. (SQLite dev keeps REAL — these ALTERs are
-- Postgres-only and the app rounds to 2dp on the way in regardless.)
ALTER TABLE journal_lines
  ALTER COLUMN debit TYPE NUMERIC(14,2) USING debit::numeric(14,2),
  ALTER COLUMN credit TYPE NUMERIC(14,2) USING credit::numeric(14,2);

ALTER TABLE drawer_sessions
  ALTER COLUMN opening_amount TYPE NUMERIC(14,2) USING opening_amount::numeric(14,2),
  ALTER COLUMN expected_amount TYPE NUMERIC(14,2) USING expected_amount::numeric(14,2),
  ALTER COLUMN counted_amount TYPE NUMERIC(14,2) USING counted_amount::numeric(14,2),
  ALTER COLUMN difference TYPE NUMERIC(14,2) USING difference::numeric(14,2);

ALTER TABLE bank_accounts
  ALTER COLUMN opening_balance TYPE NUMERIC(14,2) USING opening_balance::numeric(14,2);

ALTER TABLE payment_settlements
  ALTER COLUMN gross_amount TYPE NUMERIC(14,2) USING gross_amount::numeric(14,2),
  ALTER COLUMN fee_amount TYPE NUMERIC(14,2) USING fee_amount::numeric(14,2),
  ALTER COLUMN net_amount TYPE NUMERIC(14,2) USING net_amount::numeric(14,2);
