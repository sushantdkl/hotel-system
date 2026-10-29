-- Convert the production Dim Sum Puri savings-deposit shape to the newer
-- Savings module without dropping old columns or records. Fresh databases
-- already have these columns, so all operations remain idempotent.

INSERT INTO accounts (code, name, type, subtype, parent_id, is_active, is_system)
SELECT '1040', 'Savings & Deposits', 'asset', 'savings', id, 1, 1
FROM accounts WHERE code = '1000'
ON CONFLICT (code) DO NOTHING;

ALTER TABLE savings_deposits ADD COLUMN IF NOT EXISTS destination_name TEXT;
ALTER TABLE savings_deposits ADD COLUMN IF NOT EXISTS reference_number TEXT;
ALTER TABLE savings_deposits ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE savings_deposits ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE savings_deposits ADD COLUMN IF NOT EXISTS voided_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE savings_deposits ADD COLUMN IF NOT EXISTS voided_at TIMESTAMP;
ALTER TABLE savings_deposits ADD COLUMN IF NOT EXISTS void_reason TEXT;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='savings_deposits' AND column_name='bank_name') THEN
    EXECUTE 'UPDATE savings_deposits SET destination_name = COALESCE(destination_name, bank_name)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='savings_deposits' AND column_name='reference') THEN
    EXECUTE 'UPDATE savings_deposits SET reference_number = COALESCE(reference_number, reference)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='savings_deposits' AND column_name='note') THEN
    EXECUTE 'UPDATE savings_deposits SET notes = COALESCE(notes, note)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='savings_deposits' AND column_name='recorded_by') THEN
    EXECUTE 'UPDATE savings_deposits SET created_by = COALESCE(created_by, recorded_by)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='savings_deposits' AND column_name='cancelled_by') THEN
    EXECUTE 'UPDATE savings_deposits SET voided_by = COALESCE(voided_by, cancelled_by)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='savings_deposits' AND column_name='cancelled_at') THEN
    EXECUTE 'UPDATE savings_deposits SET voided_at = COALESCE(voided_at, cancelled_at)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='savings_deposits' AND column_name='cancel_reason') THEN
    EXECUTE 'UPDATE savings_deposits SET void_reason = COALESCE(void_reason, cancel_reason)';
  END IF;
END $$;

UPDATE savings_deposits
SET destination_name = COALESCE(NULLIF(TRIM(destination_name), ''), 'Savings deposit');

-- Production called the non-cash source `bank`; the newer UI calls it
-- `online`. Both post to the same Bank ledger account (1020).
UPDATE savings_deposits SET source_account = 'online' WHERE source_account = 'bank';
UPDATE savings_deposits SET status = 'voided' WHERE status = 'cancelled';

ALTER TABLE savings_deposits ALTER COLUMN destination_name SET NOT NULL;
