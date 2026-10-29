-- =====================================================================
-- Default operational seed  (Postgres)
-- Run AFTER seed_sundar_menu.sql (needs menu_items / menu_categories).
--
-- Adds:
--   1. Table floors + table types (the "hardcoded" defaults, now in DB
--      so Table Management is no longer empty)
--   2. Unit conversions (kg/g, l/ml, dozen/pcs)
--   3. Inventory categories
--   4. Inventory items:
--        a. raw ingredients (rice, chicken, oil, ...)
--        b. finished-goods 1:1 stock for every Drink / Ice Cream / Cake,
--           linked by menu_item_id  ->  1 order = -1 unit
--   5. Recipes + recipe lines for every cooked dish
--        ->  ordering a dish deducts its raw materials
--
-- Idempotent: re-running replaces only the rows this seed created.
--   Marker on inventory: notes LIKE 'Default seed%' / 'Default finished-good%'
--   Marker on recipes:   prep_notes = '__default_seed__'
--   Marker on unit_conv: note = '__default_seed__'
--
-- Quantities are sensible DEFAULTS. Tune them in the app once live.
-- =====================================================================

BEGIN;

-- --------------------------------------------------------------- cleanup
DELETE FROM recipe_items WHERE recipe_id IN (SELECT id FROM recipes WHERE prep_notes = '__default_seed__');
DELETE FROM recipes      WHERE prep_notes = '__default_seed__';
DELETE FROM stock_movements WHERE reason = 'Default seed opening stock';
DELETE FROM recipe_items WHERE raw_material_id IN
  (SELECT id FROM inventory_items WHERE notes LIKE 'Default seed%' OR notes LIKE 'Default finished-good%');
DELETE FROM inventory_items WHERE notes LIKE 'Default seed%' OR notes LIKE 'Default finished-good%';

-- ============================================================ 1. FLOORS
INSERT INTO table_floors (name, normalized_name, sort_order) VALUES
  ('Ground',  'ground',  1),
  ('First',   'first',   2),
  ('Second',  'second',  3),
  ('Rooftop', 'rooftop', 4),
  ('Basement','basement',5),
  ('Outdoor', 'outdoor', 6)
ON CONFLICT (normalized_name) DO NOTHING;

-- ============================================================ 2. TYPES
INSERT INTO table_types (name, normalized_name, color, default_capacity) VALUES
  ('Regular', 'regular', '#3b82f6', 4),
  ('VIP',     'vip',     '#a855f7', 6),
  ('Outdoor', 'outdoor', '#22c55e', 4),
  ('Event',   'event',   '#f59e0b', 10),
  ('Counter', 'counter', '#64748b', 2),
  ('Booth',   'booth',   '#ec4899', 4)
ON CONFLICT (normalized_name) DO NOTHING;

-- ==================================================== 3. UNIT CONVERSIONS
INSERT INTO unit_conversions (from_unit, to_unit, factor, note) VALUES
  ('kg',     'g',   1000, '__default_seed__'),
  ('g',      'kg',  0.001,'__default_seed__'),
  ('l',      'ml',  1000, '__default_seed__'),
  ('ml',     'l',   0.001,'__default_seed__'),
  ('dozen',  'pcs', 12,   '__default_seed__'),
  ('packet', 'pcs', 1,    '__default_seed__')
ON CONFLICT (from_unit, to_unit) DO NOTHING;

-- ================================================ 4. INVENTORY CATEGORIES
INSERT INTO inventory_categories (name, normalized_name)
SELECT v.name, lower(v.name) FROM (VALUES
  ('Grains & Flour'),
  ('Meat & Poultry'),
  ('Vegetables'),
  ('Dairy'),
  ('Oil & Fats'),
  ('Spices & Condiments'),
  ('Bakery'),
  ('Beverages'),
  ('Frozen & Ice Cream')
) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM inventory_categories c WHERE lower(c.name) = lower(v.name));

-- ============================================= 4a. RAW INGREDIENT STOCK
INSERT INTO inventory_items
  (item_name, quantity, unit, cost_per_unit, min_stock_level, min_stock, category, supplier, notes, created_at, updated_at)
