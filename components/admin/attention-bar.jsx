'use client';

import { AlertTriangle } from 'lucide-react';

/**
 * "What do I need to do next?" banner. Semantic colour is used here and on
 * status badges only — everything else in the admin stays neutral.
 */
export default function AttentionBar({ tone = 'amber', title, body, action }) {
  const tones = {
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    red: 'border-red-200 bg-red-50 text-red-900',
    blue: 'border-blue-200 bg-blue-50 text-blue-900',
  };
  return (
    <div className={`flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center ${tones[tone] || tones.amber}`}>
      <AlertTriangle className="h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        {body && <p className="mt-0.5 text-sm opacity-80">{body}</p>}
      </div>
      {action}
    </div>
  );
}
