'use client';

/**
 * Live “how long has this table been open?” label for running floor cards,
 * plus settled sitting time for dine-in orders and bills.
 */

import { useEffect, useState } from 'react';
import { formatOpenDuration, formatSittingDuration } from '@/lib/time-utils.js';

export { formatOpenDuration, formatSittingDuration };

/** Tick once a minute so open duration stays current without heavy re-renders. */
export function useOpenDuration(openedAt, enabled = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled || !openedAt) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [openedAt, enabled]);
  return enabled ? formatOpenDuration(openedAt, now) : null;
}

const CLOSED_STATUSES = new Set([
  'completed', 'cancelled', 'canceled', 'voided', 'refunded', 'paid',
]);

export function sittingStillOpen(status, closedAt) {
  if (closedAt) return false;
  const s = String(status || '').toLowerCase();
  return !s || !CLOSED_STATUSES.has(s);
}

/** Live or settled “how long was this table occupied?” label. Dine-in only. */
export function SittingTime({
  openedAt,
  closedAt = null,
  status = '',
  dineIn = true,
  empty = '—',
  className = 'tabular-nums',
}) {
  const live = dineIn && sittingStillOpen(status, closedAt);
  const ticking = useOpenDuration(openedAt, live);
  if (!dineIn) return empty;
  const label = live ? ticking : formatSittingDuration(openedAt, closedAt);
  if (!label) return empty;
  return <span className={className}>{live ? `open ${label}` : label}</span>;
}
