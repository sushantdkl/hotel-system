'use client';

/**
 * The only place a quantity is changed by hand.
 *
 * The ledger refuses a manual_adjustment without a reason (400), so the reason
 * is required here rather than discovered by the owner as an error. Per the
 * owner's spec the modal also routes the change to the record that explains it:
 *   increase  + "purchased"      -> POST /api/admin/purchases (creates an expense)
 *   increase  + "not purchased"  -> plain manual adjustment
 *   decrease  + "wastage"        -> hands off to the wastage flow
 *   decrease  + anything else    -> plain manual adjustment
 *
 * ── Which path converts ───────────────────────────────────────────────────
 * The count can be typed in either unit ("5 kg" or "5000 g"), but the two
 * routes out of here take different units and only one of them converts:
 *
 *   adjustment -> PUT /api/admin/inventory sends an absolute `quantity`, which
 *       that route diffs and posts with the default units:'consumption'. So we
 *       convert to consumption units HERE.
 *   purchase   -> POST /api/admin/purchases posts lines with units:'purchase',
 *       so the ledger converts and we send PURCHASE units RAW.
 *
 * See lib/inventory-ledger.js for the canonical unit rule.
 */

import { useState } from 'react';
import { ArrowRight, Trash2, Truck } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import { apiJson } from '@/lib/authed-fetch';
import QuantityInput from '@/components/ui/quantity-input';
import CostEntry from '@/components/ui/cost-entry';
import { unitLabel } from '@/lib/units';
import { toConsumptionAmount, deriveCost, blankCost, hasTwoUnits, round } from '@/lib/entry-math';
import { nepalDateString } from '@/lib/report-dates.js';

const DECREASE_REASONS = [
  'Stock count correction',
  'Transferred to another outlet',
  'Returned to supplier',
  'Staff meal',
  'Other',
];
const INCREASE_REASONS = [
  'Stock count correction',
  'Found stock / miscount',
  'Transferred in from another outlet',
  'Opening balance correction',
  'Other',
];

