'use client';

/**
 * App-wide custom confirm / prompt / alert dialogs — a themed replacement for
 * the browser's window.confirm/prompt/alert. Promise-based so callers can
 * `await` a decision inline.
 *
 *   const { confirm, prompt, alert } = useConfirm();
 *
 *   if (!(await confirm({ title, message, tone: 'danger' }))) return;
 *
 *   const reason = await prompt({ title, message, label: 'Reason', required: true });
 *   if (reason == null) return;          // cancelled
 *
 *   await alert({ title, message });     // single OK button
 */

import * as React from 'react';
import { AlertTriangle, Info, Loader2, Trash2, X } from 'lucide-react';

const ConfirmContext = React.createContext(null);

const TONES = {
  default: { ring: 'bg-blue-100 text-blue-600', btn: 'bg-blue-600 hover:bg-blue-700', Icon: Info },
  danger: { ring: 'bg-red-100 text-red-600', btn: 'bg-red-600 hover:bg-red-700', Icon: AlertTriangle },
  warning: { ring: 'bg-amber-100 text-amber-600', btn: 'bg-amber-500 hover:bg-amber-600', Icon: AlertTriangle },
  delete: { ring: 'bg-red-100 text-red-600', btn: 'bg-red-600 hover:bg-red-700', Icon: Trash2 },
};

export function ConfirmProvider({ children }) {
  const [dialog, setDialog] = React.useState(null);
  const [value, setValue] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const resolver = React.useRef(null);

  const open = React.useCallback((opts) => {
    return new Promise((resolve) => {
      resolver.current = resolve;
      setValue(opts?.defaultValue ?? '');
      setBusy(false);
      setDialog({
        mode: opts.mode || 'confirm', // confirm | prompt | alert
        title: opts.title || 'Are you sure?',
        message: opts.message || '',
        tone: opts.tone || (opts.mode === 'alert' ? 'default' : 'warning'),
        confirmLabel: opts.confirmLabel || (opts.mode === 'alert' ? 'OK' : 'Confirm'),
        cancelLabel: opts.cancelLabel || 'Cancel',
        label: opts.label || null,
        placeholder: opts.placeholder || '',
        required: opts.required !== false && opts.mode === 'prompt',
        multiline: !!opts.multiline,
      });
    });
  }, []);

  const settle = React.useCallback((result) => {
    const resolve = resolver.current;
    resolver.current = null;
    setDialog(null);
    setValue('');
    setBusy(false);
    resolve?.(result);
  }, []);

  const api = React.useMemo(() => ({
    confirm: (opts = {}) => open({ ...opts, mode: 'confirm' }),
    prompt: (opts = {}) => open({ ...opts, mode: 'prompt' }),
    alert: (opts = {}) => open({ ...opts, mode: 'alert' }),
  }), [open]);

  const onCancel = () => {
    if (busy) return;
    settle(dialog.mode === 'prompt' ? null : false);
  };

  const onConfirm = () => {
    if (dialog.mode === 'prompt') {
      const trimmed = String(value).trim();
      if (dialog.required && !trimmed) return;
      settle(trimmed);
    } else {
      settle(true);
    }
  };

  const tone = dialog ? (TONES[dialog.tone] || TONES.default) : TONES.default;
  const ToneIcon = tone.Icon;
  const confirmDisabled = busy || (dialog?.mode === 'prompt' && dialog.required && !String(value).trim());

  return (
    <ConfirmContext.Provider value={api}>
      {children}
      {dialog && (
        <div className="fixed inset-0 z-[120] flex items-end justify-center sm:items-center">
          <div
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-[1px] animate-in fade-in duration-150"
            onClick={onCancel}
          />
          <div className="relative z-10 w-full max-w-md rounded-t-2xl bg-white p-5 shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200 sm:rounded-2xl sm:p-6">
            <button
              type="button"
              onClick={onCancel}
              className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="flex items-start gap-3.5">
              <div className={`shrink-0 rounded-xl p-2.5 ${tone.ring}`}>
                <ToneIcon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1 pr-4">
                <h3 className="text-lg font-bold text-slate-900">{dialog.title}</h3>
                {dialog.message && (
                  <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{dialog.message}</p>
                )}
              </div>
            </div>

            {dialog.mode === 'prompt' && (
              <div className="mt-4">
                {dialog.label && (
                  <label className="mb-1 block text-xs font-semibold text-slate-700">
                    {dialog.label}{dialog.required && <span className="text-red-500"> *</span>}
                  </label>
                )}
                {dialog.multiline ? (
                  <textarea
                    autoFocus
                    rows={3}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={dialog.placeholder}
                    className="w-full resize-none rounded-xl border-2 border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none"
                  />
                ) : (
                  <input
                    autoFocus
                    type="text"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !confirmDisabled) onConfirm(); }}
                    placeholder={dialog.placeholder}
                    className="w-full rounded-xl border-2 border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none"
                  />
                )}
              </div>
            )}

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {dialog.mode !== 'alert' && (
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={busy}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 sm:min-w-[110px]"
                >
                  {dialog.cancelLabel}
                </button>
              )}
              <button
                type="button"
                onClick={onConfirm}
                disabled={confirmDisabled}
                className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 sm:min-w-[110px] ${tone.btn}`}
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {dialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = React.useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx;
}
