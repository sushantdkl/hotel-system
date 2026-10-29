-- Prepared KOT/item cancellations are finished-menu wastage. Keep their menu
-- identity and source document so they appear in the normal wastage audit.
ALTER TABLE wastage_log ADD COLUMN IF NOT EXISTS menu_item_id INTEGER REFERENCES menu_items(id) ON DELETE SET NULL;
ALTER TABLE wastage_log ADD COLUMN IF NOT EXISTS source_type TEXT;
ALTER TABLE wastage_log ADD COLUMN IF NOT EXISTS source_id INTEGER;

-- Migration 004 required a raw material or recipe. A prepared menu item may
-- legitimately have neither while its recipe/inventory setup is incomplete.
ALTER TABLE wastage_log DROP CONSTRAINT IF EXISTS wastage_log_check;

CREATE INDEX IF NOT EXISTS idx_wastage_log_menu_item ON wastage_log(menu_item_id);
CREATE INDEX IF NOT EXISTS idx_wastage_log_source ON wastage_log(source_type, source_id);
