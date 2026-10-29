-- One-time production repair:
-- Attach old 08 Aug 2026 records that were created before the Business Day
-- feature was deployed to the existing open business day.
--
-- Confirmed production state from phpPgAdmin:
--   business_days.id = 2
--   business_days.business_date = 2026-08-08
--   status = open
--   opening_cash = 3490.00
--
-- Confirmed unassigned old paid sales:
--   13 bills
--   Rs 3675
--
-- This script only updates rows where business_day_id IS NULL.
-- It does not delete data and does not move rows already assigned to another day.

BEGIN;

CREATE TABLE IF NOT EXISTS manual_business_day_attach_backup_20260808 (
  id BIGSERIAL PRIMARY KEY,
  captured_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  table_name TEXT NOT NULL,
  row_id INTEGER,
  business_day_id_before INTEGER,
  row_snapshot JSONB
);

-- Safety: the target day must already be the correct open 08 Aug business day.
DO $$
DECLARE
  ok_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO ok_count
  FROM business_days
  WHERE id = 2
    AND business_date = DATE '2026-08-08'
    AND status = 'open';

  IF ok_count <> 1 THEN
    RAISE EXCEPTION 'Target business day id=2 / 2026-08-08 / open was not found. Stop.';
  END IF;
END $$;

-- Show what will be attached.
SELECT
  'BEFORE unassigned Aug 8 bills' AS check_name,
  COUNT(*) AS bills,
  COALESCE(SUM(grand_total), 0) AS total
FROM bills
WHERE business_day_id IS NULL
  AND (created_at + INTERVAL '5 hours 45 minutes')::date = DATE '2026-08-08'
  AND LOWER(COALESCE(status, '')) NOT IN ('void', 'voided', 'cancelled', 'canceled');

SELECT
  'BEFORE assigned target day bills' AS check_name,
  COUNT(*) AS bills,
  COALESCE(SUM(grand_total), 0) AS total
FROM bills
WHERE business_day_id = 2
  AND LOWER(COALESCE(status, '')) NOT IN ('void', 'voided', 'cancelled', 'canceled');

-- Backup affected rows before update.
INSERT INTO manual_business_day_attach_backup_20260808 (table_name, row_id, business_day_id_before, row_snapshot)
SELECT 'orders', id, business_day_id, to_jsonb(orders)
FROM orders
WHERE business_day_id IS NULL
  AND (created_at + INTERVAL '5 hours 45 minutes')::date = DATE '2026-08-08';

INSERT INTO manual_business_day_attach_backup_20260808 (table_name, row_id, business_day_id_before, row_snapshot)
SELECT 'bills', id, business_day_id, to_jsonb(bills)
FROM bills
WHERE business_day_id IS NULL
  AND (created_at + INTERVAL '5 hours 45 minutes')::date = DATE '2026-08-08';

INSERT INTO manual_business_day_attach_backup_20260808 (table_name, row_id, business_day_id_before, row_snapshot)
SELECT 'kots', id, business_day_id, to_jsonb(kots)
FROM kots
WHERE business_day_id IS NULL
  AND (printed_at + INTERVAL '5 hours 45 minutes')::date = DATE '2026-08-08';

INSERT INTO manual_business_day_attach_backup_20260808 (table_name, row_id, business_day_id_before, row_snapshot)
SELECT 'bill_payments', id, business_day_id, to_jsonb(bill_payments)
FROM bill_payments
WHERE business_day_id IS NULL
  AND (created_at + INTERVAL '5 hours 45 minutes')::date = DATE '2026-08-08';

INSERT INTO manual_business_day_attach_backup_20260808 (table_name, row_id, business_day_id_before, row_snapshot)
SELECT 'bill_payment_allocations', id, business_day_id, to_jsonb(bill_payment_allocations)
FROM bill_payment_allocations
WHERE business_day_id IS NULL
  AND (created_at + INTERVAL '5 hours 45 minutes')::date = DATE '2026-08-08';

INSERT INTO manual_business_day_attach_backup_20260808 (table_name, row_id, business_day_id_before, row_snapshot)
SELECT 'journal_entries', id, business_day_id, to_jsonb(journal_entries)
FROM journal_entries
WHERE business_day_id IS NULL
  AND (
    entry_date = DATE '2026-08-08'
    OR (created_at + INTERVAL '5 hours 45 minutes')::date = DATE '2026-08-08'
  );

-- Attach orders first.
UPDATE orders
SET business_day_id = 2
WHERE business_day_id IS NULL
  AND (created_at + INTERVAL '5 hours 45 minutes')::date = DATE '2026-08-08';

-- Attach KOTs through their order where possible.
UPDATE kots k
SET business_day_id = o.business_day_id
FROM orders o
WHERE k.business_day_id IS NULL
  AND k.order_id = o.id
  AND o.business_day_id = 2;

-- Fallback for KOTs without order linkage but printed on 08 Aug.
UPDATE kots
SET business_day_id = 2
WHERE business_day_id IS NULL
  AND (printed_at + INTERVAL '5 hours 45 minutes')::date = DATE '2026-08-08';

-- Attach bills through their order where possible.
UPDATE bills b
SET business_day_id = o.business_day_id
FROM orders o
WHERE b.business_day_id IS NULL
  AND b.order_id = o.id
  AND o.business_day_id = 2;

