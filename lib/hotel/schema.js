import { ensureColumn } from '../db/schema-helpers.js';
import { HOTEL_FOLIO_SCHEMA, HOTEL_GUEST_SCHEMA, HOTEL_CATEGORY_SCHEMA, HOTEL_LATE_COLUMNS, HOTEL_OPERATIONS_SCHEMA, HOTEL_OTA_SCHEMA, HOTEL_RATES_SCHEMA, HOTEL_UPGRADE_COLUMNS, PMS_CORE_COLUMNS, PMS_CORE_SCHEMA, upgradeFolioTable } from './folio-schema.js';
import { PMS_EXTRA_COLUMNS, PMS_EXTRA_SCHEMA, upgradeTicketTable } from './pms-schema.js';

// Newest hotel table; PostgreSQL must have migrated through the file that creates it.
export const LATEST_HOTEL_TABLE = ['hotel_laundry_orders', '088_pms_operations'];
const statements = (sql) => sql.split(';').map((part) => part.trim()).filter(Boolean);

// Deliberately portable DDL: new hotel records never reuse restaurant tables.
export const HOTEL_SCHEMA = `
CREATE TABLE IF NOT EXISTS hotel_properties (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'Asia/Kathmandu',
  currency TEXT NOT NULL DEFAULT 'NPR', updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS hotel_rooms (
  id TEXT PRIMARY KEY, property_id TEXT NOT NULL REFERENCES hotel_properties(id),
  room_number TEXT NOT NULL, floor INTEGER NOT NULL CHECK (floor BETWEEN 0 AND 99),
  room_type TEXT NOT NULL, capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 20),
  nightly_rate_cents BIGINT NOT NULL CHECK (nightly_rate_cents >= 0),
  cleaning_status TEXT NOT NULL DEFAULT 'ready' CHECK (cleaning_status IN ('ready', 'dirty', 'cleaning', 'inspection')),
  blocked INTEGER NOT NULL DEFAULT 0 CHECK (blocked IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(property_id, room_number)
);
CREATE TABLE IF NOT EXISTS hotel_reservations (
  id TEXT PRIMARY KEY, property_id TEXT NOT NULL REFERENCES hotel_properties(id),
  room_id TEXT NOT NULL REFERENCES hotel_rooms(id), guest_name TEXT NOT NULL,
  guest_phone TEXT NOT NULL DEFAULT '', arrival_date TEXT NOT NULL, departure_date TEXT NOT NULL,
  guest_count INTEGER NOT NULL CHECK (guest_count BETWEEN 1 AND 20),
  source TEXT NOT NULL DEFAULT 'Direct', meal_plan TEXT NOT NULL DEFAULT 'Room only',
  nightly_rate_cents BIGINT NOT NULL CHECK (nightly_rate_cents >= 0),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'in_house', 'cancelled')),
  checked_in_at TIMESTAMP, cancelled_at TIMESTAMP,
  created_by INTEGER REFERENCES users(id), created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (departure_date > arrival_date)
);
CREATE INDEX IF NOT EXISTS idx_hotel_reservations_room_dates ON hotel_reservations(room_id, status, arrival_date, departure_date);
CREATE TABLE IF NOT EXISTS hotel_audit_events (
  id TEXT PRIMARY KEY, property_id TEXT NOT NULL REFERENCES hotel_properties(id),
  actor_id INTEGER REFERENCES users(id), action TEXT NOT NULL, entity_id TEXT NOT NULL,
  details TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS hotel_command_receipts (
  request_key TEXT PRIMARY KEY, actor_id INTEGER NOT NULL REFERENCES users(id),
  payload_hash TEXT NOT NULL, result_json TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO hotel_properties (id, name) VALUES ('main', 'Your hotel') ON CONFLICT(id) DO NOTHING;
`;

const ready = new WeakMap();
export async function ensureHotelSchema(db) {
  if (ready.has(db)) return ready.get(db);
  const pending = (async () => {
    if (db.driver === 'postgres') {
      const row = await db.get(`SELECT to_regclass('public.${LATEST_HOTEL_TABLE[0]}') AS installed`);
      if (!row?.installed) throw Object.assign(new Error(`Hotel schema is not installed. Run database migrations through ${LATEST_HOTEL_TABLE[1]} (npm run db:migrate).`), { status: 503, expose: true });
    } else {
      for (const sql of HOTEL_SCHEMA.split(';').map((part) => part.trim()).filter(Boolean)) await db.run(sql);
      for (const [table, column, type] of HOTEL_UPGRADE_COLUMNS) await ensureColumn(db, table, column, type);
      for (const sql of HOTEL_FOLIO_SCHEMA.split(';').map((part) => part.trim()).filter(Boolean)) await db.run(sql);
      for (const sql of HOTEL_GUEST_SCHEMA.split(';').map((part) => part.trim()).filter(Boolean)) await db.run(sql);
      for (const sql of HOTEL_RATES_SCHEMA.split(';').map((part) => part.trim()).filter(Boolean)) await db.run(sql);
      for (const sql of HOTEL_OPERATIONS_SCHEMA.split(';').map((part) => part.trim()).filter(Boolean)) await db.run(sql);
      for (const sql of HOTEL_OTA_SCHEMA.split(';').map((part) => part.trim()).filter(Boolean)) await db.run(sql);
      for (const sql of HOTEL_CATEGORY_SCHEMA.split(';').map((part) => part.trim()).filter(Boolean)) await db.run(sql);
      for (const [table, column, type] of HOTEL_LATE_COLUMNS) await ensureColumn(db, table, column, type);
      await upgradeFolioTable(db);
      for (const [table, column, type] of PMS_CORE_COLUMNS) await ensureColumn(db, table, column, type);
      for (const sql of statements(PMS_CORE_SCHEMA)) await db.run(sql);
      await db.run('UPDATE hotel_reservations SET adults = guest_count WHERE adults IS NULL');
      await db.run(`INSERT INTO hotel_groups (id, name, primary_guest_id, master_reservation_id, payer_mode)
        SELECT group_id, MIN(guest_name), MIN(guest_id), MIN(id), 'individual' FROM hotel_reservations WHERE group_id IS NOT NULL GROUP BY group_id
        ON CONFLICT (id) DO NOTHING`);
      await upgradeTicketTable(db);
      for (const sql of statements(PMS_EXTRA_SCHEMA)) await db.run(sql);
      for (const [table, column, type] of PMS_EXTRA_COLUMNS) await ensureColumn(db, table, column, type);
    }
  })().catch((error) => { ready.delete(db); throw error; });
  ready.set(db, pending);
  return pending;
}
