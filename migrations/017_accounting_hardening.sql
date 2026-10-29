-- 017: harden the accounting foundation.
--
-- (a) Seed the default Chart of Accounts + default drawer/bank in a committed
--     migration. Previously seeding lived only in JS behind an in-process flag,
--     so a rollback of the first seeding transaction could strand the engine.
--     With the accounts committed here, that flag can never disable posting.
-- (b) Add external_ref for idempotent manual operations (deposits, withdrawals,
--     transfers, settlements, cash exchange).
-- (c) One open session per drawer (partial unique index).
-- (d) A journal line cannot be debit AND credit at once.
-- (e) Reporting indexes for the sub-ledger tags.

INSERT INTO accounts (code, name, type, subtype, is_system) VALUES
  ('1000','Assets','asset',NULL,1),
  ('1010','Cash on Hand','asset','cash',1),
  ('1020','Bank','asset','bank',1),
  ('1030','Cash Reserve / Safe','asset','cash_reserve',1),
  ('1100','Card Clearing','asset','clearing',1),
  ('1110','eSewa Clearing','asset','clearing',1),
  ('1120','Khalti Clearing','asset','clearing',1),
  ('1130','QR / Fonepay Clearing','asset','clearing',1),
  ('1140','Online Clearing','asset','clearing',1),
  ('1200','Inventory','asset','inventory',1),
  ('1300','Accounts Receivable','asset','receivable',1),
  ('2000','Liabilities','liability',NULL,1),
  ('2010','Accounts Payable','liability','payable',1),
  ('3000','Equity','equity',NULL,1),
  ('3010','Owner''s Equity','equity',NULL,1),
  ('3020','Opening Balance Equity','equity',NULL,1),
  ('4000','Income','income',NULL,1),
  ('4010','Sales Revenue','income','sales',1),
  ('4020','Other Income','income',NULL,1),
  ('5000','Expenses','expense',NULL,1),
  ('5010','Purchases / COGS','expense','cogs',1),
  ('5020','Operating Expenses','expense','operating',1),
  ('5030','Payroll','expense','payroll',1),
  ('5040','Wastage / Inventory Loss','expense','wastage',1),
  ('5050','Payment Processing Fees','expense','fees',1),
  ('5060','Cash Over / Short','expense','variance',1)
ON CONFLICT (code) DO NOTHING;

UPDATE accounts SET parent_id = (SELECT id FROM accounts WHERE code='1000') WHERE code IN ('1010','1020','1030','1100','1110','1120','1130','1140','1200','1300') AND parent_id IS NULL;
UPDATE accounts SET parent_id = (SELECT id FROM accounts WHERE code='2000') WHERE code IN ('2010') AND parent_id IS NULL;
UPDATE accounts SET parent_id = (SELECT id FROM accounts WHERE code='3000') WHERE code IN ('3010','3020') AND parent_id IS NULL;
UPDATE accounts SET parent_id = (SELECT id FROM accounts WHERE code='4000') WHERE code IN ('4010','4020') AND parent_id IS NULL;
UPDATE accounts SET parent_id = (SELECT id FROM accounts WHERE code='5000') WHERE code IN ('5010','5020','5030','5040','5050','5060') AND parent_id IS NULL;

INSERT INTO cash_drawers (name)
  SELECT 'Main Drawer' WHERE NOT EXISTS (SELECT 1 FROM cash_drawers);
INSERT INTO bank_accounts (name, account_id)
  SELECT 'Primary Bank', (SELECT id FROM accounts WHERE code='1020')
  WHERE NOT EXISTS (SELECT 1 FROM bank_accounts);

ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS external_ref TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_external_ref ON journal_entries(external_ref) WHERE external_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_drawer_one_open ON drawer_sessions(drawer_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_journal_lines_drawer ON journal_lines(drawer_id) WHERE drawer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_journal_lines_bank ON journal_lines(bank_account_id) WHERE bank_account_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_line_one_side') THEN
    ALTER TABLE journal_lines ADD CONSTRAINT chk_line_one_side CHECK (NOT (debit > 0 AND credit > 0));
  END IF;
END $$;
