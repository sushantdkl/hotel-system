-- Reporting hot paths used by the restaurant management overview.
-- These are read-performance indexes only; no business data is changed.

CREATE INDEX IF NOT EXISTS idx_bills_status_paid_at
  ON bills(status, paid_at DESC);

CREATE INDEX IF NOT EXISTS idx_kots_printed_status
  ON kots(printed_at DESC, status);

CREATE INDEX IF NOT EXISTS idx_bill_corrections_type_created
  ON bill_corrections(type, created_at DESC);
