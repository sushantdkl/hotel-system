'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  CALENDAR_EVENT, DEFAULT_CALENDAR_SYSTEM, getCalendarSystem,
  normalizeCalendarSystem, setCalendarSystem as cacheCalendarSystem,
} from '@/lib/calendar-system.js';

const CalendarContext = createContext({
  calendarSystem: DEFAULT_CALENDAR_SYSTEM,
  setCalendarSystem: () => {},
});

export function CalendarSystemProvider({ children }) {
  const [calendarSystem, setState] = useState(DEFAULT_CALENDAR_SYSTEM);

  useEffect(() => {
    const cached = getCalendarSystem();
    cacheCalendarSystem(cached);
    queueMicrotask(() => setState(cached));

    const sync = (event) => setState(normalizeCalendarSystem(event.detail));
    window.addEventListener(CALENDAR_EVENT, sync);

    const token = window.localStorage.getItem('pos_token');
    if (token) {
      fetch('/api/admin/settings', { headers: { Authorization: `Bearer ${token}` } })
        .then((response) => response.ok ? response.json() : null)
        .then((data) => {
          if (!data) return;
          const live = normalizeCalendarSystem(data.settings?.calendar_system);
          cacheCalendarSystem(live);
          setState(live);
        })
        .catch(() => {});
    }
    return () => window.removeEventListener(CALENDAR_EVENT, sync);
  }, []);

  const value = useMemo(() => ({
    calendarSystem,
    setCalendarSystem: (next) => {
      const normalized = cacheCalendarSystem(next);
      setState(normalized);
    },
  }), [calendarSystem]);

  return <CalendarContext.Provider value={value}>{children}</CalendarContext.Provider>;
}

export function useCalendarSystem() {
  return useContext(CalendarContext);
}
