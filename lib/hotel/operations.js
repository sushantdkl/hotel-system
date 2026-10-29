/**
 * Housekeeping dispatch, minibar, and maintenance tickets.
 *
 * Every cleaning task (checkout, room move, readiness change) goes through
 * createCleaningTask: it is auto-assigned to a clocked-in housekeeper (fewest
 * open tasks, then one already working that floor, then lowest id) and marked
 * High priority when a guest arrives in that room today. The assignee gets an
 * in-app notification (and WhatsApp/SMS if configured, lib/notifications.js).
 */
import { randomUUID } from 'node:crypto';
import { notify, usersWithRole } from '../notifications.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

/** Pick an on-shift housekeeper for a room on `floor`. Pure on the given rows. */
export function pickHousekeeper(candidates, floor) {
  return [...candidates].sort((a, b) => a.open - b.open || Number(b.floors.includes(floor)) - Number(a.floors.includes(floor)) || a.id - b.id)[0] || null;
}

async function onShiftHousekeepers(tx) {
  const staff = await usersWithRole(tx, 'housekeeping', { clockedIn: true });
  const out = [];
  for (const s of staff) {
    const open = await tx.all(`SELECT r.floor FROM hotel_housekeeping_tasks t JOIN hotel_rooms r ON r.id = t.room_id
      WHERE t.assigned_to = ? AND t.status <> 'ready'`, [s.id]);
    out.push({ id: Number(s.id), name: s.full_name, open: open.length, floors: open.map((row) => Number(row.floor)) });
  }
  return out;
}

/**
 * One open task per room (unique index). A turnover replaces an open stayover
 * task (closed as done); a second turnover request updates the open task.
 * task_type: checkout | move | readiness | stayover.
 */
