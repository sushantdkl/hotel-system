'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import QuantityInput from '@/components/ui/quantity-input';
import { normalizeUnitOrKeep } from '@/lib/units';
import { toConsumptionAmount, hasTwoUnits, round } from '@/lib/entry-math';

/**
 * Canonical reason list. The DB column is free text, so the three pre-008
 * values ('burnt', 'dropped', plus anything typed before) still read fine —
 * WASTAGE_REASON_LABELS below maps them for display.
 */
export const WASTAGE_REASONS = [
  { value: 'expired', label: 'Expired' },
  { value: 'burned', label: 'Burned' },
  { value: 'spoiled', label: 'Spoiled' },
  { value: 'returned', label: 'Returned' },
  { value: 'preparation_error', label: 'Preparation Error' },
  { value: 'customer_complaint', label: 'Customer Complaint' },
  { value: 'spillage', label: 'Spillage' },
  { value: 'other', label: 'Other' },
];

export const WASTAGE_REASON_LABELS = {
  ...Object.fromEntries(WASTAGE_REASONS.map((r) => [r.value, r.label])),
  burnt: 'Burned',
  dropped: 'Spillage',
};

const SHIFTS = ['morning', 'afternoon', 'evening', 'night'];

/**
 * `request(url, options)` — caller-supplied fetch wrapper so this works with
 * both the kitchen page's `apiCall` and the admin pages' authed fetch.
 * `presetItem` pre-selects a raw material (used by the inventory row action and
 * by the adjustment modal when a decrease turns out to be wastage);
 * `presetQuantity` is in CONSUMPTION units, which is what that modal computes.
 *
 * ── Which path converts ───────────────────────────────────────────────────
 * POST /api/admin/wastage takes the quantity in CONSUMPTION units and has no
 * `units` flag (logWastage feeds it straight to the ledger as a delta), so a
 * quantity typed in the purchase unit is converted HERE, once.
 */
