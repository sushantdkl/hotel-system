'use client';

import { buildTimeline } from '@/lib/waiter-reservations';

export default function ReservationTimeline({ reservation }) {
  if (!reservation) return null;
  const steps = buildTimeline(reservation);
  return (
    <ol className="space-y-0">
      {steps.map((step, i) => (
        <li key={step.key} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span
              className={`h-2.5 w-2.5 rounded-full mt-1.5 ${
                step.end
                  ? 'bg-red-500'
                  : step.done
                    ? 'bg-emerald-500'
                    : 'bg-slate-300'
              }`}
            />
            {i < steps.length - 1 && (
              <span className={`w-px flex-1 min-h-[16px] ${step.done ? 'bg-emerald-200' : 'bg-slate-200'}`} />
            )}
          </div>
          <p
            className={`text-xs pb-3 ${
              step.done ? 'text-slate-800 font-medium' : 'text-slate-400'
            }`}
          >
            {step.label}
          </p>
        </li>
      ))}
    </ol>
  );
}
