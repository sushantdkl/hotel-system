-- 016: managed vocabulary for expense categories.
-- expenses.category stays free text; this backs it with an editable list so the
-- owner picks from a controlled set instead of retyping "Rent"/"rent".
CREATE TABLE IF NOT EXISTS expense_categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO expense_categories (name, normalized_name)
SELECT DISTINCT trim(category), lower(trim(category))
FROM expenses WHERE category IS NOT NULL AND trim(category) <> ''
ON CONFLICT (normalized_name) DO NOTHING;
