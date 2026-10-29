/**
 * Restaurant <-> hotel links. The restaurant keeps owning its orders, bills and
 * table reservations; the hotel only records which stay they belong to
 * (orders.hotel_stay_id, reservations.hotel_stay_id) so staff see an
 * "In-house guest · Room 203" badge and the guest profile shows the spend.
 * Linking never forces room billing: the guest can still pay cash/QR/card.
 */
import { randomUUID } from 'node:crypto';
import { ensureHotelSchema } from './schema.js';
import { folioLinkForBill } from './room-charges.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export const ROOM_SERVICE_FLOW = { ordered: ['preparing', 'ready', 'cancelled'], preparing: ['ready'], ready: ['out_for_delivery'], out_for_delivery: ['delivered'], delivered: ['tray_cleared'], tray_cleared: [], cancelled: [] };

async function inHouseStay(db, stayId) {
  const stay = await db.get(`SELECT b.id, b.guest_name, b.meal_plan, b.departure_date, r.room_number FROM hotel_reservations b JOIN hotel_rooms r ON r.id = b.room_id
    WHERE b.id = ? AND b.status IN ('in_house', 'confirmed') AND b.checked_out_at IS NULL`, [stayId]);
  if (!stay) fail('Choose an in-house (or arriving) hotel guest.', 404);
  return stay;
}

async function audit(db, actor, action, entityId, message) {
  await db.run("INSERT INTO hotel_audit_events (id, property_id, actor_id, action, entity_id, details) VALUES (?, 'main', ?, ?, ?, ?)", [randomUUID(), actor.id, action, entityId, JSON.stringify({ message })]);
}

export async function linkOrderToStay(db, actor, { orderId, stayId }) {
  await ensureHotelSchema(db);
  const order = await db.get('SELECT id, order_number, status FROM orders WHERE id = ?', [Number(orderId)]);
  if (!order) fail('Order not found.', 404);
  if (!stayId) {
    await db.run('UPDATE orders SET hotel_stay_id = NULL WHERE id = ?', [order.id]);
    return { message: `Order ${order.order_number} is no longer linked to a hotel guest.` };
  }
  const stay = await inHouseStay(db, stayId);
  await db.run('UPDATE orders SET hotel_stay_id = ? WHERE id = ?', [stay.id, order.id]);
  await audit(db, actor, 'order_linked', stay.id, `Order ${order.order_number} linked to room ${stay.room_number} (${stay.guest_name}).`);
  return { message: `Order ${order.order_number} linked to room ${stay.room_number} · ${stay.guest_name}.`, stay: { id: stay.id, room: stay.room_number, guest: stay.guest_name } };
}

export async function linkTableReservationToStay(db, actor, { reservationId, stayId }) {
  await ensureHotelSchema(db);
  const reservation = await db.get('SELECT id, name FROM reservations WHERE id = ?', [Number(reservationId)]);
  if (!reservation) fail('Table reservation not found.', 404);
  if (!stayId) {
    await db.run('UPDATE reservations SET hotel_stay_id = NULL WHERE id = ?', [reservation.id]);
    return { message: 'Table reservation unlinked from the hotel stay.' };
  }
  const stay = await inHouseStay(db, stayId);
  await db.run('UPDATE reservations SET hotel_stay_id = ? WHERE id = ?', [stay.id, reservation.id]);
  await audit(db, actor, 'table_reservation_linked', stay.id, `Table reservation #${reservation.id} (${reservation.name}) linked to room ${stay.room_number}.`);
  return { message: `Table reservation linked to room ${stay.room_number} · ${stay.guest_name}.` };
}

/** Badge data for orders (by id) and table reservations (by id). */
export async function stayBadges(db, { orderIds = [], reservationIds = [] }) {
  await ensureHotelSchema(db);
  const badge = (row) => ({ stayId: row.stay_id, room: row.room_number, guest: row.guest_name, meal: row.meal_plan, inHouse: row.status === 'in_house' && !row.checked_out_at });
  const out = { orders: {}, reservations: {} };
  const ids = orderIds.map(Number).filter(Boolean).slice(0, 200);
  if (ids.length) {
    const rows = await db.all(`SELECT o.id, b.id AS stay_id, b.guest_name, b.meal_plan, b.status, b.checked_out_at, r.room_number FROM orders o
      JOIN hotel_reservations b ON b.id = o.hotel_stay_id JOIN hotel_rooms r ON r.id = b.room_id WHERE o.id IN (${ids.map(() => '?').join(',')})`, ids);
    for (const row of rows) out.orders[row.id] = badge(row);
  }
  const rids = reservationIds.map(Number).filter(Boolean).slice(0, 200);
  if (rids.length) {
    const rows = await db.all(`SELECT x.id, b.id AS stay_id, b.guest_name, b.meal_plan, b.status, b.checked_out_at, r.room_number FROM reservations x
      JOIN hotel_reservations b ON b.id = x.hotel_stay_id JOIN hotel_rooms r ON r.id = b.room_id WHERE x.id IN (${rids.map(() => '?').join(',')})`, rids);
    for (const row of rows) out.reservations[row.id] = badge(row);
  }
  return out;
}

