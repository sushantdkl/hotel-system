'use client';

/**
 * Receive a delivery, or edit one that was already received.
 *
 * ── Which path converts ───────────────────────────────────────────────────
 * Nothing here converts. Quantities and unit costs are in PURCHASE units —
 * that is how a delivery note reads — and createPurchase() posts every line
 * with units:'purchase', so the ledger converts exactly once. The "adds N g"
 * hints below are display only; converting them into the payload as well
 * would multiply twice.
 *
 * A line's cost can be typed as a rate OR as the line total, whichever the
 * invoice shows; `cost_basis` records which one the user typed so the other
 * stays derived. Only the rate is ever sent.
 *
 * Editing reverses the previous receipt and re-applies the new one inside a
 * single transaction (lib/purchases.js), which is why the warning is worded
 * the way it is.
 */

import { useEffect, useMemo, useState } from 'react';
import { Paperclip, Plus, Trash2, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  AdminField,
  adminInputClass,
  adminTextareaClass,
  adminDialogXl,
  adminBtnPrimary,
  adminBtnSecondary,
  adminFieldStackClass,
} from '@/components/ui/admin-form';
import Combobox from '@/components/ui/combobox';
import { useToast } from '@/components/ui/toast';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import { apiJson, authedRequest } from '@/lib/authed-fetch';
import { unitLabel } from '@/lib/units';
import { round } from '@/lib/entry-math';
import { nepalDateString } from '@/lib/report-dates.js';
import DateInput from '@/components/ui/date-input.jsx';
import { useConfirm } from '@/components/ui/confirm';

const today = () => nepalDateString();
const blankLine = () => ({
  inventory_item_id: '',
  quantity_ordered: '',
  quantity_received: '',
  unit_cost: '',
  line_total: '',
  cost_basis: 'unit',
});

