SELECT id, description, supplier, created_at, updated_at
FROM expenses WHERE source_type = 'purchase' AND source_id = 50;

SELECT action, created_at, note, before_data, after_data
FROM purchase_change_audit WHERE purchase_id = 50 ORDER BY created_at;
