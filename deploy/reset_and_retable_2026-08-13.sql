-- ============================================================================
-- FULL TRANSACTIONAL RESET + NEW TABLE/FLOOR PLAN
-- Run against production Postgres. IRREVERSIBLE. Take a pg_dump backup first:
--   pg_dump "$DATABASE_URL" -F c -f backup_before_reset_2026-08-13.dump
-- ============================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- PART 1: wipe all orders, bills, business days, accounting, payroll,
-- and inventory-movement HISTORY. Current stock-on-hand quantities,
-- menu, users, customers, reservations and settings are NOT touched.
-- CASCADE also sweeps order_items, kot_items, bill_payments, journal_lines,
-- business_day_sessions, business_day_audit — anything FK'd to these.
-- ---------------------------------------------------------------------------
TRUNCATE TABLE
  orders, kots,
  bills, bill_payment_allocations, customer_ledger, bill_corrections,
  business_days,
  journal_entries, drawer_sessions, payment_settlements,
  expenses, salary_payments, salary_advances,
  stock_movements, wastage_log
RESTART IDENTITY CASCADE;

-- Bill/order/KOT numbering (BIL-0001, ORD-0001, ...) is tracked separately
-- from the Postgres id sequences — reset it too so the next bill starts at 1.
DELETE FROM document_counters;

-- Customer records are kept, but their cached spend/visit/credit counters
-- point at bills that no longer exist. Zero them so the numbers are honest.
UPDATE customers SET total_visits = 0, total_spent = 0, current_credit = 0;

-- ---------------------------------------------------------------------------
-- PART 2: replace the default T-01..T-12 tables with the real floor plan.
-- Safe to run standalone — table_id/current_order_id references use
-- ON DELETE SET NULL, nothing else blocks this.
-- ---------------------------------------------------------------------------
DELETE FROM tables WHERE table_number IN
  ('T-01','T-02','T-03','T-04','T-05','T-06','T-07','T-08','T-09','T-10','T-11','T-12');

INSERT INTO table_floors (name, normalized_name, sort_order)
SELECT v.name, lower(v.name), v.ord FROM (VALUES
  ('Ground Floor Garden', 1),
  ('First Floor',         2),
  ('Second Floor',        3),
  ('Third Floor',         4)
) AS v(name, ord)
ON CONFLICT (normalized_name) DO NOTHING;

INSERT INTO tables (table_number, capacity, status, floor, table_type, is_active)
SELECT v.num, 4, 'available', v.floor, 'regular', 1
FROM (VALUES
  -- Ground Floor Garden
  ('G1', 'Ground Floor Garden'), ('G2', 'Ground Floor Garden'),
  ('G3', 'Ground Floor Garden'), ('G4', 'Ground Floor Garden'),
  -- First Floor
  ('A1', 'First Floor'), ('A2', 'First Floor'),
  ('B1', 'First Floor'), ('B2', 'First Floor'), ('B3', 'First Floor'), ('B4', 'First Floor'),
  ('Cabin C', 'First Floor'),
  -- Second Floor
  ('D1', 'Second Floor'), ('D2', 'Second Floor'), ('D3', 'Second Floor'), ('D4', 'Second Floor'),
  ('E1', 'Second Floor'), ('E2', 'Second Floor'),
  ('F1', 'Second Floor'), ('F2', 'Second Floor'),
  -- Third Floor
  ('C1', 'Third Floor'), ('C2', 'Third Floor'), ('C3', 'Third Floor'),
  ('C4', 'Third Floor'), ('C5', 'Third Floor'), ('C6', 'Third Floor'),
  ('R1', 'Third Floor'), ('R2', 'Third Floor'), ('R3', 'Third Floor')
) AS v(num, floor)
ON CONFLICT (table_number) DO NOTHING;

-- Drop the now-unused old floor labels from the picklist (only if nothing
-- still references them — harmless no-op otherwise).
DELETE FROM table_floors tf
WHERE tf.normalized_name IN ('ground', 'first', 'rooftop')
  AND NOT EXISTS (SELECT 1 FROM tables t WHERE lower(trim(t.floor)) = tf.normalized_name);

COMMIT;
