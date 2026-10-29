-- 008: inventory ledger foundation
--
-- CANONICAL UNIT RULE (see lib/inventory-ledger.js for the enforcement point):
--   inventory_items.quantity      -> always CONSUMPTION units (== inventory_items.unit)
--   inventory_items.cost_per_unit -> always cost of ONE CONSUMPTION unit (moving average)
--   inventory_items.conversion_factor -> consumption units contained in 1 purchase unit
--   Anything entered in purchase units (deliveries, CSV cost columns) is converted
--   at the API boundary by the ledger; nothing downstream re-converts.
--   stock_movements.quantity_changed / balance_after -> consumption units
--   stock_movements.unit_cost -> cost basis per consumption unit at the time of the move
--
-- Existing seeded rows already satisfy this (e.g. Green Chili 5000 grams @ 0.25/gram,
-- conversion_factor 1000 => Rs 250/kg), so no quantity/cost backfill is needed.
--
-- Postgres DDL, matching the convention of 006/007. The SQLite fallback gets the
-- equivalent schema at runtime from ensureLedgerSchema() in lib/inventory-ledger.js.

-- ---------------------------------------------------------------- suppliers
CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  notes TEXT,
  is_archived INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_normalized_name ON suppliers(normalized_name);

-- Backfill from the free-text supplier columns that exist today.
INSERT INTO suppliers (name, normalized_name)
SELECT MIN(trim(s)), lower(trim(s))
FROM (
  SELECT supplier AS s FROM inventory_items WHERE supplier IS NOT NULL AND trim(supplier) <> ''
  UNION ALL
  SELECT supplier AS s FROM expenses WHERE supplier IS NOT NULL AND trim(supplier) <> ''
) src
GROUP BY lower(trim(s))
ON CONFLICT (normalized_name) DO NOTHING;

-- ---------------------------------------------------------- inventory_items
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS is_archived INTEGER DEFAULT 0;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL;

UPDATE inventory_items SET is_archived = 0 WHERE is_archived IS NULL;

UPDATE inventory_items i
SET supplier_id = s.id
FROM suppliers s
WHERE i.supplier_id IS NULL AND s.normalized_name = lower(trim(i.supplier));

-- Duplicate names block the unique index below. Keep the oldest row live and
-- archive the rest — archived rows stay visible in history/reports.
UPDATE inventory_items SET is_archived = 1 WHERE id IN (
  SELECT id FROM (
    SELECT id, row_number() OVER (PARTITION BY lower(trim(item_name)) ORDER BY id) AS rn
    FROM inventory_items WHERE COALESCE(is_archived, 0) = 0
  ) dupes WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_items_normalized_name
  ON inventory_items (lower(trim(item_name)))
  WHERE COALESCE(is_archived, 0) = 0;

-- ---------------------------------------------------------- stock_movements
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS unit_cost DOUBLE PRECISION;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS balance_after DOUBLE PRECISION;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS quantity_requested DOUBLE PRECISION;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS variance DOUBLE PRECISION;

-- 006 pinned change_type to 4 values; the ledger uses a richer vocabulary
-- (order_deduction, order_void, purchase_receipt, wastage, manual_adjustment,
-- transfer, opening_balance) and still writes the legacy names where UI reads them.
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_change_type_check;

-- ------------------------------------------------------------------ expenses
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS source_type TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS source_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_expenses_source ON expenses(source_type, source_id);

-- ----------------------------------------------------------------- purchases
CREATE TABLE IF NOT EXISTS purchases (
  id SERIAL PRIMARY KEY,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier TEXT,
  invoice_number TEXT,
  invoice_date TEXT,
  expected_delivery_date TEXT,
  received_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  subtotal DOUBLE PRECISION DEFAULT 0,
  tax DOUBLE PRECISION DEFAULT 0,
  discount DOUBLE PRECISION DEFAULT 0,
  shipping DOUBLE PRECISION DEFAULT 0,
  total DOUBLE PRECISION DEFAULT 0,
  notes TEXT,
  attachment_url TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  void_reason TEXT,
  voided_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchases_invoice_date ON purchases(invoice_date);

CREATE TABLE IF NOT EXISTS purchase_items (
  id SERIAL PRIMARY KEY,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  inventory_item_id INTEGER REFERENCES inventory_items(id) ON DELETE SET NULL,
  quantity_ordered DOUBLE PRECISION DEFAULT 0,
  quantity_received DOUBLE PRECISION DEFAULT 0,
  unit_cost DOUBLE PRECISION DEFAULT 0,
  line_total DOUBLE PRECISION DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_item ON purchase_items(inventory_item_id);

-- --------------------------------------------------------------- wastage_log
ALTER TABLE wastage_log ADD COLUMN IF NOT EXISTS employee_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE wastage_log ADD COLUMN IF NOT EXISTS shift TEXT;
ALTER TABLE wastage_log ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE wastage_log ADD COLUMN IF NOT EXISTS total_cost DOUBLE PRECISION;
