/**
 * Laundry orders and minibar consumption.
 *
 * Laundry: Collected -> Washing -> Ironing -> Ready -> Delivered (or Cancelled).
 * The folio charge (LAUNDRY, 4041) is posted once, when the order is delivered;
 * the order keeps the folio row id, so a retry or a second "delivered" click
 * cannot post twice.
 *
 * Minibar: catalog items may be linked to an inventory item. Consumption posts
 * the folio charge (MINIBAR, 4042) and the stock movement (hotel_consumption)
 * in the same transaction, keyed by the request so neither can be duplicated.
 */
import { randomUUID } from 'node:crypto';
import { applyStockChange } from '../inventory-ledger.js';
import { postCharge, postingDay } from './folios.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export const LAUNDRY_FLOW = { collected: ['washing', 'ready', 'cancelled'], washing: ['ironing', 'ready'], ironing: ['ready'], ready: ['delivered'], delivered: [], cancelled: [] };

async function inHouseByRoom(tx, roomNumber) {
  const stay = await tx.get(`SELECT b.*, r.room_number FROM hotel_reservations b JOIN hotel_rooms r ON r.id = b.room_id
    WHERE r.property_id = 'main' AND r.room_number = ? AND b.status = 'in_house' AND b.checked_out_at IS NULL LIMIT 1`, [roomNumber]);
  if (!stay) fail(`Room ${roomNumber} has no in-house guest.`, 409);
  return stay;
}

export async function createLaundry(tx, action, actor) {
  const stay = await inHouseByRoom(tx, action.roomId);
  if (!action.items) fail('List the laundry items.');
  if (!(Number.isInteger(action.pieces) && action.pieces >= 1 && action.pieces <= 500)) fail('Enter the number of pieces (1–500).');
  if (!(action.amountCents >= 0)) fail('Enter the laundry price.');
  const id = `LD-${randomUUID().slice(0, 8).toUpperCase()}`;
  await tx.run('INSERT INTO hotel_laundry_orders (id, reservation_id, room_number, items, pieces, amount_cents, express, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, stay.id, stay.room_number, action.items, action.pieces, action.amountCents, action.express ? 1 : 0, action.notes || '', actor.id]);
  return { id, message: `Laundry ${id} collected from room ${stay.room_number}.` };
}

export async function updateLaundry(tx, action, actor, today) {
  const order = await tx.get('SELECT * FROM hotel_laundry_orders WHERE id = ?', [action.id]);
  if (!order) fail('Laundry order not found.', 404);
  if (!(LAUNDRY_FLOW[order.status] || []).includes(action.status)) fail(`A ${order.status} order cannot move to ${action.status}.`, 409);
  let folioId = order.folio_entry_id;
  if (action.status === 'delivered' && !folioId && Number(order.amount_cents) > 0) {
    const booking = await tx.get('SELECT b.*, r.room_number FROM hotel_reservations b JOIN hotel_rooms r ON r.id = b.room_id WHERE b.id = ?', [order.reservation_id]);
    if (booking.status !== 'in_house' || booking.checked_out_at) fail('The guest has checked out. Settle this laundry with the guest directly or cancel it.', 409);
    const day = await postingDay(tx, today);
    const result = await postCharge(tx, { booking, actor, day, today, sourceType: 'LAUNDRY', sourceId: order.id, description: `Laundry ${order.id} · ${order.pieces} pc${order.express ? ' · express' : ''}`, netCents: Number(order.amount_cents), key: `laundry:${order.id}` });
    folioId = result.id;
  }
  await tx.run('UPDATE hotel_laundry_orders SET status = ?, folio_entry_id = ?, updated_at = CURRENT_TIMESTAMP, delivered_at = CASE WHEN ? = \'delivered\' THEN CURRENT_TIMESTAMP ELSE delivered_at END WHERE id = ?', [action.status, folioId, action.status, order.id]);
  return { id: order.id, message: action.status === 'delivered' ? `Laundry ${order.id} delivered and charged to the folio.` : `Laundry ${order.id}: ${action.status}.` };
}

export async function listLaundry(db) {
  const rows = await db.all(`SELECT l.*, b.guest_name FROM hotel_laundry_orders l JOIN hotel_reservations b ON b.id = l.reservation_id
    WHERE l.status NOT IN ('delivered', 'cancelled') OR l.updated_at >= ? ORDER BY l.created_at DESC LIMIT 200`, [new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10)]);
  return rows.map((l) => ({ id: l.id, stayId: l.reservation_id, roomId: l.room_number, guest: l.guest_name, items: l.items, pieces: Number(l.pieces), amount: Number(l.amount_cents) / 100, express: Boolean(Number(l.express)), status: l.status, folioEntryId: l.folio_entry_id ? Number(l.folio_entry_id) : null, createdAt: l.created_at }));
}

