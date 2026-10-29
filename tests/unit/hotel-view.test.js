import test from 'node:test';
import assert from 'node:assert/strict';
import { balance, roomAvailable, roomState } from '../../lib/hotel/view.js';

const state = {
  businessDate: '2026-10-27',
  rooms: [{ id: '101', cleaning: 'ready' }, { id: '102', cleaning: 'dirty' }, { id: '103', cleaning: 'ready', blocked: true }],
  bookings: [{ id: 'B1', roomId: '101', start: '2026-10-25', end: '2026-10-27', status: 'in_house', entries: [{ amount: 100 }], payments: [{ amount: 40.5 }] }],
};

test('room state reflects stays, cleaning and blocks', () => {
  assert.equal(roomState(state, state.rooms[0]), 'departure');
  assert.equal(roomState(state, state.rooms[1]), 'dirty');
  assert.equal(roomState(state, state.rooms[2]), 'blocked');
});

test('room availability respects overlaps, overstays and blocks', () => {
  assert.equal(roomAvailable(state, '101', '2026-10-28', '2026-10-29'), false, 'overstaying guest still in room');
  assert.equal(roomAvailable(state, '101', '2026-10-28', '2026-10-29', 'B1'), true);
  assert.equal(roomAvailable(state, '102', '2026-10-27', '2026-10-28'), true);
  assert.equal(roomAvailable(state, '103', '2026-10-27', '2026-10-28'), false);
  assert.equal(balance(state.bookings[0]), 59.5);
});
