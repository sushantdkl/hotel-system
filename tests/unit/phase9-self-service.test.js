import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PosDatabase } from '../../lib/db/index.js';
import { createCustomRole, deleteCustomRole, ensurePermissionCache, isPermissionAllowedSync, listRolePermissions, resolveRoleChoice, setRolePermissions } from '../../lib/permissions.js';
import { permissionRole } from '../../lib/roles.js';
import { runHotelCommand, hotelSnapshot } from '../../lib/hotel/service.js';
import { publicPrecheckin, submitPrecheckin } from '../../lib/hotel/precheckin.js';
import { getGuest } from '../../lib/hotel/guests.js';
import { enableRoomService, requireInHouse, roomServiceGuard } from '../../lib/hotel/room-service.js';
import { AuthService } from '../../lib/auth/auth.js';

const owner = { id: 1, role: 'admin', full_name: 'Owner' };
const manager = { id: 2, role: 'manager', full_name: 'Manager' };
const now = new Date('2026-10-28T04:00:00Z');

async function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase9-'));
  const db = new PosDatabase(path.join(dir, 'test.db'));
  const run = (action, actor = owner) => runHotelCommand(db, action, actor, randomUUID(), now);
  try { await fn({ db, run }); } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

test('custom role: created from a base role, edited by manager, enforced, protected', async () => fixture(async ({ db }) => {
  await listRolePermissions(db);
  const { key } = await createCustomRole(db, manager, { label: 'Bellboy', baseRole: 'receptionist' });
  await assert.rejects(createCustomRole(db, { id: 3, role: 'waiter' }, { label: 'X', baseRole: 'waiter' }), { status: 403 });
  await assert.rejects(createCustomRole(db, owner, { label: 'bellboy', baseRole: 'waiter' }), /already exists/);
  await assert.rejects(createCustomRole(db, owner, { label: 'Boss', baseRole: 'admin' }), /staff role to start from/);
  await ensurePermissionCache(db);
  assert.ok(isPermissionAllowedSync(key, 'hotel.front_desk'), 'copied from receptionist');
  // Manager may edit the custom role but not built-in roles.
  await setRolePermissions(db, [{ role: key, key: 'hotel.folios', allowed: false }], manager);
  await assert.rejects(setRolePermissions(db, [{ role: 'receptionist', key: 'hotel.folios', allowed: false }], manager), { status: 403 });
  await ensurePermissionCache(db);
  assert.equal(isPermissionAllowedSync(key, 'hotel.folios'), false);
  assert.equal(isPermissionAllowedSync('receptionist', 'hotel.folios'), true, 'base role unchanged');
  // Restaurant permissions do not apply to a hotel-based custom role.
  await assert.rejects(setRolePermissions(db, [{ role: key, key: 'bills.void', allowed: true }], owner), /No valid permission/);
  const matrix = await listRolePermissions(db);
  assert.equal(matrix.roleBase[key], 'receptionist');

  // Assign it to a user: base role decides the portal, custom role the permissions.
  const choice = await resolveRoleChoice(db, `custom:${key}`);
  assert.deepEqual(choice, { role: 'receptionist', customRole: key });
  const u = await db.run('INSERT INTO users (username, password_hash, full_name, role, custom_role) VALUES (?, ?, ?, ?, ?)', ['bell', 'x', 'Bell Boy', choice.role, choice.customRole]);
  const token = `t-${randomUUID()}`;
  await db.run("INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, '2099-01-01 00:00:00')", [u.lastInsertRowid, token]);
  const auth = new AuthService(); auth.db = db;
  const session = await auth.verifySession(token);
  assert.deepEqual([session.role, session.custom_role, permissionRole(session)], ['receptionist', key, `user:${u.lastInsertRowid}:${key}`]);
  await assert.rejects(deleteCustomRole(db, owner, key), /Move the staff/);
  await db.run('UPDATE users SET custom_role = NULL WHERE id = ?', [u.lastInsertRowid]);
  await deleteCustomRole(db, owner, key);
  assert.equal((await listRolePermissions(db)).roles.includes(key), false);
}));