SELECT v.item_name, v.qty, v.unit, v.cost, v.minlvl, v.minlvl, v.category,
       'Default Supplier', 'Default seed stock', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
  -- Grains & Flour
  ('Rice',                100, 'kg',   90,  15, 'Grains & Flour'),
  ('Basmati Rice',         50, 'kg',  150,  10, 'Grains & Flour'),
  ('Maida (Flour)',        50, 'kg',   70,  10, 'Grains & Flour'),
  ('Chowmein Noodles',     40, 'kg',  120,  10, 'Grains & Flour'),
  ('Instant Noodles',     100, 'pcs',  20,  20, 'Grains & Flour'),
  ('Beaten Rice (Chiura)', 30, 'kg',  100,   8, 'Grains & Flour'),
  ('Puffed Rice',          20, 'kg',   80,   5, 'Grains & Flour'),
  ('Corn Kernels',         15, 'kg',  150,   5, 'Grains & Flour'),
  ('Papad',               200, 'pcs',   8,  40, 'Grains & Flour'),
  -- Meat & Poultry
  ('Chicken',              50, 'kg',  320,  10, 'Meat & Poultry'),
  ('Local Chicken',        20, 'kg',  500,   5, 'Meat & Poultry'),
  ('Mutton',               30, 'kg',  900,   8, 'Meat & Poultry'),
  ('Duck Meat',            15, 'kg',  550,   5, 'Meat & Poultry'),
  ('Chicken Sausage',     100, 'pcs',  35,  20, 'Meat & Poultry'),
  ('Eggs',                200, 'pcs',  18,  40, 'Meat & Poultry'),
  -- Vegetables
  ('Potato',               80, 'kg',   60,  15, 'Vegetables'),
  ('Onion',                60, 'kg',   80,  15, 'Vegetables'),
  ('Tomato',               40, 'kg',   70,  10, 'Vegetables'),
  ('Garlic',               15, 'kg',  200,   5, 'Vegetables'),
  ('Ginger',               10, 'kg',  180,   3, 'Vegetables'),
  ('Green Chilli',         10, 'kg',  120,   3, 'Vegetables'),
  ('Mushroom',             15, 'kg',  250,   5, 'Vegetables'),
  ('Mixed Vegetables',     40, 'kg',   90,  10, 'Vegetables'),
  ('Cabbage',              20, 'kg',   50,   5, 'Vegetables'),
  ('Carrot',               20, 'kg',   70,   5, 'Vegetables'),
  ('Coriander',             5, 'kg',  150,   2, 'Vegetables'),
  ('Lemon',               100, 'pcs',  10,  20, 'Vegetables'),
  ('Soybean (Bhatmas)',    15, 'kg',  160,   5, 'Vegetables'),
  ('Peanuts',              15, 'kg',  200,   5, 'Vegetables'),
  ('Cashew (Kaju)',        10, 'kg', 1400,   3, 'Vegetables'),
  ('Gundruk',               5, 'kg',  300,   2, 'Vegetables'),
  ('Mixed Fruits',         15, 'kg',  200,   5, 'Vegetables'),
  -- Dairy
  ('Paneer',               15, 'kg',  400,   5, 'Dairy'),
  ('Milk',                 40, 'l',   100,  10, 'Dairy'),
  ('Butter',               10, 'kg',  700,   3, 'Dairy'),
  ('Cheese',                8, 'kg',  900,   3, 'Dairy'),
  ('Cream',                10, 'l',   350,   3, 'Dairy'),
  ('Curd',                 20, 'kg',  120,   5, 'Dairy'),
  -- Oil & Fats
  ('Cooking Oil',          50, 'l',   180,  10, 'Oil & Fats'),
  ('Mustard Oil',          20, 'l',   250,   5, 'Oil & Fats'),
  ('Ghee',                 10, 'kg',  900,   3, 'Oil & Fats'),
  -- Spices & Condiments
  ('Salt',                 20, 'kg',   30,   5, 'Spices & Condiments'),
  ('Sugar',                30, 'kg',  100,   8, 'Spices & Condiments'),
  ('Mixed Spices (Masala)',10, 'kg',  500,   3, 'Spices & Condiments'),
  ('Cumin (Jeera)',         5, 'kg',  600,   2, 'Spices & Condiments'),
  ('Timur',                 3, 'kg', 1200,   1, 'Spices & Condiments'),
  ('Soy Sauce',            10, 'l',   200,   3, 'Spices & Condiments'),
  ('Chilli Sauce',         10, 'l',   220,   3, 'Spices & Condiments'),
  ('Tomato Ketchup',       15, 'l',   180,   4, 'Spices & Condiments'),
  ('Honey',                 5, 'kg',  800,   2, 'Spices & Condiments'),
  ('Coffee Powder',         5, 'kg', 1200,   2, 'Beverages'),
  ('Tea Leaves',            5, 'kg',  600,   2, 'Beverages'),
  -- Bakery
  ('Bread',               100, 'pcs',  10,  20, 'Bakery')
) AS v(item_name, qty, unit, cost, minlvl, category);

