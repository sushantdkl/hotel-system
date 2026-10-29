/**
 * Shared reservation constants + datetime helpers.
 */

export const RESERVATION_STATUS = {
  NEW: 'new',
  CONFIRMED: 'confirmed',
  ARRIVED: 'arrived',
  SEATED: 'seated',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  NO_SHOW: 'no_show',
};

export const CANCEL_REASON = {
  GUEST: 'guest',
  RESTAURANT: 'restaurant',
  EXPIRED: 'expired',
  LATE_NO_SHOW: 'late_no_show',
};

export const INQUIRY_STATUS = {
  NEW: 'new',
  CONTACTED: 'contacted',
  RESOLVED: 'resolved',
  ARCHIVED: 'archived',
};

/** Allowed manual transitions (completed only via payment hook). */
export const RESERVATION_TRANSITIONS = {
  [RESERVATION_STATUS.NEW]: [
    RESERVATION_STATUS.CONFIRMED,
    RESERVATION_STATUS.CANCELLED,
    RESERVATION_STATUS.ARRIVED,
    RESERVATION_STATUS.SEATED,
  ],
  [RESERVATION_STATUS.CONFIRMED]: [
    RESERVATION_STATUS.ARRIVED,
    RESERVATION_STATUS.SEATED,
    RESERVATION_STATUS.CANCELLED,
    RESERVATION_STATUS.NO_SHOW,
  ],
  [RESERVATION_STATUS.ARRIVED]: [
    RESERVATION_STATUS.SEATED,
    RESERVATION_STATUS.CANCELLED,
    RESERVATION_STATUS.NO_SHOW,
  ],
  [RESERVATION_STATUS.SEATED]: [RESERVATION_STATUS.CANCELLED],
  [RESERVATION_STATUS.COMPLETED]: [],
  [RESERVATION_STATUS.CANCELLED]: [],
  [RESERVATION_STATUS.NO_SHOW]: [],
};

export function assertReservationTransition(from, to, { allowComplete = false } = {}) {
  if (from === to) return;
  if (to === RESERVATION_STATUS.COMPLETED) {
    if (!allowComplete) {
      throw new Error('Reservations complete only after payment.');
    }
    if (from !== RESERVATION_STATUS.SEATED) {
      throw new Error('Only seated reservations can be completed.');
    }
    return;
  }
  const allowed = RESERVATION_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    throw new Error(`Cannot change reservation from ${from} to ${to}.`);
  }
}

export function reservationDateTime(dateStr, timeStr) {
  if (!dateStr) return null;
  const t = timeStr && String(timeStr).trim() ? String(timeStr).trim() : null;
  if (!t) return null;
  const normalized = t.length === 5 ? `${t}:00` : t;
  const d = new Date(`${dateStr}T${normalized}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Format a Date as `YYYY-MM-DD HH:MM:SS` in the *host's* local time.
 *
 * Note the basis: every other bare timestamp in this schema is UTC (SQLite's
 * CURRENT_TIMESTAMP, and parseDbDate() reads them as UTC), but this one is
 * host-local. That is correct for its main job — turning a booking's entered
 * date + time back into the wall-clock string that was typed — and the timing
 * analytics only ever take the *difference* between two columns written this
 * way, so the basis cancels and those figures are right.
 *
 * It is a trap for anything new, though: do not compare a column written by
 * this function against a UTC-anchored range (nepalRangeUtcBounds and friends)
 * without converting first, and do not render one as an absolute clock time.
 */
export function formatDbDateTime(d) {
  if (!d || Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function parsePartySize(guests, partySize) {
  if (partySize != null && partySize !== '' && Number.isFinite(Number(partySize))) {
    return Math.max(1, Math.floor(Number(partySize)));
  }
  const g = String(guests || '');
  if (/50\+/.test(g)) return 50;
  const m = g.match(/(\d+)/);
  if (m) return Math.max(1, parseInt(m[1], 10));
  return 2;
}

export function guestsLabelFromSize(size) {
  const n = Number(size) || 2;
  if (n <= 2) return '1-2 guests';
  if (n <= 5) return '3-5 guests';
  if (n <= 10) return '6-10 guests';
  if (n <= 20) return '11-20 guests';
  if (n <= 50) return '20-50 guests';
  return '50+ guests';
}

export function parsePreferences(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}
