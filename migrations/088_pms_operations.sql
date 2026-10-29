-- PMS operations: meal-plan packages with daily allowances, package usage,
-- laundry orders, minibar catalog linked to inventory, restaurant order /
-- table reservation links to hotel stays, room-service delivery tracking,
-- housekeeping task types, maintenance workflow, audit detail.
-- SQLite mirror: PMS_EXTRA_SCHEMA / PMS_EXTRA_COLUMNS in lib/hotel/pms-schema.js.

ALTER TABLE hotel_rate_plans ADD COLUMN IF NOT EXISTS plan_code TEXT NOT NULL DEFAULT 'CUSTOM';
ALTER TABLE hotel_rate_plans ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS hotel_plan_components (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES hotel_rate_plans(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  adult_cents BIGINT NOT NULL DEFAULT 0 CHECK (adult_cents >= 0),
  child_cents BIGINT NOT NULL DEFAULT 0 CHECK (child_cents >= 0),
  timing TEXT NOT NULL DEFAULT 'after_night' CHECK (timing IN ('after_night', 'night_of')),
  start_time TEXT NOT NULL DEFAULT '00:00',
  end_time TEXT NOT NULL DEFAULT '23:59',
  outlets TEXT NOT NULL DEFAULT 'restaurant,room_service',
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_hotel_plan_components_plan ON hotel_plan_components(plan_id);

CREATE TABLE IF NOT EXISTS hotel_package_usage (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL REFERENCES hotel_reservations(id),
  component_id TEXT NOT NULL,
  component_label TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  outlet TEXT NOT NULL,
  bill_id INTEGER,
  bill_number TEXT,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  reversed INTEGER NOT NULL DEFAULT 0 CHECK (reversed IN (0, 1)),
  source_key TEXT NOT NULL UNIQUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_hotel_package_usage_stay ON hotel_package_usage(reservation_id, usage_date);
CREATE INDEX IF NOT EXISTS idx_hotel_package_usage_bill ON hotel_package_usage(bill_id);

CREATE TABLE IF NOT EXISTS hotel_package_settlements (
  reservation_id TEXT PRIMARY KEY REFERENCES hotel_reservations(id),
  accrued_cents BIGINT NOT NULL,
  consumed_cents BIGINT NOT NULL,
  breakage_cents BIGINT NOT NULL,
  journal_id INTEGER REFERENCES journal_entries(id),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hotel_laundry_orders (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL REFERENCES hotel_reservations(id),
  room_number TEXT NOT NULL,
  items TEXT NOT NULL,
  pieces INTEGER NOT NULL DEFAULT 1 CHECK (pieces BETWEEN 1 AND 500),
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
  express INTEGER NOT NULL DEFAULT 0 CHECK (express IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'collected' CHECK (status IN ('collected', 'washing', 'ironing', 'ready', 'delivered', 'cancelled')),
  folio_entry_id INTEGER REFERENCES hotel_folio_entries(id),
  notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivered_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_hotel_laundry_status ON hotel_laundry_orders(status, created_at);
CREATE INDEX IF NOT EXISTS idx_hotel_laundry_stay ON hotel_laundry_orders(reservation_id);

CREATE TABLE IF NOT EXISTS hotel_minibar_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  price_cents BIGINT NOT NULL CHECK (price_cents >= 0),
  inventory_item_id INTEGER REFERENCES inventory_items(id) ON DELETE SET NULL,
  par_level INTEGER NOT NULL DEFAULT 2 CHECK (par_level BETWEEN 0 AND 50),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Restaurant documents linked to a hotel stay (restaurant still owns them).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS hotel_stay_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS room_service_status TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS room_service_requested_time TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS room_service_delivered_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS room_service_delivered_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_orders_hotel_stay ON orders(hotel_stay_id) WHERE hotel_stay_id IS NOT NULL;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS hotel_stay_id TEXT;

-- Housekeeping task type and start time (turnaround).
ALTER TABLE hotel_housekeeping_tasks ADD COLUMN IF NOT EXISTS task_type TEXT NOT NULL DEFAULT 'checkout';
ALTER TABLE hotel_housekeeping_tasks ADD COLUMN IF NOT EXISTS started_at TIMESTAMP;

-- Maintenance workflow: open, assigned, in progress, waiting for part, resolved, closed.
ALTER TABLE hotel_maintenance_tickets DROP CONSTRAINT IF EXISTS hotel_maintenance_tickets_status_check;
ALTER TABLE hotel_maintenance_tickets ADD CONSTRAINT hotel_maintenance_tickets_status_check
  CHECK (status IN ('open', 'assigned', 'in_progress', 'waiting_part', 'resolved', 'closed'));
ALTER TABLE hotel_maintenance_tickets ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP;
ALTER TABLE hotel_maintenance_tickets ADD COLUMN IF NOT EXISTS block_kind TEXT NOT NULL DEFAULT 'out_of_order';

-- Audit detail: reason and hotel business date.
ALTER TABLE hotel_audit_events ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE hotel_audit_events ADD COLUMN IF NOT EXISTS business_date TEXT;
CREATE INDEX IF NOT EXISTS idx_hotel_audit_events_entity ON hotel_audit_events(entity_id, created_at);

-- Invoice reprints: first print is ORIGINAL, later prints DUPLICATE.
ALTER TABLE hotel_checkout_statements ADD COLUMN IF NOT EXISTS print_count INTEGER NOT NULL DEFAULT 0;

-- Guest preferences (room, pillow, diet...).
ALTER TABLE hotel_guests ADD COLUMN IF NOT EXISTS preferences TEXT NOT NULL DEFAULT '';

-- Restaurant settlement methods for hotel guests. `room` (charge to the guest
-- folio) was missing from this constraint, so Charge to Room could not settle
-- on PostgreSQL; `package` is the part covered by the guest's meal plan.
ALTER TABLE bill_payment_allocations DROP CONSTRAINT IF EXISTS bill_payment_allocations_method_check;
ALTER TABLE bill_payment_allocations ADD CONSTRAINT bill_payment_allocations_method_check
  CHECK (method IN ('cash', 'online', 'credit', 'qr', 'card', 'bank', 'bank_transfer', 'cheque', 'fonepay', 'esewa', 'khalti', 'room', 'package'));
