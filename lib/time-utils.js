// Nepal timezone utilities
// SQLite CURRENT_TIMESTAMP is UTC without a Z suffix — parse carefully.
import { formatCalendarDate, formatCalendarDateTime } from '@/lib/calendar-system.js';

export function parseDbDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const s = String(value).trim();
  if (!s) return null;

  // Already ISO with timezone
  if (/Z$/i.test(s) || /[+-]\d{2}:\d{2}$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // "2026-07-18 15:30:00" or "2026-07-18T15:30:00" → treat as UTC (SQLite default)
  const normalized = s.includes('T') ? s : s.replace(' ', 'T');
  const d = new Date(`${normalized}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function getNepaliDateTime(inputDate = null) {
  const d = inputDate ? parseDbDate(inputDate) || new Date(inputDate) : new Date();
  if (Number.isNaN(d.getTime())) return 'N/A';
  return d.toLocaleString('sv-SE', { timeZone: 'Asia/Kathmandu' }).replace(' ', 'T');
}

export function getNepaliDateString(inputDate = null) {
  const d = inputDate ? parseDbDate(inputDate) || new Date(inputDate) : new Date();
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kathmandu' });
}

export function getNepaliNow() {
  return new Date();
}

export function formatNepalTime(dateString) {
  return formatCalendarDateTime(dateString, { empty: 'N/A', adStyle: 'numeric', separator: ', ' });
}

export function formatNepalDate(dateString) {
  return formatCalendarDate(dateString);
}

export function formatNepalClock(dateString) {
  if (!dateString) return '—';
  const date = parseDbDate(dateString) || new Date(dateString);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('en-US', {
    timeZone: 'Asia/Kathmandu',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/** How long a table/order has been open: `12m`, `1h 4m`, `1d 2h`. */
export function formatOpenDuration(openedAt, now = Date.now()) {
  if (!openedAt) return null;
  const start = parseDbDate(openedAt);
  if (!start) return null;
  const minutes = Math.max(0, Math.floor((now - start.getTime()) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`;
}

/** Settled sitting uses closedAt; otherwise duration runs until now. */
export function formatSittingDuration(openedAt, closedAt = null, now = Date.now()) {
  if (!openedAt) return null;
  if (!closedAt) return formatOpenDuration(openedAt, now);
  const end = parseDbDate(closedAt);
  return formatOpenDuration(openedAt, end ? end.getTime() : now);
}
