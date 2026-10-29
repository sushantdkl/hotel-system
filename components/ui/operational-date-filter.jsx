'use client';

import { OPERATIONAL_DATE_PRESETS } from '@/lib/operational-date-range';

export default function OperationalDateFilter({ value, onChange }) {
  return (
    <div className="flex gap-1.5 overflow-x-auto" aria-label="Date range">
      {OPERATIONAL_DATE_PRESETS.map((preset) => (
        <button
          key={preset.id}
          type="button"
          onClick={() => onChange(preset.id)}
          className={`h-8 shrink-0 rounded-lg px-2.5 text-xs font-semibold ${
            value === preset.id
              ? 'bg-slate-900 text-white'
              : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}
