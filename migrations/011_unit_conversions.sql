-- 011: user-defined unit conversions (1 Box = 24 Bottles, 1 Sack = 25 Kg).
-- The lib/units.js catalogue only derives physics ratios (kg→g); supplier
-- pack sizes live here so they can be recorded once instead of re-typed on
-- every inventory item. factor = how many to_unit are inside one from_unit.
CREATE TABLE IF NOT EXISTS unit_conversions (
  id SERIAL PRIMARY KEY,
  from_unit TEXT NOT NULL,
  to_unit TEXT NOT NULL,
  factor DOUBLE PRECISION NOT NULL CHECK (factor > 0),
  note TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (from_unit, to_unit)
);
