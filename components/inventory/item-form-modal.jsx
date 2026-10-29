'use client';

/**
 * Add / edit one inventory item.
 *
 * On edit the quantity field is absent on purpose — changing stock goes
 * through StockAdjustmentModal so a reason is always captured.
 *
 * ── Units ─────────────────────────────────────────────────────────────────
 * Both unit fields are UnitSelect (pick from the catalogue or type a custom
 * one). Changing either unit re-derives conversion_factor from lib/units;
 * typing in the factor marks it manual and nothing overwrites it after that.
 * The factor is never auto-derived on mount, so an existing item's hand-tuned
 * factor survives being opened for edit.
 *
 * ── Which path converts (this is where double conversion would hide) ──────
 * Opening stock is typed in whatever unit the owner is holding, then:
 *
 *   "I already own this"  -> POST /api/admin/inventory
 *        That route posts `quantity` through the ledger with the DEFAULT
 *        units:'consumption', so we convert to consumption units HERE.
 *
 *   "I just purchased it" -> POST /api/admin/inventory (quantity 0)
 *                        -> POST /api/admin/purchases
 *        createPurchase() posts its lines with units:'purchase', so the ledger
 *        converts and we send PURCHASE units RAW. No conversion here.
 *
 * Exactly one conversion happens on each path. See lib/entry-math.js.
 */

import { useState, useEffect } from 'react';
import { ChevronDown, Truck, Warehouse } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  AdminField,
  adminInputClass,
  adminTextareaClass,
  adminDialogLg,
  adminBtnPrimary,
  adminBtnSecondary,
  adminFieldStackClass,
} from '@/components/ui/admin-form';
import { useToast } from '@/components/ui/toast';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import { apiJson } from '@/lib/authed-fetch';
import UnitSelect from '@/components/ui/unit-select';
import Combobox from '@/components/ui/combobox';
import QuantityInput from '@/components/ui/quantity-input';
import CostEntry from '@/components/ui/cost-entry';
import { unitLabel, normalizeUnitOrKeep } from '@/lib/units';
import { resolveConversionFactor } from '@/lib/unit-conversions';
import { toConsumptionAmount, deriveCost, blankCost, hasTwoUnits, round } from '@/lib/entry-math';
import { nepalDateString } from '@/lib/report-dates.js';

