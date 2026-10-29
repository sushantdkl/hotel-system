'use client';

import { useEffect, useState } from 'react';
import { QrCode, RefreshCw, X } from 'lucide-react';
import { usePaymentQr } from '@/lib/payment-qr.js';

/**
 * Full-screen payment QR for the waiter's tablet.
 *
 * Waiters carry a tablet but walk to the counter to show the printed code.
 * This shows the same code the admin uploaded in Settings, big enough to scan
 * at arm's length across a table.
 *
 * Read-only by design: it records NOTHING. The cashier still settles the bill.
 * The one thing a printed placard cannot do is show the amount, so when the
 * caller actually knows the outstanding balance it is displayed large above
 * the code. A code with `payload` (EMVCo merchant QR) is redrawn with that
 * amount set in it; any other code carries none, so the guest types it in.
 *
 * Note for anyone wiring this up: GET /api/admin/settings answers
 * `{ settings: {...} }`. Reading `data.esewa_qr_image` off the top level finds
 * nothing and the modal wrongly reports "no QR uploaded" — read
 * `data.settings.esewa_qr_image`.
 */

const money = (value) =>
  `Rs ${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function PayQrModal({
  open,
  onClose,
  codes = [],
  restaurantName = '',
  loading = false,
  error = '',
  onRetry,
  /** Outstanding balance, or null when the caller does not know it. */
  amountDue = null,
}) {
  const [activeKey, setActiveKey] = useState(codes[0]?.key || '');

  // Escape closes, and the body must not scroll behind a full-screen overlay.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  // Resolved during render rather than synced in an effect: if the selected
  // key is not among the codes (they loaded late, or one was removed) the
  // first code wins, with no extra render pass.
  const active = codes.find((code) => code.key === activeKey) || codes[0] || null;
  const knowsAmount = amountDue !== null && amountDue !== undefined && Number.isFinite(Number(amountDue));
  const settled = knowsAmount && Number(amountDue) <= 0.005;
  const qr = usePaymentQr(
    { bank_qr_image: active?.image, payment_qr_payload: active?.payload },
    open && knowsAmount ? amountDue : 0,
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[95] flex flex-col bg-white"
      role="dialog"
      aria-modal="true"
      aria-label="Payment QR"
    >
      <header className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">Scan to pay</p>
          <h2 className="truncate text-lg font-bold text-stone-900">{restaurantName || 'Payment QR'}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-xl p-2.5 text-stone-500 hover:bg-stone-100 hover:text-stone-900"
          aria-label="Close"
        >
          <X className="h-7 w-7" />
        </button>
      </header>

      {codes.length > 1 && (
        <div className="flex gap-2 border-b border-stone-200 px-4 py-2" role="tablist">
          {codes.map((code) => (
            <button
              key={code.key}
              type="button"
              role="tab"
              aria-selected={code.key === active?.key}
              onClick={() => setActiveKey(code.key)}
              className={`rounded-xl px-4 py-2 text-sm font-semibold ${
                code.key === active?.key ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-700'
              }`}
            >
              {code.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-4">
        {loading ? (
          <p className="text-sm text-stone-500">Loading payment QR…</p>
        ) : error ? (
          <div className="text-center">
            <p className="text-sm font-semibold text-rose-700">{error}</p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-stone-900 px-5 py-3 text-sm font-semibold text-white hover:bg-stone-800"
              >
                <RefreshCw className="h-4 w-4" /> Try again
              </button>
            )}
          </div>
        ) : !active ? (
          <div className="max-w-sm text-center">
            <QrCode className="mx-auto h-12 w-12 text-stone-300" />
            <p className="mt-4 text-base font-semibold text-stone-900">No payment QR uploaded yet</p>
            <p className="mt-2 text-sm text-stone-600">
              An admin can add one in <strong>Settings → Payment QR</strong>. Until then, take payment at the counter.
            </p>
          </div>
        ) : (
          <>
            {/* A static merchant QR carries no amount — the guest types it in,
                so it is the biggest thing on the screen when we know it. */}
            {settled ? (
              <p className="mb-2 rounded-xl bg-emerald-50 px-4 py-2 text-base font-bold text-emerald-800">
                Nothing left to pay
              </p>
            ) : knowsAmount ? (
              <div className="mb-2 text-center">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">{qr.amountInQr ? 'Amount (already set in the QR)' : 'Amount to enter'}</p>
                <p className="text-4xl font-extrabold tabular-nums text-stone-900 sm:text-5xl">{money(amountDue)}</p>
              </div>
            ) : null}

            <img
              src={qr.image}
              alt={active.label}
              className="max-h-[62vh] w-auto max-w-[min(92vw,44rem)] flex-1 object-contain"
            />
            <p className="mt-2 text-center text-sm text-stone-600">
              {active.label} · hold the phone steady and scan
            </p>
          </>
        )}
      </div>

      <footer className="border-t border-stone-200 px-4 py-3">
        <p className="mb-2 text-center text-[11px] text-stone-500">
          This screen only shows the code. The cashier still settles the bill.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-xl bg-stone-900 py-3.5 text-base font-semibold text-white hover:bg-stone-800"
        >
          Close
        </button>
      </footer>
    </div>
  );
}
