-- 020: bank reconciliation.
-- A bank line (journal_lines on account 1020) can be flagged as cleared against
-- the bank statement. A reconciliation snapshot records the statement balance vs
-- the cleared book balance so the difference is auditable. No stored running
-- balances — cleared/uncleared totals are still derived from journal_lines.
ALTER TABLE journal_lines ADD COLUMN IF NOT EXISTS reconciled INTEGER DEFAULT 0;
ALTER TABLE journal_lines ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS bank_reconciliations (
  id SERIAL PRIMARY KEY,
  bank_account_id INTEGER REFERENCES bank_accounts(id) ON DELETE CASCADE,
  statement_date DATE NOT NULL,
  statement_balance NUMERIC(14,2) NOT NULL,
  book_balance NUMERIC(14,2) NOT NULL,
  difference NUMERIC(14,2) NOT NULL,
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bank_recon_account ON bank_reconciliations(bank_account_id, statement_date DESC);
