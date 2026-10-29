-- Recipe/BOM engine: unit conversion fields on inventory_items, recipes,
-- recipe_items (BOM lines), wastage_log.

ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS purchase_unit TEXT;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS consumption_unit TEXT;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS conversion_factor DOUBLE PRECISION DEFAULT 1;

CREATE TABLE IF NOT EXISTS recipes (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('menu_item', 'sub_recipe')),
  menu_item_id INTEGER UNIQUE REFERENCES menu_items(id) ON DELETE CASCADE,
  yield_quantity DOUBLE PRECISION DEFAULT 1,
  yield_unit TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recipe_items (
  id SERIAL PRIMARY KEY,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  raw_material_id INTEGER REFERENCES inventory_items(id) ON DELETE RESTRICT,
  component_recipe_id INTEGER REFERENCES recipes(id) ON DELETE RESTRICT,
  quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0),
  unit TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (raw_material_id IS NOT NULL AND component_recipe_id IS NULL) OR
    (raw_material_id IS NULL AND component_recipe_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS wastage_log (
  id SERIAL PRIMARY KEY,
  raw_material_id INTEGER REFERENCES inventory_items(id) ON DELETE SET NULL,
  recipe_id INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
  quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0),
  unit TEXT,
  reason TEXT NOT NULL CHECK (reason IN ('burnt', 'expired', 'dropped', 'returned', 'other')),
  logged_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CHECK (raw_material_id IS NOT NULL OR recipe_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_recipes_menu_item ON recipes(menu_item_id);
CREATE INDEX IF NOT EXISTS idx_recipe_items_recipe ON recipe_items(recipe_id);
CREATE INDEX IF NOT EXISTS idx_recipe_items_raw_material ON recipe_items(raw_material_id);
CREATE INDEX IF NOT EXISTS idx_recipe_items_component ON recipe_items(component_recipe_id);
CREATE INDEX IF NOT EXISTS idx_wastage_log_created ON wastage_log(created_at DESC);
