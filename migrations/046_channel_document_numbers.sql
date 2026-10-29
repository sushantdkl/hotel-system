-- Re-prefix existing orders, bills and KOTs into the channel-aware scheme.
--
--   BILL-397 / B397  ->  T-397  |  TW-397  |  D-397     (by the order's channel)
--   KOT-2001         ->  K-2001 |  K-TW-2001 | K-D-2001
--   ORD-417 / O417   ->  O-417  |  O-TW-417  | O-D-417
--
-- THE SERIAL IS PRESERVED. Only the prefix changes, so bill 397 is still bill
-- 397: an old printed docket, a customer's photo of a receipt and the database
-- row still match, and document_counters stays exactly where it is. Renumbering
-- from 1 would have broken all three.
--
-- The channel rule is the one in lib/order-types.js normalizedOrderType():
-- order_type 'delivery' is delivery; no table at all is takeaway; anything with
-- a table is dine-in. Written out here rather than derived from the number,
-- because the old text never carried the channel.
--
-- Rows in any other format (imports, seeded ORD-2001-DEMO01 numbers) are left
-- alone by the LIKE/regex guards. Numbers already converted do not match the
-- legacy patterns, so re-running this migration is a no-op.

-- Orders -------------------------------------------------------------------
UPDATE orders o
SET order_number = CASE
      WHEN LOWER(COALESCE(o.order_type, '')) = 'delivery' THEN 'O-D-'
      WHEN o.table_id IS NULL AND NULLIF(TRIM(COALESCE(o.table_number, '')), '') IS NULL THEN 'O-TW-'
      ELSE 'O-'
    END || SUBSTRING(o.order_number FROM '([0-9]{3,})$')
WHERE o.order_number ~* '^(ORD-|O)[0-9]{3,}$';

-- Bills --------------------------------------------------------------------
UPDATE bills b
SET bill_number = CASE
      WHEN LOWER(COALESCE(o.order_type, '')) = 'delivery' THEN 'D-'
      WHEN o.table_id IS NULL AND NULLIF(TRIM(COALESCE(o.table_number, '')), '') IS NULL THEN 'TW-'
      ELSE 'T-'
    END || SUBSTRING(b.bill_number FROM '([0-9]{3,})$')
FROM orders o
WHERE o.id = b.order_id
  AND b.bill_number ~* '^(BILL-|B)[0-9]{3,}$';

-- A bill with no order row keeps a channel-neutral dine-in prefix rather than
-- being left in the old format: T is the house default, and guessing takeaway
-- from a missing join would misreport the mix.
UPDATE bills b
SET bill_number = 'T-' || SUBSTRING(b.bill_number FROM '([0-9]{3,})$')
WHERE b.order_id IS NULL
  AND b.bill_number ~* '^(BILL-|B)[0-9]{3,}$';

-- KOTs ---------------------------------------------------------------------
-- A ticket carries its own table snapshot; fall back to the order's when it is
-- empty, otherwise a NULL table would read as takeaway and mislabel historical
-- dine-in tickets.
UPDATE kots k
SET kot_number = CASE
      WHEN LOWER(COALESCE(k.order_type, o.order_type, '')) = 'delivery' THEN 'K-D-'
      WHEN COALESCE(k.table_id, o.table_id) IS NULL
       AND NULLIF(TRIM(COALESCE(k.table_number, o.table_number, '')), '') IS NULL THEN 'K-TW-'
      ELSE 'K-'
    END || SUBSTRING(k.kot_number FROM '([0-9]{3,})$')
FROM orders o
WHERE o.id = k.order_id
  AND k.kot_number ~* '^(KOT-|K)[0-9]{3,}$';

UPDATE kots k
SET kot_number = CASE
      WHEN LOWER(COALESCE(k.order_type, '')) = 'delivery' THEN 'K-D-'
      WHEN k.table_id IS NULL AND NULLIF(TRIM(COALESCE(k.table_number, '')), '') IS NULL THEN 'K-TW-'
      ELSE 'K-'
    END || SUBSTRING(k.kot_number FROM '([0-9]{3,})$')
WHERE k.order_id IS NULL
  AND k.kot_number ~* '^(KOT-|K)[0-9]{3,}$';
