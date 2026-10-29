/**
 * Guest profiles and private ID/KYC documents. Documents are stored in the
 * database (base64) and only served through an authenticated API, never from
 * public/. Every reservation links to a profile (`hotel_reservations.guest_id`).
 */
import { randomUUID } from 'node:crypto';
import { ensureHotelSchema } from './schema.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const text = (v, max) => {
  const clean = typeof v === 'string' ? v.trim() : '';
  if (clean.length > max) fail(`A field exceeds its ${max}-character limit.`);
  return clean;
};
export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
export const DOCUMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const ID_TYPES = ['Citizenship', 'Passport', 'Driving licence', 'National ID', 'Voter ID', 'Other'];

const mapGuest = (g) => ({
  id: g.id, name: g.full_name, phone: g.phone, email: g.email, nationality: g.nationality,
  idType: g.id_type, idNumber: g.id_number, address: g.address, vip: Boolean(Number(g.vip)),
  blacklisted: Boolean(Number(g.blacklisted)), notes: g.notes, preferences: g.preferences || '',
});

/**
 * Profile for a new booking: an explicit guestId, else the existing profile
 * with the same phone and name, else a new profile. Runs inside the booking tx.
 */
export async function resolveBookingGuest(tx, { guestId, guest, phone }) {
  if (guestId) {
    const row = await tx.get('SELECT * FROM hotel_guests WHERE id = ?', [guestId]);
    if (!row) fail('Guest profile not found.', 404);
    return mapGuest(row);
  }
  if (!guest) fail('Enter the guest name.');
  if (phone) {
    const row = await tx.get('SELECT * FROM hotel_guests WHERE phone = ? AND LOWER(full_name) = LOWER(?) ORDER BY created_at LIMIT 1', [phone, guest]);
    if (row) return mapGuest(row);
  }
  const id = `G-${randomUUID().slice(0, 8).toUpperCase()}`;
  await tx.run('INSERT INTO hotel_guests (id, full_name, phone) VALUES (?, ?, ?)', [id, guest, phone || '']);
  return { id, name: guest, phone: phone || '', vip: false, blacklisted: false };
}

export async function listGuests(db, query = '') {
  await ensureHotelSchema(db);
  const q = `%${String(query || '').trim().toLowerCase()}%`;
  const rows = await db.all(`SELECT g.*, (SELECT COUNT(*) FROM hotel_reservations r WHERE r.guest_id = g.id AND r.status <> 'cancelled') AS stays,
      (SELECT MAX(r.arrival_date) FROM hotel_reservations r WHERE r.guest_id = g.id AND r.status <> 'cancelled') AS last_arrival,
      (SELECT COUNT(*) FROM hotel_guest_documents d WHERE d.guest_id = g.id) AS documents
    FROM hotel_guests g
    WHERE LOWER(g.full_name) LIKE ? OR g.phone LIKE ? OR LOWER(g.id_number) LIKE ? OR LOWER(g.id) LIKE ?
    ORDER BY g.updated_at DESC LIMIT 200`, [q, q, q, q]);
  return rows.map((g) => ({ ...mapGuest(g), stays: Number(g.stays), lastArrival: g.last_arrival, documents: Number(g.documents) }));
}

