-- 015: accounting foundation — double-entry engine.
--
-- Ledger balances are NEVER stored: the General Ledger, Cash Book and Bank Book
-- are all derived from journal_lines. Journals are posted automatically by the
-- business flows (sales, expenses, cash/bank movements) via lib/accounting.js;
-- the default Chart of Accounts is seeded idempotently in that same module so
-- the seed logic lives in one place for both Postgres and the SQLite fallback.

CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('asset','liability','equity','income','expense')),
  subtype TEXT,                    -- cash | bank | clearing | receivable | payable | inventory | ...
  parent_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  is_active INTEGER DEFAULT 1,
  is_system INTEGER DEFAULT 0,     -- seeded accounts the engine relies on; not deletable
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cash_drawers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bank_accounts (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  account_number TEXT,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  opening_balance DOUBLE PRECISION DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id SERIAL PRIMARY KEY,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  memo TEXT,
  source_type TEXT,                -- 'bill' | 'expense' | 'transfer' | 'settlement' | 'drawer' | 'exchange' | NULL(manual)
  source_id INTEGER,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- One automatic journal per business event: reposting is idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_source ON journal_entries(source_type, source_id)
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS journal_lines (
  id SERIAL PRIMARY KEY,
  journal_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  debit DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (credit >= 0),
  memo TEXT,
  drawer_id INTEGER REFERENCES cash_drawers(id) ON DELETE SET NULL,
  bank_account_id INTEGER REFERENCES bank_accounts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_journal_lines_journal ON journal_lines(journal_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(entry_date DESC);

CREATE TABLE IF NOT EXISTS drawer_sessions (
  id SERIAL PRIMARY KEY,
  drawer_id INTEGER NOT NULL REFERENCES cash_drawers(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opening_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  opened_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expected_amount DOUBLE PRECISION,
  counted_amount DOUBLE PRECISION,
  difference DOUBLE PRECISION,
  note TEXT,
  closed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  closed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_drawer_sessions_drawer ON drawer_sessions(drawer_id, status);

CREATE TABLE IF NOT EXISTS payment_settlements (
  id SERIAL PRIMARY KEY,
  method TEXT NOT NULL,
  gross_amount DOUBLE PRECISION NOT NULL,
  fee_amount DOUBLE PRECISION DEFAULT 0,
  net_amount DOUBLE PRECISION NOT NULL,
  bank_account_id INTEGER REFERENCES bank_accounts(id) ON DELETE SET NULL,
  reference TEXT,
  note TEXT,
  settled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  settled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  journal_id INTEGER REFERENCES journal_entries(id) ON DELETE SET NULL
);
