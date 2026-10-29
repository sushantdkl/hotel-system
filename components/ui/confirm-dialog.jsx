'use client';

import { createPortal } from 'react-dom';
import { useSyncExternalStore } from 'react';
import { AlertTriangle, X } from 'lucide-react';

/**
 * Full-screen confirmation dialog (portaled to body so sidebar transforms don't clip it).
 */
/** Client-ness never changes after hydration, so there is nothing to subscribe to. */
const subscribeNoop = () => () => {};

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger', // danger | warning | primary
  busy = false,
  icon: Icon = AlertTriangle,
  onConfirm,
  onCancel,
}) {
  // createPortal needs `document`, absent while server-rendering.
  // useSyncExternalStore reports client-ness without a setState-in-effect pass.
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);

  if (!open || !mounted) return null;

  const confirmClass =
    variant === 'danger'
      ? 'bg-red-600 hover:bg-red-700 text-white'
      : variant === 'warning'
        ? 'bg-amber-600 hover:bg-amber-700 text-white'
        : 'bg-stone-900 hover:bg-stone-800 text-white';

  const iconWrap =
    variant === 'danger'
      ? 'bg-red-50 text-red-600'
      : variant === 'warning'
        ? 'bg-amber-50 text-amber-700'
        : 'bg-stone-100 text-stone-800';

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
        aria-label="Dismiss"
        disabled={busy}
        onClick={onCancel}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="relative bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden"
      >
        <div className="p-5 border-b border-slate-100">
          <div className="flex items-start justify-between gap-3">
            <div className={`w-12 h-12 rounded-full ${iconWrap} flex items-center justify-center shrink-0`}>
              <Icon className="w-6 h-6" />
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              className="h-9 w-9 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 disabled:opacity-50"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <h3 id="confirm-dialog-title" className="text-lg font-bold text-slate-900 mt-3">
            {title}
          </h3>
          {description && (
            <p className="text-sm text-slate-600 mt-1.5 leading-relaxed whitespace-pre-wrap">
              {description}
            </p>
          )}
        </div>
        <div className="p-4 flex flex-col-reverse sm:flex-row gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="flex-1 h-11 rounded-xl bg-slate-100 text-slate-800 font-semibold disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`flex-1 h-11 rounded-xl font-semibold disabled:opacity-50 ${confirmClass}`}
          >
            {busy ? 'Please wait…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
