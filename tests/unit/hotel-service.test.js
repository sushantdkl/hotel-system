import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PosDatabase } from '../../lib/db/index.js';
import { hotelSnapshot, runHotelCommand } from '../../lib/hotel/service.js';

const now = new Date('2026-10-27T10:00:00Z');
const actor = { id: 1, role: 'admin' };
const room = { type: 'room', roomId: '101', floor: 4, roomType: 'Deluxe', capacity: 2, rate: 5500.25 };
const booking = { type: 'book', roomId: '101', guest: 'Test guest', start: '2026-10-27', end: '2026-10-29', guests: 2 };
async function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-service-'));
  const file = path.join(dir, 'test.db');
  const db = new PosDatabase(file);
  const command = (action, key = randomUUID(), date = now) => runHotelCommand(db, action, actor, key, date);
  try { await fn(db, command); }
  finally { db.close(); for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(file + suffix)) fs.unlinkSync(file + suffix); fs.rmdirSync(dir); }
}

test('hotel starts empty, rooms and reservations survive reconnection, and rates are snapshotted', async () => fixture(async (db, command) => {
  assert.equal((await hotelSnapshot(db, now)).rooms.length, 0);
  await command(room);
  const created = await command(booking);
  const first = await hotelSnapshot(db, now);
  assert.equal(first.rooms[0].floor, 4);
  assert.equal(first.bookings[0].rate, 5500.25);
  assert.equal(first.bookings[0].meal, 'Room only');
  await command({ ...room, type: 'room_edit', rate: 7000, version: 1 });
  const second = await hotelSnapshot(db, now);
  assert.equal(second.rooms[0].rate, 7000);
  assert.equal(second.bookings[0].rate, 5500.25);
  const file = db.db.name;
  const reconnected = new PosDatabase(file);
  try { assert.equal((await hotelSnapshot(reconnected, now)).bookings[0].id, created.id); }
  finally { reconnected.close(); }
}));

test('two concurrent attempts cannot book the same inventory; retries are exactly once', async () => fixture(async (db, command) => {
  await command(room);
  const key = randomUUID();
  const results = await Promise.allSettled([command(booking, key), command({ ...booking, guest: 'Other guest' })]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.status, 409);
  const retry = await command(booking, key);
  assert.equal(retry.id, results[0].value.id);
  await assert.rejects(command({ ...booking, guest: 'Changed guest' }, key), { status: 409 });
  assert.equal((await hotelSnapshot(db, now)).bookings.length, 1);
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM hotel_audit_events WHERE action = 'book'")).n, 1);
  await command({ ...booking, start: '2026-10-29', end: '2026-10-30' });
  assert.equal((await hotelSnapshot(db, now)).bookings.length, 2);
}));

test('capacity, real dates, ownership and room version are validated', async () => fixture(async (db, command) => {
  await command(room);
  await assert.rejects(command({ ...booking, guests: 3 }), /up to 2/);
  await assert.rejects(command({ ...booking, start: '2026-02-31' }), /valid arrival/);
  await assert.rejects(command({ ...room, roomId: '101' }), { status: 409 });
  await assert.rejects(runHotelCommand(db, booking, { id: 2, role: 'waiter' }, randomUUID(), now), { status: 403 });
  await assert.rejects(command({ type: 'room_status', roomId: '101', version: 0, cleaning: 'dirty', blocked: 0 }), { status: 409 });
  await command({ type: 'room_status', roomId: '101', version: 1, cleaning: 'dirty', blocked: 0 });
  await assert.rejects(command({ type: 'room_status', roomId: '101', version: 2, cleaning: 'ready', blocked: 0 }), /sequence/);
}));

test('cancellation frees inventory, check-in enforces readiness and overdue stays keep the room', async () => fixture(async (db, command) => {
  await command(room);
  const cancelled = await command(booking);
  await command({ type: 'cancel', id: cancelled.id });
  const created = await command(booking);
  await command({ type: 'room_status', roomId: '101', version: 1, cleaning: 'dirty', blocked: 0 });
  await assert.rejects(command({ type: 'checkin', id: created.id }), /ready/);
  for (const [version, cleaning] of [[2, 'cleaning'], [3, 'inspection'], [4, 'ready']]) await command({ type: 'room_status', roomId: '101', version, cleaning, blocked: 0 });
  const request = randomUUID();
  await command({ type: 'checkin', id: created.id }, request);
  await command({ type: 'checkin', id: created.id }, request);
  await assert.rejects(command({ type: 'checkin', id: created.id }), { status: 409 });
  await assert.rejects(command({ type: 'cancel', id: created.id }), { status: 409 });
  await assert.rejects(command({ type: 'room_status', roomId: '101', version: 5, cleaning: 'dirty', blocked: 1 }), /occupied/);
  await assert.rejects(command({ ...booking, start: '2026-10-30', end: '2026-11-01' }, randomUUID(), new Date('2026-10-30T10:00:00Z')), /unavailable/);
  assert.equal((await hotelSnapshot(db, now)).bookings.filter((b) => b.status === 'in_house').length, 1);
}));
