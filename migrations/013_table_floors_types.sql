-- 013: managed vocabulary for table floors and table types.
-- tables.floor and tables.table_type were free text (migrations 001/002). These
-- give both a managed backing list so the owner picks from a controlled set
-- instead of retyping "VIP"/"vip"/"V.I.P". The tables.floor / tables.table_type
-- text columns stay as the stored value (mirror pattern) so the live floor
-- board, its filters and sorts keep working untouched. position_x/y already
-- exist on tables, so a drag-and-drop layout can be built later without schema
-- changes.
CREATE TABLE IF NOT EXISTS table_floors (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS table_types (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#3b82f6',
  default_capacity INTEGER DEFAULT 4,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed the managed lists from whatever is already on the tables.
INSERT INTO table_floors (name, normalized_name)
SELECT DISTINCT trim(floor), lower(trim(floor))
FROM tables WHERE floor IS NOT NULL AND trim(floor) <> ''
ON CONFLICT (normalized_name) DO NOTHING;

INSERT INTO table_types (name, normalized_name)
SELECT DISTINCT trim(table_type), lower(trim(table_type))
FROM tables WHERE table_type IS NOT NULL AND trim(table_type) <> ''
ON CONFLICT (normalized_name) DO NOTHING;
