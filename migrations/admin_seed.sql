CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO users (
  username,
  password_hash,
  full_name,
  role,
  is_active,
  must_change_password
) VALUES (
  'admin',
  crypt('1234', gen_salt('bf', 12)),
  'Restaurant Admin',
  'admin',
  1,
  1
)
ON CONFLICT (username) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  must_change_password = 1,
  updated_at = CURRENT_TIMESTAMP;   