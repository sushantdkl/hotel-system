-- Manager and hotel staff roles. Keep the list in sync with lib/roles.js.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'manager', 'cashier', 'waiter', 'kitchen', 'receptionist', 'housekeeping'));
