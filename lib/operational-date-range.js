export const OPERATIONAL_DATE_PRESETS = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'last7', label: '7 days' },
  { id: 'all', label: 'All' },
];

export function nepalDateToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu' }).format(new Date());
}

function shiftDate(value, days) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function operationalDateRange(preset) {
  const today = nepalDateToday();
  if (preset === 'yesterday') {
    const yesterday = shiftDate(today, -1);
    return { from: yesterday, to: yesterday };
  }
  if (preset === 'last7') return { from: shiftDate(today, -6), to: today };
  if (preset === 'all') return { from: '', to: '' };
  return { from: today, to: today };
}
