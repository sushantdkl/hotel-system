-- 012: normalize raw-material categories.
-- Migration 007 added inventory_items.category as free text. This gives that
-- text a managed backing list plus a category_id FK (the supplier pattern),
-- then backfills both from the values already in use so nothing is lost.
CREATE TABLE IF NOT EXISTS inventory_categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES inventory_categories(id) ON DELETE SET NULL;

-- Seed the managed list from the categories already typed on items.
INSERT INTO inventory_categories (name, normalized_name)
SELECT DISTINCT trim(category), lower(trim(category))
FROM inventory_items
WHERE category IS NOT NULL AND trim(category) <> ''
ON CONFLICT (normalized_name) DO NOTHING;

-- Link existing items to their category row.
UPDATE inventory_items i
SET category_id = c.id
FROM inventory_categories c
WHERE i.category_id IS NULL
  AND i.category IS NOT NULL
  AND lower(trim(i.category)) = c.normalized_name;

CREATE INDEX IF NOT EXISTS idx_inventory_items_category_id ON inventory_items(category_id);
