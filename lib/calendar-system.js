import bikramSambat from 'bikram-sambat';

export const CALENDAR_STORAGE_KEY = 'pos_calendar_system';
export const CALENDAR_EVENT = 'pos-calendar-system-change';
export const DEFAULT_CALENDAR_SYSTEM = 'BS';
export const BS_MONTH_NAMES = [
  'Baisakh', 'Jestha', 'Ashadh', 'Shrawan', 'Bhadra', 'Ashwin',
  'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra',
];

export function normalizeCalendarSystem(value) {
  return String(value || '').toUpperCase() === 'AD' ? 'AD' : 'BS';
}

export function getCalendarSystem() {
  // Server-side API helpers do not know the authenticated user's presentation
  // setting. Keep them canonical/AD; client surfaces apply the live setting.
  if (typeof window === 'undefined') return 'AD';
  if (!window.localStorage) return 'AD';
  return normalizeCalendarSystem(window.localStorage.getItem(CALENDAR_STORAGE_KEY));
}

export function setCalendarSystem(value) {
  const normalized = normalizeCalendarSystem(value);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(CALENDAR_STORAGE_KEY, normalized);
    document.documentElement.dataset.calendarSystem = normalized;
    window.dispatchEvent(new CustomEvent(CALENDAR_EVENT, { detail: normalized }));
  }
  return normalized;
}

const pad = (value) => String(value).padStart(2, '0');

export function isCanonicalAdDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return false;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCFullYear() === Number(year)
    && date.getUTCMonth() + 1 === Number(month)
    && date.getUTCDate() === Number(day);
}

export function adToBsParts(adIso) {
  if (!isCanonicalAdDate(adIso)) throw new Error(`Invalid AD date: ${adIso}`);
  return bikramSambat.toBik(adIso);
}

export function adToBsIso(adIso) {
  const { year, month, day } = adToBsParts(adIso);
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function bsDaysInMonth(year, month) {
  return bikramSambat.daysInMonth(Number(year), Number(month));
}

export function isValidBsDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!match) return false;
  try {
    const [, year, month, day] = match.map(Number);
    return month >= 1 && month <= 12 && day >= 1 && day <= bsDaysInMonth(year, month);
  } catch {
    return false;
  }
}

export function bsToAdIso(bsIso) {
  if (!isValidBsDate(bsIso)) throw new Error(`Invalid BS date: ${bsIso}`);
  const [year, month, day] = bsIso.split('-').map(Number);
  return bikramSambat.toGreg_text(year, month, day);
}

export function bsWeekday(year, month, day) {
  const adIso = bsToAdIso(`${year}-${pad(month)}-${pad(day)}`);
  const [adYear, adMonth, adDay] = adIso.split('-').map(Number);
  return new Date(Date.UTC(adYear, adMonth - 1, adDay)).getUTCDay();
}

export function adDateInNepal(value) {
  if (!value) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kathmandu', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(value);
  }
  const source = String(value).trim();
  if (isCanonicalAdDate(source)) return source;

  let date;
  if (/Z$/i.test(source) || /[+-]\d{2}:\d{2}$/.test(source)) date = new Date(source);
  else if (source.includes('T') || source.includes(' ')) date = new Date(`${source.replace(' ', 'T')}Z`);
  else date = new Date(source);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kathmandu', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function adDisplay(adIso, style = 'short') {
  const [year, month, day] = adIso.split('-').map(Number);
  if (style === 'numeric') {
    return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
      timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
    });
  }
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-GB', {
    timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric',
  });
}

export function formatCalendarDate(value, options = {}) {
  if (!value) return options.empty || '—';
  const adIso = adDateInNepal(value);
  if (!adIso) return String(value);
  if (normalizeCalendarSystem(options.calendarSystem || getCalendarSystem()) === 'BS') {
    try { return `${adToBsIso(adIso)} BS`; } catch { return adDisplay(adIso); }
  }
  return adDisplay(adIso, options.adStyle);
}

export function formatCalendarDateTime(value, options = {}) {
  if (!value) return options.empty || '—';
  let date;
  if (value instanceof Date) date = value;
  else {
    const source = String(value).trim();
    if (/Z$/i.test(source) || /[+-]\d{2}:\d{2}$/.test(source)) date = new Date(source);
    else if (source.includes('T') || source.includes(' ')) date = new Date(`${source.replace(' ', 'T')}Z`);
    else date = new Date(`${source}T00:00:00+05:45`);
  }
  if (Number.isNaN(date.getTime())) return String(value);
  const system = normalizeCalendarSystem(options.calendarSystem || getCalendarSystem());
  const datePart = formatCalendarDate(value, { ...options, calendarSystem: system });
  let timePart = date.toLocaleTimeString('en-US', {
    timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', hour12: true,
  });
  if (system === 'AD' && options.lowerCaseTime) timePart = timePart.toLowerCase();
  return `${datePart}${system === 'BS' ? ' · ' : (options.separator || ' · ')}${timePart}`;
}

export function formatCalendarText(value, options = {}) {
  if (value == null) return value;
  if (normalizeCalendarSystem(options.calendarSystem || getCalendarSystem()) === 'AD') return String(value);
  return String(value).replace(/\b\d{4}-\d{2}-\d{2}\b/g, (date) => formatCalendarDate(date, options));
}

export function formatCalendarRangeLabel(range, fallback = 'Selected period') {
  if (!range?.start || !range?.end) return range?.label || fallback;
  const prefix = String(range.label || fallback).split('·')[0].trim();
  const dates = range.start === range.end
    ? formatCalendarDate(range.start)
    : `${formatCalendarDate(range.start)} – ${formatCalendarDate(range.end)}`;
  const open = /·\s*Open\s*$/i.test(String(range.label || '')) ? ' · Open' : '';
  return `${prefix} · ${dates}${open}`;
}

export function formatCalendarMonth(value = new Date(), options = {}) {
  const system = normalizeCalendarSystem(options.calendarSystem || getCalendarSystem());
  if (system === 'BS') {
    const adIso = adDateInNepal(value);
    try {
      const bs = adToBsParts(adIso);
      return `${BS_MONTH_NAMES[bs.month - 1]} ${bs.year} BS`;
    } catch { /* fall through to AD */ }
  }
  const date = value instanceof Date ? value : new Date(`${adDateInNepal(value)}T12:00:00+05:45`);
  return date.toLocaleString('en-US', { timeZone: 'Asia/Kathmandu', month: 'long', year: 'numeric' });
}
