-- Presentation-only calendar preference. All stored dates remain canonical AD.
INSERT INTO system_settings (setting_key, setting_value)
VALUES ('calendar_system', 'BS')
ON CONFLICT (setting_key) DO NOTHING;