export async function getGuest(db, id) {
  await ensureHotelSchema(db);
  const row = await db.get('SELECT * FROM hotel_guests WHERE id = ?', [id]);
  if (!row) fail('Guest profile not found.', 404);
  const stays = await db.all(`SELECT r.id, r.arrival_date, r.departure_date, r.status, r.checked_out_at, r.nightly_rate_cents, r.group_id, rm.room_number
    FROM hotel_reservations r JOIN hotel_rooms rm ON rm.id = r.room_id WHERE r.guest_id = ? ORDER BY r.arrival_date DESC`, [id]);
  const documents = await db.all('SELECT id, label, file_name, mime, size_bytes, created_at FROM hotel_guest_documents WHERE guest_id = ? ORDER BY created_at DESC', [id]);
  // Guest 360: spend by department from folio rows (transfers are not new
  // spend; credits reduce it), meals covered by the plan, restaurant bills.
  const ids = stays.map((s) => s.id);
  const marks = ids.map(() => '?').join(',') || "''";
  const rows = ids.length ? await db.all(`SELECT reservation_id, kind, category, source_type, amount_cents FROM hotel_folio_entries WHERE reservation_id IN (${marks})`, ids) : [];
  const spend = { room: 0, restaurant: 0, roomService: 0, laundry: 0, minibar: 0, other: 0, mealsInPlan: 0, payments: 0, outstanding: 0 };
  const balances = new Map();
  for (const r of rows) {
    const sign = { charge: 1, refund: 1, payment: -1, credit: -1 }[r.kind];
    balances.set(r.reservation_id, (balances.get(r.reservation_id) || 0) + sign * Number(r.amount_cents));
    if (r.kind === 'payment') spend.payments += Number(r.amount_cents);
    if (r.kind === 'refund') spend.payments -= Number(r.amount_cents);
    if ((r.kind === 'charge' || r.kind === 'credit') && r.category !== 'transfer') {
      const key = { ROOM: 'room', EARLY_CHECKIN: 'room', LATE_CHECKOUT: 'room', EXTRA_BED: 'room', RESTAURANT: 'restaurant', ROOM_SERVICE: 'roomService', LAUNDRY: 'laundry', MINIBAR: 'minibar' }[r.source_type] || 'other';
      spend[key] += (r.kind === 'credit' ? -1 : 1) * Number(r.amount_cents);
    }
  }
  if (ids.length) spend.mealsInPlan = Number((await db.get(`SELECT COALESCE(SUM(amount_cents), 0) AS c FROM hotel_package_usage WHERE reversed = 0 AND reservation_id IN (${marks})`, ids)).c);
  spend.outstanding = [...balances.values()].reduce((s, b) => s + b, 0);
  const bills = ids.length ? await db.all(`SELECT bl.id, bl.bill_number, bl.grand_total, bl.status, bl.created_at, o.hotel_stay_id,
      CASE WHEN o.order_type = 'room_service' OR t.table_type = 'room_service' OR t.hotel_room_id IS NOT NULL THEN 'Room service' ELSE 'Restaurant' END AS outlet
    FROM orders o JOIN bills bl ON bl.order_id = o.id LEFT JOIN tables t ON t.id = o.table_id WHERE o.hotel_stay_id IN (${marks}) ORDER BY bl.created_at DESC LIMIT 50`, ids).catch(() => []) : [];
  const moves = ids.length ? await db.all(`SELECT reservation_id, from_room_number, to_room_number, reason, business_date FROM hotel_room_moves WHERE reservation_id IN (${marks}) ORDER BY created_at`, ids) : [];
  const total = spend.room + spend.restaurant + spend.roomService + spend.laundry + spend.minibar + spend.other;
  const money = (c) => Math.round(c) / 100;
  return {
    ...mapGuest(row),
    stays: stays.map((s) => ({ id: s.id, room: s.room_number, start: s.arrival_date, end: s.departure_date, status: s.checked_out_at ? 'checked_out' : s.status, rate: Number(s.nightly_rate_cents) / 100, groupId: s.group_id, balance: money(balances.get(s.id) || 0) })),
    documents: documents.map((d) => ({ id: d.id, label: d.label, fileName: d.file_name, mime: d.mime, size: Number(d.size_bytes), createdAt: d.created_at })),
    spend: { ...Object.fromEntries(Object.entries(spend).map(([k, v]) => [k, money(v)])), total: money(total) },
    restaurantBills: bills.map((b) => ({ id: Number(b.id), number: b.bill_number, amount: Number(b.grand_total), status: b.status, date: String(b.created_at).slice(0, 10), outlet: b.outlet, stayId: b.hotel_stay_id })),
    roomHistory: moves.map((m) => ({ stayId: m.reservation_id, from: m.from_room_number, to: m.to_room_number, reason: m.reason, date: m.business_date })),
  };
}

