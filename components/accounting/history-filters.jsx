'use client';

import DateInput from '@/components/ui/date-input.jsx';

export default function HistoryFilters({
  search,
  from,
  to,
  selectValue = '',
  selectLabel = 'Type',
  selectOptions = [],
  searchPlaceholder = 'Search history…',
  onChange,
}) {
  const active = Boolean(search || from || to || selectValue);
  const change = (key, value) => onChange?.({ [key]: value });

  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-gray-200 bg-gray-50/60 px-4 py-3">
      <label className="min-w-[220px] flex-1">
        <span className="mb-1 block text-xs font-medium text-gray-600">Search</span>
        <input value={search} onChange={(event) => change('search', event.target.value)} className={CONTROL} placeholder={searchPlaceholder} />
      </label>
      <label>
        <span className="mb-1 block text-xs font-medium text-gray-600">From</span>
        <DateInput value={from} max={to || undefined} onChange={(value) => change('from', value)} className={CONTROL} />
      </label>
      <label>
        <span className="mb-1 block text-xs font-medium text-gray-600">To</span>
        <DateInput value={to} min={from || undefined} onChange={(value) => change('to', value)} className={CONTROL} />
      </label>
      {selectOptions.length > 0 && (
        <label>
          <span className="mb-1 block text-xs font-medium text-gray-600">{selectLabel}</span>
          <select value={selectValue} onChange={(event) => change('selectValue', event.target.value)} className={CONTROL}>
            {selectOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      )}
      <button type="button" disabled={!active} onClick={() => onChange?.({ search: '', from: '', to: '', selectValue: '' })} className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">
        Clear
      </button>
    </div>
  );
}

const CONTROL = 'h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900';
