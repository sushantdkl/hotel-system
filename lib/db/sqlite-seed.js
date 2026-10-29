import bcrypt from 'bcryptjs';
import { logger } from '../logger.js';

export const SQLITE_SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT UNIQUE NOT NULL,
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'cashier', 'waiter', 'kitchen', 'receptionist', 'housekeeping', 'maintenance', 'watchman')),
  email TEXT,
  phone TEXT,
  is_active INTEGER DEFAULT 1,
  must_change_password INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT UNIQUE NOT NULL,
  device_name TEXT,
  device_type TEXT,
  ip_address TEXT,
  last_seen DATETIME,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS menu_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  display_order INTEGER DEFAULT 0,
  icon TEXT,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  category_id INTEGER NOT NULL REFERENCES menu_categories(id),
  base_price REAL NOT NULL CHECK (base_price >= 0),
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
  stock_usage REAL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS menu_item_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  variant_name TEXT NOT NULL,
  price_modifier REAL DEFAULT 0,
  is_default INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  position_x REAL DEFAULT 0,
  position_y REAL DEFAULT 0,
  shape TEXT DEFAULT 'square',
  color TEXT DEFAULT '#3b82f6',
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  total_visits INTEGER DEFAULT 0,
  total_spent REAL DEFAULT 0,
  credit_limit REAL DEFAULT 0,
  current_credit REAL DEFAULT 0,
  is_vip INTEGER DEFAULT 0,
  is_blacklisted INTEGER DEFAULT 0,
  notes TEXT,
  phone_digits TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id INTEGER,
  menu_item_id INTEGER REFERENCES menu_items(id) ON DELETE SET NULL,
  item_name TEXT,
  quantity INTEGER DEFAULT 1 CHECK (quantity > 0),
  price REAL NOT NULL CHECK (price >= 0),
  subtotal REAL NOT NULL CHECK (subtotal >= 0),
  special_instructions TEXT,
  status TEXT DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS kots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kot_number TEXT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  station TEXT DEFAULT 'main',
  status TEXT DEFAULT 'pending',
  prepared_by INTEGER,
  printed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME,
  completed_at DATETIME
);

CREATE TABLE IF NOT EXISTS kot_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kot_id INTEGER NOT NULL REFERENCES kots(id) ON DELETE CASCADE,
  order_item_id INTEGER,
  menu_item_id INTEGER,
  quantity INTEGER NOT NULL DEFAULT 1,
  special_instructions TEXT,
  status TEXT DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_number TEXT UNIQUE NOT NULL,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  subtotal REAL NOT NULL CHECK (subtotal >= 0),
  tax REAL DEFAULT 0,
  vat_amount REAL DEFAULT 0,
  service_charge REAL DEFAULT 0,
  discount_amount REAL DEFAULT 0,
  discount_reason TEXT,
  grand_total REAL NOT NULL CHECK (grand_total >= 0),
  cashier_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  tax_percent REAL DEFAULT 0,
  service_charge_percent REAL DEFAULT 0,
  status TEXT DEFAULT 'unpaid',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  paid_at DATETIME
);

CREATE TABLE IF NOT EXISTS bill_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  amount REAL NOT NULL CHECK (amount >= 0),
  payment_method TEXT NOT NULL,
  reference_number TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_name TEXT,
  name TEXT,
  quantity REAL DEFAULT 0,
  unit TEXT,
  cost_per_unit REAL DEFAULT 0,
  selling_price REAL,
  min_stock_level REAL DEFAULT 0,
  min_stock REAL DEFAULT 0,
  supplier TEXT,
  notes TEXT,
  menu_item_id INTEGER REFERENCES menu_items(id) ON DELETE SET NULL,
  is_archived INTEGER DEFAULT 0,
  pos_stock_visible INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  description TEXT,
  category TEXT,
  amount REAL NOT NULL,
  expense_date DATE,
  purchase_date TEXT,
  supplier TEXT,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS system_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  setting_key TEXT UNIQUE NOT NULL,
  setting_value TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  deposit_amount REAL DEFAULT 0,
  checked_in_at TEXT,
  seated_at TEXT,
  completed_at TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  subject TEXT,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'new',
  admin_notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rate_limits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rate_key TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

