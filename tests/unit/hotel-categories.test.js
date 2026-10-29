import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PosDatabase } from '../../lib/db/index.js';
import { runHotelCommand, hotelSnapshot } from '../../lib/hotel/service.js';

const owner = { id: 1, role: 'admin' };
const now = new Date('2026-10-28T04:00:00Z');

async function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-cat-'));
  const db = new PosDatabase(path.join(dir, 'test.db'));
  const run = (action, actor = owner) => runHotelCommand(db, action, actor, randomUUID(), now);
  try { await fn({ db, run, snap: () => hotelSnapshot(db, now) }); } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

test('categories: create, bulk rooms, single room defaults, rename cascades, delete guard', async () => fixture(async ({ run, snap }) => {
  await assert.rejects(run({ type: 'category', name: '', rate: 10, capacity: 2 }), /category name/);
  const deluxe = await run({ type: 'category', name: 'Deluxe King', rate: 4500, capacity: 2, beds: '1 king', amenities: 'AC, balcony' });
  await run({ type: 'rooms_bulk', categoryId: deluxe.id, floor: 1, from: 101, to: 105, prefix: '' });
  let state = await snap();
  assert.equal(state.rooms.length, 5);
  assert.deepEqual([state.rooms[0].type, state.rooms[0].rate, state.rooms[0].capacity], ['Deluxe King', 4500, 2]);
  assert.match((await run({ type: 'rooms_bulk', categoryId: deluxe.id, floor: 1, from: 104, to: 106, prefix: '' })).message, /1 room\(s\) added.*2 already existed/);
  await assert.rejects(run({ type: 'rooms_bulk', categoryId: deluxe.id, floor: 1, from: 1, to: 500, prefix: '' }), /up to 100/);
  await assert.rejects(run({ type: 'rooms_bulk', categoryId: deluxe.id, floor: 1, from: 1, to: 2, prefix: '' }, { id: 2, role: 'receptionist' }), { status: 403 });

  // Single room: blank price/capacity come from the category; given ones override.
  await run({ type: 'room', roomId: 'A201', floor: 2, categoryId: deluxe.id, rate: '', capacity: '' });
  await run({ type: 'room', roomId: 'A202', floor: 2, categoryId: deluxe.id, rate: 5000, capacity: 3 });
  state = await snap();
  const a201 = state.rooms.find((r) => r.id === 'A201');
  const a202 = state.rooms.find((r) => r.id === 'A202');
  assert.deepEqual([a201.rate, a201.capacity, a202.rate, a202.capacity], [4500, 2, 5000, 3]);

  // Rename + apply price cascades to rooms and seasons; bookings keep their price.
  await run({ type: 'season', name: 'Peak', start: '2026-12-01', end: '2026-12-31', roomType: 'Deluxe King', percent: 10 });
  const b = await run({ type: 'book', guest: 'Keeps price', roomId: '101', start: '2026-11-01', end: '2026-11-02', guests: 1 });
  await run({ type: 'category', id: deluxe.id, name: 'Deluxe', rate: 4800, capacity: 2, applyToRooms: true });
  state = await snap();
  assert.ok(state.rooms.every((r) => r.type === 'Deluxe' && r.rate === 4800));
  assert.equal(state.seasons[0].roomType, 'Deluxe');
  assert.equal(state.bookings.find((x) => x.id === b.id).rate, 4500);
  assert.equal(state.categories.find((c) => c.id === deluxe.id).rooms, 8);

  await assert.rejects(run({ type: 'category_delete', id: deluxe.id }), /Move or remove the rooms/);
  const empty = await run({ type: 'category', name: 'Unused', rate: 100, capacity: 1 });
  await run({ type: 'category_delete', id: empty.id });
  assert.equal((await snap()).categories.some((c) => c.name === 'Unused'), false);
}));

test('rooms created before categories get categories automatically', async () => fixture(async ({ run, snap }) => {
  await run({ type: 'room', roomId: '301', roomType: 'Old Type', capacity: 3, floor: 3, rate: 2000 });
  const cat = (await snap()).categories.find((c) => c.name === 'Old Type');
  assert.deepEqual([cat.rate, cat.capacity, cat.rooms], [2000, 3, 1]);
}));