export default function ReceiveDeliveryModal({ purchase, items, suppliers, employees, onClose, onSaved }) {
  const { addToast } = useToast();
  const { confirm } = useConfirm();
  const editing = Boolean(purchase?.id);
  const closedDayEdit = editing && purchase?.expense?.business_day_status === 'closed';
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [changeReason, setChangeReason] = useState('');
  const [form, setForm] = useState({
    supplier: purchase?.supplier || '',
    invoice_number: purchase?.invoice_number || '',
    invoice_date: purchase?.invoice_date?.slice(0, 10) || today(),
    expected_delivery_date: purchase?.expected_delivery_date?.slice(0, 10) || '',
    received_by: purchase?.received_by || '',
    // `payment_method` lives on the linked expense, not the purchase row itself —
    // getPurchase() nests it under `.expense`. Reading purchase.payment_method
    // directly always misses and silently falls back to 'cash' on edit.
    payment_method: purchase?.expense?.payment_method || purchase?.payment_method || 'cash',
    tax: purchase?.tax ?? '',
    discount: purchase?.discount ?? '',
    shipping: purchase?.shipping ?? '',
    notes: purchase?.notes || '',
    attachment_url: purchase?.attachment_url || '',
  });
  const [lines, setLines] = useState(
    purchase?.items?.length
      ? purchase.items.map((l) => ({
          inventory_item_id: String(l.inventory_item_id || ''),
          quantity_ordered: String(l.quantity_ordered ?? ''),
          quantity_received: String(l.quantity_received ?? ''),
          unit_cost: String(l.unit_cost ?? ''),
          line_total: '',
          cost_basis: 'unit',
        }))
      : [blankLine()]
  );
  const [partialDelivery, setPartialDelivery] = useState(Boolean(
    purchase?.items?.some((line) => Number(line.quantity_received) < Number(line.quantity_ordered))
  ));
  const [showDetails, setShowDetails] = useState(Boolean(
    editing || purchase?.expected_delivery_date || purchase?.attachment_url || purchase?.notes
      || Number(purchase?.tax || 0) || Number(purchase?.discount || 0) || Number(purchase?.shipping || 0)
  ));

  const itemById = useMemo(() => new Map(items.map((i) => [String(i.id), i])), [items]);
  const itemOptions = useMemo(
    () =>
      (items || [])
        .map((it) => ({
          value: String(it.id),
          label: it.item_name,
          hint: `(${it.purchase_unit || it.unit})`,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base', numeric: true })),
    [items]
  );
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const money = (v) => Number(v || 0) || 0;

  /** Received quantity for a line, defaulting to the ordered amount. */
  const receivedOf = (l) => (l.quantity_received === '' ? money(l.quantity_ordered) : money(l.quantity_received));

  /**
   * The rate, whether it was typed or has to be recovered from a typed total.
   * Returns null when a total was given but nothing was received — there is no
   * rate to derive, and 0 would silently wipe the item's moving average.
   */
  function rateOf(l) {
    if (l.cost_basis !== 'total') return money(l.unit_cost);
    const received = receivedOf(l);
    if (!(received > 0) || String(l.line_total).trim() === '') return null;
    return money(l.line_total) / received;
  }

  const totalOf = (l) => {
    const rate = rateOf(l);
    return rate === null ? money(l.line_total) : receivedOf(l) * rate;
  };

  const validLines = lines.filter((l) => l.inventory_item_id && Number(l.quantity_ordered || l.quantity_received) > 0);
  const subtotal = validLines.reduce((s, l) => s + totalOf(l), 0);
  const total = subtotal + money(form.tax) + money(form.shipping) - money(form.discount);
  const isPartial = validLines.some(
    (l) => l.quantity_received !== '' && money(l.quantity_received) < money(l.quantity_ordered)
  );

  useEffect(() => {
    // Default the receiver to the logged-in user on a fresh delivery.
    if (editing || form.received_by) return;
    try {
      const me = JSON.parse(localStorage.getItem('pos_user') || '{}');
      if (me?.id) set({ received_by: me.id });
    } catch {
      /* no stored user — the field stays optional */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateLine(index, patch) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  async function uploadInvoice(file) {
    if (!file) return;
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await authedRequest('/api/uploads/receipts', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) throw data;
      set({ attachment_url: data.url });
    } catch (error) {
      addToast(friendlyFromError(error, 'upload_failed'));
    } finally {
      setUploading(false);
    }
  }

  async function submit(useBusinessFunding = false) {
    useBusinessFunding = useBusinessFunding === true;
    if (!validLines.length) {
      addToast(friendlyMessage('validation', { description: 'Add at least one delivered item with a quantity.' }));
      return;
    }
    if (closedDayEdit && changeReason.trim().length < 3) {
      addToast(friendlyMessage('validation', { description: 'Enter a clear reason for correcting this closed purchase.' }));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        change_reason: closedDayEdit ? changeReason.trim() : undefined,
        use_business_funding: useBusinessFunding,
        received_by: form.received_by || null,
        expected_delivery_date: form.expected_delivery_date || null,
        tax: money(form.tax),
        discount: money(form.discount),
        shipping: money(form.shipping),
        // PURCHASE units and a per-purchase-unit rate, unconverted —
        // createPurchase posts these with units:'purchase'.
        items: validLines.map((l) => ({
          inventory_item_id: Number(l.inventory_item_id),
          quantity_ordered: money(l.quantity_ordered),
          quantity_received: receivedOf(l),
          unit_cost: round(rateOf(l) ?? 0, 6),
        })),
      };
      const data = editing
        ? await apiJson(`/api/admin/purchases/${purchase.id}`, { method: 'PUT', body: JSON.stringify(payload) })
        : await apiJson('/api/admin/purchases', { method: 'POST', body: JSON.stringify(payload) });

      (data.purchase?.stock?.warnings || []).forEach((w) =>
        addToast(friendlyMessage('validation', { description: w }))
      );
      addToast(
        friendlyMessage('save_success', {
          description: editing
            ? 'Purchase updated — the old receipt was reversed and the new one applied.'
            : `Stock updated and an expense of Rs ${total.toFixed(2)} posted.`,
        })
      );
      onSaved?.();
      onClose();
    } catch (error) {
      if (error?.code === 'business_funding_required') {
        setSaving(false);
        const approved = await confirm({
          title: 'Use Business Funding?',
          message: `${error.error || error.message}\n\nAvailable in Business Funding on that date: Rs ${Number(error.available || 0).toFixed(2)}.`,
          confirmLabel: `Use Rs ${Number(error.shortfall || 0).toFixed(2)}`,
          tone: 'warning',
        });
        if (approved) await submit(true);
        return;
      }
      if (error?.code === 'business_funding_insufficient') {
        addToast(friendlyMessage('validation', {
          title: 'No funding on the invoice date',
          description: `${error.error || error.message} If the investment already existed then, correct its date in Business Funding. If the owner paid personally, choose Owner Pocket; if it was unpaid, choose Credit.`,
        }));
        return;
      }
      addToast(friendlyFromError(error, 'save_failed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent onClose={onClose} className={adminDialogXl}>
        <DialogHeader>
          <DialogTitle>{editing ? `Edit purchase #${purchase.id}` : 'Receive delivery'}</DialogTitle>
        </DialogHeader>

        <div className={`mt-6 ${adminFieldStackClass}`}>
          {editing && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Saving reverses the stock this purchase originally added, then applies the new lines and updates the linked
              expense. For a closed day, the financial difference is recorded as a separate correction. Everything succeeds
              together or nothing changes.
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <AdminField label="Supplier" hint="Pick an existing supplier, or type a new one if your permissions allow it.">
              <input
                list="delivery-suppliers"
                value={form.supplier}
                onChange={(e) => set({ supplier: e.target.value })}
                className={adminInputClass}
                placeholder="Pick one, or type a new name"
              />
              <datalist id="delivery-suppliers">
                {suppliers.map((s) => (
                  <option key={s.id} value={s.name} />
                ))}
              </datalist>
            </AdminField>
            <AdminField label="Invoice number">
              <input value={form.invoice_number} onChange={(e) => set({ invoice_number: e.target.value })} className={adminInputClass} placeholder="Optional" />
            </AdminField>
            <AdminField label="Invoice date" hint="This is the date used in purchase and expense reports.">
              <DateInput disabled={closedDayEdit} value={form.invoice_date} onChange={(v) => set({ invoice_date: v })} className={adminInputClass} />
            </AdminField>
            <AdminField label="Payment" hint={closedDayEdit ? 'Use Correct payment from the purchase details to reclassify a closed-day payment.' : 'The payment is attributed to the invoice-date business day. On credit books the amount to Accounts Payable.'}>
              <select disabled={closedDayEdit} value={form.payment_method} onChange={(e) => set({ payment_method: e.target.value })} className={`${adminInputClass} disabled:bg-gray-100 disabled:text-gray-500`}>
                <option value="cash">Paid — Business Cash</option>
                <option value="online">Paid — Online</option>
                <option value="business_funding">Paid — Business Funding Balance</option>
                <option value="owner_pocket">Paid — Owner Pocket (personal money)</option>
                <option value="credit">On credit (payable)</option>
              </select>
              <p className="mt-1.5 text-xs text-gray-500">Owner Pocket increases owner equity without adding money to the drawer.</p>
              {form.payment_method === 'business_funding' && (
                <p className="mt-1.5 text-xs text-violet-700">
                  Only funding dated on or before the invoice date is available. If it was entered late, correct the investment date in Business Funding.
                </p>
              )}
            </AdminField>
          </div>

          {form.invoice_date && form.invoice_date < today() && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span className="font-semibold">Historical invoice:</span> the purchase, stock receipt, expense and payment are
              attributed to the {form.invoice_date} business day. The time entered and staff member remain recorded as today’s
              audit information.
            </p>
          )}
          {closedDayEdit ? <AdminField label="Correction reason" hint="Required. Stock is reversed and reapplied; the financial difference is appended without rewriting the closed journal."><textarea rows={3} value={changeReason} onChange={(event) => setChangeReason(event.target.value)} className={adminTextareaClass} placeholder="Why is this closed purchase being corrected?" /></AdminField> : null}

          <button
            type="button"
            onClick={() => setShowDetails((value) => !value)}
            className="inline-flex h-9 self-start items-center rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 transition-transform duration-150 hover:bg-gray-50 active:scale-[0.97]"
          >
            {showDetails ? 'Hide extra details' : 'Add tax, attachment or notes'}
          </button>

          {showDetails && (
            <div className="grid grid-cols-1 gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4 sm:grid-cols-2 lg:grid-cols-3">
              <AdminField label="Expected delivery date">
                <DateInput value={form.expected_delivery_date} onChange={(v) => set({ expected_delivery_date: v })} className={adminInputClass} />
              </AdminField>
              <AdminField label="Received by">
                <select value={form.received_by} onChange={(e) => set({ received_by: e.target.value })} className={adminInputClass}>
                  <option value="">Current user</option>
                  {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.full_name || emp.username}</option>)}
                </select>
              </AdminField>
              <AdminField label="Invoice attachment">
                {form.attachment_url ? (
                  <span className="flex min-h-11 items-center gap-2 text-sm text-gray-600">
                    <Paperclip className="h-4 w-4" />
                    <a href={form.attachment_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Attached</a>
                    <button type="button" onClick={() => set({ attachment_url: '' })} className="text-gray-400 hover:text-red-600"><X className="h-3.5 w-3.5" /></button>
                  </span>
                ) : (
                  <input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={(e) => uploadInvoice(e.target.files?.[0])} disabled={uploading} className="min-h-11 w-full text-sm" />
                )}
              </AdminField>
              <AdminField label="Tax"><input type="number" step="any" value={form.tax} onChange={(e) => set({ tax: e.target.value })} className={adminInputClass} placeholder="0" /></AdminField>
              <AdminField label="Discount"><input type="number" step="any" value={form.discount} onChange={(e) => set({ discount: e.target.value })} className={adminInputClass} placeholder="0" /></AdminField>
              <AdminField label="Shipping"><input type="number" step="any" value={form.shipping} onChange={(e) => set({ shipping: e.target.value })} className={adminInputClass} placeholder="0" /></AdminField>
              <div className="sm:col-span-2 lg:col-span-3">
                <AdminField label="Notes"><textarea rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} className={adminTextareaClass} /></AdminField>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-gray-200">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-gray-900">Delivered items</p>
                <p className="text-xs text-gray-500">
                  Select an item, enter the delivered quantity and its cost per purchase unit.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={partialDelivery}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setPartialDelivery(checked);
                      if (!checked) {
                        setLines((current) => current.map((line) => ({
                          ...line,
                          quantity_received: '',
                        })));
                      }
                    }}
                  /> Partial delivery
                </label>
                <button type="button" onClick={() => setLines((p) => [...p, blankLine()])} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-700 transition-transform duration-150 hover:bg-gray-50 active:scale-[0.97]">
                  <Plus className="h-3.5 w-3.5" /> Add item
                </button>
              </div>
            </div>

            <div className="overflow-x-auto hidden md:block">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                    <th className="px-3 py-2 font-semibold">Item</th>
                    {partialDelivery ? <><th className="px-3 py-2 font-semibold">Ordered</th><th className="px-3 py-2 font-semibold">Received</th></> : <th className="px-3 py-2 font-semibold">Quantity</th>}
                    <th className="px-3 py-2 font-semibold">Unit cost</th>
                    <th className="px-3 py-2 text-right font-semibold">Line total</th>
                    <th className="w-10 px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {lines.map((line, i) => {
                    const item = itemById.get(line.inventory_item_id);
                    const received = receivedOf(line);
                    const factor = Number(item?.conversion_factor) > 0 ? Number(item.conversion_factor) : 1;
                    const short = line.quantity_received !== '' && money(line.quantity_received) < money(line.quantity_ordered);
                    const rate = rateOf(line);
                    return (
                      <tr key={i}>
                        <td className="px-3 py-2">
                          <Combobox
                            value={line.inventory_item_id}
                            onChange={(v) => updateLine(i, { inventory_item_id: String(v || '') })}
                            options={itemOptions}
                            allowCustom={false}
                            portal
                            placeholder="Search item…"
                            className="h-9 w-64 rounded-md border border-gray-300 bg-white pl-2 pr-8 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200"
                          />
                          {item && received > 0 && (
                            <p className="mt-1 text-xs text-gray-400">
                              {received} {unitLabel(item.purchase_unit || item.unit)} = {round(received * factor)}{' '}
                              {unitLabel(item.consumption_unit || item.unit)} added to stock
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <input type="number" step="any" value={line.quantity_ordered} onChange={(e) => updateLine(i, { quantity_ordered: e.target.value })} className="h-9 w-24 rounded-md border border-gray-300 px-2 text-sm" />
                        </td>
                        {partialDelivery && <td className="px-3 py-2">
                          <input
                            type="number"
                            step="any"
                            value={line.quantity_received}
                            onChange={(e) => updateLine(i, { quantity_received: e.target.value })}
                            placeholder="all"
                            className={`h-9 w-24 rounded-md border px-2 text-sm ${short ? 'border-amber-400 bg-amber-50' : 'border-gray-300'}`}
                          />
                        </td>}
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            step="any"
                            value={line.unit_cost}
                            onChange={(e) => updateLine(i, { unit_cost: e.target.value, cost_basis: 'unit' })}
                            placeholder="0"
                            className="h-9 w-28 rounded-md border border-gray-300 px-2 text-sm"
                          />
                          <p className="mt-1 text-xs text-gray-400">
                            per {unitLabel(item?.purchase_unit || item?.unit) || 'unit'}
                          </p>
                        </td>
                        <td className="px-3 py-2">
                          <span className="block w-28 text-right font-medium tabular-nums text-gray-900">
                            {received > 0 && rate !== null ? `Rs ${round(totalOf(line), 2).toFixed(2)}` : '—'}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {lines.length > 1 && (
                            <button type="button" onClick={() => setLines((p) => p.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="space-y-4 p-4 md:hidden">
              {lines.map((line, i) => {
                const item = itemById.get(line.inventory_item_id);
                const received = receivedOf(line);
                const factor = Number(item?.conversion_factor) > 0 ? Number(item.conversion_factor) : 1;
                const short = line.quantity_received !== '' && money(line.quantity_received) < money(line.quantity_ordered);
                const rate = rateOf(line);
                return (
                  <div key={`m-${i}`} className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3">
                    <Combobox
                      value={line.inventory_item_id}
                      onChange={(v) => updateLine(i, { inventory_item_id: String(v || '') })}
                      options={itemOptions}
                      allowCustom={false}
                      portal
                      placeholder="Search item…"
                      className={`${adminInputClass} pr-10`}
                    />
                    <div className={`grid gap-3 ${partialDelivery ? 'grid-cols-2' : 'grid-cols-1'}`}>
                      <AdminField label={partialDelivery ? 'Ordered' : 'Quantity'}>
                        <input type="number" step="any" value={line.quantity_ordered} onChange={(e) => updateLine(i, { quantity_ordered: e.target.value })} className={adminInputClass} />
                      </AdminField>
                      {partialDelivery && <AdminField label="Received">
                        <input type="number" step="any" value={line.quantity_received} onChange={(e) => updateLine(i, { quantity_received: e.target.value })} placeholder="all" className={`${adminInputClass} ${short ? 'border-amber-400 bg-amber-50' : ''}`} />
                      </AdminField>}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <AdminField label="Unit cost">
                        <input type="number" step="any" value={line.unit_cost} onChange={(e) => updateLine(i, { unit_cost: e.target.value, cost_basis: 'unit' })} className={adminInputClass} />
                      </AdminField>
                      <AdminField label="Line total">
                        <div className="flex h-11 items-center justify-end rounded-lg border border-gray-200 bg-white px-3 font-medium tabular-nums text-gray-900">
                          {received > 0 && rate !== null ? `Rs ${round(totalOf(line), 2).toFixed(2)}` : '—'}
                        </div>
                      </AdminField>
                    </div>
                    {item && received > 0 && (
                      <p className="text-xs text-gray-500">Adds {round(received * factor)} {unitLabel(item.consumption_unit || item.unit)} to stock</p>
                    )}
                    {lines.length > 1 && (
                      <button type="button" onClick={() => setLines((p) => p.filter((_, j) => j !== i))} className="text-sm font-medium text-red-600">Remove line</button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="ml-auto w-full max-w-lg rounded-xl border border-gray-200 bg-gray-50 p-5 text-sm">
              <Row label="Subtotal" value={subtotal} />
              <Row label="Tax" value={money(form.tax)} />
              <Row label="Shipping" value={money(form.shipping)} />
              <Row label="Discount" value={-money(form.discount)} />
              <div className="mt-2 flex items-center justify-between border-t border-gray-200 pt-2">
                <span className="font-semibold text-gray-900">Total</span>
                <span className="font-semibold tabular-nums text-gray-900">Rs {total.toFixed(2)}</span>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                {isPartial ? 'Saved as a partial delivery — the outstanding quantity stays visible on the purchase.' : 'Saved as fully received.'}{' '}
                An expense of Rs {total.toFixed(2)} is created and linked to this purchase.
              </p>
          </div>
        </div>

        <DialogFooter>
          <button type="button" onClick={onClose} className={adminBtnSecondary}>
            Cancel
          </button>
          <button type="button" disabled={saving || uploading} onClick={submit} className={adminBtnPrimary}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Receive & update stock'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between py-1 text-gray-600">
      <span>{label}</span>
      <span className="tabular-nums">Rs {Number(value).toFixed(2)}</span>
    </div>
  );
}
