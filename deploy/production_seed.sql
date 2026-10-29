-- =====================================================================
-- Raithane Daure Chulo — production seed (Postgres)
-- Run AFTER deploy/production_schema.sql on a fresh database.
--
-- Loads, idempotently (safe to re-run):
--   1. Chart of Accounts + default cash drawer / bank
--   2. Restaurant settings (Raithane Daure Chulo branding, VAT/service, receipt)
--   3. First admin — login PIN 984898 (change after first sign-in)
--   4. Table floors, table types (categories) and tables T-01..T-12
--   5. Unit conversions (kg/g, l/ml, dozen/pcs, packet/pcs)
--   6. Full menu: 22 categories, 100 items and 46 variants, generated from
--      data/menu/raithane-menu.json (the client's handwritten menu book).
--      Items sold in more than one size, portion or preparation carry real
--      menu_item_variants rows. Every item carries a photo from
--      public/images/dishes or public/raithane, and a source_ref so
--      scripts/import-raithane-menu.mjs can sync later corrections.
--   7. Inventory categories + ingredient master (opening stock 0 — the
--      client fills real stock later)
--   8. An empty recipe shell for every menu item (no ingredient lines —
--      this menu's dish compositions weren't supplied, so none were
--      invented; fill recipes in later via Admin -> Recipes so stock
--      auto-deducts on sale)
--   9. schema_migrations markers 001..038 so `npm run db:migrate` is a
--      no-op afterwards (and only applies anything newer than this)
--
-- Markers used for idempotency:
--   recipes.prep_notes      = 'Default seed recipe'
--   inventory_items.notes   = 'Default seed ingredient'
--   unit_conversions.note   = 'Default seed'
-- =====================================================================

BEGIN;

-- pgcrypto is needed to hash the admin PIN below (bcrypt-compatible $2a$).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================ 1. ACCOUNTS
INSERT INTO accounts (code, name, type, subtype, is_system) VALUES
  ('1000','Assets','asset',NULL,1),
  ('1010','Cash on Hand','asset','cash',1),
  ('1020','Bank','asset','bank',1),
  ('1100','Card Clearing','asset','clearing',1),
  ('1110','eSewa Clearing','asset','clearing',1),
  ('1120','Khalti Clearing','asset','clearing',1),
  ('1130','QR / Fonepay Clearing','asset','clearing',1),
  ('1140','Online Clearing','asset','clearing',1),
  ('1200','Inventory','asset','inventory',1),
  ('1300','Accounts Receivable','asset','receivable',1),
  ('2000','Liabilities','liability',NULL,1),
  ('2010','Accounts Payable','liability','payable',1),
  ('2020','VAT / Tax Payable','liability','tax_payable',1),
  ('3000','Equity','equity',NULL,1),
  ('3010','Owner''s Equity','equity',NULL,1),
  ('3020','Opening Balance Equity','equity',NULL,1),
  ('4000','Income','income',NULL,1),
  ('4010','Sales Revenue','income','sales',1),
  ('4020','Other Income','income',NULL,1),
  ('5000','Expenses','expense',NULL,1),
  ('5010','Purchases / COGS','expense','cogs',1),
  ('5020','Operating Expenses','expense','operating',1),
  ('5030','Payroll','expense','payroll',1),
  ('5040','Wastage / Inventory Loss','expense','wastage',1),
  ('5050','Payment Processing Fees','expense','fees',1),
  ('5060','Cash Over / Short','expense','variance',1)
ON CONFLICT (code) DO NOTHING;

UPDATE accounts SET parent_id = (SELECT id FROM accounts WHERE code='1000') WHERE code IN ('1010','1020','1100','1110','1120','1130','1140','1200','1300') AND parent_id IS NULL;
UPDATE accounts SET parent_id = (SELECT id FROM accounts WHERE code='2000') WHERE code IN ('2010','2020') AND parent_id IS NULL;
UPDATE accounts SET parent_id = (SELECT id FROM accounts WHERE code='3000') WHERE code IN ('3010','3020') AND parent_id IS NULL;
UPDATE accounts SET parent_id = (SELECT id FROM accounts WHERE code='4000') WHERE code IN ('4010','4020') AND parent_id IS NULL;
UPDATE accounts SET parent_id = (SELECT id FROM accounts WHERE code='5000') WHERE code IN ('5010','5020','5030','5040','5050','5060') AND parent_id IS NULL;

INSERT INTO cash_drawers (name) SELECT 'Main Drawer' WHERE NOT EXISTS (SELECT 1 FROM cash_drawers);
INSERT INTO bank_accounts (name, account_id)
  SELECT 'Primary Bank', (SELECT id FROM accounts WHERE code='1020') WHERE NOT EXISTS (SELECT 1 FROM bank_accounts);

-- ============================================================ 2. SETTINGS
INSERT INTO system_settings (setting_key, setting_value) VALUES
  ('restaurant_name','Raithane Daure Chulo'),
  ('restaurant_address','Birendranagar-08, Surkhet, Karnali Province, Nepal'),
  ('restaurant_phone','+977 984-9216081'),
  ('restaurant_email',''),
  ('vat_number',''),
  ('pan_number',''),
  ('vat_percentage','0'),
  ('service_charge_percentage','0'),
  ('currency','NPR'),
  ('receipt_footer','Thank you for visiting Raithane Daure Chulo!'),
  ('receipt_paper_size','80'),
  ('website','https://raithanedaurechulo.com.np'),
  ('qr_ordering_enabled','true'),
  ('bank_qr_image',''),
  ('esewa_qr_image',''),
  ('reservation_hold_minutes','30'),
  ('reservation_grace_minutes','20'),
  ('reservation_dining_minutes','90'),
  ('reservation_cleaning_minutes','10'),
  ('reservation_auto_cancel_minutes','20'),
  ('reservation_min_lead_minutes','60')
ON CONFLICT (setting_key) DO NOTHING;

-- ============================================================== 3. ADMIN
-- Login is PIN-based. Seeded PIN = 984898. CHANGE after first sign-in
-- (must_change_password forces a reset on first login).
INSERT INTO users (username, password_hash, full_name, role, is_active, must_change_password)
VALUES ('admin', crypt('984898', gen_salt('bf', 12)), 'Restaurant Admin', 'admin', 1, 1)
ON CONFLICT (username) DO NOTHING;

-- ============================================================== 4. FLOORS
INSERT INTO table_floors (name, normalized_name, sort_order) VALUES
  ('Ground',  'ground',  1),
  ('First',   'first',   2),
  ('Rooftop', 'rooftop', 3),
  ('Outdoor', 'outdoor', 4)
ON CONFLICT (normalized_name) DO NOTHING;

-- ---- table types (a.k.a. table categories) ----
INSERT INTO table_types (name, normalized_name, color, default_capacity) VALUES
  ('Regular', 'regular', '#3b82f6', 4),
  ('VIP',     'vip',     '#a855f7', 6),
  ('Family',  'family',  '#22c55e', 6),
  ('Couple',  'couple',  '#ec4899', 2),
  ('Outdoor', 'outdoor', '#f59e0b', 4),
  ('Counter', 'counter', '#64748b', 2)
ON CONFLICT (normalized_name) DO NOTHING;

-- ---- tables T-01..T-12 ----
INSERT INTO tables (table_number, capacity, status, floor, section, table_type, is_active)
SELECT v.num, v.cap, 'available', v.floor, v.section, v.ttype, 1
FROM (VALUES
  ('T-01', 2, 'Ground',  'Main',    'couple'),
  ('T-02', 2, 'Ground',  'Main',    'couple'),
  ('T-03', 4, 'Ground',  'Main',    'regular'),
  ('T-04', 4, 'Ground',  'Main',    'regular'),
  ('T-05', 4, 'Ground',  'Main',    'regular'),
  ('T-06', 6, 'Ground',  'Main',    'family'),
  ('T-07', 4, 'First',   'Hall',    'regular'),
  ('T-08', 4, 'First',   'Hall',    'regular'),
  ('T-09', 6, 'First',   'Hall',    'family'),
  ('T-10', 6, 'First',   'VIP',     'vip'),
  ('T-11', 4, 'Rooftop', 'Terrace', 'outdoor'),
  ('T-12', 4, 'Rooftop', 'Terrace', 'outdoor')
) AS v(num, cap, floor, section, ttype)
WHERE NOT EXISTS (SELECT 1 FROM tables t WHERE t.table_number = v.num);

-- ==================================================== 5. UNIT CONVERSIONS
INSERT INTO unit_conversions (from_unit, to_unit, factor, note) VALUES
  ('kg',     'g',   1000,  'Default seed'),
  ('g',      'kg',  0.001, 'Default seed'),
  ('l',      'ml',  1000,  'Default seed'),
  ('ml',     'l',   0.001, 'Default seed'),
  ('dozen',  'pcs', 12,    'Default seed'),
  ('packet', 'pcs', 1,     'Default seed')
ON CONFLICT (from_unit, to_unit) DO NOTHING;

-- ================================================= 6. MENU CATEGORIES (22)
-- Generated from data/menu/raithane-menu.json (the client's handwritten menu
-- book, transcribed). Regenerate rather than hand-edit: that file is the
-- source of truth, and scripts/import-raithane-menu.mjs syncs a live database
-- from it by source_ref.
INSERT INTO menu_categories (name, display_order)
SELECT v.name, v.ord FROM (VALUES
  ('Breakfast', 1),
  ('Lunch / Khana', 2),
  ('Tandoor', 3),
  ('Chicken / Sekuwa / Grill', 4),
  ('Mutton', 5),
  ('Fish', 6),
  ('Choila', 7),
  ('Noodles / Chowmein', 8),
  ('Fried Rice', 9),
  ('Biryani', 10),
  ('Momo', 11),
  ('Soup', 12),
  ('Snacks', 13),
  ('Khaja Set', 14),
  ('Pizza', 15),
  ('Sandwich', 16),
  ('Coffee - Black Base', 17),
  ('Coffee - Milk Base', 18),
  ('Coffee Dessert', 19),
  ('Iced / Refreshers', 20),
  ('Cold Drinks', 21),
  ('Tea & Lassi', 22)
) AS v(name, ord)
ON CONFLICT (name) DO NOTHING;

-- ================================================ 6a2. MASTER FOOD GROUPS
ALTER TABLE menu_categories ADD COLUMN IF NOT EXISTS food_group TEXT DEFAULT 'food';
UPDATE menu_categories SET food_group = 'beverage'
WHERE name IN ('Coffee - Black Base', 'Coffee - Milk Base', 'Coffee Dessert', 'Cold Drinks', 'Iced / Refreshers', 'Tea & Lassi')
  AND COALESCE(food_group, 'food') <> 'beverage';
UPDATE menu_categories SET food_group = 'food'
WHERE name NOT IN ('Coffee - Black Base', 'Coffee - Milk Base', 'Coffee Dessert', 'Cold Drinks', 'Iced / Refreshers', 'Tea & Lassi')
  AND (food_group IS NULL OR food_group = '' OR lower(food_group) IN ('foods', 'beverages'));

-- ================================================= 6b. MENU ITEMS (100)
-- source_ref is the stable key scripts/import-raithane-menu.mjs matches on,
-- so a later menu correction updates these rows instead of duplicating them.
-- The column is created here because this seed runs before the migrations.
-- Photos are the files under public/images/dishes and public/raithane.
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS source_ref TEXT;

INSERT INTO menu_items
  (source_ref, name, description, category_id, base_price, is_available, is_vegetarian, display_order, image_url)
SELECT v.ref, v.name, v.descr, c.id, v.price, 1, v.veg, v.ord, v.image
FROM (VALUES
  -- Breakfast
  ('bf-kodo-makai-roti-set','Kodo / Makai Roti Set',NULL,'Breakfast',450,1,1,'/raithane/menu-sel-roti.webp'),
  ('bf-indian','Indian Breakfast',NULL,'Breakfast',230,1,2,'/images/dishes/Aloo Paratha.jpg'),
  ('bf-american','American Breakfast',NULL,'Breakfast',550,0,3,'/images/dishes/grand breakfast combo.jpg'),
  ('bf-raithane-special','Raithane Special Breakfast',NULL,'Breakfast',390,0,4,'/raithane/serve-breakfast.webp'),
  ('bf-egg','Egg',NULL,'Breakfast',140,0,5,'/images/dishes/Masala  Omelette.jpg'),
  ('bf-bread-egg-set','Bread Egg Set',NULL,'Breakfast',150,0,6,'/images/dishes/Bread Omelette.jpg'),
  ('bf-boil-egg','Boiled Egg (2 pcs)',NULL,'Breakfast',80,0,7,'/raithane/menu-egg-toast.webp'),
  -- Lunch / Khana
  ('kh-karnali-special-thali','Karnali Special Thali Set',NULL,'Lunch / Khana',750,0,1,'/raithane/menu-special-thali.webp'),
  ('kh-veg-normal','Veg Khana Normal',NULL,'Lunch / Khana',250,1,2,'/raithane/menu-veg-set.webp'),
  ('kh-veg-special','Veg Khana with Paneer, Mix Veg & Gundruk',NULL,'Lunch / Khana',450,1,3,'/raithane/menu-dal-bhat.webp'),
  ('kh-broiler-chicken','Broiler Chicken Khana',NULL,'Lunch / Khana',400,0,4,'/images/dishes/chicken khana set.jpg'),
  ('kh-local-chicken','Local Chicken Khana',NULL,'Lunch / Khana',530,0,5,'/raithane/serve-nepali-meals.webp'),
  ('kh-mutton','Mutton Khana',NULL,'Lunch / Khana',500,0,6,'/images/dishes/mutton khana set.jpg'),
  ('kh-fish','Fish Khana Set',NULL,'Lunch / Khana',500,0,7,'/raithane/menu-fish-fry.webp'),
  ('kh-kalij','Kalij Khana Set',NULL,'Lunch / Khana',950,0,8,'/raithane/serve-meat.webp'),
  ('kh-dhindo-set','Dhindo Set',NULL,'Lunch / Khana',270,0,9,'/raithane/menu-dhido.webp'),
  -- Tandoor
  ('td-tandoori-roti','Tandoori Roti',NULL,'Tandoor',30,1,1,'/images/dishes/roti curry.jpg'),
  ('td-naan','Naan',NULL,'Tandoor',60,1,2,'/images/dishes/Plain Paratha.jpg'),
  ('td-aloo-paratha','Aloo Paratha',NULL,'Tandoor',60,1,3,'/images/dishes/Aloo Paratha.jpg'),
  -- Chicken / Sekuwa / Grill
  ('sk-chicken-sekuwa','Chicken Sekuwa',NULL,'Chicken / Sekuwa / Grill',400,0,1,'/raithane/menu-chicken-sekuwa.webp'),
  ('sk-grill-chicken','Grill Chicken',NULL,'Chicken / Sekuwa / Grill',500,0,2,'/images/dishes/Chicken Sekuwa.jpg'),
  ('sk-chicken-wings','Chicken Wings (4 pcs)',NULL,'Chicken / Sekuwa / Grill',400,0,3,'/images/dishes/Chicken Wings.jpg'),
  ('sk-chicken-leg','Chicken Leg Piece (2 pcs)',NULL,'Chicken / Sekuwa / Grill',180,0,4,'/images/dishes/Chicken Wings.jpg'),
  ('sk-chicken-lollipop','Chicken Lollipop (5 pcs)',NULL,'Chicken / Sekuwa / Grill',350,0,5,'/images/dishes/Chicken Loly Pop.avif'),
  ('sk-afghani-chicken','Afghani Chicken',NULL,'Chicken / Sekuwa / Grill',550,0,6,'/images/dishes/Chicken Shapta.jpg'),
  ('sk-chicken-tikka','Chicken Tikka',NULL,'Chicken / Sekuwa / Grill',490,0,7,'/images/dishes/Chicken Chilly Momo.jpg'),
  -- Mutton
  ('mu-boneless-sekuwa','Boneless Mutton Sekuwa',NULL,'Mutton',550,0,1,'/images/dishes/Mutton Sekuwa.jpg'),
  ('mu-sekuwa-with-bone','Mutton Sekuwa With Bone',NULL,'Mutton',450,0,2,'/raithane/serve-meat.webp'),
  ('mu-bhutuwa','Mutton Bhutuwa',NULL,'Mutton',550,0,3,'/images/dishes/mutton bhutan.jpg'),
  ('mu-khasi-set','Khasi Set',NULL,'Mutton',550,0,4,'/images/dishes/Mutton Tass Set.jpg'),
  ('mu-bhutan-set','Bhutan Set',NULL,'Mutton',350,0,5,'/images/dishes/Kalejo Pangro.jpg'),
  ('mu-head-ear-tongue','Head / Ear / Tongue Set',NULL,'Mutton',450,0,6,'/images/dishes/Jhaneko Sekuwa.jpg'),
  ('mu-khasi-khutta-jhol','Khasi Khutta Jhol',NULL,'Mutton',250,0,7,'/images/dishes/Mutton Jhol Momo.jpg'),
  ('mu-liver','Mutton Liver (1 kg)',NULL,'Mutton',1850,0,8,'/images/dishes/Kalejo Pangro.jpg'),
  -- Fish
  ('fs-bbq','Fish BBQ (1 kg)',NULL,'Fish',950,0,1,'/raithane/menu-fish-fry.webp'),
  ('fs-fry','Fish Fry',NULL,'Fish',375,0,2,'/raithane/menu-fish-fry.webp'),
  -- Choila
  ('ch-mutton-choila','Mutton Choila',NULL,'Choila',400,0,1,'/images/dishes/Mutton Chhoila.jpg'),
  ('ch-chicken-choila','Chicken Choila',NULL,'Choila',300,0,2,'/images/dishes/Chicken Chhoila.jpg'),
  ('ch-duck-choila','Duck Choila',NULL,'Choila',450,0,3,'/raithane/menu-choila.webp'),
  -- Noodles / Chowmein
  ('nd-veg-chowmein','Veg Chowmein',NULL,'Noodles / Chowmein',130,1,1,'/images/dishes/Veg. Chowmin.jpg'),
  ('nd-chicken-chowmein','Chicken Chowmein',NULL,'Noodles / Chowmein',190,0,2,'/images/dishes/Chicken Chowmin.jpg'),
  ('nd-mix-chowmein','Mix Chowmein','Chicken + sausage','Noodles / Chowmein',220,0,3,'/images/dishes/Mix Chowmin.jpg'),
  ('nd-raithane-special-chowmein','Raithane Daure Special Chowmein','Chicken, sausage, mutton, egg, sweet corn','Noodles / Chowmein',350,0,4,'/raithane/menu-chowmein.webp'),
  -- Fried Rice
  ('fr-veg','Veg Fried Rice',NULL,'Fried Rice',175,1,1,'/images/dishes/Veg. Fried Rice.jpg'),
  ('fr-egg','Egg Fried Rice',NULL,'Fried Rice',220,0,2,'/images/dishes/Egg Fried Rice.jpg'),
  ('fr-chicken','Chicken Fried Rice',NULL,'Fried Rice',280,0,3,'/images/dishes/Chicken Fried Rice.jpg'),
  ('fr-mutton','Mutton Fried Rice',NULL,'Fried Rice',350,0,4,'/images/dishes/Mix Fried Rice.jpg'),
  ('fr-mix','Mix Fried Rice',NULL,'Fried Rice',450,0,5,'/images/dishes/Mix Fried Rice.jpg'),
  -- Biryani
  ('br-chicken','Chicken Biryani',NULL,'Biryani',340,0,1,'/images/dishes/biryani.jpg'),
  ('br-mutton','Mutton Biryani',NULL,'Biryani',490,0,2,'/images/dishes/Normal Biryani.jpg'),
  -- Momo
  ('mo-veg','Veg Momo',NULL,'Momo',120,1,1,'/raithane/menu-momo.webp'),
  ('mo-chicken','Chicken Momo',NULL,'Momo',150,0,2,'/images/dishes/Chicken Steam Momo.jpg'),
  ('mo-mutton','Mutton Momo',NULL,'Momo',240,0,3,'/images/dishes/Mutton Steam Momo.jpg'),
  ('mo-chicken-c','Chicken C-Momo',NULL,'Momo',230,0,4,'/images/dishes/Chicken C Momo.jpg'),
  ('mo-chicken-crispy','Chicken Crispy Momo',NULL,'Momo',220,0,5,'/images/dishes/Chcken Fried Momo.jpg'),
  ('mo-chicken-kothey','Chicken Kothey Momo',NULL,'Momo',190,0,6,'/images/dishes/fry-momo.jpg'),
  ('mo-chicken-chilli','Chicken Chilli Momo',NULL,'Momo',230,0,7,'/images/dishes/Chicken Chilly Momo.jpg'),
  ('mo-fried','Fried Momo',NULL,'Momo',190,0,8,'/images/dishes/fry-momo.jpg'),
  -- Soup
  ('sp-veg','Veg Soup',NULL,'Soup',120,1,1,'/images/dishes/Veg Hot N Sour.jpg'),
  ('sp-chicken','Chicken Soup',NULL,'Soup',175,0,2,'/images/dishes/Chicken Hot N Sour.jpg'),
  ('sp-hot-sour','Hot & Sour Soup',NULL,'Soup',220,0,3,'/images/dishes/Chicken Hot N Sour.jpg'),
  ('sp-mix','Mix Soup',NULL,'Soup',230,0,4,'/images/dishes/Chicken Thupka.jpg'),
  ('sp-mushroom','Mushroom Soup',NULL,'Soup',200,1,5,'/images/dishes/Mushroom Soup.jpg'),
  -- Snacks
  ('sn-paneer-pakoda','Paneer Pakoda',NULL,'Snacks',275,1,1,'/images/dishes/Paneer Pakoda.jpg'),
  ('sn-veg-pakoda','Veg Pakoda',NULL,'Snacks',150,1,2,'/images/dishes/Veg. Pakoda.jpg'),
  ('sn-french-fries','French Fries',NULL,'Snacks',150,1,3,'/images/dishes/French Fries.jpg'),
  ('sn-chicken-chilli','Chicken Chilli',NULL,'Snacks',350,0,4,'/images/dishes/chicken-chilly.jpg'),
  ('sn-chicken-65','Chicken 65',NULL,'Snacks',385,0,5,'/images/dishes/Draigon Chicken.jpg'),
  ('sn-karnali-aalu','Karnali Aalu',NULL,'Snacks',150,1,6,'/images/dishes/aalo sadhenko.jpg'),
  -- Khaja Set
  ('kj-raithane-khaja-set','Raithane Khaja Set','Local chicken, bhutuwa, fish fry, salad, pickle, gundruk achar','Khaja Set',750,0,1,'/raithane/serve-khaja.webp'),
  -- Pizza
  ('pz-veg-lover','Veg Lover Pizza',NULL,'Pizza',395,1,1,'/images/dishes/Veg. Pizza.jpg'),
  ('pz-paneer','Paneer Pizza',NULL,'Pizza',495,1,2,'/images/dishes/Paneer Pizza.jpg'),
  ('pz-chicken-tikka','Chicken Tikka Pizza',NULL,'Pizza',485,0,3,'/images/dishes/Chicken Pizza.jpg'),
  ('pz-meat-lover','Meat Lover Pizza',NULL,'Pizza',525,0,4,'/images/dishes/Mushroom Pizza.jpg'),
  -- Sandwich
  ('sw-veg','Veg Sandwich',NULL,'Sandwich',250,1,1,'/images/dishes/Veg Sandwich.jpg'),
  ('sw-chicken','Chicken Sandwich',NULL,'Sandwich',350,0,2,'/images/dishes/Chicken Sandwich.jpg'),
  ('sw-cheese','Cheese Sandwich',NULL,'Sandwich',350,1,3,'/images/dishes/Veg Sandwich.jpg'),
  ('sw-grill','Grill Sandwich',NULL,'Sandwich',380,0,4,'/images/dishes/Club Sandwich.jpg'),
  ('sw-club','Club Sandwich',NULL,'Sandwich',420,0,5,'/images/dishes/Club Sandwich.jpg'),
  -- Coffee - Black Base
  ('cb-espresso','Espresso',NULL,'Coffee - Black Base',100,1,1,'/images/dishes/espresso.jpg'),
  ('cb-doppio','Doppio',NULL,'Coffee - Black Base',120,1,2,'/images/dishes/doppio.webp'),
  ('cb-lungo','Lungo',NULL,'Coffee - Black Base',130,1,3,'/images/dishes/espresso.jpg'),
  ('cb-americano','Americano',NULL,'Coffee - Black Base',130,1,4,'/images/dishes/Americano.webp'),
  -- Coffee - Milk Base
  ('cm-cappuccino','Cappuccino',NULL,'Coffee - Milk Base',160,1,1,'/images/dishes/Cappuccino.jpg'),
  ('cm-cafe-latte','Cafe Latte',NULL,'Coffee - Milk Base',160,1,2,'/images/dishes/Café latte.jpg'),
  ('cm-cafe-mocha','Cafe Mocha',NULL,'Coffee - Milk Base',200,1,3,'/images/dishes/caffe motcha.jpg'),
  -- Coffee Dessert
  ('cds-honey-doppio','Honey Doppio',NULL,'Coffee Dessert',150,1,1,'/images/dishes/doppio.webp'),
  ('cds-affogato','Affogato',NULL,'Coffee Dessert',200,1,2,'/images/dishes/ice cream.jpg'),
  ('cds-espresso-con-panna','Espresso Con Panna',NULL,'Coffee Dessert',220,1,3,'/images/dishes/Macchiato.jpg'),
  -- Iced / Refreshers
  ('ic-iced-americano','Iced Americano',NULL,'Iced / Refreshers',180,1,1,'/images/dishes/Iced Americano.jpg'),
  ('ic-iced-cappuccino','Iced Cappuccino',NULL,'Iced / Refreshers',200,1,2,'/images/dishes/iced cappucino.jpg'),
  ('ic-mint-lemonade','Mint Lemonade',NULL,'Iced / Refreshers',200,1,3,'/images/dishes/Lamonade.jpg'),
  ('ic-virgin-mojito','Virgin Mojito',NULL,'Iced / Refreshers',250,1,4,'/images/dishes/Virgin Mojito.jpg'),
  ('ic-blended-mint-lemonade','Blended Mint Lemonade',NULL,'Iced / Refreshers',200,1,5,'/images/dishes/Lamonade.jpg'),
  -- Cold Drinks
  ('cd-coke-sprite-fanta','Coke / Sprite / Fanta',NULL,'Cold Drinks',80,1,1,'/images/dishes/Cold Drinks.jpg'),
  ('cd-iced-soda','Iced Masala Soda / Coke / Sprite / Fanta',NULL,'Cold Drinks',140,1,2,'/images/dishes/jumbo coke.jpg'),
  -- Tea & Lassi
  ('tl-milk-tea','Milk Tea',NULL,'Tea & Lassi',40,1,1,'/raithane/menu-milk-tea.webp'),
  ('tl-banana-lassi','Banana Lassi',NULL,'Tea & Lassi',130,1,2,'/images/dishes/Banana Lassi.jpg'),
  ('tl-mixed-lassi','Mixed Lassi',NULL,'Tea & Lassi',150,1,3,'/raithane/menu-lassi.webp'),
  ('tl-normal-lassi','Normal Lassi',NULL,'Tea & Lassi',100,1,4,'/images/dishes/Sweet Lassi.jpg')
) AS v(ref, name, descr, cat, price, veg, ord, image)
JOIN menu_categories c ON c.name = v.cat
WHERE NOT EXISTS (
  SELECT 1 FROM menu_items m WHERE m.name = v.name AND m.category_id = c.id
);

-- ============================================ 6c. MENU ITEM VARIANTS (46)
-- price is the absolute price the POS and the public menu bill at;
-- price_modifier is kept in sync as the delta from base_price so the older
-- code paths that only know the modifier still charge correctly. The price
-- column is added lazily by the app at runtime, so it is created here to keep
-- this seed standalone. The first variant listed for an item is its default
-- and carries the same price as the item's base_price.
ALTER TABLE menu_item_variants ADD COLUMN IF NOT EXISTS price DOUBLE PRECISION;

INSERT INTO menu_item_variants (menu_item_id, variant_name, price, price_modifier, is_default)
SELECT m.id, v.variant_name, v.price, v.price - m.base_price, v.is_default
FROM (VALUES
  -- Breakfast
  ('Egg','Breakfast','China',140,1),
  ('Egg','Breakfast','Local',160,0),
  ('Boiled Egg (2 pcs)','Breakfast','Normal',80,1),
  ('Boiled Egg (2 pcs)','Breakfast','Local',100,0),
  -- Lunch / Khana
  ('Dhindo Set','Lunch / Khana','Veg',270,1),
  ('Dhindo Set','Lunch / Khana','Chicken',400,0),
  ('Dhindo Set','Lunch / Khana','Mutton',500,0),
  ('Dhindo Set','Lunch / Khana','Buff',500,0),
  -- Tandoor
  ('Tandoori Roti','Tandoor','Plain',30,1),
  ('Tandoori Roti','Tandoor','Butter',40,0),
  ('Naan','Tandoor','Garlic',60,1),
  ('Naan','Tandoor','Cheese',80,0),
  -- Chicken / Sekuwa / Grill
  ('Chicken Sekuwa','Chicken / Sekuwa / Grill','Half kg',400,1),
  ('Chicken Sekuwa','Chicken / Sekuwa / Grill','1 kg',700,0),
  ('Grill Chicken','Chicken / Sekuwa / Grill','Half',500,1),
  ('Grill Chicken','Chicken / Sekuwa / Grill','Whole',980,0),
  -- Mutton
  ('Boneless Mutton Sekuwa','Mutton','Set',550,1),
  ('Boneless Mutton Sekuwa','Mutton','1 kg',2700,0),
  ('Mutton Sekuwa With Bone','Mutton','Set',450,1),
  ('Mutton Sekuwa With Bone','Mutton','1 kg',1650,0),
  ('Mutton Bhutuwa','Mutton','Set',550,1),
  ('Mutton Bhutuwa','Mutton','1 kg',2250,0),
  -- Fish
  ('Fish Fry','Fish','1 pc',375,1),
  ('Fish Fry','Fish','2 pcs',750,0),
  -- Momo
  ('Veg Momo','Momo','Steam',120,1),
  ('Veg Momo','Momo','Fry',150,0),
  ('Chicken Momo','Momo','Steam',150,1),
  ('Chicken Momo','Momo','Fry',180,0),
  ('Mutton Momo','Momo','Steam',240,1),
  ('Mutton Momo','Momo','Fry',270,0),
  -- Snacks
  ('Karnali Aalu','Snacks','Boiled',150,1),
  ('Karnali Aalu','Snacks','Roasted',200,0),
  -- Pizza
  ('Veg Lover Pizza','Pizza','Small',395,1),
  ('Veg Lover Pizza','Pizza','Medium',495,0),
  ('Veg Lover Pizza','Pizza','Large',595,0),
  ('Paneer Pizza','Pizza','Small',495,1),
  ('Paneer Pizza','Pizza','Medium',595,0),
  ('Paneer Pizza','Pizza','Large',695,0),
  ('Chicken Tikka Pizza','Pizza','Small',485,1),
  ('Chicken Tikka Pizza','Pizza','Medium',585,0),
  ('Chicken Tikka Pizza','Pizza','Large',685,0),
  ('Meat Lover Pizza','Pizza','Small',525,1),
  ('Meat Lover Pizza','Pizza','Medium',655,0),
  ('Meat Lover Pizza','Pizza','Large',725,0),
  -- Coffee - Black Base
  ('Americano','Coffee - Black Base','Single Shot',130,1),
  ('Americano','Coffee - Black Base','Double',140,0)
) AS v(item, cat, variant_name, price, is_default)
JOIN menu_categories c ON c.name = v.cat
JOIN menu_items m ON m.name = v.item AND m.category_id = c.id
WHERE NOT EXISTS (
  SELECT 1 FROM menu_item_variants x
  WHERE x.menu_item_id = m.id AND x.variant_name = v.variant_name
);
-- ================================================ 7. INVENTORY CATEGORIES
INSERT INTO inventory_categories (name, normalized_name)
SELECT v.name, lower(v.name) FROM (VALUES
  ('Grains & Flour'),
  ('Bakery'),
  ('Meat & Poultry'),
  ('Vegetables'),
  ('Fruits'),
  ('Dairy'),
  ('Oil & Fats'),
  ('Spices & Condiments'),
  ('Beverages')
) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM inventory_categories c WHERE lower(c.name) = lower(v.name));

