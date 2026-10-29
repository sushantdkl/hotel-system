/**
 * Date presets must resolve in the Nepal calendar, never the viewer's.
 *
 * The Expenses and Savings screens built their ranges from `new Date()` and
 * getFullYear/getMonth/getDate, which read the browser's local clock. On a UTC
 * host every instant after 18:15 UTC is already the next day in Nepal, so
 * "Today" quietly queried yesterday — while the rows it filters are dated in
 * Nepal. An owner checking from another timezone got a different day again.
 *
 * These tests pin the shared arithmetic those screens now use.
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

import { nepalDateString, resolvePeriodRange } from '@/lib/report-dates.js';

/** The rule both screens use: walk whole days from a Nepal date string. */
const shiftNepalDate = (dateStr, days) => {
  const cursor = new Date(`${dateStr}T12:00:00+05:45`);
  cursor.setDate(cursor.getDate() + days);
  return nepalDateString(cursor);
};

const monthStart = (y, m) => `${y}-${String(m).padStart(2, '0')}-01`;

test('the Nepal calendar date rolls over 5h45m before UTC does', () => {
  // 18:14 UTC is still the same Nepal day; 18:15 UTC is the next one.
  assert.equal(nepalDateString(new Date('2026-08-24T18:14:00Z')), '2026-08-24');
  assert.equal(nepalDateString(new Date('2026-08-24T18:15:00Z')), '2026-08-25');
});

test('a Nepal date is independent of the host clock', () => {
  // Same instant, expressed three ways — one answer.
  const instant = new Date('2026-08-24T20:00:00Z');
  assert.equal(nepalDateString(instant), '2026-08-25');
  assert.equal(nepalDateString(new Date(instant.getTime())), '2026-08-25');
  assert.equal(nepalDateString(instant.toISOString()), '2026-08-25');
});

test('shifting days never lands on a half-day or skips one', () => {
  assert.equal(shiftNepalDate('2026-08-24', -6), '2026-08-18');
  assert.equal(shiftNepalDate('2026-08-24', 0), '2026-08-24');
  assert.equal(shiftNepalDate('2026-03-01', -1), '2026-02-28');
  // Leap year
  assert.equal(shiftNepalDate('2028-03-01', -1), '2028-02-29');
});

test('last month is a whole calendar month, including across a year boundary', () => {
  const lastMonthOf = (today) => {
    const [year, month] = today.split('-').map(Number);
    const prevYear = month === 1 ? year - 1 : year;
    const prevMonth = month === 1 ? 12 : month - 1;
    return { from: monthStart(prevYear, prevMonth), to: shiftNepalDate(monthStart(year, month), -1) };
  };

  assert.deepEqual(lastMonthOf('2026-08-15'), { from: '2026-07-01', to: '2026-07-31' });
  assert.deepEqual(lastMonthOf('2026-01-15'), { from: '2025-12-01', to: '2025-12-31' }); // year rollover
  assert.deepEqual(lastMonthOf('2026-03-10'), { from: '2026-02-01', to: '2026-02-28' }); // short month
  assert.deepEqual(lastMonthOf('2028-03-10'), { from: '2028-02-01', to: '2028-02-29' }); // leap
});

test('quarter starts on the right month all year', () => {
  const quarterStart = (month) => monthStart(2026, Math.floor((month - 1) / 3) * 3 + 1);
  assert.equal(quarterStart(1), '2026-01-01');
  assert.equal(quarterStart(3), '2026-01-01');
  assert.equal(quarterStart(4), '2026-04-01');
  assert.equal(quarterStart(7), '2026-07-01');
  assert.equal(quarterStart(12), '2026-10-01');
});

test('every preset the reports engine offers resolves to a valid ordered range', () => {
  const presets = [
    'today', 'yesterday', 'last3', 'last7', 'last30',
    'this_week', 'this_month', 'last_month', 'year', 'week', 'month',
  ];
  for (const preset of presets) {
    const r = resolvePeriodRange(preset);
    assert.match(r.start, /^\d{4}-\d{2}-\d{2}$/, `${preset} start`);
    assert.match(r.end, /^\d{4}-\d{2}-\d{2}$/, `${preset} end`);
    assert.ok(r.start <= r.end, `${preset} must not run backwards`);
    assert.ok(r.label, `${preset} needs a label an owner can read`);
  }
});

test('a custom range given backwards is corrected, not left inverted', () => {
  const r = resolvePeriodRange('custom', '2026-08-20', '2026-08-01');
  assert.equal(r.start, '2026-08-01');
  assert.equal(r.end, '2026-08-20');
});

test('BS presets use Bikram Sambat boundaries before converting to canonical AD', () => {
  const options = { calendarSystem: 'BS', now: new Date('2026-09-16T06:00:00.000Z') };
  const month = resolvePeriodRange('this_month', null, null, options);
  assert.deepEqual({ start: month.start, end: month.end }, { start: '2026-08-17', end: '2026-09-16' });
  assert.equal(resolvePeriodRange('year', null, null, options).start, '2026-04-14');
  assert.equal(resolvePeriodRange('quarter', null, null, options).start, '2026-07-17');
  assert.equal(resolvePeriodRange('this_week', null, null, options).start, '2026-09-12');
  assert.match(month.label, /2083-05-01 BS/);
});

test('AD presets retain Gregorian boundaries when AD is selected', () => {
  const options = { calendarSystem: 'AD', now: new Date('2026-09-16T06:00:00.000Z') };
  assert.equal(resolvePeriodRange('this_month', null, null, options).start, '2026-09-01');
  assert.equal(resolvePeriodRange('year', null, null, options).start, '2026-01-01');
  assert.equal(resolvePeriodRange('quarter', null, null, options).start, '2026-07-01');
  assert.equal(resolvePeriodRange('this_week', null, null, options).start, '2026-09-14');
});

/* ---- host desk boards ------------------------------------------- */

test('reservation board boundaries come from the Nepal calendar, not the host', async () => {
  const { listReservations } = await import('@/lib/leads.js');

  /*
   * Frozen at 20:00 UTC on 24 Aug = 01:45 NPT on 25 Aug — inside the window
   * where the two calendars disagree. Without a fixed clock this test passes
   * for 18 hours a day whatever the code does.
   */
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-08-24T20:00:00Z') });
  try {
    assert.equal(nepalDateString(), '2026-08-25', 'the frozen instant is already tomorrow in Nepal');

    const seen = [];
    const db = {
      driver: 'sqlite',
      async all(sql, params = []) { seen.push({ sql, params }); return []; },
      async get() { return {}; },
      async run() { return {}; },
      async exec() { return {}; },
    };

    for (const [board, expected] of [
      ['today', '2026-08-25'],
      ['upcoming', '2026-08-25'],
      ['all', '2026-08-24'], // ops window opens the day before
    ]) {
      seen.length = 0;
      await listReservations({ board }, db);
      // ensureLeadsTables also touches `reservations`; match the board query by its join.
      const query = seen.find((q) => /LEFT JOIN tables t ON t\.id = r\.table_id/.test(q.sql));
      assert.ok(query, `${board} board must query reservations`);
      const bound = query.params.find((p) => /^\d{4}-\d{2}-\d{2}$/.test(String(p)));
      assert.equal(
        bound,
        expected,
        `${board} board must anchor on the Nepal calendar — read from the host clock it bound `
        + '2026-08-24, so from Nepal midnight to 05:45 NPT the host desk showed the wrong day'
      );
    }
  } finally {
    mock.timers.reset();
  }
});
