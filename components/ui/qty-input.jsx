'use client';

import { useEffect, useState } from 'react';

/**
 * Tap-to-type quantity box that sits between the − and + buttons.
 * Commits a whole number >= 1 on Enter/blur; anything invalid snaps back.
 * `onCommit(next)` receives the absolute quantity — callers turn it into a delta.
 */
export default function QtyInput({ value, onCommit, disabled = false, className = 'w-10 h-8 text-sm', ariaLabel = 'Quantity' }) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => { setDraft(String(value)); }, [value]);

  const commit = () => {
    const next = Math.min(9999, parseInt(draft, 10));
    if (!Number.isFinite(next) || next < 1 || next === Number(value)) {
      setDraft(String(value));
      return;
    }
    onCommit(next);
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={draft}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 4))}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setDraft(String(value)); e.currentTarget.blur(); }
      }}
      className={`rounded-md border border-transparent bg-transparent text-center font-bold text-slate-900 hover:border-slate-300 focus:border-blue-500 focus:bg-white focus:outline-none ${className}`}
    />
  );
}