-- ===================================== 7b. INGREDIENT MASTER (opening stock 0)
-- quantity = 0 on purpose: the client enters real stock later. cost/min are 0
-- too; only the recipe lines below carry per-dish amounts.
INSERT INTO inventory_items
  (item_name, name, quantity, unit, cost_per_unit, min_stock_level, min_stock, category, supplier, notes, created_at, updated_at)
SELECT v.item_name, v.item_name, 0, v.unit, 0, 0, 0, v.category,
       'To be set', 'Default seed ingredient', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
  -- Grains & Flour
  ('Rice','kg','Grains & Flour'),
  ('Basmati Rice','kg','Grains & Flour'),
  ('Maida (Flour)','kg','Grains & Flour'),
  ('Chowmein Noodles','kg','Grains & Flour'),
  ('Corn Kernels','kg','Grains & Flour'),
  -- Bakery
  ('Bread','pcs','Bakery'),
  ('Burger Bun','pcs','Bakery'),
  ('Pizza Base','pcs','Bakery'),
  ('Oreo Biscuit','pcs','Bakery'),
  -- Meat & Poultry
  ('Chicken','kg','Meat & Poultry'),
  ('Mutton','kg','Meat & Poultry'),
  ('Chicken Liver','kg','Meat & Poultry'),
  ('Chicken Sausage','pcs','Meat & Poultry'),
  ('Eggs','pcs','Meat & Poultry'),
  -- Vegetables
  ('Potato','kg','Vegetables'),
  ('Onion','kg','Vegetables'),
  ('Tomato','kg','Vegetables'),
  ('Mushroom','kg','Vegetables'),
  ('Mixed Vegetables','kg','Vegetables'),
  ('Peanuts','kg','Vegetables'),
  ('Cashew Nut','kg','Vegetables'),
  ('Mint Leaves','kg','Vegetables'),
  ('Lemon','pcs','Vegetables'),
  -- Fruits
  ('Watermelon','kg','Fruits'),
  ('Apple','kg','Fruits'),
  ('Orange','kg','Fruits'),
  ('Banana','pcs','Fruits'),
  ('Mixed Fruits','kg','Fruits'),
  -- Dairy
  ('Paneer','kg','Dairy'),
  ('Milk','l','Dairy'),
  ('Cheese','kg','Dairy'),
  ('Cream','l','Dairy'),
  ('Curd','kg','Dairy'),
  ('Ice Cream','l','Dairy'),
  -- Oil & Fats
  ('Cooking Oil','l','Oil & Fats'),
  ('Mustard Oil','l','Oil & Fats'),
  ('Ghee','kg','Oil & Fats'),
  -- Spices & Condiments
  ('Salt','kg','Spices & Condiments'),
  ('Sugar','kg','Spices & Condiments'),
  ('Mixed Spices (Masala)','kg','Spices & Condiments'),
  ('Biryani Masala','kg','Spices & Condiments'),
  ('Timur','kg','Spices & Condiments'),
  ('Black Pepper','kg','Spices & Condiments'),
  ('Soy Sauce','l','Spices & Condiments'),
  ('Chilli Sauce','l','Spices & Condiments'),
  ('Honey','kg','Spices & Condiments'),
  -- Beverages
  ('Coffee Powder','kg','Beverages'),
  ('Instant Coffee (Nescafe)','kg','Beverages'),
  ('Tea Leaves','kg','Beverages'),
  ('Green Tea Bag','pcs','Beverages'),
  ('Herbal Tea Bag','pcs','Beverages'),
  ('Cola Syrup','l','Beverages'),
  ('Chocolate Syrup','l','Beverages'),
  ('Real Juice Pack','pcs','Beverages'),
  ('Cold Drink Bottle','pcs','Beverages'),
  ('Red Bull Can','pcs','Beverages')
) AS v(item_name, unit, category)
WHERE NOT EXISTS (
  SELECT 1 FROM inventory_items i WHERE i.item_name = v.item_name AND i.notes = 'Default seed ingredient'
);

