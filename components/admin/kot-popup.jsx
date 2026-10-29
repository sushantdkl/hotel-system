'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChefHat, LoaderCircle, X } from 'lucide-react';

const STATUS_BADGE = {
  pending: 'bg-amber-100 text-amber-700',
  preparing: 'bg-sky-100 text-sky-700',
  completed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
  voided: 'bg-red-100 text-red-700',
};

/** Click-to-preview popup for a single KOT — used from bills, orders and reports so a KOT never has to open a whole new page just to be read. */
export default function KotPopup({ kotId, onClose }) {
  const [kot, setKot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!kotId) return undefined;
    const controller = new AbortController();
    Promise.resolve()
      .then(() => {
        if (controller.signal.aborted) return null;
        setLoading(true);
        setError(null);
        return fetch(`/api/admin/pos/kots/${kotId}`, {
          signal: controller.signal,
          headers: { Authorization: `Bearer ${localStorage.getItem('pos_token')}` },
        });
      })
      .then(async (response) => {
        if (!response) return;
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'The kitchen ticket could not be loaded.');
        setKot(body.kot || null);
      })
      .catch((loadError) => {
        if (loadError.name !== 'AbortError') setError(loadError.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    const closeOnEscape = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      controller.abort();
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [kotId, onClose]);

  if (!kotId || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-gray-950/55 p-4 backdrop-blur-[2px]" role="presentation" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Kitchen ticket details"
        onMouseDown={(event) => event.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-200 px-5 py-4">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400"><ChefHat className="h-3.5 w-3.5" /> Kitchen ticket</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-gray-950">{kot?.kotNumber || `KOT #${kotId}`}</h2>
              {kot?.status && <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_BADGE[String(kot.status).toLowerCase()] || 'bg-gray-100 text-gray-700'}`}>{kot.status}</span>}
            </div>
            {kot && <p className="mt-1 text-xs text-gray-400">{kot.orderNumber}{kot.tableNumber ? ` · Table ${kot.tableNumber}` : ''}{kot.station ? ` · ${kot.station}` : ''}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 hover:bg-gray-100" aria-label="Close kitchen ticket"><X className="h-5 w-5" /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex min-h-40 items-center justify-center"><LoaderCircle className="h-6 w-6 animate-spin text-gray-400" /></div>
          ) : error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : kot ? (
            <div className="space-y-4">
              <dl className="grid grid-cols-3 gap-2 rounded-xl border border-gray-200 bg-gray-50/70 px-3 py-2.5 text-center">
                <div><dt className="text-[10px] uppercase tracking-wide text-gray-400">Printed</dt><dd className="mt-0.5 text-xs font-medium text-gray-900">{kot.printedAtDisplay}</dd></div>
                <div><dt className="text-[10px] uppercase tracking-wide text-gray-400">Started</dt><dd className="mt-0.5 text-xs font-medium text-gray-900">{kot.startedAtDisplay}</dd></div>
                <div><dt className="text-[10px] uppercase tracking-wide text-gray-400">Completed</dt><dd className="mt-0.5 text-xs font-medium text-gray-900">{kot.completedAtDisplay}</dd></div>
              </dl>
              {kot.cancelReason && <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700"><span className="font-semibold">Reason:</span> {kot.cancelReason}</p>}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Items</p>
                <div className="divide-y divide-gray-100 rounded-xl border border-gray-200">
                  {kot.items.length ? kot.items.map((item, index) => (
                    <div key={index} className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900">{item.quantity}× {item.name}</p>
                        {item.instructions && <p className="mt-0.5 text-xs text-gray-500">{item.instructions}</p>}
                      </div>
                      {item.status && <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${STATUS_BADGE[String(item.status).toLowerCase()] || 'bg-gray-100 text-gray-700'}`}>{item.status}</span>}
                    </div>
                  )) : <p className="px-3 py-4 text-center text-sm text-gray-500">No item lines on this ticket.</p>}
                </div>
              </div>
              {kot.orderNotes && <p className="text-xs text-gray-500"><span className="font-semibold text-gray-600">Order notes:</span> {kot.orderNotes}</p>}
            </div>
          ) : null}
        </div>
      </section>
    </div>,
    document.body
  );
}
