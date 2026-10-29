-- Production schema migration 001
-- Fresh PostgreSQL install for restaurant POS (cPanel)

CREATE TABLE IF NOT EXISTS schema_migrations (
  id SERIAL PRIMARY KEY,
  version TEXT UNIQUE NOT NULL,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'cashier', 'waiter', 'kitchen')),
  email TEXT,
  phone TEXT,
  is_active INTEGER DEFAULT 1,
  must_change_password INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS devices (
  id SERIAL PRIMARY KEY,
  device_id TEXT UNIQUE NOT NULL,
  device_name TEXT,
  device_type TEXT,
  ip_address TEXT,
  last_seen TIMESTAMP,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS menu_categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  display_order INTEGER DEFAULT 0,
  icon TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS menu_items (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category_id INTEGER NOT NULL REFERENCES menu_categories(id),
  base_price DOUBLE PRECISION NOT NULL CHECK (base_price >= 0),
  image_url TEXT,
  preparation_time INTEGER DEFAULT 15,
  is_vegetarian INTEGER DEFAULT 0,
  is_vegan INTEGER DEFAULT 0,
  is_spicy INTEGER DEFAULT 0,
  spice_level INTEGER DEFAULT 0,
  is_available INTEGER DEFAULT 1,
  tags TEXT,
  allergens TEXT,
  calories INTEGER,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS menu_item_variants (
  id SERIAL PRIMARY KEY,
  menu_item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  variant_name TEXT NOT NULL,
  price_modifier DOUBLE PRECISION DEFAULT 0,
  is_default INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tables (
  id SERIAL PRIMARY KEY,
  table_number TEXT UNIQUE NOT NULL,
  capacity INTEGER DEFAULT 4,
  status TEXT DEFAULT 'available',
  current_order_id INTEGER,
  is_active INTEGER DEFAULT 1,
  floor TEXT,
  section TEXT,
  waiter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  table_type TEXT DEFAULT 'regular',
  min_capacity INTEGER DEFAULT 1,
  position_x DOUBLE PRECISION DEFAULT 0,
  position_y DOUBLE PRECISION DEFAULT 0,
  shape TEXT DEFAULT 'square',
  color TEXT DEFAULT '#3b82f6',
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  total_visits INTEGER DEFAULT 0,
  total_spent DOUBLE PRECISION DEFAULT 0,
  credit_limit DOUBLE PRECISION DEFAULT 0,
  current_credit DOUBLE PRECISION DEFAULT 0,
  is_vip INTEGER DEFAULT 0,
  is_blacklisted INTEGER DEFAULT 0,
  notes TEXT,
  phone_digits TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  order_number TEXT UNIQUE NOT NULL,
  table_id INTEGER REFERENCES tables(id) ON DELETE SET NULL,
  table_number TEXT,
  order_type TEXT DEFAULT 'dine_in',
  status TEXT DEFAULT 'pending',
  waiter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT,
  customer_phone TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE tables DROP CONSTRAINT IF EXISTS tables_current_order_id_fkey;
ALTER TABLE tables
  ADD CONSTRAINT tables_current_order_id_fkey
  FOREIGN KEY (current_order_id) REFERENCES orders(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id INTEGER,
  menu_item_id INTEGER REFERENCES menu_items(id) ON DELETE SET NULL,
  item_name TEXT,
  quantity INTEGER DEFAULT 1 CHECK (quantity > 0),
  price DOUBLE PRECISION NOT NULL CHECK (price >= 0),
  subtotal DOUBLE PRECISION NOT NULL CHECK (subtotal >= 0),
  special_instructions TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS kots (
  id SERIAL PRIMARY KEY,
  kot_number TEXT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  station TEXT DEFAULT 'main',
  status TEXT DEFAULT 'pending',
  prepared_by INTEGER,
  printed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP,
  completed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS kot_items (
  id SERIAL PRIMARY KEY,
  kot_id INTEGER NOT NULL REFERENCES kots(id) ON DELETE CASCADE,
  order_item_id INTEGER,
  menu_item_id INTEGER,
  quantity INTEGER NOT NULL DEFAULT 1,
  special_instructions TEXT,
  status TEXT DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS bills (
  id SERIAL PRIMARY KEY,
  bill_number TEXT UNIQUE NOT NULL,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  subtotal DOUBLE PRECISION NOT NULL CHECK (subtotal >= 0),
  tax DOUBLE PRECISION DEFAULT 0,
  vat_amount DOUBLE PRECISION DEFAULT 0,
  service_charge DOUBLE PRECISION DEFAULT 0,
  discount_amount DOUBLE PRECISION DEFAULT 0,
  discount_reason TEXT,
  grand_total DOUBLE PRECISION NOT NULL CHECK (grand_total >= 0),
  cashier_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  tax_percent DOUBLE PRECISION DEFAULT 0,
  service_charge_percent DOUBLE PRECISION DEFAULT 0,
  status TEXT DEFAULT 'unpaid',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  paid_at TIMESTAMP
);

-- At most one paid bill per order
CREATE UNIQUE INDEX IF NOT EXISTS idx_bills_one_paid_per_order
  ON bills(order_id) WHERE status = 'paid';

CREATE TABLE IF NOT EXISTS bill_payments (
  id SERIAL PRIMARY KEY,
  bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  amount DOUBLE PRECISION NOT NULL CHECK (amount >= 0),
  payment_method TEXT NOT NULL,
  reference_number TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id SERIAL PRIMARY KEY,
  item_name TEXT,
  name TEXT,
  quantity DOUBLE PRECISION DEFAULT 0,
  unit TEXT,
  cost_per_unit DOUBLE PRECISION DEFAULT 0,
  selling_price DOUBLE PRECISION,
  min_stock_level DOUBLE PRECISION DEFAULT 0,
  min_stock DOUBLE PRECISION DEFAULT 0,
  supplier TEXT,
  notes TEXT,
  menu_item_id INTEGER REFERENCES menu_items(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  description TEXT,
  category TEXT,
  amount DOUBLE PRECISION NOT NULL,
  expense_date DATE,
  purchase_date TEXT,
  supplier TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS system_settings (
  id SERIAL PRIMARY KEY,
  setting_key TEXT UNIQUE NOT NULL,
  setting_value TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reservations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT,
  guests TEXT,
  party_size INTEGER DEFAULT 2,
  occasion TEXT,
  message TEXT,
  status TEXT DEFAULT 'new',
  table_id INTEGER REFERENCES tables(id) ON DELETE SET NULL,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  admin_notes TEXT,
  cancel_reason TEXT,
  source TEXT DEFAULT 'web',
  expected_end_at TEXT,
  preferences TEXT,
  is_vip INTEGER DEFAULT 0,
  deposit_required INTEGER DEFAULT 0,
  deposit_paid INTEGER DEFAULT 0,
  deposit_amount DOUBLE PRECISION DEFAULT 0,
  checked_in_at TEXT,
  seated_at TEXT,
  completed_at TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inquiries (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  subject TEXT,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'new',
  admin_notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rate_limits (
  id SERIAL PRIMARY KEY,
  rate_key TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items(category_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_available ON menu_items(is_available);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_table ON orders(table_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_tables_status ON tables(status);
CREATE INDEX IF NOT EXISTS idx_bills_status ON bills(status);
CREATE INDEX IF NOT EXISTS idx_bills_order ON bills(order_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_customers_phone_digits ON customers(phone_digits);
CREATE INDEX IF NOT EXISTS idx_reservations_date_status ON reservations(date, status);
CREATE INDEX IF NOT EXISTS idx_reservations_order ON reservations(order_id);
CREATE INDEX IF NOT EXISTS idx_inventory_menu_item ON inventory_items(menu_item_id);
CREATE INDEX IF NOT EXISTS idx_rate_limits_key_created ON rate_limits(rate_key, created_at);
CREATE INDEX IF NOT EXISTS idx_bill_payments_created ON bill_payments(created_at DESC);
