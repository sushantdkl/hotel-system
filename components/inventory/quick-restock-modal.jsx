'use client';

/**
 * Single-line restock. `item` pre-selects the raw material (from a table row's
 * "+ Restock" button); omit it for a free-choice picker.
 *
 * ── Which path converts ───────────────────────────────────────────────────
 * Nothing here converts. POST /api/admin/inventory/restock already accepts a
 * `units` flag and hands it to the ledger, so the quantity and the matching
 * cost are sent RAW in whichever unit was typed and the ledger converts once.
 * Converting here as well would multiply twice.
 */

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import { apiJson } from '@/lib/authed-fetch';
import QuantityInput from '@/components/ui/quantity-input';
import CostEntry from '@/components/ui/cost-entry';
import { unitLabel } from '@/lib/units';
import { deriveCost, blankCost, hasTwoUnits, round } from '@/lib/entry-math';

function factorOf(item) {
  const cf = Number(item?.conversion_factor);
  return Number.isFinite(cf) && cf > 0 ? cf : 1;
}

export default function QuickRestockModal({ item, rawMaterials = [], onClose, onRestocked }) {
  const { addToast } = useToast();
  const [saving, setSaving] = useState(false);
  const [itemId, setItemId] = useState(item?.id ? String(item.id) : '');
  const [supplier, setSupplier] = useState(item?.supplier || '');
  const [invoiceNumber, setInvoiceNumber] = useState('');

  // With the free-choice picker the units only exist once an item is chosen.
  const selected = item || rawMaterials.find((m) => String(m.id) === itemId) || null;
  const factor = factorOf(selected);
  const cUnit = selected?.consumption_unit || selected?.unit || '';
  const pUnit = selected?.purchase_unit || cUnit;
  const dual = hasTwoUnits({ purchaseUnit: selected?.purchase_unit, consumptionUnit: cUnit, factor });

  const [quantity, setQuantity] = useState({ amount: '', unit: 'purchase' });
  const [cost, setCost] = useState(() =>
    // Stored per consumption unit; shown back as the per-purchase-unit rate.
    item?.cost_per_unit === undefined || item?.cost_per_unit === null || item?.cost_per_unit === ''
      ? blankCost()
      : { basis: 'per_purchase_unit', amount: String(round(Number(item.cost_per_unit) * factorOf(item), 6)) }
  );

  const entry = dual ? quantity : { ...quantity, unit: 'consumption' };
  const amount = Number(entry.amount);
  // Cost totals are always spread across PURCHASE units.
  const qtyPurchase = Number.isFinite(amount) ? (entry.unit === 'purchase' ? amount : amount / factor) : NaN;
  const costs = deriveCost(cost, qtyPurchase > 0 ? qtyPurchase : null, factor);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!itemId) {
      addToast(friendlyMessage('validation', { description: 'Pick which raw material to restock.' }));
      return;
    }
    if (!(amount > 0)) {
      addToast(friendlyMessage('validation', { description: 'Added quantity must be greater than zero.' }));
      return;
    }

    setSaving(true);
    try {
      // Quantity and cost go RAW, tagged with the unit they were typed in —
      // the ledger converts them together. See the header.
      const unitCost = entry.unit === 'purchase' ? costs.perPurchaseUnit : costs.perConsumptionUnit;
      const data = await apiJson('/api/admin/inventory/restock', {
        method: 'POST',
        body: JSON.stringify({
          inventory_item_id: itemId,
          added_quantity: amount,
          units: entry.unit,
          unit_cost: unitCost === null ? null : unitCost,
          supplier: supplier || null,
          invoice_number: invoiceNumber || null,
        }),
      });
      addToast(
        friendlyMessage('save_success', {
          description: `${round(amount * (entry.unit === 'purchase' ? factor : 1))} ${unitLabel(cUnit)} added to stock.`,
        })
      );
      onRestocked?.(data.item);
      onClose();
    } catch (error) {
      addToast(friendlyFromError(error, 'save_failed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>Restock {selected?.item_name || 'raw material'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {!item && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Raw material</label>
              <select className={INPUT} value={itemId} onChange={(e) => setItemId(e.target.value)}>
                <option value="">Select item…</option>
                {rawMaterials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.item_name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Added quantity</label>
            <QuantityInput
              value={entry}
              onChange={setQuantity}
              purchaseUnit={selected?.purchase_unit}
              consumptionUnit={cUnit}
              factor={factor}
              autoFocus
              hint="will be added to stock"
            />
          </div>

          <div className="rounded-xl border border-gray-200 p-4">
            <CostEntry
              value={cost}
              onChange={setCost}
              quantity={qtyPurchase > 0 ? qtyPurchase : null}
              purchaseUnit={pUnit}
              consumptionUnit={cUnit}
              factor={factor}
              label="Cost"
            />
            <p className="mt-2 text-xs text-gray-400">
              Leave blank to keep the current average cost — a zero here would drag it down.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Supplier name</label>
              <input type="text" className={INPUT} value={supplier} onChange={(e) => setSupplier(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Invoice / PO number</label>
              <input type="text" className={INPUT} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
            </div>
          </div>
        </form>
        <DialogFooter>
          <button type="button" onClick={onClose} className="h-10 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-700">
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSubmit}
            className="h-10 rounded-lg bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {saving ? 'Restocking…' : 'Restock'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const INPUT = 'h-10 w-full rounded-lg border border-gray-300 px-3 text-sm text-gray-900';
