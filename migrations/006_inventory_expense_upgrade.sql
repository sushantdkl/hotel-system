-- Stock movement audit log (order deductions, manual restocks, wastage, adjustments)
CREATE TABLE IF NOT EXISTS stock_movements (
  id SERIAL PRIMARY KEY,
  inventory_item_id INTEGER REFERENCES inventory_items(id) ON DELETE SET NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('order_deduction', 'manual_restock', 'wastage', 'adjustment')),
  quantity_changed DOUBLE PRECISION NOT NULL,
  performed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT,
  reference_id TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_item ON stock_movements(inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created ON stock_movements(created_at DESC);

-- Expense ledger: payment method, who logged it, optional receipt attachment
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'cash';
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS logged_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_url TEXT;
