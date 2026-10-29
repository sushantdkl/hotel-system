-- Inventory Command Center needs a category to filter/group raw materials by.
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS category TEXT;