export function seedDemoData(db) {
  logger.info('seeding_sqlite_demo_data_start');

  // 1. Seed Users (with hashed PINs)
  const users = [
    { username: 'admin', pin: '123456', name: 'Restaurant Admin', role: 'admin' },
    { username: 'john', pin: '1234', name: 'John Waiter', role: 'waiter' },
    { username: 'ram', pin: '4567', name: 'Ram Waiter', role: 'waiter' },
    { username: 'sita', pin: '7890', name: 'Sita Cashier', role: 'cashier' },
    { username: 'chef', pin: '1111', name: 'Chef Kitchen', role: 'kitchen' },
  ];

  for (const u of users) {
    const hash = bcrypt.hashSync(u.pin, 10);
    db.prepare(`
      INSERT INTO users (username, password_hash, full_name, role, is_active, must_change_password)
      VALUES (?, ?, ?, ?, 1, 0)
    `).run(u.username, hash, u.name, u.role);
  }

  // 2. Seed System Settings
  const settings = [
    { key: 'restaurant_name', value: 'Raithane Daure Chulo' },
    { key: 'restaurant_address', value: 'Birendranagar-08, Surkhet, Karnali Province, Nepal' },
    { key: 'restaurant_phone', value: '+977 984-9216081' },
    { key: 'restaurant_email', value: '' },
    { key: 'currency_symbol', value: 'Rs' },
    // Tax/service default to 0% and remain editable in Settings.
    { key: 'vat_percentage', value: '0' },
    { key: 'service_charge_percentage', value: '0' },
    { key: 'owner_name', value: '' },
  ];

  for (const s of settings) {
    db.prepare(`
      INSERT INTO system_settings (setting_key, setting_value)
      VALUES (?, ?)
    `).run(s.key, s.value);
  }

  // 3. Seed Tables (T-01 to T-10)
  for (let i = 1; i <= 10; i++) {
    const num = `T-${String(i).padStart(2, '0')}`;
    const capacity = i <= 4 ? 2 : i <= 7 ? 4 : i <= 9 ? 6 : 8;
    const floor = i <= 5 ? 'Ground' : 'First';
    const section = i % 2 === 0 ? 'Main' : 'Terrace';
    db.prepare(`
      INSERT INTO tables (table_number, capacity, status, floor, section, is_active)
      VALUES (?, ?, 'available', ?, ?, 1)
    `).run(num, capacity, floor, section);
  }

  // 4. Seed Menu Categories
  const categories = [
    { name: 'Snacks', desc: 'Light bites & starters', order: 1 },
    { name: 'Soups', desc: 'Warm & comforting soups', order: 2 },
    { name: 'Mains', desc: 'Premium main courses', order: 3 },
    { name: 'Noodles & Rice', desc: 'Flavourful rice & chow mein dishes', order: 4 },
    { name: 'Breads', desc: 'Fresh tandoori rotis & naans', order: 5 },
    { name: 'Beverages', desc: 'Refreshing cold drinks & hot teas', order: 6 },
    { name: 'Desserts', desc: 'Sweet endings to your meal', order: 7 },
  ];

  const catMap = {};
  for (const c of categories) {
    const result = db.prepare(`
      INSERT INTO menu_categories (name, description, display_order, is_active)
      VALUES (?, ?, ?, 1)
    `).run(c.name, c.desc, c.order);
    catMap[c.name] = result.lastInsertRowid;
  }

  // 5. Seed Menu Items matching the committed SVG images
  const menuItems = [
    // Snacks
    { name: 'Vegetable Samosa', desc: 'Crispy pastry filled with spiced potatoes and peas', cat: 'Snacks', price: 120, img: '/uploads/menu/1-vegetable-samosa.svg', veg: 1 },
    { name: 'Paneer Tikka', desc: 'Marinated cottage cheese cubes grilled to perfection', cat: 'Snacks', price: 280, img: '/uploads/menu/2-paneer-tikka.svg', veg: 1 },
    { name: 'Chicken Tikka', desc: 'Tender chicken pieces marinated in yoghurt and hot spices', cat: 'Snacks', price: 320, img: '/uploads/menu/3-chicken-tikka.svg', veg: 0 },
    { name: 'Chicken Wings', desc: 'Crispy fried chicken wings tossed in dry spices', cat: 'Snacks', price: 250, img: '/uploads/menu/4-chicken-wings.svg', veg: 0 },
    { name: 'Veg Momos (8pcs)', desc: 'Nepali style steamed vegetable dumplings served with chutney', cat: 'Snacks', price: 150, img: '/uploads/menu/5-veg-momos-8pcs.svg', veg: 1 },
    { name: 'Chicken Momos (8pcs)', desc: 'Steamed chicken dumplings served with spicy sesame chutney', cat: 'Snacks', price: 220, img: '/uploads/menu/6-chicken-momos-8pcs.svg', veg: 0 },
    { name: 'French Fries', desc: 'Classic golden potato fries served with ketchup', cat: 'Snacks', price: 120, img: '/uploads/menu/7-french-fries.svg', veg: 1 },
    { name: 'Onion Rings', desc: 'Deep fried battered onion rings, crisp and golden', cat: 'Snacks', price: 140, img: '/uploads/menu/8-onion-rings.svg', veg: 1 },

    // Soups
    { name: 'Tomato Soup', desc: 'Creamy tomato soup flavored with garlic and herbs', cat: 'Soups', price: 110, img: '/uploads/menu/9-tomato-soup.svg', veg: 1 },
    { name: 'Hot & Sour Soup', desc: 'Tangy and spicy thick vegetable soup', cat: 'Soups', price: 130, img: '/uploads/menu/10-hot-sour-soup.svg', veg: 1 },
    { name: 'Mushroom Soup', desc: 'Freshly pureed button mushroom soup with cream', cat: 'Soups', price: 140, img: '/uploads/menu/11-mushroom-soup.svg', veg: 1 },

    // Mains
    { name: 'Butter Chicken', desc: 'Boneless tandoori chicken cooked in smooth tomato-butter gravy', cat: 'Mains', price: 450, img: '/uploads/menu/12-butter-chicken.svg', veg: 0 },
    { name: 'Chicken Curry', desc: 'Traditional homestyle chicken curry cooked with ground spices', cat: 'Mains', price: 380, img: '/uploads/menu/13-chicken-curry.svg', veg: 0 },
    { name: 'Dal Makhni', desc: 'Slow cooked black lentils and kidney beans with butter and cream', cat: 'Mains', price: 240, img: '/uploads/menu/14-dal-makhni.svg', veg: 1 },
    { name: 'Paneer Butter Masala', desc: 'Paneer cubes in a rich, creamy onion-tomato gravy', cat: 'Mains', price: 320, img: '/uploads/menu/15-paneer-butter-masala.svg', veg: 1 },
    { name: 'Veg Thali', desc: 'Traditional platter with rice, dal, veg curry, pickle, and papad', cat: 'Mains', price: 280, img: '/uploads/menu/16-veg-thali.svg', veg: 1 },
    { name: 'Chicken Biryani', desc: 'Fragrant basmati rice layered with spiced chicken and herbs', cat: 'Mains', price: 350, img: '/uploads/menu/17-chicken-biryani.svg', veg: 0 },

    // Noodles & Rice
    { name: 'Thukpa', desc: 'Warm Sherpa style noodle soup with seasonal vegetables', cat: 'Noodles & Rice', price: 180, img: '/uploads/menu/18-thukpa.svg', veg: 1 },
    { name: 'Veg Chowmein', desc: 'Stir-fried noodles with crisp vegetables and soy sauce', cat: 'Noodles & Rice', price: 160, img: '/uploads/menu/19-chowmein-veg.svg', veg: 1 },
    { name: 'Chicken Chowmein', desc: 'Wok-tossed noodles with shredded chicken and vegetables', cat: 'Noodles & Rice', price: 210, img: '/uploads/menu/20-chowmein-chicken.svg', veg: 0 },
    { name: 'Steam Rice', desc: 'Steamed premium basmati rice', cat: 'Noodles & Rice', price: 100, img: '/uploads/menu/24-steam-rice.svg', veg: 1 },
    { name: 'Jeera Rice', desc: 'Fragrant rice tempered with cumin seeds and ghee', cat: 'Noodles & Rice', price: 120, img: '/uploads/menu/25-jeera-rice.svg', veg: 1 },
    { name: 'Veg Fried Rice', desc: 'Wok-tossed rice with finely chopped vegetables and seasoning', cat: 'Noodles & Rice', price: 180, img: '/uploads/menu/26-veg-fried-rice.svg', veg: 1 },

    // Breads
    { name: 'Butter Naan', desc: 'Soft leavened clay oven bread topped with butter', cat: 'Breads', price: 60, img: '/uploads/menu/21-butter-naan.svg', veg: 1 },
    { name: 'Garlic Naan', desc: 'Clay oven bread flavored with garlic and butter', cat: 'Breads', price: 80, img: '/uploads/menu/22-garlic-naan.svg', veg: 1 },
    { name: 'Plain Roti', desc: 'Traditional whole wheat flatbread baked in tandoor', cat: 'Breads', price: 30, img: '/uploads/menu/23-plain-roti.svg', veg: 1 },

    // Beverages
    { name: 'Masala Tea', desc: 'Traditional spiced milk tea brewed with cardamom and ginger', cat: 'Beverages', price: 50, img: '/uploads/menu/27-masala-tea.svg', veg: 1 },
    { name: 'Coffee', desc: 'Hot brewed milk coffee', cat: 'Beverages', price: 80, img: '/uploads/menu/28-coffee.svg', veg: 1 },
    { name: 'Cold Coffee', desc: 'Chilled blended milk coffee served with ice cream', cat: 'Beverages', price: 120, img: '/uploads/menu/29-cold-coffee.svg', veg: 1 },
    { name: 'Sweet Lassi', desc: 'Sweetened refreshing yoghurt drink', cat: 'Beverages', price: 100, img: '/uploads/menu/30-lassi-sweet.svg', veg: 1 },
    { name: 'Coke', desc: 'Chilled bottle of Coca-Cola', cat: 'Beverages', price: 60, img: '/uploads/menu/31-coke.svg', veg: 1 },
    { name: 'Fresh Lemonade', desc: 'Freshly squeezed lemon juice with sugar syrup and water', cat: 'Beverages', price: 70, img: '/uploads/menu/32-fresh-lemonade.svg', veg: 1 },

    // Desserts
    { name: 'Gulab Jamun', desc: 'Soft fried dough balls soaked in sweet sugar syrup', cat: 'Desserts', price: 90, img: '/uploads/menu/33-gulab-jamun.svg', veg: 1 },
    { name: 'Rasgulla', desc: 'Spongy cottage cheese balls soaked in light sugar syrup', cat: 'Desserts', price: 80, img: '/uploads/menu/34-rasgulla.svg', veg: 1 },
    { name: 'Ice Cream Scoop', desc: 'Single scoop of vanilla, strawberry or chocolate ice cream', cat: 'Desserts', price: 90, img: '/uploads/menu/35-ice-cream-scoop.svg', veg: 1 },
    { name: 'Kheer', desc: 'Traditional slow-cooked sweet rice pudding with cardamom and nuts', cat: 'Desserts', price: 110, img: '/uploads/menu/36-kheer.svg', veg: 1 },
  ];

  let displayOrder = 0;
  for (const item of menuItems) {
    displayOrder += 1;
    const catId = catMap[item.cat];
    db.prepare(`
      INSERT INTO menu_items (name, description, category_id, base_price, image_url, preparation_time, is_vegetarian, is_available, display_order)
      VALUES (?, ?, ?, ?, ?, 15, ?, 1, ?)
    `).run(item.name, item.desc, catId, item.price, item.img, item.veg, displayOrder);
  }

  // 6. Seed Orders, KOTs, Bills, Payments
  seedDemoOrders(db);

  logger.info('seeding_sqlite_demo_data_complete');
}

