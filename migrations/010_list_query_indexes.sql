-- 010: indexes for the paginated admin list queries
--
-- The admin list endpoints now filter, sort and count in SQL (lib/paginate.js)
-- instead of shipping whole tables to the browser. That moves the cost onto the
-- database, so the columns those queries filter and sort on need covering.
--
-- Composite indexes are (filter, sort) in that order on purpose: the list
-- screens almost always narrow by status/category/type and then order by date,
-- and a composite in that order serves the WHERE and the ORDER BY together.
-- The single-column date indexes that already existed stay useful for the
-- unfiltered default view.
--
-- Everything here is CREATE INDEX IF NOT EXISTS so re-running is a no-op, and
-- the SQL is plain SQLite-compatible syntax — no Postgres-only `::text` /
-- `::date` casts, no partial-index predicates, no NULLS LAST — so the same file
-- stays valid on the SQLite dev fallback.
--
-- Already present before this migration (not repeated here):
--   orders(created_at DESC), orders(status), orders(table_id),
--   order_items(order_id), bills(order_id), bills(status),
--   expenses(source_type, source_id), customers(phone_digits),
--   stock_movements(created_at DESC), stock_movements(inventory_item_id),
--   purchases(supplier_id), purchases(invoice_date),
--   suppliers(normalized_name), wastage_log(created_at DESC),
--   purchase_items(purchase_id), purchase_items(inventory_item_id)

-- Orders: the ledger is filtered by status or type, then ordered by date.
CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_type_created ON orders (order_type, created_at DESC);

-- Expenses: default sort is created_at; the page filters by category, and the
-- reports read the business date off purchase_date / expense_date.
CREATE INDEX IF NOT EXISTS idx_expenses_created ON expenses (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category_created ON expenses (category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_purchase_date ON expenses (purchase_date);
CREATE INDEX IF NOT EXISTS idx_expenses_expense_date ON expenses (expense_date);

-- Customers: the list is alphabetical by default.
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers (name);

-- Stock movements: the fastest-growing table here — several rows per order.
-- The per-item history view is the hot path, hence the composite.
CREATE INDEX IF NOT EXISTS idx_stock_movements_item_created ON stock_movements (inventory_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_type_created ON stock_movements (change_type, created_at DESC);

-- Purchases: listed newest-first and filtered by status.
CREATE INDEX IF NOT EXISTS idx_purchases_created ON purchases (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_status_created ON purchases (status, created_at DESC);

-- Suppliers: listed alphabetically, archived ones hidden.
CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers (name);
CREATE INDEX IF NOT EXISTS idx_suppliers_is_archived ON suppliers (is_archived);

-- Wastage: grouped by item and by reason on the wastage page and in reports.
CREATE INDEX IF NOT EXISTS idx_wastage_log_item ON wastage_log (raw_material_id);
CREATE INDEX IF NOT EXISTS idx_wastage_log_reason_created ON wastage_log (reason, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wastage_log_employee ON wastage_log (employee_id);

-- Inventory: the item list filters by supplier and by category.
CREATE INDEX IF NOT EXISTS idx_inventory_items_supplier ON inventory_items (supplier_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON inventory_items (category);
