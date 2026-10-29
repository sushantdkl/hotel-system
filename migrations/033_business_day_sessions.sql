-- 033: Store sessions inside a business day.
-- A business day is the reporting/accounting container; store sessions are
-- individual open/close cycles within that same business date.

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

ALTER TABLE business_day_sessions
  ADD COLUMN IF NOT EXISTS opening_journal_id INTEGER REFERENCES journal_entries(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_business_day_sessions_one_open
  ON business_day_sessions(business_day_id, status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_business_day_sessions_day
  ON business_day_sessions(business_day_id, session_number);

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
