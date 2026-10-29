/**
 * Channel-prefixed document numbers.
 *
 * The rule that matters most here is the one that is easiest to break later:
 * the SERIAL is shared per document type. Giving each channel its own counter
 * would restart numbering per channel and produce two bills that differ only by
 * prefix — an audit hole. These tests pin that down.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  CHANNEL_PREFIX, BILL_NUMBER_PATTERN, documentPrefix, formatDocumentNumber, nextDocumentNumber,
} from '../../lib/document-numbers.js';

function memoryDb() {
  const raw = new DatabaseSync(':memory:');
  return {
    driver: 'sqlite',
    all: async (sql, params = []) => raw.prepare(sql).all(...(params || [])),
    get: async (sql, params = []) => raw.prepare(sql).get(...(params || [])),
    run: async (sql, params = []) => raw.prepare(sql).run(...(params || [])),
  };
}

const DINE_IN = { order_type: 'dine_in', table_id: 4, table_number: 'T-04' };
const TAKEAWAY = { order_type: 'takeaway', table_id: null, table_number: null };
const DELIVERY = { order_type: 'delivery', table_id: null, table_number: null };

test('each channel prints its own prefix for order, bill and KOT', () => {
  assert.equal(documentPrefix('bill', DINE_IN), 'T');
  assert.equal(documentPrefix('bill', TAKEAWAY), 'TW');
  assert.equal(documentPrefix('bill', DELIVERY), 'D');
  assert.equal(documentPrefix('kot', DINE_IN), 'K');
  assert.equal(documentPrefix('kot', TAKEAWAY), 'K-TW');
  assert.equal(documentPrefix('kot', DELIVERY), 'K-D');
  assert.equal(documentPrefix('order', DINE_IN), 'O');
  assert.equal(documentPrefix('order', TAKEAWAY), 'O-TW');
  assert.equal(documentPrefix('order', DELIVERY), 'O-D');
});

test('an order with a table is dine-in even when order_type says otherwise', () => {
  // normalizedOrderType() treats a table-linked order as dine-in; the number
  // must agree with the classifier every report groups by.
  assert.equal(documentPrefix('bill', { order_type: 'counter', table_id: 7 }), 'T');
  assert.equal(documentPrefix('kot', { order_type: '', table_number: 'T-02' }), 'K');
});

test('an unknown order falls back to the caller prefix rather than mis-labelling', () => {
  assert.equal(documentPrefix('bill', null, 'BILL'), 'BILL');
  assert.equal(documentPrefix('order', null, 'WEB'), 'WEB');
});

test('numbers are zero-padded to three digits behind the prefix', () => {
  assert.equal(formatDocumentNumber('T', 1), 'T-001');
  assert.equal(formatDocumentNumber('TW', 42), 'TW-042');
  assert.equal(formatDocumentNumber('K-D', 7), 'K-D-007');
  assert.equal(formatDocumentNumber('K-TW', 1234), 'K-TW-1234');
});

test('the bill serial keeps running across channels — one book, three prefixes', async () => {
  const db = memoryDb();
  const numbers = [];
  for (const order of [DINE_IN, TAKEAWAY, DINE_IN, DELIVERY, TAKEAWAY]) {
    numbers.push(await nextDocumentNumber(db, { type: 'bill', prefix: 'BILL', order }));
  }
  assert.deepEqual(numbers, ['T-001', 'TW-002', 'T-003', 'D-004', 'TW-005']);

  // The serial is per document type, so KOTs count independently of bills but
  // still continuously among themselves.
  const kots = [];
  for (const order of [DELIVERY, DINE_IN, TAKEAWAY]) {
    kots.push(await nextDocumentNumber(db, { type: 'kot', prefix: 'KOT', order }));
  }
  assert.deepEqual(kots, ['K-D-001', 'K-002', 'K-TW-003']);
});

test('a channel never gets its own counter, so no two bills share a serial', async () => {
  const db = memoryDb();
  const seen = new Set();
  for (let i = 0; i < 30; i += 1) {
    const order = [DINE_IN, TAKEAWAY, DELIVERY][i % 3];
    const number = await nextDocumentNumber(db, { type: 'bill', prefix: 'BILL', order });
    const serial = number.replace(/^[A-Z-]+-/, '');
    assert.equal(seen.has(serial), false, `serial ${serial} was issued twice (${number})`);
    seen.add(serial);
  }
  assert.equal(seen.size, 30);
});

test('caller-supplied bill numbers are recognised in every format ever issued', () => {
  for (const value of ['BILL-001', 'B397', 'T-001', 'TW-042', 'D-118', 'tw-007']) {
    assert.equal(BILL_NUMBER_PATTERN.test(value), true, `${value} should be accepted`);
  }
  for (const value of ['', 'K-001', 'O-001', 'RANDOM', 'T-01']) {
    assert.equal(BILL_NUMBER_PATTERN.test(value), false, `${value} should be rejected`);
  }
});

test('every channel has a prefix for every document type', () => {
  for (const type of ['order', 'bill', 'kot']) {
    for (const channel of ['dine_in', 'takeaway', 'delivery']) {
      assert.equal(typeof CHANNEL_PREFIX[type][channel], 'string');
      assert.notEqual(CHANNEL_PREFIX[type][channel], '');
    }
  }
  // Order, bill and KOT must stay tellable apart within a channel.
  for (const channel of ['dine_in', 'takeaway', 'delivery']) {
    const prefixes = ['order', 'bill', 'kot'].map((type) => CHANNEL_PREFIX[type][channel]);
    assert.equal(new Set(prefixes).size, 3, `prefixes collide for ${channel}: ${prefixes.join()}`);
  }
});
