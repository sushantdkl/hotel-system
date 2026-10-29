-- 019: supplier sub-ledger tag on journal lines.
-- Accounts Payable lives in one GL account (2010). Tagging the line with a
-- supplier makes a per-supplier ledger + ageing possible without a second
-- balances table — same pattern as drawer_id / bank_account_id.
ALTER TABLE journal_lines
  ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_journal_lines_supplier ON journal_lines(supplier_id) WHERE supplier_id IS NOT NULL;
