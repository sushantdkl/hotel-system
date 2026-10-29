'use client';

import DateInput from '@/components/ui/date-input.jsx';

/** Calendar-aware date plus native clock. Value remains AD YYYY-MM-DDTHH:mm. */
export default function DateTimeInput({ value = '', onChange, className = '', min, max }) {
  const [date = '', time = ''] = String(value || '').split('T');
  const combine = (nextDate, nextTime) => {
    if (!nextDate && !nextTime) onChange('');
    else onChange(`${nextDate || date}T${nextTime || time || '00:00'}`);
  };
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_7.5rem] gap-2">
      <DateInput value={date} onChange={(next) => combine(next, time)} min={min?.slice(0, 10)} max={max?.slice(0, 10)} className={className} />
      <input type="time" value={time} onChange={(event) => combine(date, event.target.value)} className={className} aria-label="Time" />
    </div>
  );
}
