'use client';

import { resolvePeriodRange } from '@/lib/report-dates.js';
import DateInput from './date-input.jsx';
import { useCalendarSystem } from '@/lib/calendar-context.jsx';

const PRESETS = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['this_week', 'This Week'],
  ['this_month', 'This Month'],
  ['custom', 'Custom'],
];

/**
 * Controlled Today/Yesterday/Week/Month/Custom filter. Parent owns
 * `{ period, from, to }` (from/to are Nepal-calendar YYYY-MM-DD strings,
 * ready to send straight to a `?from=&to=` list endpoint); empty period
 * means no date filter applied.
 */
export default function DateRangeFilter({ value, onChange, className = '', compact = false }) {
  const { calendarSystem } = useCalendarSystem();
  const period = value?.period || '';
  const isCustom = period === 'custom';

  const selectPreset = (id) => {
    if (id === period) { onChange({ period: '', from: '', to: '' }); return; }
    if (id === 'custom') { onChange({ period: 'custom', from: value?.from || '', to: value?.to || '' }); return; }
    const range = resolvePeriodRange(id, null, null, { calendarSystem });
    onChange({ period: id, from: range.start, to: range.end });
  };

  if (compact) {
    return (
      <div className={`flex min-w-0 flex-wrap items-center gap-2 ${className}`}>
        <select
          value={period}
          onChange={(e) => selectPreset(e.target.value)}
          className="h-9 min-w-0 rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-700 outline-none transition-colors focus:border-gray-400"
          aria-label="Date range"
        >
          <option value="">All dates</option>
          {PRESETS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        {isCustom && (
          <div className="flex min-w-0 items-center gap-1.5">
            <DateInput value={value?.from || ''} onChange={(from) => onChange({ period: 'custom', from, to: value?.to || '' })} className="h-9 w-28 min-w-0 rounded-lg border border-gray-200 px-2 text-sm" aria-label="From date" />
            <span className="text-xs text-gray-400">to</span>
            <DateInput value={value?.to || ''} onChange={(to) => onChange({ period: 'custom', from: value?.from || '', to })} className="h-9 w-28 min-w-0 rounded-lg border border-gray-200 px-2 text-sm" aria-label="To date" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
        {PRESETS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => selectPreset(id)}
            aria-pressed={period === id}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              period === id ? 'bg-gray-950 text-white' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {isCustom && (
        <div className="flex items-center gap-1.5">
          <DateInput
            value={value?.from || ''}
            onChange={(from) => onChange({ period: 'custom', from, to: value?.to || '' })}
            className="h-9 w-28 rounded-lg border border-gray-200 px-2 text-sm"
            aria-label="From date"
          />
          <span className="text-xs text-gray-400">to</span>
          <DateInput
            value={value?.to || ''}
            onChange={(to) => onChange({ period: 'custom', from: value?.from || '', to })}
            className="h-9 w-28 rounded-lg border border-gray-200 px-2 text-sm"
            aria-label="To date"
          />
        </div>
      )}
    </div>
  );
}
