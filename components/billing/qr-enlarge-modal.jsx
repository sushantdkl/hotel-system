'use client';

import { X } from 'lucide-react';

/**
 * Full-screen-ish QR enlarge modal for eSewa / bank / Fonepay scans.
 */
export default function QrEnlargeModal({ open, title, image, onClose }) {
  if (!open || !image) return null;

  return (
    <div
      className="fixed inset-0 z-[90] bg-black/75 flex items-center justify-center p-3 sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title || 'Payment QR'}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-xl sm:max-w-2xl p-4 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 mb-3 sm:mb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Scan to pay</p>
            <h3 className="text-lg sm:text-xl font-bold text-stone-900">{title || 'Payment QR'}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-stone-500 hover:bg-stone-100 hover:text-stone-800"
            aria-label="Close"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex items-center justify-center rounded-xl border-2 border-stone-200 bg-stone-50 p-3 sm:p-5">
          <img
            src={image}
            alt={title || 'QR code'}
            className="w-full max-w-[min(92vw,34rem)] max-h-[min(72vh,34rem)] object-contain"
          />
        </div>

        <p className="text-center text-sm text-stone-600 mt-3 sm:mt-4">
          Hold the phone steady and scan this QR code
        </p>

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full py-3 rounded-xl bg-stone-900 text-white font-semibold hover:bg-stone-800"
        >
          Close
        </button>
      </div>
    </div>
  );
}
