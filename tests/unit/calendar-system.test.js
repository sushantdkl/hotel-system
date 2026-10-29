import test from 'node:test';
import assert from 'node:assert/strict';

import {
  adToBsIso, bsDaysInMonth, bsToAdIso, bsWeekday,
  formatCalendarDate, isValidBsDate,
} from '@/lib/calendar-system.js';

test('known AD date converts to the requested English-digit BS presentation', () => {
  assert.equal(adToBsIso('2026-09-02'), '2083-05-17');
  assert.equal(formatCalendarDate('2026-09-02', { calendarSystem: 'BS' }), '2083-05-17 BS');
});

test('AD and BS conversion round trips across month and year boundaries', () => {
  for (const ad of ['2025-04-13', '2025-04-14', '2026-08-16', '2026-08-17', '2026-09-01', '2026-09-02', '2027-04-13']) {
    assert.equal(bsToAdIso(adToBsIso(ad)), ad, ad);
  }
});

test('every day at both sides of each BS month boundary round trips', () => {
  for (let month = 1; month <= 12; month += 1) {
    const last = bsDaysInMonth(2083, month);
    for (const day of [1, last]) {
      const bs = `2083-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      assert.equal(adToBsIso(bsToAdIso(bs)), bs);
    }
  }
});

test('BS validation uses the real month table, not Gregorian month lengths', () => {
  const length = bsDaysInMonth(2083, 5);
  assert.equal(length, 31);
  assert.equal(isValidBsDate(`2083-05-${length}`), true);
  assert.equal(isValidBsDate(`2083-05-${length + 1}`), false);
});

test('BS weekday advances correctly over a month boundary', () => {
  const last = bsDaysInMonth(2083, 4);
  assert.equal(bsWeekday(2083, 5, 1), (bsWeekday(2083, 4, last) + 1) % 7);
});
