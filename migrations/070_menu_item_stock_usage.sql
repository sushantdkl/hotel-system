-- POS visible-stock checks require a per-sale usage multiplier. Older
-- databases only received this column lazily after visiting Products.
ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS stock_usage DOUBLE PRECISION DEFAULT 1;

UPDATE menu_items SET stock_usage = 1 WHERE stock_usage IS NULL OR stock_usage <= 0;