function seedDemoOrders(db) {
  logger.info('seeding_demo_orders_start');

  // Helpers
  const getUser = (username) => db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  const getTable = (num) => db.prepare('SELECT id FROM tables WHERE table_number = ?').get(num);
  const getMenuItem = (name) => db.prepare('SELECT id, base_price, name FROM menu_items WHERE name = ?').get(name);

  const adminId   = getUser('admin')?.id;
  const johnId    = getUser('john')?.id;
  const ramId     = getUser('ram')?.id;
  const sitaId    = getUser('sita')?.id;

  // --------------------------------------------------------------------------
  // 1. Demo Customers
  // --------------------------------------------------------------------------
  const customers = [
    { name: 'Priya Sharma',    phone: '9801234567', email: 'priya@example.com',   visits: 5,  spent: 4200, vip: 1 },
    { name: 'Rohan Thapa',     phone: '9842345678', email: 'rohan@example.com',   visits: 3,  spent: 2150, vip: 0 },
    { name: 'Anita Gurung',    phone: '9803456789', email: 'anita@example.com',   visits: 8,  spent: 7800, vip: 1 },
    { name: 'Bikram KC',       phone: '9864567890', email: 'bikram@example.com',  visits: 2,  spent: 1600, vip: 0 },
    { name: 'Sunita Lama',     phone: '9815678901', email: 'sunita@example.com',  visits: 12, spent: 9500, vip: 1 },
    { name: 'Rajesh Adhikari', phone: '9806789012', email: 'rajesh@example.com',  visits: 1,  spent: 540,  vip: 0 },
  ];

  const custIds = [];
  for (const c of customers) {
    const r = db.prepare(`
      INSERT INTO customers (name, phone, email, total_visits, total_spent, is_vip, phone_digits)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(c.name, c.phone, c.email, c.visits, c.spent, c.vip, c.phone.slice(-4));
    custIds.push(r.lastInsertRowid);
  }

  // --------------------------------------------------------------------------
  // Helper to insert a complete order + items and return the order id
  // --------------------------------------------------------------------------
  function insertOrder({ orderNum, tableId, tableNum, waiterId, customerId, customerName, status, createdAt, items }) {
    const r = db.prepare(`
      INSERT INTO orders (order_number, table_id, table_number, waiter_id, customer_id, customer_name, order_type, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'dine_in', ?, ?, ?)
    `).run(orderNum, tableId, tableNum, waiterId, customerId ?? null, customerName ?? null, status, createdAt, createdAt);
    const orderId = r.lastInsertRowid;

    for (const it of items) {
      const mi = getMenuItem(it.name);
      if (!mi) continue;
      const qty  = it.qty ?? 1;
      const price = mi.base_price;
      db.prepare(`
        INSERT INTO order_items (order_id, item_id, menu_item_id, item_name, quantity, price, subtotal, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(orderId, mi.id, mi.id, mi.name, qty, price, price * qty, it.status ?? 'served', createdAt);
    }
    return orderId;
  }

  // Helper to insert a KOT for an order
  function insertKOT({ kotNum, orderId, status, items, createdAt }) {
    const r = db.prepare(`
      INSERT INTO kots (kot_number, order_id, station, status, printed_at)
      VALUES (?, ?, 'main', ?, ?)
    `).run(kotNum, orderId, status, createdAt);
    const kotId = r.lastInsertRowid;
    for (const it of items) {
      const mi = getMenuItem(it.name);
      if (!mi) continue;
      db.prepare(`
        INSERT INTO kot_items (kot_id, menu_item_id, quantity, status)
        VALUES (?, ?, ?, ?)
      `).run(kotId, mi.id, it.qty ?? 1, it.status ?? status);
    }
    return kotId;
  }

  // Helper to insert a paid bill + payment
  function insertPaidBill({ billNum, orderId, subtotal, vatPct, scPct, cashierId, method, paidAt }) {
    const vat = parseFloat(((subtotal * vatPct) / 100).toFixed(2));
    const sc  = parseFloat(((subtotal * scPct)  / 100).toFixed(2));
    const grand = parseFloat((subtotal + vat + sc).toFixed(2));
    const r = db.prepare(`
      INSERT INTO bills (bill_number, order_id, subtotal, tax, vat_amount, service_charge, grand_total, status, cashier_id, tax_percent, service_charge_percent, created_at, paid_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?, ?, ?)
    `).run(billNum, orderId, subtotal, vat, vat, sc, grand, cashierId, vatPct, scPct, paidAt, paidAt);
    const billId = r.lastInsertRowid;
    db.prepare(`
      INSERT INTO bill_payments (bill_id, amount, payment_method, created_at)
      VALUES (?, ?, ?, ?)
    `).run(billId, grand, method, paidAt);
    return billId;
  }

  // --------------------------------------------------------------------------
  // 2. COMPLETED / PAID ORDERS (yesterday + today morning)
  // --------------------------------------------------------------------------
  const yest = (h, m = '00') => `${new Date(Date.now() - 86400000).toISOString().slice(0, 10)} ${h}:${m}:00`;
  const tod  = (h, m = '00') => `${new Date().toISOString().slice(0, 10)} ${h}:${m}:00`;

  // Completed order 1 — yesterday lunch, T-01, John, Priya Sharma, cash
  {
    const tbl = getTable('T-01');
    const oid = insertOrder({
      orderNum: 'ORD-2001-DEMO01', tableId: tbl.id, tableNum: 'T-01',
      waiterId: johnId, customerId: custIds[0], customerName: 'Priya Sharma',
      status: 'completed', createdAt: yest('12', '15'),
      items: [
        { name: 'Vegetable Samosa', qty: 2 },
        { name: 'Butter Chicken',   qty: 1 },
        { name: 'Butter Naan',      qty: 3 },
        { name: 'Sweet Lassi',      qty: 2 },
      ],
    });
    insertKOT({ kotNum: 'KOT-2001', orderId: oid, status: 'completed',
      items: [
        { name: 'Vegetable Samosa', qty: 2, status: 'completed' },
        { name: 'Butter Chicken',   qty: 1, status: 'completed' },
        { name: 'Butter Naan',      qty: 3, status: 'completed' },
      ],
      createdAt: yest('12', '16'),
    });
    // subtotal: 120*2 + 450 + 60*3 + 100*2 = 240+450+180+200 = 1070
    insertPaidBill({ billNum: 'BILL-2001-DEMO01', orderId: oid, subtotal: 1070,
      vatPct: 13, scPct: 10, cashierId: sitaId, method: 'cash', paidAt: yest('13', '30') });
  }

  // Completed order 2 — yesterday dinner, T-04, Ram, Rohan Thapa, card
  {
    const tbl = getTable('T-04');
    const oid = insertOrder({
      orderNum: 'ORD-2002-DEMO02', tableId: tbl.id, tableNum: 'T-04',
      waiterId: ramId, customerId: custIds[1], customerName: 'Rohan Thapa',
      status: 'completed', createdAt: yest('19', '45'),
      items: [
        { name: 'Chicken Momos (8pcs)', qty: 1 },
        { name: 'Chicken Biryani',      qty: 2 },
        { name: 'Gulab Jamun',          qty: 2 },
        { name: 'Coke',                 qty: 2 },
      ],
    });
    insertKOT({ kotNum: 'KOT-2002', orderId: oid, status: 'completed',
      items: [
        { name: 'Chicken Momos (8pcs)', qty: 1, status: 'completed' },
        { name: 'Chicken Biryani',      qty: 2, status: 'completed' },
        { name: 'Gulab Jamun',          qty: 2, status: 'completed' },
      ],
      createdAt: yest('19', '47'),
    });
    // subtotal: 220 + 350*2 + 90*2 + 60*2 = 220+700+180+120 = 1220
    insertPaidBill({ billNum: 'BILL-2002-DEMO02', orderId: oid, subtotal: 1220,
      vatPct: 13, scPct: 10, cashierId: sitaId, method: 'card', paidAt: yest('21', '10') });
  }

  // Completed order 3 — today morning, T-06, John, Anita Gurung, cash
  {
    const tbl = getTable('T-06');
    const oid = insertOrder({
      orderNum: 'ORD-2003-DEMO03', tableId: tbl.id, tableNum: 'T-06',
      waiterId: johnId, customerId: custIds[2], customerName: 'Anita Gurung',
      status: 'completed', createdAt: tod('10', '05'),
      items: [
        { name: 'Mushroom Soup',       qty: 1 },
        { name: 'Veg Thali',           qty: 2 },
        { name: 'Masala Tea',          qty: 2 },
      ],
    });
    insertKOT({ kotNum: 'KOT-2003', orderId: oid, status: 'completed',
      items: [
        { name: 'Mushroom Soup', qty: 1, status: 'completed' },
        { name: 'Veg Thali',     qty: 2, status: 'completed' },
      ],
      createdAt: tod('10', '06'),
    });
    // subtotal: 140 + 280*2 + 50*2 = 140+560+100 = 800
    insertPaidBill({ billNum: 'BILL-2003-DEMO03', orderId: oid, subtotal: 800,
      vatPct: 13, scPct: 10, cashierId: sitaId, method: 'cash', paidAt: tod('10', '55') });
  }

  // Completed order 4 — today morning, T-08, Ram, Bikram KC, esewa
  {
    const tbl = getTable('T-08');
    const oid = insertOrder({
      orderNum: 'ORD-2004-DEMO04', tableId: tbl.id, tableNum: 'T-08',
      waiterId: ramId, customerId: custIds[3], customerName: 'Bikram KC',
      status: 'completed', createdAt: tod('11', '20'),
      items: [
        { name: 'Chicken Tikka',   qty: 1 },
        { name: 'Dal Makhni',      qty: 1 },
        { name: 'Garlic Naan',     qty: 2 },
        { name: 'Cold Coffee',     qty: 1 },
      ],
    });
    insertKOT({ kotNum: 'KOT-2004', orderId: oid, status: 'completed',
      items: [
        { name: 'Chicken Tikka', qty: 1, status: 'completed' },
        { name: 'Dal Makhni',    qty: 1, status: 'completed' },
        { name: 'Garlic Naan',   qty: 2, status: 'completed' },
      ],
      createdAt: tod('11', '21'),
    });
    // subtotal: 320 + 240 + 80*2 + 120 = 320+240+160+120 = 840
    insertPaidBill({ billNum: 'BILL-2004-DEMO04', orderId: oid, subtotal: 840,
      vatPct: 13, scPct: 10, cashierId: sitaId, method: 'esewa', paidAt: tod('12', '10') });
  }

  // --------------------------------------------------------------------------
  // 3. ACTIVE ORDER — T-02 — status: 'preparing'  (KOT in kitchen)
  // --------------------------------------------------------------------------
  {
    const tbl = getTable('T-02');
    const oid = insertOrder({
      orderNum: 'ORD-3001-LIVE01', tableId: tbl.id, tableNum: 'T-02',
      waiterId: johnId, customerId: custIds[4], customerName: 'Sunita Lama',
      status: 'preparing', createdAt: tod('12', '30'),
      items: [
        { name: 'Veg Momos (8pcs)',  qty: 1, status: 'preparing' },
        { name: 'Butter Chicken',    qty: 1, status: 'preparing' },
        { name: 'Butter Naan',       qty: 2, status: 'preparing' },
        { name: 'Fresh Lemonade',    qty: 2, status: 'pending' },
      ],
    });
    insertKOT({ kotNum: 'KOT-3001', orderId: oid, status: 'preparing',
      items: [
        { name: 'Veg Momos (8pcs)', qty: 1, status: 'preparing' },
        { name: 'Butter Chicken',   qty: 1, status: 'preparing' },
        { name: 'Butter Naan',      qty: 2, status: 'pending' },
      ],
      createdAt: tod('12', '31'),
    });
    // Mark table as occupied
    db.prepare(`UPDATE tables SET status='occupied', current_order_id=?, waiter_id=? WHERE id=?`)
      .run(oid, johnId, tbl.id);
  }

  // --------------------------------------------------------------------------
  // 4. ACTIVE ORDER — T-05 — status: 'pending'  (just placed, KOT pending)
  // --------------------------------------------------------------------------
  {
    const tbl = getTable('T-05');
    const oid = insertOrder({
      orderNum: 'ORD-3002-LIVE02', tableId: tbl.id, tableNum: 'T-05',
      waiterId: ramId, customerId: custIds[5], customerName: 'Rajesh Adhikari',
      status: 'pending', createdAt: tod('12', '45'),
      items: [
        { name: 'Chicken Wings',     qty: 1, status: 'pending' },
        { name: 'Hot & Sour Soup',   qty: 2, status: 'pending' },
        { name: 'Chicken Chowmein',  qty: 1, status: 'pending' },
        { name: 'Coke',              qty: 2, status: 'pending' },
      ],
    });
    insertKOT({ kotNum: 'KOT-3002', orderId: oid, status: 'pending',
      items: [
        { name: 'Chicken Wings',    qty: 1, status: 'pending' },
        { name: 'Hot & Sour Soup',  qty: 2, status: 'pending' },
        { name: 'Chicken Chowmein', qty: 1, status: 'pending' },
      ],
      createdAt: tod('12', '46'),
    });
    db.prepare(`UPDATE tables SET status='occupied', current_order_id=?, waiter_id=? WHERE id=?`)
      .run(oid, ramId, tbl.id);
  }

  // --------------------------------------------------------------------------
  // 5. READY ORDER — T-03 — status: 'ready' (food ready, awaiting billing)
  // --------------------------------------------------------------------------
  {
    const tbl = getTable('T-03');
    const oid = insertOrder({
      orderNum: 'ORD-3003-LIVE03', tableId: tbl.id, tableNum: 'T-03',
      waiterId: johnId, customerName: 'Walk-in Guest',
      status: 'ready', createdAt: tod('12', '00'),
      items: [
        { name: 'Paneer Tikka',         qty: 1, status: 'served' },
        { name: 'Paneer Butter Masala', qty: 1, status: 'served' },
        { name: 'Jeera Rice',           qty: 1, status: 'served' },
        { name: 'Garlic Naan',          qty: 2, status: 'served' },
        { name: 'Sweet Lassi',          qty: 1, status: 'served' },
      ],
    });
    insertKOT({ kotNum: 'KOT-3003', orderId: oid, status: 'completed',
      items: [
        { name: 'Paneer Tikka',         qty: 1, status: 'completed' },
        { name: 'Paneer Butter Masala', qty: 1, status: 'completed' },
        { name: 'Jeera Rice',           qty: 1, status: 'completed' },
        { name: 'Garlic Naan',          qty: 2, status: 'completed' },
      ],
      createdAt: tod('12', '01'),
    });
    db.prepare(`UPDATE tables SET status='occupied', current_order_id=?, waiter_id=? WHERE id=?`)
      .run(oid, johnId, tbl.id);
  }

  logger.info('seeding_demo_orders_complete');
}