export async function saveGuest(db, actor, data) {
  await ensureHotelSchema(db);
  const fields = {
    full_name: text(data?.name, 100), phone: text(data?.phone, 30), email: text(data?.email, 120),
    nationality: text(data?.nationality, 60), id_type: text(data?.idType, 40), id_number: text(data?.idNumber, 60),
    address: text(data?.address, 300), notes: text(data?.notes, 1000), preferences: text(data?.preferences, 500),
    vip: data?.vip ? 1 : 0, blacklisted: data?.blacklisted ? 1 : 0,
  };
  if (!fields.full_name) fail('Enter the guest name.');
  if (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) fail('Enter a valid email address.');
  const keys = Object.keys(fields);
  let id = data?.id;
  if (id) {
    const result = await db.run(`UPDATE hotel_guests SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [...keys.map((k) => fields[k]), id]);
    if (!result.changes) fail('Guest profile not found.', 404);
    // Keep the reservation name snapshot current for stays not yet finished.
    await db.run("UPDATE hotel_reservations SET guest_name = ?, guest_phone = ? WHERE guest_id = ? AND status IN ('confirmed', 'in_house') AND checked_out_at IS NULL", [fields.full_name, fields.phone, id]);
  } else {
    id = `G-${randomUUID().slice(0, 8).toUpperCase()}`;
    await db.run(`INSERT INTO hotel_guests (id, ${keys.join(', ')}) VALUES (?, ${keys.map(() => '?').join(', ')})`, [id, ...keys.map((k) => fields[k])]);
  }
  await audit(db, actor, 'guest_saved', id, `Guest profile ${fields.full_name} saved.`);
  return { id, message: 'Guest profile saved.' };
}

export async function addGuestDocument(db, actor, guestId, { label, fileName, mime, bytes }) {
  await ensureHotelSchema(db);
  if (!(await db.get('SELECT id FROM hotel_guests WHERE id = ?', [guestId]))) fail('Guest profile not found.', 404);
  if (!DOCUMENT_TYPES.includes(mime)) fail('Upload a JPG, PNG, WebP image or a PDF.');
  if (!bytes?.length) fail('The file is empty.');
  if (bytes.length > MAX_DOCUMENT_BYTES) fail('Files can be up to 2 MB.');
  const id = randomUUID();
  await db.run('INSERT INTO hotel_guest_documents (id, guest_id, label, file_name, mime, size_bytes, data_base64, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, guestId, text(label, 60) || 'ID document', String(fileName || 'document').slice(0, 120), mime, bytes.length, Buffer.from(bytes).toString('base64'), actor.id]);
  await audit(db, actor, 'guest_document_added', guestId, `ID document added for guest ${guestId}.`);
  return { id, message: 'Document uploaded.' };
}

export async function getGuestDocument(db, id) {
  await ensureHotelSchema(db);
  const row = await db.get('SELECT file_name, mime, data_base64 FROM hotel_guest_documents WHERE id = ?', [id]);
  if (!row) fail('Document not found.', 404);
  return { fileName: row.file_name, mime: row.mime, bytes: Buffer.from(row.data_base64, 'base64') };
}

export async function deleteGuestDocument(db, actor, id) {
  await ensureHotelSchema(db);
  const row = await db.get('SELECT guest_id FROM hotel_guest_documents WHERE id = ?', [id]);
  if (!row) fail('Document not found.', 404);
  await db.run('DELETE FROM hotel_guest_documents WHERE id = ?', [id]);
  await audit(db, actor, 'guest_document_deleted', row.guest_id, `ID document removed for guest ${row.guest_id}.`);
  return { message: 'Document removed.' };
}

async function audit(db, actor, action, entityId, message) {
  await db.run("INSERT INTO hotel_audit_events (id, property_id, actor_id, action, entity_id, details) VALUES (?, 'main', ?, ?, ?, ?)",
    [randomUUID(), actor.id, action, entityId, JSON.stringify({ message })]);
}
