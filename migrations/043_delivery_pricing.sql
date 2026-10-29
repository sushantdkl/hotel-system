-- Delivery pricing is snapshotted so later admin setting changes never alter old orders/bills.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_distance_km NUMERIC(10,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_pricing_label TEXT;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(14,2) NOT NULL DEFAULT 0;

INSERT INTO system_settings (setting_key, setting_value)
VALUES
  ('delivery_pricing_enabled', 'false'),
  ('delivery_pricing_mode', 'fixed'),
  ('delivery_fixed_fee', '0'),
  ('delivery_distance_bands', '[]'),
  ('delivery_per_km_rate', '0'),
  ('delivery_minimum_fee', '0'),
  ('delivery_max_distance_km', '0')
ON CONFLICT (setting_key) DO NOTHING;

