-- 040: KOT cancellation history is a first-class record. Older production
-- databases can predate these compatibility columns even when the app code
-- already reads them.
ALTER TABLE kots ADD COLUMN IF NOT EXISTS void_reason TEXT;
ALTER TABLE kots ADD COLUMN IF NOT EXISTS voided_at TIMESTAMP;
ALTER TABLE kots ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
ALTER TABLE kots ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;
ALTER TABLE kots ADD COLUMN IF NOT EXISTS cancelled_by INTEGER;
ALTER TABLE kots ADD COLUMN IF NOT EXISTS previous_status TEXT;
