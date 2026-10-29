-- Exactly one website hero banner across offers + combos.
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS website_featured INTEGER DEFAULT 0;
ALTER TABLE menu_combos ADD COLUMN IF NOT EXISTS website_featured INTEGER DEFAULT 0;
