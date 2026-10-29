'use client';

/**
 * The optional per-bill service / extra / custom charge control.
 *
 * Settings holds the house rate. A packing fee, an event surcharge or a WAIVED
 * service charge is a decision made at this checkout, so it is a tick box on the
 * bill rather than a global setting.
 *
 * Extracted so the three checkout screens — Admin POS, walk-in billing and the
 * cashier's bill page — offer the identical control and send the identical
 * payload. Three copies of a pricing control is three chances for them to price
 * the same bill differently.
 *
 * Sends MODE and VALUE, never a computed amount: every route re-prices the bill
 * server-side and must not trust a client total.
 */

import { Percent } from 'lucide-react';

export const emptyServiceCharge = { enabled: false, mode: 'percent', value: '' };

/** The two fields every checkout route reads. Null when nothing was chosen. */
export function serviceChargePayload(charge) {
  if (!charge?.enabled) return { service_charge_mode: null, service_charge_value: null };
  return {
    service_charge_mode: charge.mode,
    service_charge_value: Number(charge.value) || 0,
  };
}

export default function ServiceChargeField({ value = emptyServiceCharge, onChange, className = '' }) {
  const charge = value || emptyServiceCharge;
  const set = (patch) => onChange?.({ ...charge, ...patch });
  return (
    <div className={`rounded-xl border border-violet-200 bg-violet-50/70 p-3 ${className}`}>
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={!!charge.enabled}
          onChange={(event) => set({ enabled: event.target.checked })}
          className="mt-0.5 h-4 w-4 rounded border-violet-300 text-violet-600"
        />
        <span>
          <span className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
            <Percent className="h-4 w-4 text-violet-700" /> Service / extra charge
          </span>
          <span className="mt-0.5 block text-xs text-slate-600">
            Adds a charge to this bill only. Leave unticked to use the house rate from Settings.
          </span>
        </span>
      </label>
      {charge.enabled && (
        <div className="mt-3 flex items-end gap-2">
          <label className="flex-1 text-xs font-bold text-slate-900">
            Charge
            <input
              type="number"
              min="0"
              step={charge.mode === 'amount' ? '0.01' : '0.1'}
              inputMode="decimal"
              value={charge.value ?? ''}
              onChange={(event) => set({ value: event.target.value })}
              className="mt-1 w-full rounded-lg border-2 border-violet-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
              placeholder={charge.mode === 'amount' ? '0.00' : '0'}
            />
          </label>
          {/* Rs or % is a real choice, not a formatting detail: one is a fixed
              fee, the other scales with the bill. */}
          <div className="flex overflow-hidden rounded-lg border-2 border-violet-200">
            {[['percent', '%'], ['amount', 'Rs']].map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => set({ mode })}
                className={`px-3 py-2 text-sm font-bold transition-colors ${
                  charge.mode === mode ? 'bg-violet-600 text-white' : 'bg-white text-slate-700 hover:bg-violet-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