export async function createCleaningTask(tx, { roomId, reservationId = null, status = 'dirty', note, actorId, today, taskType = 'readiness' }) {
  const room = await tx.get('SELECT id, room_number, floor FROM hotel_rooms WHERE id = ?', [roomId]);
  const open = await tx.get("SELECT id, task_type FROM hotel_housekeeping_tasks WHERE room_id = ? AND status <> 'ready'", [roomId]);
  if (open && open.task_type === 'stayover' && taskType !== 'stayover') {
    await tx.run("UPDATE hotel_housekeeping_tasks SET status = 'ready', completed_at = CURRENT_TIMESTAMP, note = note || ' · closed by turnover', version = version + 1 WHERE id = ?", [open.id]);
  } else if (open) {
    await tx.run('UPDATE hotel_housekeeping_tasks SET note = ?, reservation_id = COALESCE(reservation_id, ?), version = version + 1, updated_by = ? WHERE id = ?', [note, reservationId, actorId, open.id]);
    return { id: open.id, assignee: null, priority: null, existing: true };
  }
  const arrival = await tx.get("SELECT id FROM hotel_reservations WHERE room_id = ? AND status = 'confirmed' AND arrival_date = ? LIMIT 1", [roomId, today]);
  const priority = arrival ? 'High' : 'Normal';
  const assignee = pickHousekeeper(await onShiftHousekeepers(tx), Number(room.floor));
  const id = randomUUID();
  const fullNote = arrival ? `URGENT · next arrival today · ${note}` : note;
  // reservation_id is unique on tasks: only the checkout task carries it.
  const taskReservation = reservationId && !(await tx.get('SELECT id FROM hotel_housekeeping_tasks WHERE reservation_id = ?', [reservationId])) ? reservationId : null;
  await tx.run('INSERT INTO hotel_housekeeping_tasks (id, room_id, reservation_id, status, priority, note, updated_by, assigned_to, task_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, roomId, taskReservation, status, priority, fullNote, actorId, assignee?.id || null, taskType]);
  if (assignee) await notify(tx, assignee.id, { title: `${arrival ? 'URGENT: ' : ''}${taskType === 'stayover' ? 'Service' : 'Clean'} room ${room.room_number}`, body: fullNote, link: '/admin/hotel/housekeeping' });
  return { id, assignee, priority };
}

/** Stayover service for an occupied room (does not change the sellable status). */
export async function requestStayover(tx, action, actor, today) {
  const room = await tx.get("SELECT * FROM hotel_rooms WHERE property_id = 'main' AND room_number = ?", [action.roomId]);
  if (!room) fail('Room not found.', 404);
  const stay = await tx.get("SELECT id FROM hotel_reservations WHERE room_id = ? AND status = 'in_house' AND checked_out_at IS NULL LIMIT 1", [room.id]);
  if (!stay) fail('Stayover service is for occupied rooms. Use the turnover board for vacant rooms.', 409);
  if (room.hk_flag === 'dnd') fail(`Room ${room.room_number} is on Do Not Disturb.`, 409);
  const task = await createCleaningTask(tx, { roomId: room.id, note: action.note || 'Stayover service', actorId: actor.id, today, taskType: 'stayover' });
  return { id: task.id, message: `Stayover service requested for room ${room.room_number}.` };
}

/** Occupied-room flags: Do Not Disturb or guest-requested pickup. */
export async function setRoomFlag(tx, action, actor, today) {
  if (!['', 'dnd', 'pickup'].includes(action.flag)) fail('Choose Do Not Disturb, Pickup or clear.');
  const room = await tx.get("SELECT * FROM hotel_rooms WHERE property_id = 'main' AND room_number = ?", [action.roomId]);
  if (!room) fail('Room not found.', 404);
  await tx.run('UPDATE hotel_rooms SET hk_flag = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [action.flag, room.id]);
  if (action.flag === 'pickup') await requestStayover(tx, { roomId: room.room_number, note: 'Guest requested pickup service' }, actor, today).catch(() => null);
  return { id: room.id, message: `Room ${room.room_number}: ${action.flag === 'dnd' ? 'Do Not Disturb' : action.flag === 'pickup' ? 'pickup requested' : 'flag cleared'}.` };
}

export async function assignTask(tx, action, actor) {
  const task = await tx.get("SELECT t.id, t.status, r.room_number, t.note FROM hotel_housekeeping_tasks t JOIN hotel_rooms r ON r.id = t.room_id WHERE t.id = ?", [action.id]);
  if (!task) fail('Cleaning task not found.', 404);
  if (task.status === 'ready') fail('This task is already complete.', 409);
  let userId = null;
  if (action.userId) {
    const user = await tx.get("SELECT id, full_name FROM users WHERE id = ? AND role = 'housekeeping' AND COALESCE(is_active, 1) = 1", [Number(action.userId)]);
    if (!user) fail('Choose an active housekeeping staff member.');
    userId = Number(user.id);
    await notify(tx, userId, { title: `Clean room ${task.room_number}`, body: task.note, link: '/admin/hotel/housekeeping' });
  }
  await tx.run('UPDATE hotel_housekeeping_tasks SET assigned_to = ?, version = version + 1, updated_by = ? WHERE id = ?', [userId, actor.id, task.id]);
  return { id: task.id, message: userId ? `Room ${task.room_number} assigned.` : `Room ${task.room_number} unassigned.` };
}

/** Maintenance ticket from housekeeping / front desk; optionally takes the room out of order. */
export async function reportIssue(tx, action, actor) {
  if (!action.title) fail('Describe the issue.');
  if (!['low', 'normal', 'urgent'].includes(action.priority)) fail('Choose a priority.');
  const room = await tx.get("SELECT * FROM hotel_rooms WHERE property_id = 'main' AND room_number = ?", [action.roomId]);
  if (!room) fail('Room not found.', 404);
  let blocked = 0;
  const blockKind = action.blockKind === 'out_of_service' ? 'out_of_service' : 'out_of_order';
  if (action.blockRoom) {
    const occupied = await tx.get("SELECT id FROM hotel_reservations WHERE room_id = ? AND status = 'in_house' AND checked_out_at IS NULL LIMIT 1", [room.id]);
    if (occupied) fail('The room is occupied. Report without taking it out of order, or move the guest first.', 409);
    if (!room.blocked) {
      const future = await tx.get("SELECT id FROM hotel_reservations WHERE room_id = ? AND status = 'confirmed' AND arrival_date <= ? AND departure_date > ? LIMIT 1", [room.id, action.until || '9999-12-31', action.today || '0000-01-01']);
      if (future) fail(`Room ${room.room_number} has reservation ${future.id}. Move it to another room before taking this room out of order.`, 409);
      await tx.run('UPDATE hotel_rooms SET blocked = 1, block_kind = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [blockKind, room.id]);
      blocked = 1;
    }
  }
  const id = `MT-${randomUUID().slice(0, 8).toUpperCase()}`;
  await tx.run('INSERT INTO hotel_maintenance_tickets (id, room_id, title, description, priority, blocked_room, reported_by, block_kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, room.id, action.title, action.description || '', action.priority, blocked, actor.id, blockKind]);
  for (const tech of await usersWithRole(tx, 'maintenance')) {
    await notify(tx, tech.id, { title: `${action.priority === 'urgent' ? 'URGENT: ' : ''}Room ${room.room_number}: ${action.title}`, body: action.description || 'New maintenance ticket.', link: '/admin/hotel/maintenance' });
  }
  return { id, message: `Ticket ${id} opened for room ${room.room_number}${blocked ? ' and the room is now out of order' : ''}.` };
}

// Maintenance workflow. Resolved is not closed: the room returns to sale only
// after housekeeping inspects it (released rooms go to `inspection`).
export const TICKET_FLOW = {
  open: ['assigned', 'in_progress', 'resolved'],
  assigned: ['in_progress', 'waiting_part', 'resolved'],
  in_progress: ['waiting_part', 'resolved'],
  waiting_part: ['in_progress', 'resolved'],
  resolved: ['closed', 'in_progress'],
  closed: [],
};

export async function updateTicket(tx, action, actor, today = null) {
  const ticket = await tx.get('SELECT t.*, r.room_number, r.cleaning_status FROM hotel_maintenance_tickets t JOIN hotel_rooms r ON r.id = t.room_id WHERE t.id = ?', [action.id]);
  if (!ticket) fail('Ticket not found.', 404);
  if (!(TICKET_FLOW[ticket.status] || []).includes(action.status)) fail(ticket.status === 'closed' ? 'This ticket is closed.' : `A ${ticket.status.replace('_', ' ')} ticket cannot move to ${String(action.status).replace('_', ' ')}.`, 409);
  let assignee = null;
  if (action.status === 'assigned') {
    if (!action.userId) fail('Choose the technician.');
    assignee = await tx.get("SELECT id, full_name FROM users WHERE id = ? AND COALESCE(is_active, 1) = 1", [Number(action.userId)]);
    if (!assignee) fail('Technician not found.', 404);
    await notify(tx, assignee.id, { title: `Ticket ${ticket.id}: room ${ticket.room_number}`, body: ticket.title, link: '/admin/hotel/maintenance' });
  }
  await tx.run(`UPDATE hotel_maintenance_tickets SET status = ?, assigned_to = COALESCE(?, assigned_to, ?), resolution_note = COALESCE(?, resolution_note),
    resolved_at = CASE WHEN ? = 'resolved' THEN CURRENT_TIMESTAMP WHEN ? = 'closed' THEN resolved_at ELSE NULL END,
    closed_at = CASE WHEN ? = 'closed' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id = ?`,
  [action.status, assignee?.id || null, action.status === 'assigned' ? null : actor.id, action.note || null, action.status, action.status, action.status, ticket.id]);
  let released = false;
  if (action.status === 'resolved' && ticket.blocked_room) {
    // Release the room only if no other open ticket still keeps it out of order,
    // and send it to inspection rather than straight back on sale.
    const other = await tx.get("SELECT id FROM hotel_maintenance_tickets WHERE room_id = ? AND id <> ? AND status NOT IN ('resolved', 'closed') AND blocked_room = 1 LIMIT 1", [ticket.room_id, ticket.id]);
    if (!other) {
      await tx.run("UPDATE hotel_rooms SET blocked = 0, cleaning_status = CASE WHEN cleaning_status = 'ready' THEN 'inspection' ELSE cleaning_status END, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [ticket.room_id]);
      if (ticket.cleaning_status === 'ready') await createCleaningTask(tx, { roomId: ticket.room_id, status: 'inspection', note: `Inspect after repair: ${ticket.title}`, actorId: actor.id, today: today || new Date().toISOString().slice(0, 10), taskType: 'readiness' });
      released = true;
    }
  }
  const labels = { assigned: `Assigned to ${assignee?.full_name}.`, in_progress: 'Work started.', waiting_part: 'Waiting for a part.', resolved: `Ticket resolved${released ? `; room ${ticket.room_number} goes to housekeeping inspection before sale` : ''}.`, closed: 'Ticket closed.' };
  return { id: ticket.id, message: labels[action.status] };
}

export async function listTickets(db) {
  const rows = await db.all(`SELECT t.id, t.title, t.description, t.priority, t.status, t.blocked_room, t.resolution_note, t.created_at, t.resolved_at,
      t.photo_mime IS NOT NULL AS has_photo, r.room_number, rep.full_name AS reported_by_name, asg.full_name AS assigned_to_name
    FROM hotel_maintenance_tickets t JOIN hotel_rooms r ON r.id = t.room_id
    LEFT JOIN users rep ON rep.id = t.reported_by LEFT JOIN users asg ON asg.id = t.assigned_to
    ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'assigned' THEN 1 WHEN 'in_progress' THEN 1 WHEN 'waiting_part' THEN 2 WHEN 'resolved' THEN 3 ELSE 4 END, CASE t.priority WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, t.created_at DESC LIMIT 200`);
  return rows.map((t) => ({ id: t.id, roomId: t.room_number, title: t.title, description: t.description, priority: t.priority, status: t.status, blockedRoom: Boolean(Number(t.blocked_room)), resolution: t.resolution_note, createdAt: t.created_at, resolvedAt: t.resolved_at, hasPhoto: Boolean(Number(t.has_photo)), reportedBy: t.reported_by_name, assignedTo: t.assigned_to_name }));
}

export async function saveTicketPhoto(db, id, { mime, bytes }) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) fail('Upload a JPG, PNG or WebP photo.');
  if (!bytes?.length || bytes.length > MAX_PHOTO_BYTES) fail('Photos can be up to 2 MB.');
  const result = await db.run('UPDATE hotel_maintenance_tickets SET photo_mime = ?, photo_base64 = ? WHERE id = ?', [mime, Buffer.from(bytes).toString('base64'), id]);
  if (!result.changes) fail('Ticket not found.', 404);
  return { message: 'Photo attached.' };
}

export async function ticketPhoto(db, id) {
  const row = await db.get('SELECT photo_mime, photo_base64 FROM hotel_maintenance_tickets WHERE id = ?', [id]);
  if (!row?.photo_base64) fail('No photo.', 404);
  return { mime: row.photo_mime, bytes: Buffer.from(row.photo_base64, 'base64') };
}
