CREATE TABLE IF NOT EXISTS promotions (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT,
  description TEXT,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value DOUBLE PRECISION NOT NULL CHECK (discount_value > 0),
  scope TEXT NOT NULL CHECK (scope IN ('order', 'category', 'item')),
  minimum_order_amount DOUBLE PRECISION DEFAULT 0,
  maximum_discount_amount DOUBLE PRECISION,
  starts_at TIMESTAMP,
  ends_at TIMESTAMP,
  days_of_week TEXT DEFAULT '[]',
  channels TEXT DEFAULT '["pos","website","qr"]',
  auto_apply INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_promotions_code_unique
  ON promotions(UPPER(code)) WHERE code IS NOT NULL AND code <> '';
CREATE INDEX IF NOT EXISTS idx_promotions_active_schedule
  ON promotions(is_active, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS promotion_targets (
  id SERIAL PRIMARY KEY,
  promotion_id INTEGER NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('category', 'item')),
  target_id INTEGER NOT NULL,
  UNIQUE(promotion_id, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS promotion_redemptions (
  id SERIAL PRIMARY KEY,
  promotion_id INTEGER NOT NULL REFERENCES promotions(id) ON DELETE RESTRICT,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  bill_id INTEGER REFERENCES bills(id) ON DELETE SET NULL,
  promotion_name TEXT NOT NULL,
  promotion_code TEXT,
  channel TEXT NOT NULL,
  discount_amount DOUBLE PRECISION NOT NULL,
  customer_phone TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_promotion_redemptions_promotion
  ON promotion_redemptions(promotion_id, created_at);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS promotion_id INTEGER REFERENCES promotions(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS promotion_code TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS promotion_channel TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount DOUBLE PRECISION DEFAULT 0;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS promotion_id INTEGER REFERENCES promotions(id) ON DELETE SET NULL;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS promotion_code TEXT;
