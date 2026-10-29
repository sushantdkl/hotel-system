'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  BS_MONTH_NAMES, adToBsParts, bsDaysInMonth, bsToAdIso, bsWeekday,
} from '@/lib/calendar-system.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (value) => String(value).padStart(2, '0');

export default function BsCalendarPicker({ value, onSelect, min, max, visible, onVisibleChange }) {
  const selected = value ? adToBsParts(value) : null;
  const todayAd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kathmandu', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const today = adToBsParts(todayAd);
  const current = visible || selected || today;
  const monthLength = bsDaysInMonth(current.year, current.month);
  const leading = bsWeekday(current.year, current.month, 1);

  const moveMonth = (delta) => {
    let year = current.year;
    let month = current.month + delta;
    if (month < 1) { year -= 1; month = 12; }
    if (month > 12) { year += 1; month = 1; }
    onVisibleChange({ year, month, day: 1 });
  };

  const days = Array.from({ length: leading + monthLength }, (_, index) => {
    if (index < leading) return null;
    const day = index - leading + 1;
    const bsIso = `${current.year}-${pad(current.month)}-${pad(day)}`;
    const adIso = bsToAdIso(bsIso);
    return { day, adIso, disabled: (min && adIso < min) || (max && adIso > max) };
  });

  return (
    <div className="w-[292px] select-none" role="dialog" aria-label="Bikram Sambat calendar">
      <div className="mb-2 flex items-center justify-between gap-2">
        <button type="button" onClick={() => moveMonth(-1)} className="rounded-lg p-2 hover:bg-gray-100" aria-label="Previous BS month"><ChevronLeft className="h-4 w-4" /></button>
        <div className="flex min-w-0 items-center gap-1">
          <select aria-label="BS month" value={current.month} onChange={(event) => onVisibleChange({ ...current, month: Number(event.target.value), day: 1 })} className="rounded-md border border-gray-200 bg-white px-1.5 py-1 text-sm font-semibold">
            {BS_MONTH_NAMES.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
          </select>
          <select aria-label="BS year" value={current.year} onChange={(event) => onVisibleChange({ ...current, year: Number(event.target.value), day: 1 })} className="rounded-md border border-gray-200 bg-white px-1.5 py-1 text-sm font-semibold">
            {Array.from({ length: 119 }, (_, index) => 1970 + index).map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
        </div>
        <button type="button" onClick={() => moveMonth(1)} className="rounded-lg p-2 hover:bg-gray-100" aria-label="Next BS month"><ChevronRight className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-gray-400">
        {WEEKDAYS.map((day) => <span key={day} className="py-1">{day}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {days.map((entry, index) => entry ? (
          <button
            key={entry.day}
            type="button"
            disabled={entry.disabled}
            onClick={() => onSelect(entry.adIso)}
            className={`h-9 rounded-lg text-sm tabular-nums ${selected?.year === current.year && selected?.month === current.month && selected?.day === entry.day ? 'bg-gray-950 font-bold text-white' : today.year === current.year && today.month === current.month && today.day === entry.day ? 'bg-amber-50 font-bold text-amber-800' : 'text-gray-700 hover:bg-gray-100'} disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent`}
          >
            {entry.day}
          </button>
        ) : <span key={`blank-${index}`} />)}
      </div>
      <p className="mt-2 border-t border-gray-100 pt-2 text-center text-[11px] text-gray-400">Bikram Sambat · English digits</p>
    </div>
  );
}
