-- Coherent POS lifecycle additions:
-- - short staff-facing document numbers for future orders, bills and KOTs
-- - explicit KOT cancellation metadata, separate from bill voiding

CREATE TABLE IF NOT EXISTS document_counters (
  id SERIAL PRIMARY KEY,
  document_type TEXT NOT NULL UNIQUE,
  last_value INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE kots ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
ALTER TABLE kots ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;
ALTER TABLE kots ADD COLUMN IF NOT EXISTS cancelled_by INTEGER;
ALTER TABLE kots ADD COLUMN IF NOT EXISTS previous_status TEXT;

CREATE INDEX IF NOT EXISTS idx_kots_cancelled_at ON kots(cancelled_at);
CREATE INDEX IF NOT EXISTS idx_kots_cancelled_by ON kots(cancelled_by);