-- =================================== 4b. FINISHED-GOODS 1:1 (drinks etc.)
-- One inventory row per Drink / Ice Cream / Cake, linked to the menu item.
-- deductStockForItems finds it by menu_item_id -> 1 order decrements 1 unit.
INSERT INTO inventory_items
  (item_name, quantity, unit, cost_per_unit, selling_price, min_stock_level, min_stock,
   category, menu_item_id, supplier, notes, created_at, updated_at)
SELECT m.name, 100, 'pcs',
       ROUND((m.base_price * 0.5)::numeric, 2), m.base_price, 15, 15,
       CASE mc.name
         WHEN 'Drinks'               THEN 'Beverages'
         WHEN 'Desserts & Ice Cream' THEN 'Frozen & Ice Cream'
         ELSE 'Bakery'
       END,
       m.id, 'Default Supplier',
       'Default finished-good stock (1 unit per order)',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM menu_items m
JOIN menu_categories mc ON m.category_id = mc.id
WHERE mc.name IN ('Drinks', 'Desserts & Ice Cream', 'Cakes & Pastry');

-- Backfill category_id from the category text.
UPDATE inventory_items i
SET category_id = c.id
FROM inventory_categories c
WHERE lower(c.name) = lower(i.category)
  AND i.category_id IS NULL
  AND (i.notes LIKE 'Default seed%' OR i.notes LIKE 'Default finished-good%');

-- ================================================= 5. RECIPES (cooked dishes)
INSERT INTO recipes (name, type, menu_item_id, yield_quantity, yield_unit, prep_notes)
SELECT m.name, 'menu_item', m.id, 1, 'plate', '__default_seed__'
FROM menu_items m
WHERE m.name IN (
  -- Snacks
  'Veg Boil','Popcorn','Aalo Jeera','Aaloo Sadheko','Bhatmas Sadheko','Peanuts Sadheko',
  'Chips Chilly','Mushroom Chilly','Paneer Pakauda','Veg Pakauda','Lasun Poleko','Kaju Fry',
  'Dry Papad','Fry Papad','Green Salad','Fruits Salad','Gundruk Sadheko','Veg Khaja Set',
  'Chauchau Sadheko','Mustang Aalu','French Fries','Chatpate',
  -- Breakfast
  'Veg Sandwich','Chicken Sandwich','Veg Burger','Chicken Burger','Aalu Paratha',
  'Plain Paratha Set','Grand Breakfast Combo',
  -- Soups
  'Veg Manchow Soup','Mushroom Soup','Hot and Sour Soup','Tomato Cream Soup',
  'Chicken Manchow Soup','Local Chicken Soup','Mutton Soup',
  -- Rice & Noodles
  'Chicken Chow Mein','Chicken Fried Rice','Egg Fried Rice','Mixed Fried Rice',
  'Veg Chow Mein','Veg Fried Rice',
  -- Chicken
  'Chicken Boil','Chicken Chilly','Chicken Fry Sadheko','Chicken Lollipop','Chicken Roast',
  'Chicken Sausage','Chicken Sekuwa','Chicken Timur (Szechuan)','Chicken Wings',
  -- Mutton
  'Kan Jibro','Mutton Bhutan','Mutton Fry Sadheko','Mutton Pakku','Mutton Polera',
  'Mutton Sekuwa','Mutton Tas',
  -- Traditional Choila
  'Duck (Has) Choila Fry','Duck (Has) Choila Poleko','Local Chicken Choila',
  'Local Chicken Choila Poleko','Mutton (Poleko) Choila','Mutton Choila Fry'
);