export default function WastageModal({ request, presetItem = null, presetQuantity = '', onClose, onLogged }) {
  const { addToast } = useToast();
  const [kind, setKind] = useState('raw_material');
  const [rawMaterials, setRawMaterials] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({
    item_id: presetItem?.id ? String(presetItem.id) : '',
    reason: 'expired',
    notes: '',
    employee_id: '',
    shift: '',
    photo_url: '',
  });
  // presetQuantity arrives in consumption units, so it must not be re-scaled.
  const [quantity, setQuantity] = useState({
    amount: presetQuantity ? String(presetQuantity) : '',
    unit: presetQuantity ? 'consumption' : 'purchase',
  });

  useEffect(() => {
    (async () => {
      try {
        const [invRes, recipesRes] = await Promise.all([
          request('/api/admin/inventory'),
          request('/api/admin/recipes'),
        ]);
        const invData = await invRes.json();
        const recipesData = await recipesRes.json();
        setRawMaterials(invData.items || []);
        setRecipes(recipesData.recipes || []);
      } catch {
        addToast(friendlyMessage('load_failed'));
      }

      // Admin-only endpoint — the kitchen page shares this modal, so a 403 just
      // means "no employee picker" rather than an error the cook can't act on.
      try {
        const res = await request('/api/admin/employees');
        if (res.ok) {
          const data = await res.json();
          setEmployees((data.employees || []).filter((e) => e.is_active !== false));
        }
      } catch {
        /* no picker for non-admin callers */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Reuses the existing receipts uploader rather than adding a second one. */
  async function uploadPhoto(file) {
    if (!file) return;
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/api/uploads/receipts', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('pos_token')}` },
        body,
      });
      const data = await res.json();
      if (!res.ok) throw data;
      setForm((f) => ({ ...f, photo_url: data.url }));
    } catch (error) {
      addToast(friendlyFromError(error, 'save_failed'));
    } finally {
      setUploading(false);
    }
  }

  const options = kind === 'raw_material' ? rawMaterials : recipes;
  const selected = options.find((o) => String(o.id) === String(form.item_id));

  // A recipe is wasted in its own yield unit — there is no purchase unit to
  // offer, so the toggle only appears for raw materials.
  const isRaw = kind === 'raw_material';
  const factor = isRaw && Number(selected?.conversion_factor) > 0 ? Number(selected.conversion_factor) : 1;
  const cUnit = isRaw ? selected?.consumption_unit || selected?.unit || '' : selected?.yield_unit || '';
  const pUnit = isRaw ? selected?.purchase_unit || '' : '';
  const dual = hasTwoUnits({ purchaseUnit: pUnit, consumptionUnit: cUnit, factor });

  const entry = dual ? quantity : { ...quantity, unit: 'consumption' };
  const wastedConsumption = toConsumptionAmount(entry, factor);

  // Live estimate of what this entry will cost, so the owner sees the money
  // before saving. The server recomputes it from the ledger's cost basis.
  const estimatedCost =
    isRaw && selected && Number.isFinite(wastedConsumption)
      ? wastedConsumption * Number(selected.cost_per_unit || 0)
      : null;

  function selectItem(id) {
    setForm((f) => ({ ...f, item_id: id }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.item_id) {
      addToast(friendlyMessage('validation', { description: 'Select an item to log wastage for.' }));
      return;
    }
    if (!(wastedConsumption > 0)) {
      addToast(friendlyMessage('validation', { description: 'Quantity must be greater than zero.' }));
      return;
    }

    setSaving(true);
    try {
      const body = {
        // Consumption units — this endpoint has no `units` flag. See the header.
        quantity: round(wastedConsumption, 6),
        unit: normalizeUnitOrKeep(cUnit),
        reason: form.reason,
        notes: form.notes || null,
        raw_material_id: kind === 'raw_material' ? form.item_id : null,
        recipe_id: kind === 'recipe' ? form.item_id : null,
        employee_id: form.employee_id || null,
        shift: form.shift || null,
        photo_url: form.photo_url || null,
      };
      const res = await request('/api/admin/wastage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw data;
      addToast(
        friendlyMessage('save_success', {
          description: data.expense_id
            ? `Stock deducted and Rs ${Number(data.total_cost || 0).toFixed(2)} posted as an inventory loss expense.`
            : 'Wastage logged and stock adjusted.',
        })
      );
      (data.warnings || []).forEach((w) => addToast(friendlyMessage('validation', { description: w })));
      onLogged?.();
      onClose();
    } catch (error) {
      addToast(friendlyFromError(error, 'save_failed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent onClose={onClose} className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Log Wastage</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div className="flex gap-2">
            {[
              { value: 'raw_material', label: 'Ingredient' },
              { value: 'recipe', label: 'Prepared dish' },
            ].map((k) => (
              <button
                key={k.value}
                type="button"
                onClick={() => {
                  setKind(k.value);
                  setForm((f) => ({ ...f, item_id: '' }));
                  setQuantity({ amount: '', unit: 'purchase' });
                }}
                className={`h-10 flex-1 rounded-lg border text-sm font-medium ${
                  kind === k.value ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {k.label}
              </button>
            ))}
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              {kind === 'raw_material' ? 'Ingredient' : 'Prepared dish'}
            </label>
            <select
              className={INPUT}
              value={form.item_id}
              onChange={(e) => selectItem(e.target.value)}
            >
              <option value="">Select item…</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.item_name || o.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Quantity</label>
            {/* The unit is the item's own — a free-text unit here could disagree
                with the number and make the log lie about what was thrown out. */}
            <QuantityInput
              value={entry}
              onChange={setQuantity}
              purchaseUnit={pUnit}
              consumptionUnit={cUnit}
              factor={factor}
              hint="will be deducted from stock"
            />
            {!selected && <p className="mt-1 text-xs text-gray-400">Pick an item to set the unit.</p>}
          </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Reason</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {WASTAGE_REASONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, reason: r.value }))}
                  className={`h-9 rounded-lg border px-1 text-xs font-medium ${
                    form.reason === r.value ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {employees.length > 0 && (
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Employee</label>
                <select
                  className={INPUT}
                  value={form.employee_id}
                  onChange={(e) => setForm((f) => ({ ...f, employee_id: e.target.value }))}
                >
                  <option value="">Not attributed</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.full_name || emp.username}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Shift</label>
              <select
                className={INPUT}
                value={form.shift}
                onChange={(e) => setForm((f) => ({ ...f, shift: e.target.value }))}
              >
                <option value="">Not recorded</option>
                {SHIFTS.map((s) => (
                  <option key={s} value={s} className="capitalize">
                    {s[0].toUpperCase() + s.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Photo (optional)</label>
            <input type="file" accept="image/*" className="w-full text-sm" onChange={(e) => uploadPhoto(e.target.files?.[0])} />
            {uploading && <p className="mt-1 text-xs text-gray-400">Uploading…</p>}
            {form.photo_url && <p className="mt-1 text-xs text-emerald-600">Photo attached.</p>}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Notes (optional)</label>
            <textarea
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              rows={2}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>

          <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
            Saving deducts the stock, writes a movement, and posts an <span className="font-medium">inventory loss</span> expense
            {estimatedCost ? ` of about Rs ${estimatedCost.toFixed(2)}` : ''} — so this shows up in food cost automatically.
          </p>
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
            {saving ? 'Logging…' : 'Log wastage'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const INPUT = 'h-11 w-full rounded-lg border border-gray-300 px-3 text-sm text-gray-900';
