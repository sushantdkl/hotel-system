import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

import {
  PG_DATE_OID,
  PG_TIMESTAMP_WITHOUT_TIME_ZONE_OID,
  PG_TIMESTAMP_WITH_TIME_ZONE_OID,
  parseNepalWallClockTimestamp,
} from '../../lib/db/postgres.js';
import {
  formatNepalDateTime,
  nepalOperationalRangeBounds,
  resolvePeriodRange,
} from '../../lib/report-dates.js';
import { formatNepalClock, formatNepalDate } from '../../lib/time-utils.js';
import { toCsv } from '../../lib/csv.js';

const STORED_BILL_TIME = '2026-08-29 21:28:00.552194';

test('OID 1114 is parsed as an Asia/Kathmandu wall clock, independent of the host timezone', () => {
  const parsed = parseNepalWallClockTimestamp(STORED_BILL_TIME);
  assert.ok(parsed instanceof Date);
  assert.equal(parsed.toISOString(), '2026-08-29T15:43:00.552Z');
  assert.equal(pg.types.getTypeParser(PG_TIMESTAMP_WITHOUT_TIME_ZONE_OID)(STORED_BILL_TIME).toISOString(), parsed.toISOString());
});

test('Sales Report display and CSV preserve the stored Nepal bill clock', () => {
  const jsonValue = JSON.parse(JSON.stringify(parseNepalWallClockTimestamp(STORED_BILL_TIME)));
  const displayed = formatNepalDateTime(jsonValue);
  assert.equal(displayed, '29 Aug 2026, 09:28 pm');
  assert.notEqual(displayed, '30 Aug 2026, 03:13 am');
  assert.match(toCsv(['Date'], [{ Date: displayed }]), /29 Aug 2026, 09:28 pm/);
});

test('midnight-adjacent Nepal wall clocks retain their intended calendar date', () => {
  const parsed = parseNepalWallClockTimestamp('2026-08-30 00:05:00.000000');
  assert.equal(formatNepalDateTime(parsed.toISOString()), '30 Aug 2026, 12:05 am');
});

test('genuine timestamptz values retain instant semantics and convert to Nepal time', () => {
  const parser = pg.types.getTypeParser(PG_TIMESTAMP_WITH_TIME_ZONE_OID);
  const instant = parser('2026-08-29 18:15:00+00');
  assert.equal(instant.toISOString(), '2026-08-29T18:15:00.000Z');
  assert.equal(formatNepalDateTime(instant.toISOString()), '30 Aug 2026, 12:00 am');
});

test('date-only values remain strings and never shift a calendar day', () => {
  const value = pg.types.getTypeParser(PG_DATE_OID)('2026-08-30');
  assert.equal(value, '2026-08-30');
  assert.equal(String(value).slice(0, 10), '2026-08-30');
});

test('bill and bill-payment times share the same parser and print semantics', () => {
  const bill = parseNepalWallClockTimestamp(STORED_BILL_TIME);
  const payment = parseNepalWallClockTimestamp('2026-08-29 21:28:30.000000');
  assert.equal(formatNepalDate(bill), '29 Aug 2026');
  assert.match(formatNepalClock(bill), /09:28 PM/i);
  assert.equal(formatNepalDate(payment), '29 Aug 2026');
  assert.match(formatNepalClock(payment), /09:28 PM/i);
  assert.equal((payment - bill) / 1000, 29.448);
});

test('PostgreSQL Today boundaries are Nepal wall-clock boundaries', () => {
  const bounds = nepalOperationalRangeBounds('postgres', '2026-08-30');
  assert.deepEqual(bounds, {
    start: '2026-08-30 00:00:00',
    endExclusive: '2026-08-31 00:00:00',
  });
  const today = resolvePeriodRange('today');
  assert.match(today.start, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(today.end, today.start);
});
