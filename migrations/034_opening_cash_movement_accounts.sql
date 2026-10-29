-- 034: Asset account used for opening-cash movements between drawer and safe.

INSERT INTO accounts (code, name, type, subtype, is_system)
VALUES ('1030', 'Cash Reserve / Safe', 'asset', 'cash_reserve', 1)
ON CONFLICT (code) DO NOTHING;

UPDATE accounts
SET parent_id = (SELECT id FROM accounts WHERE code = '1000')
WHERE code = '1030' AND parent_id IS NULL;