export default function ItemFormModal({ item, suppliers = [], categories = [], menuItems = [], onClose, onSaved }) {
  const { addToast } = useToast();
  const editing = Boolean(item?.id);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    item_name: item?.item_name || '',
    category: item?.category || '',
    purchase_unit: item?.purchase_unit || '',
    consumption_unit: item?.consumption_unit || item?.unit || '',
    conversion_factor: item?.conversion_factor ?? 1,
    min_stock_level: item?.min_stock_level ?? 5,
    supplier: item?.supplier || '',
    notes: item?.notes || '',
    menu_item_id: item?.menu_item_id || '',
    invoice_number: '',
  });
  // Factor was typed by hand -> auto-derivation must not clobber it.
  const [factorManual, setFactorManual] = useState(false);
  const [showPurchaseUnit, setShowPurchaseUnit] = useState(() => {
    const purchaseUnit = item?.purchase_unit;
    const consumptionUnit = item?.consumption_unit || item?.unit;
    return Boolean(purchaseUnit && consumptionUnit && purchaseUnit !== consumptionUnit);
  });
  const [quantity, setQuantity] = useState({ amount: '', unit: 'purchase' });
  const [cost, setCost] = useState(() =>
    // An existing item stores cost per CONSUMPTION unit; show it back as the
    // per-purchase-unit rate the owner actually recognises.
    item?.cost_per_unit === undefined || item?.cost_per_unit === null || item?.cost_per_unit === ''
      ? blankCost()
      : { basis: 'per_purchase_unit', amount: String(round(Number(item.cost_per_unit) * displayFactorOf(item), 6)) }
  );
  const [origin, setOrigin] = useState(null); // null | 'owned' | 'purchased'
  // Owner-defined pack conversions (1 box = 24 bottles). Merged with the
  // physics catalogue so box→bottle auto-fills instead of asking every time.
  const [conversions, setConversions] = useState([]);

  useEffect(() => {
    let cancelled = false;
    apiJson('/api/admin/unit-conversions')
      .then((d) => !cancelled && setConversions(d.conversions || []))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const deriveFactor = (a, b) => resolveConversionFactor(a, b, conversions);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const factor = Number(form.conversion_factor) > 0 ? Number(form.conversion_factor) : 1;
  const cUnit = form.consumption_unit;
  const pUnit = form.purchase_unit || cUnit;
  const derivable = deriveFactor(form.purchase_unit, cUnit);
  const dual = hasTwoUnits({ purchaseUnit: form.purchase_unit, consumptionUnit: cUnit, factor });

  /**
   * Picking a unit invalidates the old factor, so re-derive and drop the manual
   * flag. When the pair isn't derivable (box_24 -> pieces) the field is left
   * exactly as-is for manual entry.
   */
  function setUnit(field, value) {
    const next = { ...form, [field]: value };
    const auto = deriveFactor(next.purchase_unit, next.consumption_unit);
    if (auto !== null) {
      next.conversion_factor = auto;
      setFactorManual(false);
    }
    setForm(next);
  }

  // With no second unit there is nothing to convert — pin the entry to
  // consumption units so a stale toggle can't multiply by a stray factor.
  const qtyEntry = dual ? quantity : { ...quantity, unit: 'consumption' };
  const qtyConsumption = toConsumptionAmount(qtyEntry, factor);
  const qtyPurchase = Number.isFinite(qtyConsumption) ? qtyConsumption / factor : NaN;
  const costQty = Number.isFinite(qtyPurchase) && qtyPurchase > 0 ? qtyPurchase : null;
  const costs = deriveCost(cost, costQty, factor);
  const hasOpening = Number.isFinite(qtyConsumption) && qtyConsumption > 0;
  const needsOrigin = !editing && hasOpening;

  async function submit(e) {
    e?.preventDefault?.();
    if (!form.item_name.trim()) {
      addToast(friendlyMessage('validation', { description: 'Give the item a name.' }));
      return;
    }
    if (!String(cUnit).trim()) {
      addToast(friendlyMessage('validation', { description: 'Set the unit this item is consumed in (g, ml, pcs…).' }));
      return;
    }
    if (needsOrigin && !origin) {
      addToast(friendlyMessage('validation', { description: 'Tell us whether this opening stock was already owned or just purchased.' }));
      return;
    }

    setSaving(true);
    try {
      const consumptionUnit = normalizeUnitOrKeep(cUnit);
      const payload = {
        ...form,
        purchase_unit: normalizeUnitOrKeep(form.purchase_unit) || null,
        consumption_unit: consumptionUnit,
        // `unit` is the legacy column; it mirrors the consumption unit.
        unit: consumptionUnit,
        conversion_factor: factor,
        // The ledger stores cost per CONSUMPTION unit.
        cost_per_unit: costs.perConsumptionUnit ?? 0,
        min_stock_level: Number(form.min_stock_level || 0),
      };

      if (editing) {
        await apiJson('/api/admin/inventory', {
          method: 'PUT',
          body: JSON.stringify({ ...payload, id: item.id, quantity: item.quantity }),
        });
        addToast(friendlyMessage('save_success', { description: `${form.item_name} saved.` }));
        onSaved?.();
        onClose();
        return;
      }

      // "I just purchased it" creates the item empty and lets the real purchase
      // path stock it — that is what writes the expense and the supplier
      // history. Anything else would be a second, parallel purchase path.
      const openingForApi = origin === 'purchased' || !hasOpening ? 0 : qtyConsumption;
      const created = await apiJson('/api/admin/inventory', {
        method: 'POST',
        body: JSON.stringify({ ...payload, quantity: openingForApi }),
      });

      if (origin === 'purchased') {
        // PURCHASE units, unconverted — createPurchase posts with units:'purchase'.
        await apiJson('/api/admin/purchases', {
          method: 'POST',
          body: JSON.stringify({
            supplier: form.supplier || null,
            invoice_number: form.invoice_number.trim() || null,
            invoice_date: nepalDateString(),
            notes: `Opening purchase for ${form.item_name.trim()}`,
            items: [
              {
                inventory_item_id: created.item.id,
                quantity_ordered: round(qtyPurchase, 6),
                quantity_received: round(qtyPurchase, 6),
                unit_cost: costs.perPurchaseUnit ?? 0,
              },
            ],
          }),
        });
        addToast(
          friendlyMessage('save_success', {
            description: `${form.item_name} added with ${round(qtyConsumption)} ${unitLabel(cUnit)} received — a purchase and a matching expense were recorded.`,
          })
        );
      } else {
        addToast(friendlyMessage('save_success', { description: `${form.item_name} saved.` }));
      }

      onSaved?.();
      onClose();
    } catch (error) {
      addToast(friendlyFromError(error, 'save_failed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent onClose={onClose} className={adminDialogLg}>
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${item.item_name}` : 'Add inventory item'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={submit} className={`mt-6 ${adminFieldStackClass}`}>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <AdminField label="Item name" required>
              <input
                autoFocus
                value={form.item_name}
                onChange={(e) => set({ item_name: e.target.value })}
                className={adminInputClass}
                placeholder="e.g. Green Chili"
              />
            </AdminField>
            <AdminField label="Category">
              <Combobox
                value={form.category}
                onChange={(v) => set({ category: v })}
                options={categories.map((c) => ({ value: c, label: c }))}
                placeholder="e.g. Vegetables"
              />
            </AdminField>
            <AdminField
              label="Linked menu item"
              hint="For one-for-one packaged stock such as bottled drinks or tobacco. Leave blank when a recipe deducts ingredients."
            >
              <Combobox
                value={form.menu_item_id}
                onChange={(v) => set({ menu_item_id: v })}
                options={menuItems.map((menuItem) => ({ value: String(menuItem.id), label: menuItem.name }))}
                placeholder="Not directly linked"
              />
            </AdminField>
          </div>

          <div className="rounded-xl border border-gray-200 p-5 sm:p-6">
            <AdminField label="Unit" required hint="Use the same unit for stock, recipes and purchases (for example kg, litre or pcs).">
              <UnitSelect value={form.consumption_unit} onChange={(v) => setUnit('consumption_unit', v)} placeholder="kg" />
            </AdminField>

            <button
              type="button"
              onClick={() => {
                if (showPurchaseUnit) {
                  setCost({ basis: 'per_purchase_unit', amount: costs.perConsumptionUnit == null ? '' : String(round(costs.perConsumptionUnit, 6)) });
                  setForm((current) => ({ ...current, purchase_unit: '', conversion_factor: 1 }));
                  setFactorManual(false);
                }
                setShowPurchaseUnit((current) => !current);
              }}
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900"
            >
              <ChevronDown className={`h-4 w-4 transition-transform ${showPurchaseUnit ? 'rotate-180' : ''}`} />
              {showPurchaseUnit ? 'Use one unit' : 'I buy this in a different unit'}
            </button>

            {showPurchaseUnit && (
              <div className="mt-4 rounded-lg bg-gray-50 p-4">
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <AdminField label="Purchase unit" hint="The unit written on the supplier invoice.">
                    <UnitSelect value={form.purchase_unit} onChange={(v) => setUnit('purchase_unit', v)} placeholder="kg" />
                  </AdminField>
                  <AdminField label="How many stock units in one purchase unit?">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={form.conversion_factor}
                      onChange={(e) => {
                        setFactorManual(true);
                        set({ conversion_factor: e.target.value });
                      }}
                      className={adminInputClass}
                    />
                  </AdminField>
                </div>
                {form.purchase_unit && cUnit && (
                  <p className="mt-2 text-xs text-gray-500">
                    1 {unitLabel(form.purchase_unit)} = <span className="font-medium text-gray-700">{factor} {unitLabel(cUnit)}</span>
                    {derivable !== null && !factorManual && ' · filled in for you'}
                    {factorManual && ' · your value, kept as typed'}
                  </p>
                )}
                {form.purchase_unit && cUnit && derivable === null && (
                  <p className="mt-2 text-xs text-amber-700">
                    This conversion is not automatic. Enter how many {unitLabel(cUnit)} are in one {unitLabel(form.purchase_unit)}.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <AdminField label="Minimum stock" hint={`In ${unitLabel(cUnit) || 'consumption units'}.`}>
              <input
                type="number"
                step="any"
                value={form.min_stock_level}
                onChange={(e) => set({ min_stock_level: e.target.value })}
                className={adminInputClass}
              />
            </AdminField>
            <AdminField label="Supplier">
              <Combobox
                value={form.supplier}
                onChange={(v) => set({ supplier: v })}
                options={suppliers.map((s) => ({ value: s.name, label: s.name }))}
                placeholder="Pick or type a new one"
              />
            </AdminField>
          </div>

          {!editing && (
            <AdminField label="Opening stock">
              <QuantityInput
                value={qtyEntry}
                onChange={(v) => {
                  setQuantity(v);
                  setOrigin(null);
                }}
                purchaseUnit={form.purchase_unit}
                consumptionUnit={cUnit}
                factor={factor}
                placeholder="0 — leave blank and receive a delivery instead"
                hint="will be added to stock"
              />
            </AdminField>
          )}

          <div className="rounded-xl border border-gray-200 p-5 sm:p-6">
            {dual ? (
              <CostEntry
                value={cost}
                onChange={setCost}
                quantity={costQty}
                purchaseUnit={form.purchase_unit}
                consumptionUnit={cUnit}
                factor={factor}
                label="Cost"
              />
            ) : (
              <AdminField label={`Cost per ${unitLabel(cUnit) || 'unit'} (Rs)`}>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={cost.amount}
                  onChange={(event) => setCost({ basis: 'per_purchase_unit', amount: event.target.value })}
                  className={adminInputClass}
                  placeholder="0"
                />
              </AdminField>
            )}
          </div>

          {needsOrigin && (
            <div className="rounded-xl border border-gray-200 p-5 sm:p-6">
              <p className="text-sm font-medium text-gray-900">Where did this opening stock come from?</p>
              <p className="mt-1 text-sm text-gray-500">
                Stock you already own is just a balance. Stock you just bought is also money out — recording it as a
                purchase creates the matching expense and supplier history, so food cost stays honest.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setOrigin('owned')}
                  className={`inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-medium ${
                    origin === 'owned' ? 'bg-gray-900 text-white' : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <Warehouse className="h-4 w-4" /> I already own this
                </button>
                <button
                  type="button"
                  onClick={() => setOrigin('purchased')}
                  className={`inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-medium ${
                    origin === 'purchased' ? 'bg-gray-900 text-white' : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <Truck className="h-4 w-4" /> I just purchased it
                </button>
              </div>

              {origin === 'owned' && (
                <p className="mt-3 text-xs text-gray-500">
                  Recorded as an opening balance of {round(qtyConsumption)} {unitLabel(cUnit)}. No expense is created.
                </p>
              )}

              {origin === 'purchased' && (
                <div className="mt-4 space-y-4">
                  <AdminField label="Invoice number">
                    <input
                      value={form.invoice_number}
                      onChange={(e) => set({ invoice_number: e.target.value })}
                      className={adminInputClass}
                      placeholder="Optional"
                    />
                  </AdminField>
                  <p className="text-xs text-gray-500">
                    A purchase of {round(qtyPurchase)} {unitLabel(pUnit)}
                    {form.supplier ? ` from ${form.supplier}` : ''} will be recorded, adding {round(qtyConsumption)}{' '}
                    {unitLabel(cUnit)} to stock and posting an expense of{' '}
                    <span className="font-medium text-gray-700">Rs {(costs.total ?? 0).toFixed(2)}</span>.
                  </p>
                </div>
              )}
            </div>
          )}

          {editing && (
            <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
              Current stock is {Number(item.quantity ?? 0)} {unitLabel(cUnit)}. Use “Adjust stock” to change it — every
              quantity change needs a reason.
            </p>
          )}

          <AdminField label="Notes">
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => set({ notes: e.target.value })}
              className={adminTextareaClass}
            />
          </AdminField>
        </form>

        <DialogFooter>
          <button type="button" onClick={onClose} className={adminBtnSecondary}>
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || (needsOrigin && !origin)}
            onClick={submit}
            className={adminBtnPrimary}
          >
            {saving ? 'Saving…' : editing ? 'Save changes' : origin === 'purchased' ? 'Add item & record purchase' : 'Add item'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function factorOf(item) {
  const cf = Number(item?.conversion_factor);
  return Number.isFinite(cf) && cf > 0 ? cf : 1;
}

function displayFactorOf(item) {
  const purchaseUnit = item?.purchase_unit;
  const consumptionUnit = item?.consumption_unit || item?.unit;
  return purchaseUnit && consumptionUnit && purchaseUnit !== consumptionUnit ? factorOf(item) : 1;
}
