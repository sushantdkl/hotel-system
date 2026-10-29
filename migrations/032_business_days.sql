-- 032: restaurant-wide business day lifecycle.
-- Business days are explicit operating periods and may cross calendar midnight.
-- Drawer sessions remain independent cashier/register shifts within a day.

CREATE TABLE IF NOT EXISTS business_days (
  id SERIAL PRIMARY KEY,
  business_date DATE NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opened_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  opened_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  opening_cash NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (opening_cash >= 0),
  opening_note TEXT,
  closed_at TIMESTAMP,
  closed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  expected_cash NUMERIC(14,2),
  counted_cash NUMERIC(14,2),
  cash_difference NUMERIC(14,2),
  closing_note TEXT,
  force_closed INTEGER NOT NULL DEFAULT 0,
  force_close_reason TEXT,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  closing_snapshot TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_business_days_one_open
  ON business_days(status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_business_days_date ON business_days(business_date DESC);

CREATE TABLE IF NOT EXISTS business_day_audit (
  id SERIAL PRIMARY KEY,
  business_day_id INTEGER NOT NULL REFERENCES business_days(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT,
  previous_value TEXT,
  new_value TEXT,
  reason TEXT,
  detail TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_business_day_audit_day
  ON business_day_audit(business_day_id, created_at, id);

CREATE TABLE IF NOT EXISTS business_day_sessions (
  id SERIAL PRIMARY KEY,
  business_day_id INTEGER NOT NULL REFERENCES business_days(id) ON DELETE RESTRICT,
  session_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opened_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  opened_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  opening_cash NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (opening_cash >= 0),
  opening_note TEXT,
  closed_at TIMESTAMP,
  closed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  expected_cash NUMERIC(14,2),
  counted_cash NUMERIC(14,2),
  cash_difference NUMERIC(14,2),
  closing_note TEXT,
  force_closed INTEGER NOT NULL DEFAULT 0,
  force_close_reason TEXT,
  closing_snapshot TEXT,
  drawer_session_id INTEGER,
  opening_journal_id INTEGER REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_business_day_sessions_one_open
  ON business_day_sessions(business_day_id, status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_business_day_sessions_day
  ON business_day_sessions(business_day_id, session_number);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS business_day_id INTEGER REFERENCES business_days(id) ON DELETE RESTRICT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS carried_from_business_day_id INTEGER REFERENCES business_days(id) ON DELETE SET NULL;
ALTER TABLE kots ADD COLUMN IF NOT EXISTS business_day_id INTEGER REFERENCES business_days(id) ON DELETE RESTRICT;
ALTER TABLE kots ADD COLUMN IF NOT EXISTS carried_from_business_day_id INTEGER REFERENCES business_days(id) ON DELETE SET NULL;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS business_day_id INTEGER REFERENCES business_days(id) ON DELETE RESTRICT;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS carried_from_business_day_id INTEGER REFERENCES business_days(id) ON DELETE SET NULL;
ALTER TABLE bill_payments ADD COLUMN IF NOT EXISTS business_day_id INTEGER REFERENCES business_days(id) ON DELETE RESTRICT;
ALTER TABLE bill_payment_allocations ADD COLUMN IF NOT EXISTS business_day_id INTEGER REFERENCES business_days(id) ON DELETE RESTRICT;
ALTER TABLE customer_ledger ADD COLUMN IF NOT EXISTS business_day_id INTEGER REFERENCES business_days(id) ON DELETE RESTRICT;
ALTER TABLE bill_corrections ADD COLUMN IF NOT EXISTS business_day_id INTEGER REFERENCES business_days(id) ON DELETE RESTRICT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS business_day_id INTEGER REFERENCES business_days(id) ON DELETE RESTRICT;
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS business_day_id INTEGER REFERENCES business_days(id) ON DELETE RESTRICT;
ALTER TABLE drawer_sessions ADD COLUMN IF NOT EXISTS business_day_id INTEGER REFERENCES business_days(id) ON DELETE RESTRICT;
ALTER TABLE payment_settlements ADD COLUMN IF NOT EXISTS business_day_id INTEGER REFERENCES business_days(id) ON DELETE RESTRICT;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS business_day_id INTEGER REFERENCES business_days(id) ON DELETE SET NULL;
ALTER TABLE salary_payments ADD COLUMN IF NOT EXISTS business_day_id INTEGER REFERENCES business_days(id) ON DELETE RESTRICT;

-- Preserve a pre-migration open drawer as the currently operating day. This is
-- a one-time continuity bridge, not automatic day creation during normal use.
INSERT INTO business_days (business_date, status, opened_at, opened_by, opening_cash, opening_note)
SELECT (s.opened_at + INTERVAL '5 hours 45 minutes')::date,
       'open', s.opened_at, s.opened_by, COALESCE(s.opening_amount, 0),
       'Continued from the drawer session active when business days were installed.'
FROM drawer_sessions s
WHERE s.status = 'open'
  AND NOT EXISTS (SELECT 1 FROM business_days WHERE status = 'open')
ORDER BY s.opened_at DESC, s.id DESC
LIMIT 1
ON CONFLICT (business_date) DO NOTHING;

-- Create read-only historical day shells. No financial values are changed.
INSERT INTO business_days (business_date, status, opened_at, closed_at, opening_cash, opening_note)
SELECT d, 'closed', d::timestamp, d::timestamp + INTERVAL '1 day', 0,
       'Historical calendar-date backfill; no opening count was available.'
FROM (
  SELECT DISTINCT (created_at + INTERVAL '5 hours 45 minutes')::date AS d FROM orders
  UNION SELECT DISTINCT (created_at + INTERVAL '5 hours 45 minutes')::date FROM bills
  UNION SELECT DISTINCT (created_at + INTERVAL '5 hours 45 minutes')::date FROM expenses
  UNION SELECT DISTINCT entry_date FROM journal_entries
) dates
WHERE d IS NOT NULL
  AND (d < (CURRENT_TIMESTAMP + INTERVAL '5 hours 45 minutes')::date
       OR EXISTS (SELECT 1 FROM business_days open_day WHERE open_day.business_date=d AND open_day.status='open'))
ON CONFLICT (business_date) DO NOTHING;

UPDATE orders o SET business_day_id = bd.id
FROM business_days bd
WHERE o.business_day_id IS NULL
  AND bd.status = 'closed'
  AND bd.business_date = (o.created_at + INTERVAL '5 hours 45 minutes')::date;
UPDATE kots k SET business_day_id = o.business_day_id
FROM orders o WHERE k.business_day_id IS NULL AND k.order_id = o.id;
UPDATE bills b SET business_day_id = o.business_day_id
FROM orders o WHERE b.business_day_id IS NULL AND b.order_id = o.id;
UPDATE bill_payments p SET business_day_id = b.business_day_id
FROM bills b WHERE p.business_day_id IS NULL AND p.bill_id = b.id;
UPDATE bill_payment_allocations p SET business_day_id = b.business_day_id
FROM bills b WHERE p.business_day_id IS NULL AND p.bill_id = b.id;
UPDATE customer_ledger c SET business_day_id = b.business_day_id
FROM bills b WHERE c.business_day_id IS NULL AND c.bill_id = b.id;
UPDATE bill_corrections c SET business_day_id = b.business_day_id
FROM bills b WHERE c.business_day_id IS NULL AND c.bill_id = b.id;
UPDATE expenses e SET business_day_id = bd.id
FROM business_days bd
WHERE e.business_day_id IS NULL
  AND bd.status = 'closed'
  AND COALESCE(e.purchase_date, CAST(e.expense_date AS TEXT)) ~ '^\d{4}-\d{2}-\d{2}$'
  AND bd.business_date = CAST(COALESCE(e.purchase_date, CAST(e.expense_date AS TEXT)) AS DATE);
UPDATE journal_entries je SET business_day_id = bd.id
FROM business_days bd
WHERE je.business_day_id IS NULL AND bd.status = 'closed' AND bd.business_date = je.entry_date;
UPDATE drawer_sessions s SET business_day_id = bd.id
FROM business_days bd
WHERE s.business_day_id IS NULL
  AND bd.status = 'closed'
  AND bd.business_date = (s.opened_at + INTERVAL '5 hours 45 minutes')::date;
UPDATE payment_settlements s SET business_day_id = bd.id
FROM business_days bd
WHERE s.business_day_id IS NULL
  AND bd.status = 'closed'
  AND bd.business_date = (s.settled_at + INTERVAL '5 hours 45 minutes')::date;
UPDATE reservations r SET business_day_id = bd.id
FROM business_days bd
WHERE r.business_day_id IS NULL AND bd.status = 'closed' AND r.date ~ '^\d{4}-\d{2}-\d{2}$' AND bd.business_date = CAST(r.date AS DATE);
UPDATE salary_payments s SET business_day_id = bd.id
FROM business_days bd
WHERE s.business_day_id IS NULL AND bd.status = 'closed' AND bd.business_date = s.paid_on;

INSERT INTO business_day_sessions
  (business_day_id, session_number, status, opened_at, opened_by, opening_cash, opening_note,
   closed_at, closed_by, expected_cash, counted_cash, cash_difference, closing_note,
   force_closed, force_close_reason, closing_snapshot, drawer_session_id)
SELECT bd.id, 1,
       CASE WHEN bd.status='open' AND bd.closed_at IS NULL THEN 'open' ELSE 'closed' END,
       bd.opened_at, bd.opened_by, bd.opening_cash, bd.opening_note,
       CASE WHEN bd.status='open' AND bd.closed_at IS NULL THEN NULL ELSE bd.closed_at END,
       bd.closed_by, bd.expected_cash, bd.counted_cash, bd.cash_difference, bd.closing_note,
       bd.force_closed, bd.force_close_reason, bd.closing_snapshot,
       (SELECT ds.id FROM drawer_sessions ds WHERE ds.business_day_id=bd.id ORDER BY ds.opened_at, ds.id LIMIT 1)
FROM business_days bd
WHERE NOT EXISTS (SELECT 1 FROM business_day_sessions s WHERE s.business_day_id=bd.id);

-- If installation found an already-open drawer, preserve only activity that
-- occurred after that drawer session began. Explicitly opened new days never
-- adopt unassigned legacy rows merely because their calendar date matches.
UPDATE orders o SET business_day_id = bd.id
FROM business_days bd
WHERE o.business_day_id IS NULL AND bd.status='open' AND o.created_at >= bd.opened_at
  AND bd.opening_note LIKE 'Continued from the drawer session%';
UPDATE kots k SET business_day_id=o.business_day_id FROM orders o
WHERE k.business_day_id IS NULL AND k.order_id=o.id AND o.business_day_id IS NOT NULL;
UPDATE bills b SET business_day_id=o.business_day_id FROM orders o
WHERE b.business_day_id IS NULL AND b.order_id=o.id AND o.business_day_id IS NOT NULL;
UPDATE bill_payments p SET business_day_id=b.business_day_id FROM bills b
WHERE p.business_day_id IS NULL AND p.bill_id=b.id AND b.business_day_id IS NOT NULL;
UPDATE bill_payment_allocations p SET business_day_id=b.business_day_id FROM bills b
WHERE p.business_day_id IS NULL AND p.bill_id=b.id AND b.business_day_id IS NOT NULL;
UPDATE customer_ledger c SET business_day_id=b.business_day_id FROM bills b
WHERE c.business_day_id IS NULL AND c.bill_id=b.id AND b.business_day_id IS NOT NULL;
UPDATE bill_corrections c SET business_day_id=b.business_day_id FROM bills b
WHERE c.business_day_id IS NULL AND c.bill_id=b.id AND b.business_day_id IS NOT NULL;
UPDATE expenses e SET business_day_id=bd.id FROM business_days bd
WHERE e.business_day_id IS NULL AND bd.status='open' AND e.created_at >= bd.opened_at
  AND bd.opening_note LIKE 'Continued from the drawer session%';
UPDATE drawer_sessions s SET business_day_id=bd.id FROM business_days bd
WHERE s.business_day_id IS NULL AND s.status='open' AND bd.status='open'
  AND s.opened_at=bd.opened_at AND bd.opening_note LIKE 'Continued from the drawer session%';
UPDATE journal_entries je SET business_day_id=bd.id FROM business_days bd
WHERE je.business_day_id IS NULL AND bd.status='open' AND je.created_at >= bd.opened_at
  AND bd.opening_note LIKE 'Continued from the drawer session%';

CREATE INDEX IF NOT EXISTS idx_orders_business_day ON orders(business_day_id, status);
CREATE INDEX IF NOT EXISTS idx_kots_business_day ON kots(business_day_id, status);
CREATE INDEX IF NOT EXISTS idx_bills_business_day ON bills(business_day_id, status);
CREATE INDEX IF NOT EXISTS idx_bill_payments_business_day ON bill_payments(business_day_id, payment_method);
CREATE INDEX IF NOT EXISTS idx_bill_allocations_business_day ON bill_payment_allocations(business_day_id, method);
CREATE INDEX IF NOT EXISTS idx_customer_ledger_business_day ON customer_ledger(business_day_id, entry_type);
CREATE INDEX IF NOT EXISTS idx_bill_corrections_business_day ON bill_corrections(business_day_id, type);
CREATE INDEX IF NOT EXISTS idx_expenses_business_day ON expenses(business_day_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_business_day ON journal_entries(business_day_id, source_type);
CREATE INDEX IF NOT EXISTS idx_drawer_sessions_business_day ON drawer_sessions(business_day_id, status);
