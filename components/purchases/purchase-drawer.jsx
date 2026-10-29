'use client';

/**
 * Side drawer for one purchase: its lines, what they did to stock, the expense
 * it generated, and the edit / void actions.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Ban, Paperclip, Pencil, WalletCards, X } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import { apiJson, authedRequest } from '@/lib/authed-fetch';
import { StatusBadge } from '@/components/admin/data-grid';
import { formatNepalDate, formatNepalTime } from '@/lib/time-utils';
import PaymentMethodCorrectionDialog from '@/components/expenses/payment-method-correction-dialog.jsx';

export const PURCHASE_STATUS = {
  received: { label: 'Received', tone: 'green' },
  partial: { label: 'Partial', tone: 'amber' },
  draft: { label: 'Draft', tone: 'gray' },
  voided: { label: 'Voided', tone: 'red' },
};

export default function PurchaseDrawer({ purchaseId, onClose, onChanged, onEdit, canEdit = true, canVoid = true, canCorrectPayment = false }) {
  const { addToast } = useToast();
  const [purchase, setPurchase] = useState(null);
  const [loading, setLoading] = useState(true);
  const [voiding, setVoiding] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [correctingPayment, setCorrectingPayment] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await apiJson(`/api/admin/purchases/${purchaseId}`);
        if (!cancelled) setPurchase(data.purchase);
      } catch (error) {
        addToast(friendlyFromError(error, 'load_failed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseId]);

  async function doVoid() {
    setVoiding(true);
    try {
      const url = `/api/admin/purchases/${purchaseId}?reason=${encodeURIComponent(voidReason.trim())}`;
      const res = await authedRequest(url, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw data;
      (data.purchase?.stock?.warnings || []).forEach((w) => addToast(friendlyMessage('validation', { description: w })));
      addToast(friendlyMessage('save_success', { description: 'Purchase voided — stock reversed and the linked expense removed.' }));
      onChanged?.();
      onClose();
    } catch (error) {
      addToast(friendlyFromError(error, 'delete_failed'));
    } finally {
      setVoiding(false);
    }
  }

  const status = PURCHASE_STATUS[purchase?.status] || PURCHASE_STATUS.received;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="relative z-10 flex h-full w-full max-w-3xl flex-col overflow-y-auto bg-white shadow-xl animate-in fade-in duration-200">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-gray-200 bg-white px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Purchase</p>
            <h2 className="truncate text-lg font-semibold text-gray-900">
              {purchase?.invoice_number || `#${purchaseId}`}
            </h2>
            {purchase && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                <span className="text-sm text-gray-500">{purchase.supplier_name || purchase.supplier || 'No supplier'}</span>
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </header>

        {loading || !purchase ? (
          <p className="p-8 text-center text-sm text-gray-500">{loading ? 'Loading purchase…' : 'This purchase could not be loaded.'}</p>
        ) : (
          <div className="flex-1 space-y-6 p-5">
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <Detail label="Invoice date" value={purchase.invoice_date ? formatNepalDate(purchase.invoice_date) : '—'} />
              <Detail label="Expected delivery" value={purchase.expected_delivery_date ? formatNepalDate(purchase.expected_delivery_date) : 'Not set'} />
              <Detail label="Received by" value={purchase.received_by_name || 'Not recorded'} />
              <Detail
                label="Paid by"
                value={`${paymentMethodLabel(purchase.expense?.payment_method || purchase.payment_method)}${
                  purchase.credit_due == null ? ''
                    : Number(purchase.credit_due) <= 0.009 ? ' · Paid'
                      : ` · Rs ${Number(purchase.credit_due).toFixed(2)} due`}`}
              />
              <Detail label="Recorded" value={purchase.created_at ? formatNepalTime(purchase.created_at) : '—'} />
            </dl>

            {purchase.status === 'voided' && (
              <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                Voided {purchase.voided_at ? formatNepalTime(purchase.voided_at) : ''}.
                {purchase.void_reason ? ` Reason: ${purchase.void_reason}.` : ''} The stock it added was reversed and its
                expense removed. The record is kept for audit.
              </p>
            )}

            <section>
              <h3 className="mb-3 text-sm font-semibold text-gray-900">Lines</h3>
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                      <th className="px-3 py-2 font-semibold">Item</th>
                      <th className="px-3 py-2 text-right font-semibold">Ordered</th>
                      <th className="px-3 py-2 text-right font-semibold">Received</th>
                      <th className="px-3 py-2 text-right font-semibold">Unit cost</th>
                      <th className="px-3 py-2 text-right font-semibold">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(purchase.items || []).map((line) => {
                      const factor = Number(line.conversion_factor) > 0 ? Number(line.conversion_factor) : 1;
                      const short = Number(line.quantity_received) < Number(line.quantity_ordered);
                      return (
                        <tr key={line.id}>
                          <td className="px-3 py-2.5">
                            <p className="font-medium text-gray-900">{line.item_name || `Item #${line.inventory_item_id}`}</p>
                            <p className="text-xs text-gray-400">
                              {Number(line.quantity_received) * factor} {line.consumption_unit || ''} into stock
                            </p>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">
                            {Number(line.quantity_ordered)} {line.purchase_unit || ''}
                          </td>
                          <td className={`px-3 py-2.5 text-right tabular-nums ${short ? 'font-medium text-amber-700' : 'text-gray-600'}`}>
                            {Number(line.quantity_received)}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">Rs {Number(line.unit_cost).toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-medium text-gray-900">Rs {Number(line.line_total).toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {(purchase.items || []).some((l) => Number(l.quantity_received) < Number(l.quantity_ordered)) && (
                <p className="mt-2 text-xs text-amber-700">
                  Some lines came in short. Edit the purchase when the rest arrives — the stock difference is applied then.
                </p>
              )}
            </section>

            <section className="rounded-xl border border-gray-200 p-4 text-sm">
              <div className="space-y-1">
                <SummaryRow label="Subtotal" value={purchase.subtotal} />
                <SummaryRow label="Tax" value={purchase.tax} />
                <SummaryRow label="Shipping" value={purchase.shipping} />
                <SummaryRow label="Discount" value={-Number(purchase.discount || 0)} />
                <div className="flex items-center justify-between border-t border-gray-200 pt-2 font-semibold text-gray-900">
                  <span>Total</span>
                  <span className="tabular-nums">Rs {Number(purchase.total || 0).toFixed(2)}</span>
                </div>
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-gray-900">Linked expense</h3>
              {purchase.expense ? (
                <div className="rounded-xl border border-gray-200 p-4 text-sm">
                  <p className="font-medium text-gray-900">{purchase.expense.description}</p>
                  <p className="mt-1 text-gray-500">
                    Rs {Number(purchase.expense.amount).toFixed(2)} · {paymentMethodLabel(purchase.expense.payment_method)} · {formatNepalDate(purchase.expense.purchase_date || purchase.expense.expense_date)}
                  </p>
                  <Link href="/admin/expenses" className="mt-2 inline-block text-sm font-medium text-gray-900 underline">
                    Open in expenses
                  </Link>
                  <p className="mt-2 text-xs text-gray-400">
                    This expense is owned by the purchase — editing it happens here, not on the expenses page.
                  </p>
                </div>
              ) : (
                <p className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
                  No expense is attached. Voided and draft purchases do not carry one.
                </p>
              )}
            </section>

            {(purchase.notes || purchase.attachment_url) && (
              <section className="space-y-2 text-sm">
                {purchase.notes && <p className="text-gray-600">{purchase.notes}</p>}
                {purchase.attachment_url && (
                  <a href={purchase.attachment_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-gray-900 underline">
                    <Paperclip className="h-4 w-4" /> Invoice attachment
                  </a>
                )}
              </section>
            )}

            {canVoid && confirmVoid && (
              <section className="rounded-xl border border-red-200 bg-red-50 p-4">
                <p className="text-sm font-semibold text-red-900">Void this purchase?</p>
                <ul className="mt-2 space-y-1 text-sm text-red-800">
                  <li>• {Number(purchase.total || 0).toFixed(2)} of stock is removed again — every received line is reversed.</li>
                  <li>• The linked expense of Rs {Number(purchase.expense?.amount || purchase.total || 0).toFixed(2)} is deleted.</li>
                  <li>• The purchase itself is kept, marked voided, so the audit trail stays intact.</li>
                </ul>
                <input
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  placeholder="Reason (required, recorded on the reversal)"
                  aria-label="Reason for voiding"
                  required
                  className="mt-3 h-10 w-full rounded-lg border border-red-300 bg-white px-3 text-sm"
                />
                <div className="mt-3 flex gap-2">
                  <button type="button" disabled={voiding || voidReason.trim().length < 3} onClick={doVoid} className="h-10 rounded-lg bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
                    {voiding ? 'Voiding…' : 'Yes, void it'}
                  </button>
                  <button type="button" onClick={() => setConfirmVoid(false)} className="h-10 rounded-lg border border-red-300 bg-white px-4 text-sm font-medium text-red-800">
                    Keep it
                  </button>
                </div>
              </section>
            )}
          </div>
        )}

        {purchase && purchase.status !== 'voided' && !confirmVoid && (canEdit || canVoid) && (
          <footer className="sticky bottom-0 flex gap-2 border-t border-gray-200 bg-white px-5 py-4">
            {canCorrectPayment && purchase.expense ? <button type="button" onClick={() => setCorrectingPayment(true)} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50">
              <WalletCards className="h-4 w-4" /> Correct payment
            </button> : null}
            {canEdit && <button type="button" onClick={() => onEdit?.(purchase)} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800">
              <Pencil className="h-4 w-4" /> Edit
            </button>}
            {canVoid && <button type="button" onClick={() => setConfirmVoid(true)} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50">
              <Ban className="h-4 w-4" /> Void / reverse
            </button>}
          </footer>
        )}
        {purchase ? <PaymentMethodCorrectionDialog
          open={correctingPayment}
          onOpenChange={setCorrectingPayment}
          endpoint={`/api/admin/purchases/${purchaseId}`}
          recordId={purchaseId}
          recordLabel="purchase"
          currentMethod={purchase.expense?.payment_method || purchase.payment_method}
          allowCredit
          onSaved={async (data) => { if (data.purchase) setPurchase(data.purchase); await onChanged?.(); }}
        /> : null}
      </aside>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-gray-900">{value}</dd>
    </div>
  );
}

function paymentMethodLabel(method) {
  const m = String(method || 'cash').toLowerCase().trim();
  if (m === 'cash') return 'Cash';
  if (m === 'credit' || m === 'due' || m === 'unpaid') return 'Credit';
  if (['bank', 'bank_transfer', 'cheque', 'card', 'qr', 'fonepay', 'esewa', 'khalti', 'online'].includes(m)) return 'Online';
  if (m === 'business_funding') return 'Business Funding';
  if (m === 'owner_pocket') return 'Owner Pocket';
  if (!m) return 'Cash';
  return m.replace(/_/g, ' ');
}

function SummaryRow({ label, value }) {
  return (
    <div className="flex items-center justify-between text-gray-600">
      <span>{label}</span>
      <span className="tabular-nums">Rs {Number(value || 0).toFixed(2)}</span>
    </div>
  );
}
