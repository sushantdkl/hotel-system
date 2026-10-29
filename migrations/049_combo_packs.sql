ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS is_combo INTEGER DEFAULT 0;
ALTER TABLE kot_items ADD COLUMN IF NOT EXISTS combo_units INTEGER;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS combo_snapshot TEXT;

CREATE TABLE IF NOT EXISTS menu_combos (
  id SERIAL PRIMARY KEY,
  menu_item_id INTEGER UNIQUE NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  channels TEXT NOT NULL DEFAULT '["pos","website","qr"]',
  is_active INTEGER DEFAULT 1,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS menu_combo_items (
  id SERIAL PRIMARY KEY,
  combo_id INTEGER NOT NULL REFERENCES menu_combos(id) ON DELETE CASCADE,
  component_menu_item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE RESTRICT,
  variant_name TEXT,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  display_order INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_menu_combo_items_combo ON menu_combo_items(combo_id, display_order);
CREATE INDEX IF NOT EXISTS idx_menu_combo_items_component ON menu_combo_items(component_menu_item_id);
