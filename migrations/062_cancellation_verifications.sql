-- Append-only review events. These never change cancellation or financial state.
CREATE TABLE IF NOT EXISTS cancellation_verifications (
  id SERIAL PRIMARY KEY,
  document_type TEXT NOT NULL CHECK (document_type IN ('order','kot','bill')),
  document_id INTEGER NOT NULL,
  reviewer_scope TEXT NOT NULL CHECK (reviewer_scope IN ('kitchen','admin')),
  status TEXT NOT NULL CHECK (status IN ('verified','disputed')),
  note TEXT,
  verified_by INTEGER NOT NULL REFERENCES users(id),
  verified_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  request_key TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_cancellation_verifications_document
ON cancellation_verifications(document_type, document_id, reviewer_scope, id);
