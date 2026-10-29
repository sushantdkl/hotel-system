-- Website showcase images for offers & discounts (happy-hour is the same table).
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS image_url TEXT;
