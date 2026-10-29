-- One-time production repair for the wrong open business date.
--
-- Situation:
--   The store was opened on 08 Aug 2026 around 03:55 PM NPT,
--   but the open business_days row was created as business_date 2026-08-07.
--
-- What this does:
--   1. Preserves a backup snapshot of the affected business_days rows.
--   2. Changes ONLY the wrongly-open 2026-08-07 business day to 2026-08-08.
--   3. Attaches unassigned 08 Aug 2026 operational records to that business day.
--
-- What this does NOT do:
--   - Does not delete orders, bills, KOTs, payments, or history.
--   - Does not reset sales, inventory, accounting, receivables, or balances.
--   - Does not move records already assigned to another business_day_id.
--
-- IMPORTANT:
--   Run the whole file in PostgreSQL/cPanel as one script.
--   If any check fails, the transaction will stop. Run ROLLBACK if your SQL
--   client does not automatically roll back after an error.

BEGIN;

-- Keep a permanent before-fix snapshot for safety.
CREATE TABLE IF NOT EXISTS manual_business_day_fix_backup_20260808 (
  id BIGSERIAL PRIMARY KEY,
  captured_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  note TEXT NOT NULL,
  business_day_id INTEGER,
  business_date DATE,
  status TEXT,
  opened_at TIMESTAMP,
  closed_at TIMESTAMP,
  opening_cash NUMERIC(14,2),
  expected_cash NUMERIC(14,2),
  counted_cash NUMERIC(14,2),
  cash_difference NUMERIC(14,2),
  row_snapshot JSONB
);

INSERT INTO manual_business_day_fix_backup_20260808 (
  note, business_day_id, business_date, status, opened_at, closed_at,
  opening_cash, expected_cash, counted_cash, cash_difference, row_snapshot
)
SELECT
  'before repair: wrong open 2026-08-07 / related 2026-08-08 check',
  bd.id, bd.business_date, bd.status, bd.opened_at, bd.closed_at,
  bd.opening_cash, bd.expected_cash, bd.counted_cash, bd.cash_difference,
  to_jsonb(bd)
FROM business_days bd
WHERE bd.business_date IN (DATE '2026-08-07', DATE '2026-08-08')
   OR (bd.status = 'open' AND bd.opening_cash = 3490);

-- Show the exact rows before changing anything.
SELECT
  'BEFORE business_days' AS check_name,
  id, business_date, status, opened_at, closed_at, opening_cash,
  expected_cash, counted_cash, cash_difference
FROM business_days
WHERE business_date IN (DATE '2026-08-07', DATE '2026-08-08')
   OR status = 'open'
ORDER BY business_date, id;

-- Hard safety checks.
DO $$
DECLARE
  wrong_open_count INTEGER;
  correct_date_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO wrong_open_count
  FROM business_days
  WHERE business_date = DATE '2026-08-07'
    AND status = 'open'
    AND closed_at IS NULL
    AND opening_cash = 3490;

  IF wrong_open_count <> 1 THEN
    RAISE EXCEPTION
      'Expected exactly one open 2026-08-07 business day with opening_cash 3490, found %.',
      wrong_open_count;
  END IF;

  SELECT COUNT(*)
  INTO correct_date_count
  FROM business_days
  WHERE business_date = DATE '2026-08-08';

  IF correct_date_count <> 0 THEN
    RAISE EXCEPTION
      'A 2026-08-08 business day already exists. Stop and inspect manually before merging dates.';
  END IF;
END $$;

-- Identify the wrong open row once and reuse it.
CREATE TEMP TABLE repair_target_business_day_20260808 AS
SELECT id AS business_day_id
FROM business_days
WHERE business_date = DATE '2026-08-07'
  AND status = 'open'
  AND closed_at IS NULL
  AND opening_cash = 3490
ORDER BY id DESC
LIMIT 1;

-- Correct the parent business date. Store sessions remain linked by business_day_id.
UPDATE business_days bd
SET business_date = DATE '2026-08-08',
    updated_at = CURRENT_TIMESTAMP
FROM repair_target_business_day_20260808 target
WHERE bd.id = target.business_day_id;

