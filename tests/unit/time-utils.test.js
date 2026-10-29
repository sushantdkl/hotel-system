import test from 'node:test';
import assert from 'node:assert/strict';

import { formatNepalClock, formatNepalDate, formatOpenDuration, formatSittingDuration, getNepaliDateString, parseDbDate } from '../../lib/time-utils.js';
import { adaptSqlForPostgres } from '../../lib/db/sql.js';

test('database timestamps without a suffix are treated as UTC and displayed in Nepal time', () => {
  const timestamp = '2026-08-12 20:00:00';
  assert.equal(parseDbDate(timestamp).toISOString(), '2026-08-12T20:00:00.000Z');
  assert.equal(getNepaliDateString(timestamp), '2026-08-13');
  assert.equal(formatNepalDate(timestamp), '13 Aug 2026');
  assert.match(formatNepalClock(timestamp), /01:45 AM/i);
});

test('Nepal-shifted SQLite calendar dates become direct wall-clock dates on Postgres', () => {
  const sql = adaptSqlForPostgres("SELECT date(o.created_at, '+5 hours', '+45 minutes') AS day FROM orders o");
  assert.doesNotMatch(sql, /Asia\/Kathmandu|AT TIME ZONE/);
  assert.match(sql, /::date/);
});

test('open and sitting durations format from opened_at to now or paid_at', () => {
  const opened = '2026-09-06 10:00:00';
  const paid = '2026-09-06 11:12:00';
  const now = Date.parse('2026-09-06T10:45:00.000Z');
  assert.equal(formatOpenDuration(opened, now), '45m');
  assert.equal(formatSittingDuration(opened, paid), '1h 12m');
  assert.equal(formatSittingDuration(null, paid), null);
  assert.equal(formatOpenDuration(opened, Date.parse('2026-09-07T12:00:00.000Z')), '1d 2h');
});