export async function saveMinibarItem(tx, action) {
  if (!action.name) fail('Enter the item name.');
  if (!(action.priceCents >= 0)) fail('Enter a price.');
  if (action.inventoryItemId && !(await tx.get('SELECT id FROM inventory_items WHERE id = ?', [action.inventoryItemId]))) fail('Inventory item not found.', 404);
  const existing = await tx.get('SELECT id FROM hotel_minibar_items WHERE LOWER(name) = LOWER(?)', [action.name]);
  const id = existing?.id || randomUUID();
  if (existing) await tx.run('UPDATE hotel_minibar_items SET price_cents = ?, inventory_item_id = ?, par_level = ?, active = ? WHERE id = ?', [action.priceCents, action.inventoryItemId || null, action.parLevel ?? 2, action.active === false ? 0 : 1, id]);
  else await tx.run('INSERT INTO hotel_minibar_items (id, name, price_cents, inventory_item_id, par_level) VALUES (?, ?, ?, ?, ?)', [id, action.name, action.priceCents, action.inventoryItemId || null, action.parLevel ?? 2]);
  return { id, message: `Minibar item ${action.name} saved.` };
}

export async function listMinibarItems(db) {
  const rows = await db.all(`SELECT m.*, i.quantity AS stock, COALESCE(i.item_name, i.name) AS inventory_name FROM hotel_minibar_items m
    LEFT JOIN inventory_items i ON i.id = m.inventory_item_id WHERE m.active = 1 ORDER BY m.name`).catch(() => db.all('SELECT * FROM hotel_minibar_items WHERE active = 1 ORDER BY name'));
  return rows.map((m) => ({ id: m.id, name: m.name, price: Number(m.price_cents) / 100, inventoryItemId: m.inventory_item_id ? Number(m.inventory_item_id) : null, inventoryName: m.inventory_name || null, stock: m.stock == null ? null : Number(m.stock), parLevel: Number(m.par_level) }));
}

/**
 * Consumption from the catalog (itemId) or free text (item + unitPrice, the
 * legacy form). Folio charge + stock movement in the caller's transaction.
 */
export async function consumeMinibar(tx, action, actor, requestKey, today) {
  const stay = await inHouseByRoom(tx, action.roomId);
  if (!(Number.isInteger(action.quantity) && action.quantity >= 1 && action.quantity <= 50)) fail('Enter a quantity (1–50).');
  let name = action.item; let unit = Math.round(Number(action.unitPrice) * 100); let inventoryId = null;
  if (action.itemId) {
    const item = await tx.get('SELECT * FROM hotel_minibar_items WHERE id = ? AND active = 1', [action.itemId]);
    if (!item) fail('Minibar item not found.', 404);
    name = item.name; unit = Number(item.price_cents); inventoryId = item.inventory_item_id ? Number(item.inventory_item_id) : null;
  }
  if (!name || !(unit > 0) || unit > 10000000) fail('Enter the item, a quantity (1-50) and a unit price.');
  const day = await postingDay(tx, today);
  const result = await postCharge(tx, { booking: stay, actor, day, today, sourceType: 'MINIBAR', sourceId: action.itemId || null, description: `Minibar · ${name} x${action.quantity}`, netCents: unit * action.quantity, quantity: action.quantity, unitCents: unit, key: `minibar:${requestKey}` });
  let stock = null;
  if (inventoryId && !result.duplicate) {
    stock = await applyStockChange(tx, { inventory_item_id: inventoryId, quantity: -action.quantity, units: 'consumption', change_type: 'hotel_consumption', performed_by: actor.id, reason: `Minibar room ${stay.room_number} (${stay.id})`, reference_id: `folio:${result.id}`, business_day_id: day.id });
  }
  return { id: stay.id, message: `Minibar charge posted to room ${stay.room_number}${stock?.warning ? `. ${stock.warning}` : stock ? '; stock updated' : ''}.` };
}
