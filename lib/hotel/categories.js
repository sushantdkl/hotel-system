/**
 * Room categories ("Deluxe King", "Family Suite", ...): default nightly price,
 * capacity, beds, description and amenities. Rooms keep the category name in
 * hotel_rooms.room_type (used by seasons, OTA room-type mapping and the rack),
 * plus their own price/capacity, which start from the category. Renaming a
 * category renames it on its rooms and seasons.
 */
import { randomUUID } from 'node:crypto';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const cents = (v) => Math.round(Number(v) * 100);
const MAX_BULK = 100;

/** Rooms created before categories existed get a category per room type (idempotent). */
export async function backfillCategories(db) {
  const missing = await db.all(`SELECT r.room_type AS name, MAX(r.nightly_rate_cents) AS rate, MAX(r.capacity) AS capacity FROM hotel_rooms r
    WHERE r.property_id = 'main' AND NOT EXISTS (SELECT 1 FROM hotel_room_types t WHERE t.name = r.room_type) GROUP BY r.room_type`);
  for (const m of missing) {
    await db.run('INSERT INTO hotel_room_types (id, name, base_rate_cents, capacity) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO NOTHING', [randomUUID(), m.name, Number(m.rate) || 0, Math.min(20, Math.max(1, Number(m.capacity) || 2))]);
  }
}

export async function listCategories(db) {
  await backfillCategories(db);
  const rows = await db.all(`SELECT t.*, (SELECT COUNT(*) FROM hotel_rooms r WHERE r.property_id = 'main' AND r.room_type = t.name) AS rooms
    FROM hotel_room_types t ORDER BY t.sort_order, t.base_rate_cents, t.name`);
  return rows.map((t) => ({ id: t.id, name: t.name, rate: Number(t.base_rate_cents) / 100, capacity: Number(t.capacity), beds: t.beds, description: t.description, amenities: t.amenities, rooms: Number(t.rooms) }));
}

function validCategory(a) {
  if (!a.name) fail('Enter a category name.');
  if (!Number.isFinite(a.rate) || a.rate < 0 || a.rate > 1000000) fail('Enter a valid nightly price.');
  if (!Number.isInteger(a.capacity) || a.capacity < 1 || a.capacity > 20) fail('Max guests must be 1 to 20.');
}

/** category, category_delete, rooms_bulk. Runs inside the hotel transaction. */
export async function processCategoryCommand(tx, action) {
  if (action.type === 'category') {
    validCategory(action);
    const clash = await tx.get('SELECT id FROM hotel_room_types WHERE LOWER(name) = LOWER(?) AND id <> ?', [action.name, action.id || '']);
    if (clash) fail('A category with that name already exists.', 409);
    const fields = [action.name, cents(action.rate), action.capacity, action.beds, action.description, action.amenities];
    if (!action.id) {
      const id = randomUUID();
      await tx.run('INSERT INTO hotel_room_types (id, name, base_rate_cents, capacity, beds, description, amenities) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, ...fields]);
      return { id, message: `Category ${action.name} added. Add rooms to it below.` };
    }
    const old = await tx.get('SELECT * FROM hotel_room_types WHERE id = ?', [action.id]);
    if (!old) fail('Category not found.', 404);
    await tx.run('UPDATE hotel_room_types SET name = ?, base_rate_cents = ?, capacity = ?, beds = ?, description = ?, amenities = ? WHERE id = ?', [...fields, action.id]);
    if (old.name !== action.name) {
      await tx.run("UPDATE hotel_rooms SET room_type = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE property_id = 'main' AND room_type = ?", [action.name, old.name]);
      await tx.run('UPDATE hotel_rate_seasons SET room_type = ? WHERE room_type = ?', [action.name, old.name]);
    }
    let applied = 0;
    if (action.applyToRooms) {
      // New price for the category's rooms; existing bookings keep their agreed price.
      const result = await tx.run("UPDATE hotel_rooms SET nightly_rate_cents = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE property_id = 'main' AND room_type = ?", [cents(action.rate), action.name]);
      applied = result.changes || 0;
    }
    return { id: action.id, message: `Category ${action.name} saved${applied ? `; new price applied to ${applied} room(s)` : ''}.` };
  }
  if (action.type === 'category_delete') {
    const cat = await tx.get('SELECT name FROM hotel_room_types WHERE id = ?', [action.id]);
    if (!cat) fail('Category not found.', 404);
    if (await tx.get("SELECT id FROM hotel_rooms WHERE property_id = 'main' AND room_type = ? LIMIT 1", [cat.name])) fail('Move or remove the rooms in this category first.', 409);
    await tx.run('DELETE FROM hotel_room_types WHERE id = ?', [action.id]);
    return { id: action.id, message: `Category ${cat.name} removed.` };
  }
  // rooms_bulk: numbers from..to (inclusive) on one floor, all in one category.
  const cat = await tx.get('SELECT * FROM hotel_room_types WHERE id = ?', [action.categoryId]);
  if (!cat) fail('Choose a category.');
  if (!Number.isInteger(action.from) || !Number.isInteger(action.to) || action.from < 0 || action.to < action.from) fail('Enter a valid room number range, e.g. 101 to 110.');
  if (action.to - action.from + 1 > MAX_BULK) fail(`Add up to ${MAX_BULK} rooms at a time.`);
  if (!Number.isInteger(action.floor) || action.floor < 0 || action.floor > 99) fail('Floor must be 0 to 99.');
  if (!/^[A-Za-z0-9-]{0,4}$/.test(action.prefix)) fail('Prefix can be up to 4 letters, digits or dashes.');
  const created = []; const skipped = [];
  for (let n = action.from; n <= action.to; n += 1) {
    const number = `${action.prefix}${n}`;
    if (number.length > 12) fail('Room numbers can be up to 12 characters.');
    if (await tx.get("SELECT id FROM hotel_rooms WHERE property_id = 'main' AND LOWER(room_number) = LOWER(?)", [number])) { skipped.push(number); continue; }
    await tx.run("INSERT INTO hotel_rooms (id, property_id, room_number, floor, room_type, capacity, nightly_rate_cents) VALUES (?, 'main', ?, ?, ?, ?, ?)",
      [randomUUID(), number, action.floor, cat.name, Number(cat.capacity), Number(cat.base_rate_cents)]);
    created.push(number);
  }
  return { id: action.categoryId, message: `${created.length} room(s) added to ${cat.name}${skipped.length ? `; ${skipped.length} already existed (${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? '…' : ''})` : ''}.` };
}

/** Single-room form: fill blank type / price / capacity from the chosen category. */
export async function applyCategoryDefaults(tx, action) {
  if (!action.categoryId) return action;
  const cat = await tx.get('SELECT * FROM hotel_room_types WHERE id = ?', [action.categoryId]);
  if (!cat) fail('Category not found.', 404);
  return {
    ...action,
    roomType: cat.name,
    rate: Number.isFinite(action.rate) && action.rateGiven ? action.rate : Number(cat.base_rate_cents) / 100,
    capacity: Number.isInteger(action.capacity) && action.capacityGiven ? action.capacity : Number(cat.capacity),
  };
}