export default function StockAdjustmentModal({ item, suppliers = [], onClose, onDone, onWastage }) {
  const { addToast } = useToast();
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState('set'); // 'set' | 'delta'
  const [reason, setReason] = useState('');
  const [reasonNote, setReasonNote] = useState('');
  const [route, setRoute] = useState(null); // null | 'purchase' | 'adjustment' | 'wastage'
  const [purchaseQty, setPurchaseQty] = useState('');
  const [cost, setCost] = useState(blankCost());
  const [supplier, setSupplier] = useState(item.supplier || '');
  const [invoiceNumber, setInvoiceNumber] = useState('');

  const current = Number(item.quantity ?? 0);
  const factor = Number(item.conversion_factor) > 0 ? Number(item.conversion_factor) : 1;
  const cUnit = item.consumption_unit || item.unit || 'units';
  const pUnit = item.purchase_unit || cUnit;
  const dual = hasTwoUnits({ purchaseUnit: item.purchase_unit, consumptionUnit: cUnit, factor });

  // Counts are typed in whichever unit is at hand; `unit` is the literal
  // 'purchase'/'consumption' selector, not a unit name.
  const [newQty, setNewQty] = useState({ amount: String(current), unit: 'consumption' });
  const [delta, setDelta] = useState({ amount: '', unit: dual ? 'purchase' : 'consumption' });

  const entry = mode === 'set' ? newQty : delta;
  const typed = dual ? entry : { ...entry, unit: 'consumption' };
  const typedConsumption = toConsumptionAmount(typed, factor);

  const target = mode === 'set' ? typedConsumption : current + (Number.isFinite(typedConsumption) ? typedConsumption : 0);
  const change = Number.isFinite(target) ? target - current : 0;
  const direction = change > 0 ? 'increase' : change < 0 ? 'decrease' : 'none';

  // Suggest a purchase quantity that lands exactly on the requested increase.
  const suggestedPurchaseQty = change > 0 ? round(change / factor) : 0;
  const effectivePurchaseQty = purchaseQty === '' ? suggestedPurchaseQty : Number(purchaseQty);
  const purchaseAddsConsumption = effectivePurchaseQty * factor;
  const costs = deriveCost(cost, effectivePurchaseQty > 0 ? effectivePurchaseQty : null, factor);

  function setEntry(value) {
    (mode === 'set' ? setNewQty : setDelta)(value);
    setRoute(null);
  }

  const finalReason = reason === 'Other' ? reasonNote.trim() : reason;

  async function submitAdjustment() {
    if (!finalReason) {
      addToast(friendlyMessage('validation', { description: 'Give a reason — the stock ledger records it against this change.' }));
      return;
    }
    setSaving(true);
    try {
      // PUT keeps every other field as-is; the route routes the quantity delta
      // through the ledger with this reason attached.
      // Consumption units — this route diffs `quantity` and posts the delta
      // with the ledger's default units:'consumption'.
      await apiJson('/api/admin/inventory', {
        method: 'PUT',
        body: JSON.stringify({
          ...item,
          id: item.id,
          quantity: round(target, 6),
          adjustment_reason: finalReason,
        }),
      });
      addToast(
        friendlyMessage('save_success', {
          description: `${item.item_name}: ${current} → ${round(target)} ${unitLabel(cUnit)}. Recorded as a manual adjustment.`,
        })
      );
      onDone?.();
      onClose();
    } catch (error) {
      addToast(friendlyFromError(error, 'save_failed'));
    } finally {
      setSaving(false);
    }
  }

  async function submitPurchase() {
    if (!(effectivePurchaseQty > 0)) {
      addToast(friendlyMessage('validation', { description: `Enter how many ${pUnit} arrived.` }));
      return;
    }
    setSaving(true);
    try {
      const data = await apiJson('/api/admin/purchases', {
        method: 'POST',
        body: JSON.stringify({
          supplier: supplier || null,
          invoice_number: invoiceNumber.trim() || null,
          invoice_date: nepalDateString(),
          notes: finalReason || 'Recorded from a stock adjustment',
          // PURCHASE units, unconverted — createPurchase posts with units:'purchase'.
          items: [
            {
              inventory_item_id: item.id,
              quantity_ordered: effectivePurchaseQty,
              quantity_received: effectivePurchaseQty,
              unit_cost: costs.perPurchaseUnit ?? 0,
            },
          ],
        }),
      });
      addToast(
        friendlyMessage('save_success', {
          description: `Saved as Purchase #${data.purchase?.id} under Purchases. Stock +${round(purchaseAddsConsumption)} ${unitLabel(cUnit)}; expense posted.`,
        })
      );
      onDone?.();
      onClose();
    } catch (error) {
      addToast(friendlyFromError(error, 'save_failed'));
    } finally {
      setSaving(false);
    }
  }

  const askingRoute = direction !== 'none' && route === null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent onClose={onClose} className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Adjust stock — {item.item_name}</DialogTitle>
        </DialogHeader>

        <div className="mt-4 space-y-5">
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div className="flex items-center justify-between gap-4 text-sm">
              <div>
                <p className="text-xs font-medium text-gray-500">Current stock</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">
                  {current} <span className="text-sm font-normal text-gray-500">{unitLabel(cUnit)}</span>
                </p>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-gray-400" />
              <div className="text-right">
                <p className="text-xs font-medium text-gray-500">After this change</p>
                <p
                  className={`mt-0.5 text-lg font-semibold tabular-nums ${
                    direction === 'increase' ? 'text-emerald-700' : direction === 'decrease' ? 'text-red-700' : 'text-gray-900'
                  }`}
                >
                  {Number.isFinite(target) ? round(target) : '—'}{' '}
                  <span className="text-sm font-normal text-gray-500">{unitLabel(cUnit)}</span>
                </p>
              </div>
            </div>
          </div>

          <div>
            <div className="mb-2 flex gap-2">
              {[
                { id: 'set', label: 'Set new count' },
                { id: 'delta', label: 'Add / remove' },
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  className={`h-9 rounded-lg px-3 text-sm font-medium ${
                    mode === m.id ? 'bg-gray-900 text-white' : 'border border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <QuantityInput
              value={typed}
              onChange={setEntry}
              purchaseUnit={item.purchase_unit}
              consumptionUnit={cUnit}
              factor={factor}
              autoFocus
              allowNegative={mode === 'delta'}
              placeholder={mode === 'set' ? 'Counted quantity' : 'e.g. 5 to add, -5 to remove'}
            />
            <p className="mt-1.5 text-xs text-gray-400">
              {dual
                ? `Type in ${unitLabel(pUnit)} or ${unitLabel(cUnit)} — stock is stored in ${unitLabel(cUnit)}.`
                : `Quantities here are in ${unitLabel(cUnit)} — the unit this item is consumed in.`}
            </p>
          </div>

          {askingRoute && direction === 'increase' && (
            <div className="rounded-xl border border-gray-200 p-4">
              <p className="text-sm font-medium text-gray-900">Was this stock purchased?</p>
              <p className="mt-1 text-sm text-gray-500">
                Recording it as a purchase also creates the matching expense, so food cost stays honest.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setRoute('purchase')}
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800"
                >
                  <Truck className="h-4 w-4" /> Yes — record a purchase
                </button>
                <button
                  type="button"
                  onClick={() => setRoute('adjustment')}
                  className="h-10 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  No — just correct the count
                </button>
              </div>
            </div>
          )}

          {askingRoute && direction === 'decrease' && (
            <div className="rounded-xl border border-gray-200 p-4">
              <p className="text-sm font-medium text-gray-900">Why is the stock going down?</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onWastage?.(item, Math.abs(change));
                    onClose();
                  }}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  <Trash2 className="h-4 w-4" /> It was wasted — log wastage
                </button>
                <button
                  type="button"
                  onClick={() => setRoute('adjustment')}
                  className="h-10 rounded-lg bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800"
                >
                  Just correct the count
                </button>
              </div>
            </div>
          )}

          {route === 'purchase' && (
            <div className="space-y-4 rounded-xl border border-gray-200 p-4">
              <p className="text-sm font-medium text-gray-900">Purchase details</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    Quantity received ({unitLabel(pUnit)})
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={purchaseQty === '' ? suggestedPurchaseQty : purchaseQty}
                    onChange={(e) => setPurchaseQty(e.target.value)}
                    className="h-10 w-full rounded-lg border border-gray-300 px-3 text-sm"
                  />
                  <p className="mt-1 text-xs text-gray-400">
                    Adds {round(purchaseAddsConsumption) || 0} {unitLabel(cUnit)} to stock
                    {dual ? ` (1 ${unitLabel(pUnit)} = ${factor} ${unitLabel(cUnit)})` : ''}.
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <CostEntry
                    value={cost}
                    onChange={setCost}
                    quantity={effectivePurchaseQty > 0 ? effectivePurchaseQty : null}
                    purchaseUnit={pUnit}
                    consumptionUnit={cUnit}
                    factor={factor}
                    label="Cost"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Supplier</label>
                  <input
                    list="adjust-suppliers"
                    value={supplier}
                    onChange={(e) => setSupplier(e.target.value)}
                    className="h-10 w-full rounded-lg border border-gray-300 px-3 text-sm"
                    placeholder="Type to pick or create"
                  />
                  <datalist id="adjust-suppliers">
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.name} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Invoice number</label>
                  <input
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    className="h-10 w-full rounded-lg border border-gray-300 px-3 text-sm"
                    placeholder="Optional"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500">
                An expense of Rs {(costs.total ?? 0).toFixed(2)} will be posted against this purchase.
              </p>
            </div>
          )}

          {route === 'adjustment' && (
            <div className="space-y-3 rounded-xl border border-gray-200 p-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Reason <span className="text-red-600">*</span>
                </label>
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="h-10 w-full rounded-lg border border-gray-300 px-3 text-sm"
                >
                  <option value="">Choose a reason…</option>
                  {(direction === 'increase' ? INCREASE_REASONS : DECREASE_REASONS).map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              {reason === 'Other' && (
                <input
                  autoFocus
                  value={reasonNote}
                  onChange={(e) => setReasonNote(e.target.value)}
                  placeholder="Describe what happened"
                  className="h-10 w-full rounded-lg border border-gray-300 px-3 text-sm"
                />
              )}
              <p className="text-xs text-gray-500">
                This reason is stored on the stock movement, so the history explains itself later.
              </p>
            </div>
          )}

          {direction === 'none' && (
            <p className="text-sm text-gray-500">
              Enter a different quantity to record an adjustment.
            </p>
          )}
        </div>

        <DialogFooter>
          <button type="button" onClick={onClose} className="h-10 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-700">
            Cancel
          </button>
          {route === 'purchase' && (
            <button
              type="button"
              disabled={saving}
              onClick={submitPurchase}
              className="h-10 rounded-lg bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {saving ? 'Recording…' : 'Record purchase'}
            </button>
          )}
          {route === 'adjustment' && (
            <button
              type="button"
              disabled={saving || !finalReason}
              onClick={submitAdjustment}
              className="h-10 rounded-lg bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save adjustment'}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
