-- 039: guest-to-staff service calls from secure table QR pages.

CREATE TABLE IF NOT EXISTS waiter_requests (
  id SERIAL PRIMARY KEY,
  table_id INTEGER NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL DEFAULT 'service'
    CHECK (request_type IN ('service', 'order', 'bill', 'water')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'acknowledged', 'completed', 'cancelled')),
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  acknowledged_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMP,
  completed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  completed_at TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_waiter_requests_one_active_table
  ON waiter_requests(table_id)
  WHERE status IN ('pending', 'acknowledged');
CREATE INDEX IF NOT EXISTS idx_waiter_requests_active
  ON waiter_requests(status, requested_at);
CREATE INDEX IF NOT EXISTS idx_waiter_requests_history
  ON waiter_requests(requested_at DESC, id DESC);
