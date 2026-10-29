-- 021: secure per-table QR token for customer ordering.
-- The QR encodes /order/<qr_token>. The token is an unguessable random string
-- (not the table id) so a table's ordering page can't be reached by guessing.
ALTER TABLE tables ADD COLUMN IF NOT EXISTS qr_token TEXT;

UPDATE tables SET qr_token = replace(gen_random_uuid()::text, '-', '') WHERE qr_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tables_qr_token ON tables(qr_token) WHERE qr_token IS NOT NULL;