-- Fallback for standalone Aug 8 bills.
UPDATE bills
SET business_day_id = 2
WHERE business_day_id IS NULL
  AND (created_at + INTERVAL '5 hours 45 minutes')::date = DATE '2026-08-08';

-- Attach payments/allocations from their bill.
UPDATE bill_payments p
SET business_day_id = b.business_day_id
FROM bills b
WHERE p.business_day_id IS NULL
  AND p.bill_id = b.id
  AND b.business_day_id = 2;

UPDATE bill_payment_allocations a
SET business_day_id = b.business_day_id
FROM bills b
WHERE a.business_day_id IS NULL
  AND a.bill_id = b.id
  AND b.business_day_id = 2;

UPDATE customer_ledger c
SET business_day_id = b.business_day_id
FROM bills b
WHERE c.business_day_id IS NULL
  AND c.bill_id = b.id
  AND b.business_day_id = 2;

UPDATE bill_corrections c
SET business_day_id = b.business_day_id
FROM bills b
WHERE c.business_day_id IS NULL
  AND c.bill_id = b.id
  AND b.business_day_id = 2;

-- Attach stock movements and wastage for daily operational reporting.
UPDATE stock_movements sm
SET business_day_id = o.business_day_id
FROM orders o
WHERE sm.business_day_id IS NULL
  AND CAST(sm.reference_id AS TEXT) = CAST(o.id AS TEXT)
  AND o.business_day_id = 2;

UPDATE stock_movements
SET business_day_id = 2
WHERE business_day_id IS NULL
  AND (created_at + INTERVAL '5 hours 45 minutes')::date = DATE '2026-08-08';

UPDATE wastage_log
SET business_day_id = 2
WHERE business_day_id IS NULL
  AND (created_at + INTERVAL '5 hours 45 minutes')::date = DATE '2026-08-08';

-- Attach journal entries by source so cash/QR reconciliation follows the bills.
UPDATE journal_entries je
SET business_day_id = 2
FROM bills b
WHERE je.business_day_id IS NULL
  AND je.source_type = 'bill'
  AND je.source_id = b.id
  AND b.business_day_id = 2;

UPDATE journal_entries je
SET business_day_id = 2
FROM bill_payments p
WHERE je.business_day_id IS NULL
  AND je.source_type IN ('bill_supplement', 'credit_collection', 'bill_payment')
  AND je.source_id = p.id
  AND p.business_day_id = 2;

UPDATE journal_entries je
SET business_day_id = 2
FROM bill_corrections c
WHERE je.business_day_id IS NULL
  AND je.id = c.journal_id
  AND c.business_day_id = 2;

-- Fallback for remaining unassigned Aug 8 journals.
-- This only sets attribution; it does not change debits/credits.
UPDATE journal_entries
SET business_day_id = 2
WHERE business_day_id IS NULL
  AND entry_date = DATE '2026-08-08';

-- Audit trail.
INSERT INTO business_day_audit (
  business_day_id, action, actor_id, actor_name,
  previous_value, new_value, reason, detail
)
VALUES (
  2,
  'manual_attach_unassigned_aug8_records',
  NULL,
  'Production SQL repair',
  '{"business_day_id":null}',
  '{"business_day_id":2}',
  'Attach pre-business-day-deploy Aug 8 production sales to the existing open business day.',
  'Only rows with business_day_id IS NULL were updated. No sales, payments, KOTs, inventory, or accounting rows were deleted.'
);

-- Verification.
SELECT
  'AFTER target day paid bills' AS check_name,
  COUNT(*) AS paid_bills,
  COALESCE(SUM(grand_total), 0) AS paid_total
FROM bills
WHERE business_day_id = 2
  AND LOWER(COALESCE(status, '')) NOT IN ('void', 'voided', 'cancelled', 'canceled')
  AND LOWER(COALESCE(payment_status, '')) IN ('paid', 'settled', 'completed');

SELECT
  'AFTER remaining unassigned Aug 8 paid bills' AS check_name,
  COUNT(*) AS paid_bills,
  COALESCE(SUM(grand_total), 0) AS paid_total
FROM bills
WHERE business_day_id IS NULL
  AND (created_at + INTERVAL '5 hours 45 minutes')::date = DATE '2026-08-08'
  AND LOWER(COALESCE(status, '')) NOT IN ('void', 'voided', 'cancelled', 'canceled')
  AND LOWER(COALESCE(payment_status, '')) IN ('paid', 'settled', 'completed');

SELECT
  'AFTER target day counts' AS check_name,
  (SELECT COUNT(*) FROM orders WHERE business_day_id = 2) AS orders,
  (SELECT COUNT(*) FROM kots WHERE business_day_id = 2) AS kots,
  (SELECT COUNT(*) FROM bills WHERE business_day_id = 2) AS bills,
  (SELECT COUNT(*) FROM bill_payments WHERE business_day_id = 2) AS bill_payments,
  (SELECT COUNT(*) FROM bill_payment_allocations WHERE business_day_id = 2) AS bill_payment_allocations,
  (SELECT COUNT(*) FROM journal_entries WHERE business_day_id = 2) AS journal_entries;

COMMIT;

