-- Owner-controlled switch for the shared Admin/Kitchen cancelled-KOT review.
-- It is deliberately off after upgrade until an administrator enables it.
INSERT INTO system_settings (setting_key, setting_value)
VALUES ('kot_cancellation_approval_enabled', 'false')
ON CONFLICT (setting_key) DO NOTHING;