/** Room-service delivery tracking on a restaurant order (same kitchen, KOT and bill). */
export async function updateRoomService(db, actor, { orderId, status, requestedTime }) {
  await ensureHotelSchema(db);
  const order = await db.get('SELECT o.id, o.order_number, o.room_service_status, o.hotel_stay_id, o.order_type, t.table_type, t.hotel_room_id FROM orders o LEFT JOIN tables t ON t.id = o.table_id WHERE o.id = ?', [Number(orderId)]);
  if (!order) fail('Order not found.', 404);
  const isRoomService = order.order_type === 'room_service' || order.table_type === 'room_service' || order.hotel_room_id;
  if (!isRoomService) fail('This is not a room-service order.', 409);
  if (requestedTime !== undefined) {
    if (requestedTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(requestedTime)) fail('Enter the requested time as HH:MM.');
    await db.run('UPDATE orders SET room_service_requested_time = ? WHERE id = ?', [requestedTime || null, order.id]);
  }
  if (status) {
    const current = order.room_service_status || 'ordered';
    if (!(ROOM_SERVICE_FLOW[current] || []).includes(status)) fail(`Room service cannot go from ${current.replaceAll('_', ' ')} to ${status.replaceAll('_', ' ')}.`, 409);
    await db.run(`UPDATE orders SET room_service_status = ?, room_service_delivered_by = CASE WHEN ? = 'delivered' THEN ? ELSE room_service_delivered_by END,
      room_service_delivered_at = CASE WHEN ? = 'delivered' THEN CURRENT_TIMESTAMP ELSE room_service_delivered_at END WHERE id = ?`, [status, status, actor.id, status, order.id]);
    if (!order.hotel_stay_id && order.hotel_room_id) {
      const stay = await db.get("SELECT id FROM hotel_reservations WHERE room_id = ? AND status = 'in_house' AND checked_out_at IS NULL LIMIT 1", [order.hotel_room_id]);
      if (stay) await db.run('UPDATE orders SET hotel_stay_id = ? WHERE id = ?', [stay.id, order.id]);
    }
  }
  return { message: `Order ${order.order_number}: ${String(status || 'updated').replaceAll('_', ' ')}.` };
}

export async function listRoomServiceOrders(db) {
  await ensureHotelSchema(db);
  const rows = await db.all(`SELECT o.id, o.order_number, o.status, o.room_service_status, o.room_service_requested_time, o.room_service_delivered_at, o.created_at, o.notes,
      t.table_number, r.room_number, b.guest_name, b.id AS stay_id, u.full_name AS delivered_by
    FROM orders o LEFT JOIN tables t ON t.id = o.table_id
    LEFT JOIN hotel_reservations b ON b.id = o.hotel_stay_id LEFT JOIN hotel_rooms r ON r.id = COALESCE(t.hotel_room_id, b.room_id)
    LEFT JOIN users u ON u.id = o.room_service_delivered_by
    WHERE (o.order_type = 'room_service' OR t.table_type = 'room_service' OR t.hotel_room_id IS NOT NULL)
      AND (COALESCE(o.room_service_status, 'ordered') NOT IN ('tray_cleared', 'cancelled') OR o.created_at >= ?)
    ORDER BY o.created_at DESC LIMIT 100`, [new Date(Date.now() - 86400000).toISOString().slice(0, 19).replace('T', ' ')]);
  return rows.map((o) => ({ id: Number(o.id), number: o.order_number, orderStatus: o.status, status: o.room_service_status || 'ordered', requestedTime: o.room_service_requested_time, deliveredAt: o.room_service_delivered_at, deliveredBy: o.delivered_by, createdAt: o.created_at, room: o.room_number || String(o.table_number || '').replace(/^Room /, ''), guest: o.guest_name, stayId: o.stay_id, notes: o.notes }));
}

/** Restaurant spend linked to a stay (orders linked, bills charged to room, package use). */
export async function staySpend(db, stayIds) {
  const ids = [].concat(stayIds).filter(Boolean);
  if (!ids.length) return [];
  const marks = ids.map(() => '?').join(',');
  return db.all(`SELECT bl.id AS bill_id, bl.bill_number, bl.grand_total, bl.status, bl.created_at, o.id AS order_id, o.order_number, o.hotel_stay_id AS stay_id,
      CASE WHEN o.order_type = 'room_service' OR t.table_type = 'room_service' OR t.hotel_room_id IS NOT NULL THEN 'room_service' ELSE 'restaurant' END AS outlet
    FROM orders o JOIN bills bl ON bl.order_id = o.id LEFT JOIN tables t ON t.id = o.table_id
    WHERE o.hotel_stay_id IN (${marks}) AND COALESCE(bl.status, '') <> 'voided' ORDER BY bl.created_at`, ids);
}

export { folioLinkForBill };
