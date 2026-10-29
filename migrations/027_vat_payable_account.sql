-- Tax collected at billing is a liability until it is remitted.

INSERT INTO accounts (code, name, type, subtype, is_system)
VALUES ('2020', 'VAT / Tax Payable', 'liability', 'tax_payable', 1)
ON CONFLICT (code) DO NOTHING;

UPDATE accounts
SET parent_id = (SELECT id FROM accounts WHERE code = '2000')
WHERE code = '2020' AND parent_id IS NULL;