-- Audit the repair inside the existing audit trail.
INSERT INTO business_day_audit (
  business_day_id, action, actor_id, actor_name,
  previous_value, new_value, reason, detail
)
SELECT
  target.business_day_id,
  'manual_business_date_repair',
  NULL,
  'Production SQL repair',
  '{"business_date":"2026-08-07"}',
  '{"business_date":"2026-08-08"}',
  'Opened on 08 Aug 2026 but saved as 07 Aug 2026.',
  'One-time cPanel/Postgres repair. No orders, bills, KOTs, payments, inventory, or accounting records were deleted.'
FROM repair_target_business_day_20260808 target;

-- Preserve earlier 08 Aug records by attaching ONLY unassigned records.
-- This does not move records that already have a business_day_id.
UPDATE orders o
SET business_day_id = target.business_day_id
FROM repair_target_business_day_20260808 target
WHERE o.business_day_id IS NULL
  AND (o.created_at + INTERVAL '5 hours 45 minutes')::date = DATE '2026-08-08';

UPDATE kots k
SET business_day_id = o.business_day_id
FROM orders o
WHERE k.business_day_id IS NULL
  AND k.order_id = o.id
  AND o.business_day_id IS NOT NULL;

UPDATE bills b
SET business_day_id = o.business_day_id
FROM orders o
WHERE b.business_day_id IS NULL
  AND b.order_id = o.id
  AND o.business_day_id IS NOT NULL;

-- Fallback for any standalone bills created on 08 Aug without an order link.
UPDATE bills b
SET business_day_id = target.business_day_id
FROM repair_target_business_day_20260808 target
WHERE b.business_day_id IS NULL
  AND (b.created_at + INTERVAL '5 hours 45 minutes')::date = DATE '2026-08-08';

UPDATE bill_payments p
SET business_day_id = b.business_day_id
FROM bills b
WHERE p.business_day_id IS NULL
  AND p.bill_id = b.id
  AND b.business_day_id IS NOT NULL;

UPDATE bill_payment_allocations p
SET business_day_id = b.business_day_id
FROM bills b
WHERE p.business_day_id IS NULL
  AND p.bill_id = b.id
  AND b.business_day_id IS NOT NULL;

UPDATE customer_ledger c
SET business_day_id = b.business_day_id
FROM bills b
WHERE c.business_day_id IS NULL
  AND c.bill_id = b.id
  AND b.business_day_id IS NOT NULL;

UPDATE bill_corrections c
SET business_day_id = b.business_day_id
FROM bills b
WHERE c.business_day_id IS NULL
  AND c.bill_id = b.id
  AND b.business_day_id IS NOT NULL;

UPDATE expenses e
SET business_day_id = target.business_day_id
FROM repair_target_business_day_20260808 target
WHERE e.business_day_id IS NULL
  AND (
    COALESCE(e.purchase_date, CAST(e.expense_date AS TEXT)) = '2026-08-08'
    OR (e.created_at + INTERVAL '5 hours 45 minutes')::date = DATE '2026-08-08'
  );

UPDATE drawer_sessions ds
SET business_day_id = target.business_day_id
FROM repair_target_business_day_20260808 target
WHERE ds.business_day_id IS NULL
  AND (ds.opened_at + INTERVAL '5 hours 45 minutes')::date = DATE '2026-08-08';

UPDATE payment_settlements ps
SET business_day_id = target.business_day_id
FROM repair_target_business_day_20260808 target
WHERE ps.business_day_id IS NULL
  AND (ps.settled_at + INTERVAL '5 hours 45 minutes')::date = DATE '2026-08-08';

UPDATE reservations r
SET business_day_id = target.business_day_id
FROM repair_target_business_day_20260808 target
WHERE r.business_day_id IS NULL
  AND r.date ~ '^\d{4}-\d{2}-\d{2}$'
  AND CAST(r.date AS DATE) = DATE '2026-08-08';

UPDATE salary_payments sp
SET business_day_id = target.business_day_id
FROM repair_target_business_day_20260808 target
WHERE sp.business_day_id IS NULL
  AND sp.paid_on = DATE '2026-08-08';

