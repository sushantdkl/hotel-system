/**
 * Guest room service by QR. Each hotel room gets a restaurant "table" named
 * "Room <number>" (section "Room service", table_type 'room_service',
 * tables.hotel_room_id = room id) with its own QR token. The guest scans the QR
 * in the room and orders through the normal QR ordering flow, so kitchen
 * tickets, waiters, Table QR printing and billing all work unchanged; the
 * cashier settles the bill with "Charge to room". Orders are accepted only
 * while a guest is checked in to that room.
 */
import { ensureColumn } from '../db/schema-helpers.js';
import { generateTableToken } from '../table-qr.js';
import { ensureHotelSchema } from './schema.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

export async function ensureRoomServiceColumns(db) {
  await ensureColumn(db, 'tables', 'qr_token', 'TEXT');
  await ensureColumn(db, 'tables', 'hotel_room_id', 'TEXT');
}

/** Create the room-service table for every hotel room that lacks one. */
export async function enableRoomService(db) {
  await ensureHotelSchema(db);
  await ensureRoomServiceColumns(db);
  const rooms = await db.all("SELECT r.id, r.room_number, r.capacity FROM hotel_rooms r WHERE r.property_id = 'main' AND NOT EXISTS (SELECT 1 FROM tables t WHERE t.hotel_room_id = r.id) ORDER BY r.room_number");
  const skipped = [];
  let created = 0;
  for (const room of rooms) {
    const name = `Room ${room.room_number}`;
    if (await db.get('SELECT id FROM tables WHERE table_number = ?', [name])) { skipped.push(name); continue; }
    await db.run(`INSERT INTO tables (table_number, capacity, status, is_active, floor, section, table_type, qr_token, hotel_room_id)
      VALUES (?, ?, 'available', 1, 'Hotel', 'Room service', 'room_service', ?, ?)`, [name, Number(room.capacity) || 2, generateTableToken(), room.id]);
    created += 1;
  }
  return { message: `${created} room-service QR table(s) created${skipped.length ? `; ${skipped.join(', ')} skipped (a restaurant table already uses that name)` : ''}. Print the codes from Table Management → QR codes.` };
}

/** For a QR table: null for normal tables, else the in-house stay (or a refusal). */
export async function roomServiceGuard(db, tableId) {
  await ensureRoomServiceColumns(db);
  const t = await db.get('SELECT table_type, hotel_room_id FROM tables WHERE id = ?', [tableId]);
  if (!t?.hotel_room_id) return null;
  const stay = await db.get("SELECT b.guest_name, r.room_number FROM hotel_reservations b JOIN hotel_rooms r ON r.id = b.room_id WHERE b.room_id = ? AND b.status = 'in_house' AND b.checked_out_at IS NULL LIMIT 1", [t.hotel_room_id]).catch(() => null);
  return { roomService: true, stay };
}

export function requireInHouse(guard) {
  if (guard?.roomService && !guard.stay) fail('Room service is available to checked-in guests. Please call the front desk.', 403);
}
