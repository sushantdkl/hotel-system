/**
 * Online check-in. The front desk creates a private link per confirmed
 * reservation (/checkin/<token>); the guest confirms contact details, ID and
 * arrival time, and may upload an ID photo. This only fills the guest profile
 * and marks the stay "pre-checked-in": the room key / physical check-in still
 * happens at the desk. The link works until the guest checks in, cancels or
 * the departure date passes.
 */
import { randomBytes } from 'node:crypto';
import { ensureHotelSchema } from './schema.js';
import { addGuestDocument, ID_TYPES } from './guests.js';
import { hotelDate } from './service.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const text = (v, max) => String(v ?? '').trim().slice(0, max);

/** Inside a hotel transaction (command `precheckin_link`). */
export async function createPrecheckinLink(tx, id) {
  const booking = await tx.get("SELECT id, status, precheckin_token FROM hotel_reservations WHERE id = ? AND property_id = 'main'", [id]);
  if (!booking) fail('Reservation not found.', 404);
  if (booking.status !== 'confirmed') fail('Online check-in is only for confirmed reservations that have not arrived.', 409);
  const token = booking.precheckin_token || randomBytes(24).toString('hex');
  if (!booking.precheckin_token) await tx.run('UPDATE hotel_reservations SET precheckin_token = ? WHERE id = ?', [token, id]);
  return { id, message: 'Online check-in link ready. Copy it from the reservation and send it to the guest.' };
}

async function stayForToken(db, token, now) {
  await ensureHotelSchema(db);
  if (!/^[a-f0-9]{48}$/.test(String(token || ''))) fail('This check-in link is not valid.', 404);
  const stay = await db.get(`SELECT b.*, r.room_type, p.name AS property_name, g.email, g.nationality, g.id_type, g.id_number, g.address
    FROM hotel_reservations b JOIN hotel_rooms r ON r.id = b.room_id JOIN hotel_properties p ON p.id = b.property_id
    LEFT JOIN hotel_guests g ON g.id = b.guest_id WHERE b.precheckin_token = ?`, [token]);
  if (!stay || stay.status !== 'confirmed' || stay.departure_date < hotelDate(now)) fail('This check-in link has expired. Please contact the hotel.', 404);
  return stay;
}

/** What the guest sees: no internal ids, prices or other guests. */
export async function publicPrecheckin(db, token, now = new Date()) {
  const s = await stayForToken(db, token, now);
  return {
    property: s.property_name, guest: s.guest_name, phone: s.guest_phone, email: s.email || '', nationality: s.nationality || '',
    idType: s.id_type || '', idNumber: s.id_number || '', address: s.address || '',
    arrival: s.arrival_date, departure: s.departure_date, roomType: s.room_type, guests: Number(s.guest_count),
    eta: s.eta || '', completedAt: s.precheckin_at || null, idTypes: ID_TYPES,
  };
}

export async function submitPrecheckin(db, token, data, file = null, now = new Date()) {
  const s = await stayForToken(db, token, now);
  const name = text(data?.name, 100);
  const phone = text(data?.phone, 30);
  const email = text(data?.email, 120);
  const idType = text(data?.idType, 40);
  const idNumber = text(data?.idNumber, 60);
  if (!name || !phone) fail('Enter your full name and phone number.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Enter a valid email address.');
  if (!ID_TYPES.includes(idType) || !idNumber) fail('Choose your ID type and enter its number.');
  const eta = text(data?.eta, 5);
  if (eta && !/^([01]\d|2[0-3]):[0-5]\d$/.test(eta)) fail('Enter the arrival time as HH:MM.');
  if (!s.guest_id) fail('This reservation has no guest profile. Please contact the hotel.', 409);
  await db.transaction(async (tx) => {
    await tx.run(`UPDATE hotel_guests SET full_name = ?, phone = ?, email = ?, nationality = ?, id_type = ?, id_number = ?, address = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [name, phone, email, text(data?.nationality, 60), idType, idNumber, text(data?.address, 300), s.guest_id]);
    await tx.run('UPDATE hotel_reservations SET guest_name = ?, guest_phone = ?, eta = ?, precheckin_at = ? WHERE id = ?', [name, phone, eta || null, now.toISOString(), s.id]);
  });
  if (file?.bytes?.length) await addGuestDocument(db, { id: null }, s.guest_id, { label: `${idType} (online check-in)`, fileName: file.fileName, mime: file.mime, bytes: file.bytes });
  return { message: 'Thank you. Your details are saved; the front desk will have your key ready.' };
}
