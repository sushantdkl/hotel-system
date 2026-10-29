'use client';

import { useEffect, useRef, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';
import BsCalendarPicker from './bs-calendar-picker.jsx';
import { useCalendarSystem } from '@/lib/calendar-context.jsx';
import { adToBsParts } from '@/lib/calendar-system.js';
import {
  adDisplayToIso, bsDisplayToIso, isoToAdDisplay, isoToBsDisplay,
  maskAdInput, maskBsInput,
} from '@/lib/date-input-model.js';

function isoToDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : undefined;
}

function dateToIso(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Controlled calendar-aware date field. The public contract always remains AD
 * YYYY-MM-DD, even while BS mode displays, accepts and picks Bikram Sambat.
 */
export default function DateInput({ value, onChange, min, max, className = '', 'aria-label': ariaLabel, placeholder, ...rest }) {
  const { calendarSystem } = useCalendarSystem();
  const isBs = calendarSystem === 'BS';
  const toDisplay = (iso) => isBs ? isoToBsDisplay(iso) : isoToAdDisplay(iso);
  const [display, setDisplay] = useState(() => toDisplay(value));
  const [open, setOpen] = useState(false);
  const [visibleBs, setVisibleBs] = useState(() => {
    try { return value ? adToBsParts(value) : null; } catch { return null; }
  });
  const wrapRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setDisplay(toDisplay(value));
      if (isBs && value) {
        try { setVisibleBs(adToBsParts(value)); } catch { /* unsupported date: keep current month */ }
      }
    });
    return () => { cancelled = true; };
  }, [value, calendarSystem]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const commit = (adIso) => {
    if (!adIso || (min && adIso < min) || (max && adIso > max)) return;
    onChange(adIso);
  };

  const handleChange = (event) => {
    const masked = isBs ? maskBsInput(event.target.value) : maskAdInput(event.target.value);
    setDisplay(masked);
    if (!masked) { onChange(''); return; }
    const adIso = isBs ? bsDisplayToIso(masked) : adDisplayToIso(masked);
    if (adIso) commit(adIso);
  };

  const disabledMatchers = [
    min ? { before: isoToDate(min) } : null,
    max ? { after: isoToDate(max) } : null,
  ].filter(Boolean);

  return (
    <div ref={wrapRef} className="relative inline-block">
      <input
        type="text"
        inputMode="numeric"
        value={display}
        onChange={handleChange}
        onFocus={() => setOpen(true)}
        placeholder={placeholder || (isBs ? 'YYYY-MM-DD BS' : 'dd/mm/yyyy')}
        maxLength={isBs ? 13 : 10}
        aria-label={ariaLabel}
        className={className}
        {...rest}
      />
      {open && (
        <div className="absolute z-50 mt-1 rounded-xl border border-gray-200 bg-white p-2 text-gray-900 shadow-lg">
          {isBs ? (
            <BsCalendarPicker
              value={value}
              min={min}
              max={max}
              visible={visibleBs}
              onVisibleChange={setVisibleBs}
              onSelect={(adIso) => { commit(adIso); setOpen(false); }}
            />
          ) : (
            <DayPicker
              mode="single"
              selected={isoToDate(value)}
              onSelect={(date) => { if (date) { commit(dateToIso(date)); setOpen(false); } }}
              defaultMonth={isoToDate(value) || new Date()}
              disabled={disabledMatchers.length ? disabledMatchers : undefined}
            />
          )}
        </div>
      )}
    </div>
  );
}