UPDATE stock_movements sm
SET business_day_id = o.business_day_id
FROM orders o
WHERE sm.business_day_id IS NULL
  AND CAST(sm.reference_id AS TEXT) = CAST(o.id AS TEXT)
  AND o.business_day_id IS NOT NULL;

UPDATE stock_movements sm
SET business_day_id = target.business_day_id
FROM repair_target_business_day_20260808 target
WHERE sm.business_day_id IS NULL
  AND (sm.created_at + INTERVAL '5 hours 45 minutes')::date = DATE '2026-08-08';

UPDATE wastage_log w
SET business_day_id = target.business_day_id
FROM repair_target_business_day_20260808 target
WHERE w.business_day_id IS NULL
  AND (w.created_at + INTERVAL '5 hours 45 minutes')::date = DATE '2026-08-08';

-- Link unassigned accounting entries by their operational source first.
UPDATE journal_entries je
SET business_day_id = b.business_day_id
FROM bills b
WHERE je.business_day_id IS NULL
  AND je.source_type = 'bill'
  AND je.source_id = b.id
  AND b.business_day_id IS NOT NULL;

UPDATE journal_entries je
SET business_day_id = p.business_day_id
FROM bill_payments p
WHERE je.business_day_id IS NULL
  AND je.source_type IN ('bill_payment', 'credit_collection')
  AND je.source_id = p.id
  AND p.business_day_id IS NOT NULL;

UPDATE journal_entries je
SET business_day_id = e.business_day_id
FROM expenses e
WHERE je.business_day_id IS NULL
  AND je.source_type = 'expense'
  AND je.source_id = e.id
  AND e.business_day_id IS NOT NULL;

UPDATE journal_entries je
SET business_day_id = c.business_day_id
FROM bill_corrections c
WHERE je.business_day_id IS NULL
  AND je.id = c.journal_id
  AND c.business_day_id IS NOT NULL;

-- Last safe fallback: tag unassigned accounting entries whose accounting date is 08 Aug.
-- This only adds reporting attribution; it does not change debit/credit amounts.
UPDATE journal_entries je
SET business_day_id = target.business_day_id
FROM repair_target_business_day_20260808 target
WHERE je.business_day_id IS NULL
  AND je.entry_date = DATE '2026-08-08';

-- Verification output.
SELECT
  'AFTER business_days' AS check_name,
  id, business_date, status, opened_at, closed_at, opening_cash,
  expected_cash, counted_cash, cash_difference
FROM business_days
WHERE business_date IN (DATE '2026-08-07', DATE '2026-08-08')
   OR status = 'open'
ORDER BY business_date, id;

SELECT
  '08 Aug attached counts' AS check_name,
  (SELECT business_day_id FROM repair_target_business_day_20260808) AS business_day_id,
  (SELECT COUNT(*) FROM orders WHERE business_day_id = (SELECT business_day_id FROM repair_target_business_day_20260808)) AS orders,
  (SELECT COUNT(*) FROM kots WHERE business_day_id = (SELECT business_day_id FROM repair_target_business_day_20260808)) AS kots,
  (SELECT COUNT(*) FROM bills WHERE business_day_id = (SELECT business_day_id FROM repair_target_business_day_20260808)) AS bills,
  (SELECT COUNT(*) FROM bill_payments WHERE business_day_id = (SELECT business_day_id FROM repair_target_business_day_20260808)) AS bill_payments,
  (SELECT COUNT(*) FROM expenses WHERE business_day_id = (SELECT business_day_id FROM repair_target_business_day_20260808)) AS expenses,
  (SELECT COUNT(*) FROM journal_entries WHERE business_day_id = (SELECT business_day_id FROM repair_target_business_day_20260808)) AS journal_entries;

SELECT
  '08 Aug paid sales check' AS check_name,
  COALESCE(SUM(grand_total), 0) AS paid_sales
FROM bills
WHERE business_day_id = (SELECT business_day_id FROM repair_target_business_day_20260808)
  AND LOWER(COALESCE(status, '')) NOT IN ('void', 'voided', 'cancelled', 'canceled')
  AND LOWER(COALESCE(payment_status, '')) IN ('paid', 'settled', 'completed');

COMMIT;

