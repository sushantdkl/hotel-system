-- Delivery executive roster + order assignment.
CREATE TABLE IF NOT EXISTS delivery_executives (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  status TEXT NOT NULL DEFAULT 'available',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_executive_id INTEGER REFERENCES delivery_executives(id);

CREATE INDEX IF NOT EXISTS idx_orders_delivery_executive_id ON orders(delivery_executive_id);