test('custom role permissions gate hotel commands', async () => fixture(async ({ db, run }) => {
  await run({ type: 'room', roomId: '101', roomType: 'King', capacity: 2, floor: 1, rate: 100 });
  const { key } = await createCustomRole(db, owner, { label: 'Night auditor', baseRole: 'receptionist' });
  await setRolePermissions(db, [{ role: key, key: 'hotel.front_desk', allowed: false }], owner);
  await ensurePermissionCache(db);
  const actor = { id: 1, role: 'receptionist', custom_role: key };
  await assert.rejects(run({ type: 'book', guest: 'G', roomId: '101', start: '2026-10-28', end: '2026-10-29', guests: 1 }, actor), { status: 403 });
  await run({ type: 'book', guest: 'G', roomId: '101', start: '2026-10-28', end: '2026-10-29', guests: 1 }, { id: 1, role: 'receptionist' });
}));

test('online check-in fills the guest profile and is limited to confirmed stays', async () => fixture(async ({ db, run }) => {
  await run({ type: 'room', roomId: '101', roomType: 'King', capacity: 2, floor: 1, rate: 100 });
  const b = await run({ type: 'book', guest: 'Early Bird', phone: '9800', roomId: '101', start: '2026-10-29', end: '2026-10-31', guests: 2 });
  await run({ type: 'precheckin_link', id: b.id });
  const token = (await hotelSnapshot(db, now)).bookings[0].precheckinToken;
  assert.match(token, /^[a-f0-9]{48}$/);
  const view = await publicPrecheckin(db, token, now);
  assert.deepEqual([view.guest, view.roomType, view.arrival], ['Early Bird', 'King', '2026-10-29']);
  assert.equal(JSON.stringify(view).includes('nightly'), false, 'no prices or internal ids');
  await assert.rejects(submitPrecheckin(db, token, { name: 'Early Bird', phone: '9800', idType: 'Spaceship', idNumber: '1' }, null, now), /ID type/);
  await submitPrecheckin(db, token, { name: 'Early B. Bird', phone: '9811', email: 'eb@example.com', idType: 'Passport', idNumber: 'P99', eta: '15:30', nationality: 'Nepali' },
    { fileName: 'id.png', mime: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]) }, now);
  const stay = (await hotelSnapshot(db, now)).bookings[0];
  assert.deepEqual([stay.guest, stay.eta, Boolean(stay.precheckinAt)], ['Early B. Bird', '15:30', true]);
  const guest = await getGuest(db, stay.guestId);
  assert.deepEqual([guest.idType, guest.idNumber, guest.documents.length], ['Passport', 'P99', 1]);
  await assert.rejects(publicPrecheckin(db, 'f'.repeat(48), now), { status: 404 });
  await run({ type: 'cancel', id: b.id });
  await assert.rejects(publicPrecheckin(db, token, now), /expired/);
}));

test('room-service QR tables accept orders only for an in-house guest', async () => fixture(async ({ db, run }) => {
  await run({ type: 'room', roomId: '101', roomType: 'King', capacity: 2, floor: 1, rate: 100 });
  const result = await enableRoomService(db);
  assert.match(result.message, /1 room-service QR table/);
  assert.match((await enableRoomService(db)).message, /^0 room-service/, 'idempotent');
  const table = await db.get("SELECT id, table_number, qr_token FROM tables WHERE table_type = 'room_service'");
  assert.equal(table.table_number, 'Room 101');
  assert.ok(table.qr_token);
  let guard = await roomServiceGuard(db, table.id);
  assert.throws(() => requireInHouse(guard), /checked-in guests/);
  const b = await run({ type: 'book', guest: 'Hungry', roomId: '101', start: '2026-10-28', end: '2026-10-29', guests: 1 });
  await run({ type: 'checkin', id: b.id });
  guard = await roomServiceGuard(db, table.id);
  assert.equal(guard.stay.guest_name, 'Hungry');
  requireInHouse(guard);
  const normal = await db.get("SELECT id FROM tables WHERE table_type <> 'room_service' OR table_type IS NULL LIMIT 1");
  if (normal) assert.equal(await roomServiceGuard(db, normal.id), null, 'restaurant tables unaffected');
}));
