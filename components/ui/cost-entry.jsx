'use client';

/**
 * Cost entered from whichever end the owner actually knows.
 *
 * A shopkeeper knows "Rs 250 per kg" or "the invoice said Rs 1,250". Nobody
 * knows "Rs 0.25 per gram" — which is what the ledger stores. So: type either
 * end, see all three, and the typed one is the source of truth.
 *
 * `value` is `{ basis: 'per_purchase_unit' | 'total', amount: string }`.
 * Callers read the derived numbers with `deriveCost()` from lib/entry-math and
 * pick the one their endpoint wants — this file never fetches, so it cannot
 * double-convert.
 */

import { unitLabel } from '@/lib/units';
import { deriveCost, round } from '@/lib/entry-math';

const money = (n) => (n === null || !Number.isFinite(n) ? '—' : `Rs ${round(n, 4)}`);

export default function CostEntry({
  value,
  onChange,
  quantity,
  purchaseUnit,
  consumptionUnit,
  factor,
  label = 'Cost',
}) {
  const entry = value || blankCost();
  const derived = deriveCost(entry, quantity, factor);
  const pUnit = unitLabel(purchaseUnit || consumptionUnit) || 'unit';
  const cUnit = unitLabel(consumptionUnit) || 'unit';
  const sameUnit = !purchaseUnit || purchaseUnit === consumptionUnit || !(Number(factor) > 0) || Number(factor) === 1;

  const options = [
    { id: 'per_purchase_unit', label: `Per ${pUnit}` },
    { id: 'total', label: 'Total amount' },
  ];

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        <div className="flex gap-1">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => onChange({ ...entry, basis: o.id })}
              className={`h-7 rounded-md px-2 text-xs font-medium ${
                entry.basis === o.id ? 'bg-gray-900 text-white' : 'border border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <span className="flex h-10 shrink-0 items-center rounded-lg bg-gray-50 px-3 text-sm text-gray-500">Rs</span>
        <input
          type="number"
          step="any"
          min="0"
          value={entry.amount}
          placeholder="0.00"
          onChange={(e) => onChange({ ...entry, amount: e.target.value })}
          className="h-10 min-w-0 flex-1 rounded-lg border border-gray-300 px-3 text-sm text-gray-900"
        />
      </div>

      <dl className="mt-2 space-y-0.5 text-xs">
        <CostRow
          label={`Per ${pUnit}`}
          value={money(derived.perPurchaseUnit)}
          typed={entry.basis === 'per_purchase_unit'}
        />
        <CostRow label="Total" value={money(derived.total)} typed={entry.basis === 'total'} />
        {!sameUnit && <CostRow label={`Per ${cUnit} (stored)`} value={money(derived.perConsumptionUnit)} typed={false} />}
      </dl>

      {entry.basis === 'total' && derived.perPurchaseUnit === null && String(entry.amount).trim() !== '' && (
        <p className="mt-1 text-xs text-amber-700">Enter a quantity first — a total can only be split into a rate once we know how much arrived.</p>
      )}
    </div>
  );
}

function CostRow({ label, value, typed }) {
  return (
    <div className="flex items-center justify-between">
      <dt className={typed ? 'font-medium text-gray-700' : 'text-gray-400'}>
        {label} {typed ? <span className="text-gray-400">· you typed this</span> : <span className="text-gray-300">· calculated</span>}
      </dt>
      <dd className={`tabular-nums ${typed ? 'font-medium text-gray-900' : 'text-gray-500'}`}>{value}</dd>
    </div>
  );
}
