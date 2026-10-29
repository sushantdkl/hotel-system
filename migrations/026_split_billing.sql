-- Public checkout detail/idempotency and atomic split-payment ledgers.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_address TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS nearby_landmark TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_note TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_idempotency_key ON orders(idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE bills ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS outstanding_amount NUMERIC(14,2) DEFAULT 0;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'unpaid';
ALTER TABLE bills ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_bills_idempotency_key ON bills(idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE bill_payments ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE bill_payments ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'not_required';
ALTER TABLE bill_payments ADD COLUMN IF NOT EXISTS settlement_status TEXT DEFAULT 'received';
ALTER TABLE bill_payments ADD COLUMN IF NOT EXISTS verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE bill_payments ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE bill_payments ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE bill_payments ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE bill_payments ADD COLUMN IF NOT EXISTS cash_tendered NUMERIC(14,2);
ALTER TABLE bill_payments ADD COLUMN IF NOT EXISTS change_amount NUMERIC(14,2) DEFAULT 0;
ALTER TABLE bill_payments ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_bill_payments_idempotency_key ON bill_payments(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS bill_payment_allocations (
  id SERIAL PRIMARY KEY,
  bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  payment_id INTEGER REFERENCES bill_payments(id) ON DELETE SET NULL,
  method TEXT NOT NULL CHECK (method IN ('cash', 'qr', 'credit')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  provider TEXT,
  reference_number TEXT,
  verification_status TEXT DEFAULT 'not_required',
  settlement_status TEXT DEFAULT 'received',
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  due_date DATE,
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  idempotency_key TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_bill_allocations_bill ON bill_payment_allocations(bill_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bill_allocations_customer ON bill_payment_allocations(customer_id) WHERE customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS customer_ledger (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  bill_id INTEGER REFERENCES bills(id) ON DELETE SET NULL,
  payment_id INTEGER REFERENCES bill_payments(id) ON DELETE SET NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('credit_sale', 'credit_payment', 'refund', 'adjustment')),
  debit NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  due_date DATE,
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  idempotency_key TEXT NOT NULL UNIQUE,
  CHECK (NOT (debit > 0 AND credit > 0))
);
CREATE INDEX IF NOT EXISTS idx_customer_ledger_customer ON customer_ledger(customer_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_customer_ledger_bill ON customer_ledger(bill_id);

ALTER TABLE journal_lines ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_journal_lines_customer ON journal_lines(customer_id) WHERE customer_id IS NOT NULL;
