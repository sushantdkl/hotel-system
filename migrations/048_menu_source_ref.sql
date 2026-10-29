-- Stable key linking a menu row back to its entry in data/menu/raithane-menu.json.
-- scripts/import-raithane-menu.mjs matches on it, so re-running the importer
-- after a menu correction updates the existing rows instead of creating a
-- second copy of every dish.
--
-- The importer adds this column itself if it is missing, but that ALTER runs as
-- the app's database user, which on a cPanel host often has DML rights only.
-- Creating it in a migration means it is applied once by whoever has DDL rights.
-- deploy/production_seed.sql also adds it, so this is a no-op on a freshly
-- seeded database.

ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS source_ref TEXT;
