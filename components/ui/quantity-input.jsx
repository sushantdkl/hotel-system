'use client';

/**
 * Quantity typed in whichever unit the owner is holding.
 *
 * "5 kg" beats "5000 g" at the keyboard, but inventory_items.quantity is in
 * consumption units, so the number has to be converted somewhere. This widget
 * keeps the raw entry (`{ amount, unit }`) and leaves the conversion to the
 * caller via `toConsumptionAmount()` from lib/entry-math — the caller decides
 * whether to convert before POSTing or to pass `units:'purchase'` through.
 *
 * That split is deliberate: converting here AND sending `units:'purchase'`
 * would double-convert, so this file never talks to the network.
 */

import { unitLabel } from '@/lib/units';
import { toConsumptionAmount, hasTwoUnits, round } from '@/lib/entry-math';

export default function QuantityInput({
  value,
  onChange,
  purchaseUnit,
  consumptionUnit,
  factor,
  placeholder = '0',
  autoFocus = false,
  allowNegative = false,
  hint = null,
}) {
  const dual = hasTwoUnits({ purchaseUnit, consumptionUnit, factor });
  const entry = value || { amount: '', unit: dual ? 'purchase' : 'consumption' };
  const converted = toConsumptionAmount(entry, factor);
  const showConversion = dual && entry.unit === 'purchase' && Number.isFinite(converted) && Number(entry.amount) !== 0;

  return (
    <div>
      <div className="flex gap-2">
        <input
          type="number"
          step="any"
          min={allowNegative ? undefined : '0'}
          autoFocus={autoFocus}
          value={entry.amount}
          placeholder={placeholder}
          onChange={(e) => onChange({ ...entry, amount: e.target.value })}
          className="h-10 min-w-0 flex-1 rounded-lg border border-gray-300 px-3 text-sm text-gray-900"
        />
        {dual ? (
          <select
            value={entry.unit}
            onChange={(e) => onChange({ ...entry, unit: e.target.value })}
            className="h-10 shrink-0 rounded-lg border border-gray-300 bg-white px-2 text-sm text-gray-900"
          >
            <option value="purchase">{unitLabel(purchaseUnit)}</option>
            <option value="consumption">{unitLabel(consumptionUnit)}</option>
          </select>
        ) : (
          <span className="flex h-10 shrink-0 items-center rounded-lg bg-gray-50 px-3 text-sm text-gray-500">
            {unitLabel(consumptionUnit || purchaseUnit) || 'units'}
          </span>
        )}
      </div>

      {showConversion && (
        <p className="mt-1 text-xs text-gray-500">
          {entry.amount} {unitLabel(purchaseUnit)} ={' '}
          <span className="font-medium text-gray-700">
            {round(converted)} {unitLabel(consumptionUnit)}
          </span>
          {hint ? ` ${hint}` : ''}
        </p>
      )}
      {!showConversion && hint && Number.isFinite(converted) && Number(entry.amount) !== 0 && (
        <p className="mt-1 text-xs text-gray-500">
          {round(converted)} {unitLabel(consumptionUnit)} {hint}
        </p>
      )}
    </div>
  );
}
