-- Fix stale "new" badge count: track when an admin actually opens a
-- reservation/inquiry, instead of counting status='new' forever.
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMP;
ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMP;