-- ---------------------------------------------------- 5b. RECIPE LINES
INSERT INTO recipe_items (recipe_id, raw_material_id, quantity, unit)
SELECT r.id, i.id, v.qty, v.unit
FROM (VALUES
  -- dish, ingredient, qty, unit
  ('Veg Boil','Mixed Vegetables',200,'g'),
  ('Popcorn','Corn Kernels',60,'g'), ('Popcorn','Cooking Oil',15,'ml'),
  ('Aalo Jeera','Potato',200,'g'), ('Aalo Jeera','Cumin (Jeera)',5,'g'), ('Aalo Jeera','Cooking Oil',15,'ml'),
  ('Aaloo Sadheko','Potato',200,'g'), ('Aaloo Sadheko','Mustard Oil',10,'ml'),
  ('Bhatmas Sadheko','Soybean (Bhatmas)',100,'g'), ('Bhatmas Sadheko','Mustard Oil',10,'ml'),
  ('Peanuts Sadheko','Peanuts',100,'g'), ('Peanuts Sadheko','Onion',30,'g'),
  ('Chips Chilly','Potato',200,'g'), ('Chips Chilly','Chilli Sauce',20,'ml'),
  ('Mushroom Chilly','Mushroom',200,'g'), ('Mushroom Chilly','Chilli Sauce',20,'ml'),
  ('Paneer Pakauda','Paneer',150,'g'), ('Paneer Pakauda','Maida (Flour)',50,'g'),
  ('Veg Pakauda','Mixed Vegetables',150,'g'), ('Veg Pakauda','Maida (Flour)',50,'g'),
  ('Lasun Poleko','Garlic',100,'g'), ('Lasun Poleko','Cooking Oil',10,'ml'),
  ('Kaju Fry','Cashew (Kaju)',100,'g'), ('Kaju Fry','Cooking Oil',15,'ml'),
  ('Dry Papad','Papad',2,'pcs'),
  ('Fry Papad','Papad',2,'pcs'), ('Fry Papad','Cooking Oil',15,'ml'),
  ('Green Salad','Mixed Vegetables',150,'g'),
  ('Fruits Salad','Mixed Fruits',200,'g'),
  ('Gundruk Sadheko','Gundruk',50,'g'), ('Gundruk Sadheko','Mustard Oil',10,'ml'),
  ('Veg Khaja Set','Beaten Rice (Chiura)',100,'g'), ('Veg Khaja Set','Mixed Vegetables',100,'g'),
  ('Chauchau Sadheko','Instant Noodles',1,'pcs'), ('Chauchau Sadheko','Onion',20,'g'),
  ('Mustang Aalu','Potato',200,'g'), ('Mustang Aalu','Mixed Spices (Masala)',5,'g'),
  ('French Fries','Potato',200,'g'), ('French Fries','Cooking Oil',20,'ml'),
  ('Chatpate','Puffed Rice',60,'g'), ('Chatpate','Onion',20,'g'),
  -- Breakfast
  ('Veg Sandwich','Bread',2,'pcs'), ('Veg Sandwich','Mixed Vegetables',80,'g'),
  ('Chicken Sandwich','Bread',2,'pcs'), ('Chicken Sandwich','Chicken',80,'g'),
  ('Veg Burger','Bread',1,'pcs'), ('Veg Burger','Mixed Vegetables',80,'g'),
  ('Chicken Burger','Bread',1,'pcs'), ('Chicken Burger','Chicken',100,'g'),
  ('Aalu Paratha','Maida (Flour)',100,'g'), ('Aalu Paratha','Potato',100,'g'),
  ('Plain Paratha Set','Maida (Flour)',150,'g'), ('Plain Paratha Set','Mixed Vegetables',80,'g'),
  ('Grand Breakfast Combo','Chicken Sausage',1,'pcs'), ('Grand Breakfast Combo','Eggs',2,'pcs'), ('Grand Breakfast Combo','Bread',2,'pcs'),
  -- Soups
  ('Veg Manchow Soup','Mixed Vegetables',100,'g'), ('Veg Manchow Soup','Soy Sauce',10,'ml'),
  ('Mushroom Soup','Mushroom',120,'g'), ('Mushroom Soup','Cream',20,'ml'),
  ('Hot and Sour Soup','Mixed Vegetables',100,'g'), ('Hot and Sour Soup','Soy Sauce',10,'ml'),
  ('Tomato Cream Soup','Tomato',150,'g'), ('Tomato Cream Soup','Cream',20,'ml'),
  ('Chicken Manchow Soup','Chicken',100,'g'), ('Chicken Manchow Soup','Soy Sauce',10,'ml'),
  ('Local Chicken Soup','Local Chicken',150,'g'),
  ('Mutton Soup','Mutton',150,'g'),
  -- Rice & Noodles
  ('Chicken Chow Mein','Chowmein Noodles',150,'g'), ('Chicken Chow Mein','Chicken',100,'g'),
  ('Chicken Fried Rice','Rice',200,'g'), ('Chicken Fried Rice','Chicken',100,'g'), ('Chicken Fried Rice','Eggs',1,'pcs'),
  ('Egg Fried Rice','Rice',200,'g'), ('Egg Fried Rice','Eggs',2,'pcs'),
  ('Mixed Fried Rice','Rice',200,'g'), ('Mixed Fried Rice','Chicken',60,'g'), ('Mixed Fried Rice','Eggs',1,'pcs'),
  ('Veg Chow Mein','Chowmein Noodles',150,'g'), ('Veg Chow Mein','Mixed Vegetables',100,'g'),
  ('Veg Fried Rice','Rice',200,'g'), ('Veg Fried Rice','Mixed Vegetables',100,'g'),
  -- Chicken
  ('Chicken Boil','Chicken',250,'g'),
  ('Chicken Chilly','Chicken',250,'g'), ('Chicken Chilly','Chilli Sauce',20,'ml'),
  ('Chicken Fry Sadheko','Chicken',250,'g'), ('Chicken Fry Sadheko','Mustard Oil',15,'ml'),
  ('Chicken Lollipop','Chicken',250,'g'), ('Chicken Lollipop','Maida (Flour)',30,'g'),
  ('Chicken Roast','Chicken',300,'g'), ('Chicken Roast','Mixed Spices (Masala)',10,'g'),
  ('Chicken Sausage','Chicken Sausage',4,'pcs'),
  ('Chicken Sekuwa','Chicken',250,'g'), ('Chicken Sekuwa','Mixed Spices (Masala)',10,'g'),
  ('Chicken Timur (Szechuan)','Chicken',250,'g'), ('Chicken Timur (Szechuan)','Timur',5,'g'),
  ('Chicken Wings','Chicken',250,'g'), ('Chicken Wings','Chilli Sauce',15,'ml'),
  -- Mutton
  ('Kan Jibro','Mutton',250,'g'),
  ('Mutton Bhutan','Mutton',250,'g'), ('Mutton Bhutan','Mixed Spices (Masala)',10,'g'),
  ('Mutton Fry Sadheko','Mutton',250,'g'), ('Mutton Fry Sadheko','Mustard Oil',15,'ml'),
  ('Mutton Pakku','Mutton',300,'g'), ('Mutton Pakku','Mixed Spices (Masala)',10,'g'),
  ('Mutton Polera','Mutton',300,'g'),
  ('Mutton Sekuwa','Mutton',250,'g'), ('Mutton Sekuwa','Mixed Spices (Masala)',10,'g'),
  ('Mutton Tas','Mutton',250,'g'), ('Mutton Tas','Onion',50,'g'),
  -- Traditional Choila
  ('Duck (Has) Choila Fry','Duck Meat',200,'g'), ('Duck (Has) Choila Fry','Mustard Oil',15,'ml'),
  ('Duck (Has) Choila Poleko','Duck Meat',200,'g'), ('Duck (Has) Choila Poleko','Timur',5,'g'),
  ('Local Chicken Choila','Local Chicken',200,'g'), ('Local Chicken Choila','Mustard Oil',15,'ml'),
  ('Local Chicken Choila Poleko','Local Chicken',200,'g'), ('Local Chicken Choila Poleko','Timur',5,'g'),
  ('Mutton (Poleko) Choila','Mutton',200,'g'), ('Mutton (Poleko) Choila','Timur',5,'g'),
  ('Mutton Choila Fry','Mutton',200,'g'), ('Mutton Choila Fry','Mustard Oil',15,'ml')
) AS v(dish, ingredient, qty, unit)
JOIN recipes r         ON r.name = v.dish AND r.prep_notes = '__default_seed__'
JOIN inventory_items i ON lower(i.item_name) = lower(v.ingredient)
                       AND i.notes = 'Default seed stock';

-- ================================================= 6. OPENING STOCK LEDGER
INSERT INTO stock_movements (inventory_item_id, change_type, quantity_changed, reason, balance_after, created_at)
SELECT id, 'opening_balance', quantity, 'Default seed opening stock', quantity, CURRENT_TIMESTAMP
FROM inventory_items
WHERE notes LIKE 'Default seed%' OR notes LIKE 'Default finished-good%';

COMMIT;

-- Sanity check (run separately if you like):
--   SELECT COUNT(*) FROM inventory_items;      -- ~78
--   SELECT COUNT(*) FROM recipes;              -- 65
--   SELECT COUNT(*) FROM recipe_items;         -- ~130
--   SELECT COUNT(*) FROM table_floors;         -- 6
--   SELECT COUNT(*) FROM table_types;          -- 6
