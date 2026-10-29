-- Columns that the app previously added at runtime via ensureColumn() rather
-- than in a migration. lib/db/schema-helpers.js ensureColumn() deliberately
-- swallows "must be owner" / "permission denied" so a list page never 500s on
-- a cPanel database whose app user has DML but not DDL rights. The side effect
-- is that on such a host the ALTER silently never happens, and the very next
-- query — which references the column directly — fails with
-- "column i.pos_stock_visible does not exist".
--
-- Adding them here makes the columns part of the deploy, applied once by
-- whoever runs the migration, instead of depending on the app's own DDL rights
-- at request time. ensureMenuVariantsSchema() and the products route still run
-- their ensureColumn() calls; those simply become no-ops afterwards.
--
-- menu_item_variants.price is the absolute price; deploy/production_seed.sql
-- also adds it, so this ALTER is a no-op on a freshly seeded database.

ALTER TABLE menu_item_variants ADD COLUMN IF NOT EXISTS price DOUBLE PRECISION;
ALTER TABLE menu_item_variants ADD COLUMN IF NOT EXISTS stock_quantity DOUBLE PRECISION;
ALTER TABLE menu_item_variants ADD COLUMN IF NOT EXISTS stock_unit TEXT;
ALTER TABLE menu_item_variants ADD COLUMN IF NOT EXISTS inventory_item_id INTEGER;
ALTER TABLE menu_item_variants ADD COLUMN IF NOT EXISTS pos_stock_visible INTEGER DEFAULT 0;

ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS pos_stock_visible INTEGER DEFAULT 0;

ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS unit TEXT;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS cost NUMERIC(14,2);
