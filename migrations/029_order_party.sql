-- Multi-party tables: multiple independent orders/tabs can share one table.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS party_label TEXT;