-- Backfill category_id from the category text.
UPDATE inventory_items i
SET category_id = c.id
FROM inventory_categories c
WHERE lower(c.name) = lower(i.category)
  AND i.category_id IS NULL
  AND i.notes = 'Default seed ingredient';

-- ================================================= 8. RECIPES (one per item)
INSERT INTO recipes (name, type, menu_item_id, yield_quantity, yield_unit, prep_notes)
SELECT m.name, 'menu_item', m.id, 1, 'plate', 'Default seed recipe'
FROM menu_items m
WHERE NOT EXISTS (
  SELECT 1 FROM recipes r WHERE r.menu_item_id = m.id AND r.prep_notes = 'Default seed recipe'
);
-- ============================================ 9. MIGRATION MARKERS (001..038)
INSERT INTO schema_migrations (version) VALUES
  ('001_init'),('002_tables_extra_columns'),('003_expenses_notes_stock'),('004_recipe_bom'),
  ('005_leads_viewed_at'),('006_inventory_expense_upgrade'),('007_inventory_category'),('008_inventory_ledger'),
  ('009_wastage_reason_vocabulary'),('010_list_query_indexes'),('011_unit_conversions'),('012_inventory_categories'),
  ('013_table_floors_types'),('014_payroll'),('015_accounting'),('016_expense_categories'),
  ('017_accounting_hardening'),('018_accounting_numeric'),('019_supplier_ledger'),('020_bank_reconciliation'),
  ('021_table_qr_token'),('022_kitchen_timing'),('023_bill_corrections'),('024_online_orders'),
  ('025_bill_admin'),('026_split_billing'),('027_vat_payable_account'),('028_admin_pos_kot'),
  ('029_order_party'),('030_pos_lifecycle_audit_numbers'),('031_analytics_overview_indexes'),('032_business_days'),
  ('033_business_day_sessions'),('034_opening_cash_movement_accounts'),('035_inventory_business_day_attribution'),
  ('036_savings_deposits'),('037_business_day_stale_ack'),('038_role_permissions')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- Sanity checks (run separately if you like):
--   SELECT COUNT(*) FROM menu_categories;      -- 22
--   SELECT COUNT(*) FROM menu_items;           -- 100
--   SELECT COUNT(*) FROM menu_item_variants;   -- 46
--   SELECT COUNT(*) FROM recipes;              -- 100 (empty shells)
--   SELECT COUNT(*) FROM inventory_items;      -- 56 (all quantity 0)
--   SELECT COUNT(*) FROM tables;               -- 12
--   SELECT COUNT(*) FROM business_days;        -- 0 (open one from Admin -> Opening & Closing)
