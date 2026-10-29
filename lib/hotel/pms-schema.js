/**
 * SQLite mirror of migrations/088_pms_operations.sql. PostgreSQL gets all of
 * this from the migration; ensureHotelSchema runs it for SQLite only.
 */
export const PMS_EXTRA_SCHEMA = `
CREATE TABLE IF NOT EXISTS hotel_plan_components (
  id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES hotel_rate_plans(id) ON DELETE CASCADE, label TEXT NOT NULL,
  adult_cents BIGINT NOT NULL DEFAULT 0 CHECK (adult_cents >= 0), child_cents BIGINT NOT NULL DEFAULT 0 CHECK (child_cents >= 0),
  timing TEXT NOT NULL DEFAULT 'after_night' CHECK (timing IN ('after_night', 'night_of')),
  start_time TEXT NOT NULL DEFAULT '00:00', end_time TEXT NOT NULL DEFAULT '23:59',
  outlets TEXT NOT NULL DEFAULT 'restaurant,room_service', sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_hotel_plan_components_plan ON hotel_plan_components(plan_id);
CREATE TABLE IF NOT EXISTS hotel_package_usage (
  id TEXT PRIMARY KEY, reservation_id TEXT NOT NULL REFERENCES hotel_reservations(id), component_id TEXT NOT NULL,
  component_label TEXT NOT NULL, usage_date TEXT NOT NULL, outlet TEXT NOT NULL, bill_id INTEGER, bill_number TEXT,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0), reversed INTEGER NOT NULL DEFAULT 0 CHECK (reversed IN (0, 1)),
  source_key TEXT NOT NULL UNIQUE, created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_hotel_package_usage_stay ON hotel_package_usage(reservation_id, usage_date);
CREATE INDEX IF NOT EXISTS idx_hotel_package_usage_bill ON hotel_package_usage(bill_id);
CREATE TABLE IF NOT EXISTS hotel_package_settlements (
  reservation_id TEXT PRIMARY KEY REFERENCES hotel_reservations(id), accrued_cents BIGINT NOT NULL, consumed_cents BIGINT NOT NULL,
  breakage_cents BIGINT NOT NULL, journal_id INTEGER REFERENCES journal_entries(id), created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS hotel_laundry_orders (
  id TEXT PRIMARY KEY, reservation_id TEXT NOT NULL REFERENCES hotel_reservations(id), room_number TEXT NOT NULL, items TEXT NOT NULL,
  pieces INTEGER NOT NULL DEFAULT 1 CHECK (pieces BETWEEN 1 AND 500), amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
  express INTEGER NOT NULL DEFAULT 0 CHECK (express IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'collected' CHECK (status IN ('collected', 'washing', 'ironing', 'ready', 'delivered', 'cancelled')),
  folio_entry_id INTEGER REFERENCES hotel_folio_entries(id), notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, delivered_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_hotel_laundry_status ON hotel_laundry_orders(status, created_at);
CREATE INDEX IF NOT EXISTS idx_hotel_laundry_stay ON hotel_laundry_orders(reservation_id);
CREATE TABLE IF NOT EXISTS hotel_minibar_items (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, price_cents BIGINT NOT NULL CHECK (price_cents >= 0),
  inventory_item_id INTEGER, par_level INTEGER NOT NULL DEFAULT 2 CHECK (par_level BETWEEN 0 AND 50),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)), created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_hotel_audit_events_entity ON hotel_audit_events(entity_id, created_at);
`;

export const PMS_EXTRA_COLUMNS = [
  ['hotel_rate_plans', 'plan_code', "TEXT NOT NULL DEFAULT 'CUSTOM'"],
  ['hotel_rate_plans', 'description', "TEXT NOT NULL DEFAULT ''"],
  ['orders', 'hotel_stay_id', 'TEXT'],
  ['orders', 'room_service_status', 'TEXT'],
  ['orders', 'room_service_requested_time', 'TEXT'],
  ['orders', 'room_service_delivered_by', 'INTEGER'],
  ['orders', 'room_service_delivered_at', 'TIMESTAMP'],
  ['reservations', 'hotel_stay_id', 'TEXT'],
  ['hotel_housekeeping_tasks', 'task_type', "TEXT NOT NULL DEFAULT 'checkout'"],
  ['hotel_housekeeping_tasks', 'started_at', 'TIMESTAMP'],
  ['hotel_maintenance_tickets', 'closed_at', 'TIMESTAMP'],
  ['hotel_maintenance_tickets', 'block_kind', "TEXT NOT NULL DEFAULT 'out_of_order'"],
  ['hotel_audit_events', 'reason', 'TEXT'],
  ['hotel_audit_events', 'business_date', 'TEXT'],
  ['hotel_checkout_statements', 'print_count', 'INTEGER NOT NULL DEFAULT 0'],
  ['hotel_guests', 'preferences', "TEXT NOT NULL DEFAULT ''"],
];

const TICKET_COLUMNS = ['id', 'room_id', 'title', 'description', 'priority', 'status', 'blocked_room', 'photo_mime', 'photo_base64', 'reported_by', 'assigned_to', 'resolution_note', 'created_at', 'resolved_at'];

/** SQLite: widen the maintenance status CHECK once (rebuild, rows copied unchanged). */
export async function upgradeTicketTable(db) {
  const row = await db.get("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'hotel_maintenance_tickets'");
  if (!row || String(row.sql).includes('waiting_part')) return;
  await db.transaction(async (tx) => {
    await tx.run(`CREATE TABLE hotel_maintenance_tickets_v2 (
      id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES hotel_rooms(id), title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '', priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'urgent')),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'in_progress', 'waiting_part', 'resolved', 'closed')),
      blocked_room INTEGER NOT NULL DEFAULT 0 CHECK (blocked_room IN (0, 1)), photo_mime TEXT, photo_base64 TEXT,
      reported_by INTEGER REFERENCES users(id) ON DELETE SET NULL, assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
      resolution_note TEXT, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, resolved_at TIMESTAMP)`);
    await tx.run(`INSERT INTO hotel_maintenance_tickets_v2 (${TICKET_COLUMNS.join(', ')}) SELECT ${TICKET_COLUMNS.join(', ')} FROM hotel_maintenance_tickets`);
    await tx.run('DROP TABLE hotel_maintenance_tickets');
    await tx.run('ALTER TABLE hotel_maintenance_tickets_v2 RENAME TO hotel_maintenance_tickets');
    await tx.run('CREATE INDEX IF NOT EXISTS idx_hotel_tickets_status ON hotel_maintenance_tickets(status, created_at)');
  });
}
