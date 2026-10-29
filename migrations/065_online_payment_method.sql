-- Cash + Online payment model. Keep legacy values readable while all new
-- application writes use the canonical `online` value.
ALTER TABLE bill_payment_allocations
  DROP CONSTRAINT IF EXISTS bill_payment_allocations_method_check;

ALTER TABLE bill_payment_allocations
  ADD CONSTRAINT bill_payment_allocations_method_check
  CHECK (method IN ('cash', 'online', 'credit', 'qr', 'card', 'bank', 'bank_transfer', 'cheque', 'fonepay', 'esewa', 'khalti'));

-- The business uses one Online balance. Move historical digital-clearing
-- journal lines onto the Bank ledger while preserving every journal's debit
-- and credit. Existing legacy payment method labels remain unchanged for audit
-- history; reports and all new writes normalize them to Online.
DO $$
DECLARE
  primary_bank_id INTEGER;
  bank_ledger_id INTEGER;
BEGIN
  SELECT id INTO bank_ledger_id FROM accounts WHERE code = '1020' LIMIT 1;

  SELECT id INTO primary_bank_id
  FROM bank_accounts
  WHERE is_active = 1
  ORDER BY CASE WHEN lower(name) = 'primary bank' THEN 0 ELSE 1 END, id
  LIMIT 1;

  IF bank_ledger_id IS NOT NULL AND primary_bank_id IS NOT NULL THEN
    UPDATE bank_accounts
    SET account_id = bank_ledger_id
    WHERE id = primary_bank_id AND account_id IS DISTINCT FROM bank_ledger_id;

    UPDATE journal_lines
    SET account_id = bank_ledger_id,
        bank_account_id = primary_bank_id
    WHERE account_id IN (
      SELECT id FROM accounts WHERE code IN ('1100', '1110', '1120', '1130', '1140')
    );

    UPDATE journal_lines
    SET bank_account_id = primary_bank_id
    WHERE account_id = bank_ledger_id
      AND bank_account_id IS DISTINCT FROM primary_bank_id;

    UPDATE bank_accounts
    SET is_active = CASE WHEN id = primary_bank_id THEN 1 ELSE 0 END;
  END IF;

  UPDATE accounts
  SET is_active = 0
  WHERE code IN ('1100', '1110', '1120', '1130', '1140');
END $$;
