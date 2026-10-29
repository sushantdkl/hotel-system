/**
 * Client-safe helpers for waiter reservation board.
 */

import { reservationDateTime, parsePreferences, parsePartySize } from '@/lib/reservation-core.js';

export function formatTimeRemaining(res, now = new Date(), graceMinutes = 20) {
  const when = reservationDateTime(res.date, res.time);
  if (!when) return { label: '—', late: false, ms: null };
  const ms = when.getTime() - now.getTime();
  if (ms >= 0) {
    const mins = Math.round(ms / 60000);
    if (mins < 60) return { label: `in ${mins}m`, late: false, ms };
    const h = Math.floor(mins / 60);
    return { label: `in ${h}h ${mins % 60}m`, late: false, ms };
  }
  const lateMins = Math.round(-ms / 60000);
  return {
    label: lateMins <= graceMinutes ? `late ${lateMins}m` : `late ${lateMins}m`,
    late: true,
    ms,
  };
}

export function isLateReservation(res, now = new Date(), graceMinutes = 20) {
  if (!['confirmed', 'arrived', 'new'].includes(res.status)) return false;
  const when = reservationDateTime(res.date, res.time);
  if (!when) return false;
  return now.getTime() - when.getTime() > graceMinutes * 60 * 1000;
}

export function specialRequestLabels(res) {
  const prefs = parsePreferences(res.preferences);
  const bits = [];
  if (res.occasion) bits.push(res.occasion);
  if (prefs.high_chair) bits.push('High chair');
  if (prefs.wheelchair) bits.push('Wheelchair');
  if (prefs.outdoor) bits.push('Outdoor');
  if (prefs.section) bits.push(prefs.section);
  if (res.message) bits.push(res.message);
  return bits;
}

export function groupReservationsForWaiter(rows, { now = new Date(), graceMinutes = 20 } = {}) {
  const late = [];
  const arrived = [];
  const waiting = [];
  const upcoming = [];
  const seated = [];
  const done = [];

  for (const r of rows || []) {
    if (['completed', 'cancelled', 'no_show'].includes(r.status)) {
      done.push(r);
      continue;
    }
    if (r.status === 'seated') {
      seated.push(r);
      continue;
    }
    if (r.status === 'arrived') {
      if (!r.table_id) waiting.push(r);
      else arrived.push(r);
      if (isLateReservation(r, now, graceMinutes) && r.table_id) {
        late.push(r);
      }
      continue;
    }
    // new + confirmed (and any other open status)
    if (!r.table_id) {
      waiting.push(r);
    }
    if (isLateReservation(r, now, graceMinutes)) {
      late.push(r);
    } else {
      upcoming.push(r);
    }
  }

  const sortByTime = (a, b) => {
    const ta = reservationDateTime(a.date, a.time)?.getTime() || 0;
    const tb = reservationDateTime(b.date, b.time)?.getTime() || 0;
    return ta - tb;
  };

  const uniq = (list) => [...new Map(list.map((r) => [r.id, r])).values()];

  return {
    late: uniq(late).sort(sortByTime),
    arrived: arrived.sort(sortByTime),
    waiting: uniq(waiting).sort(sortByTime),
    upcoming: uniq(upcoming)
      .filter((r) => !isLateReservation(r, now, graceMinutes))
      .sort(sortByTime),
    seated: seated.sort(sortByTime),
    done: done.sort((a, b) => sortByTime(b, a)),
  };
}

export function buildSuggestions(res, tables = [], now = new Date()) {
  const tips = [];
  const when = reservationDateTime(res.date, res.time);
  const party = parsePartySize(res.guests, res.party_size);
  const prefs = parsePreferences(res.preferences);

  if (when) {
    const mins = Math.round((when.getTime() - now.getTime()) / 60000);
    if (mins > 0 && mins <= 15 && res.table_number) {
      tips.push(`Arrives in ${mins}m. Prepare Table ${res.table_number}.`);
    }
  }

  if (res.table_id) {
    const t = tables.find((x) => (x.table_id || x.id) === res.table_id);
    if (t?.capacity && party > Number(t.capacity)) {
      tips.push(`Party of ${party} — Table ${t.table_number} seats ${t.capacity}.`);
    }
    if (t?.current_order_id && ['confirmed', 'arrived'].includes(res.status)) {
      tips.push(`Table ${t.table_number} is still occupied. Pick another table.`);
    }
  }

  if (prefs.outdoor) tips.push('Guest prefers outdoor seating.');
  if (prefs.wheelchair) tips.push('Needs wheelchair access.');
  if (res.is_vip) tips.push('VIP guest — prioritize seating.');
  if (/birthday/i.test(res.occasion || '')) tips.push('Birthday — ask about cake/dessert.');

  return tips.slice(0, 3);
}

export function buildTimeline(res) {
  const steps = [
    { key: 'new', label: 'Created', done: true },
    {
      key: 'confirmed',
      label: 'Confirmed',
      done: !['new'].includes(res.status),
    },
    {
      key: 'arrived',
      label: 'Arrived',
      done: ['arrived', 'seated', 'completed'].includes(res.status) || !!res.checked_in_at,
    },
    {
      key: 'table',
      label: 'Table assigned',
      done: !!res.table_id,
    },
    {
      key: 'seated',
      label: 'Seated',
      done: ['seated', 'completed'].includes(res.status) || !!res.seated_at,
    },
    {
      key: 'ordering',
      label: 'Ordering / dining',
      done: ['seated', 'completed'].includes(res.status) && !!res.order_id,
    },
    {
      key: 'payment',
      label: 'Payment',
      done: res.order_status === 'awaiting_payment' || res.status === 'completed',
    },
    {
      key: 'completed',
      label: 'Completed',
      done: res.status === 'completed' || !!res.completed_at,
    },
  ];

  if (res.status === 'cancelled' || res.status === 'no_show') {
    return [
      ...steps.filter((s) => s.done),
      {
        key: 'end',
        label: res.status === 'no_show' ? 'No-show' : 'Cancelled',
        done: true,
        end: true,
      },
    ];
  }

  return steps;
}

export function filterReservations(rows, q) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return rows;
  return (rows || []).filter((r) => {
    return (
      String(r.name || '').toLowerCase().includes(s) ||
      String(r.phone || '').includes(s) ||
      String(r.id).includes(s) ||
      String(r.table_number || '').toLowerCase().includes(s) ||
      String(r.order_number || '').toLowerCase().includes(s)
    );
  });
}

export function filterTables(tables, q) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return tables;
  return (tables || []).filter((t) => {
    return (
      String(t.table_number).toLowerCase().includes(s) ||
      String(t.status || '').toLowerCase().includes(s) ||
      String(t.order_number || '').toLowerCase().includes(s) ||
      String(t.reservation_name || '').toLowerCase().includes(s) ||
      String(t.reservation_id || '').includes(s)
    );
  });
}
