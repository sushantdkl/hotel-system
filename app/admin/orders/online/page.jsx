'use client';

import { useCallback, useEffect, useState } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import { formatCurrency } from '@/lib/currency';
import {
  ShoppingBag, Phone, Clock, Check, X, ChefHat, CheckCircle2, Ban, RotateCcw, ChevronDown, Printer,
} from 'lucide-react';
import SplitPaymentFields, { emptySplitPayment } from '@/components/billing/split-payment-fields';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useConfirm } from '@/components/ui/confirm';
import { compactOrderNumber } from '@/lib/document-display.js';
import { useRouter } from 'next/navigation';
import { formatNepalTime } from '@/lib/time-utils.js';
import { authedRequest } from '@/lib/authed-fetch';
import { loadPrintSettings } from '@/lib/print-report.js';
import { receiptFromOrderDetail } from '@/lib/bill-receipt.js';
import { printFinalBill } from '@/lib/pos-print.js';

function authedFetch(url, options = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('pos_token') : null;
  return fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
  });
}

const TABS = [
  { key: 'new', label: 'New', status: 'pending' },
  { key: 'accepted', label: 'Accepted', status: 'accepted' },
  { key: 'ready', label: 'Ready', status: 'ready' },
  { key: 'completed', label: 'Completed', status: 'completed' },
  { key: 'cancelled', label: 'Cancelled', status: 'cancelled' },
  { key: 'refunded', label: 'Refunded', status: 'refunded' },
  { key: 'all', label: 'All', status: null },
];

const STATUS_TONE = {
  pending: 'bg-amber-100 text-amber-800',
  accepted: 'bg-blue-100 text-blue-800',
  ready: 'bg-violet-100 text-violet-800',
  completed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-gray-200 text-gray-700',
  refunded: 'bg-rose-100 text-rose-800',
};
const PAY_TONE = {
  unpaid: 'bg-gray-100 text-gray-600',
  paid: 'bg-emerald-100 text-emerald-700',
  refunded: 'bg-rose-100 text-rose-700',
  partially_refunded: 'bg-orange-100 text-orange-700',
};

const isQrOrder = (order) => String(order?.notes || '').toLowerCase().includes('customer via qr');

export default function OnlineOrdersPage() {
  const router = useRouter();
  const { prompt } = useConfirm();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('new');
  const [expanded, setExpanded] = useState(null);
  const [details, setDetails] = useState({});
  const [busy, setBusy] = useState(null);
  const [toast, setToast] = useState('');

  // The order's own bill on the receipt printer — not a print of this whole page.
  const printReceipt = async (o) => {
    const [res, settings] = await Promise.all([authedRequest(`/api/admin/orders/${o.id}`), loadPrintSettings()]);
    const data = await res.json().catch(() => ({}));
    const receipt = res.ok ? receiptFromOrderDetail({ ...data, settings }) : null;
    if (!receipt?.items?.length) { setToast(data.error || 'This order has no bill to print.'); return; }
    printFinalBill(receipt, { size: settings.receipt_paper_size || '80', reprint: true, settings });
  };

  const fetchOrders = useCallback(async () => {
    try {
      const res = await authedFetch('/api/admin/orders?pageSize=200&sort=created_at&dir=desc');
      if (!res.ok) return;
      const data = await res.json();
      const rows = (data.orders || data.data || []).filter((o) =>
        String(o.order_number || '').startsWith('WEB-') || isQrOrder(o)
      );
      setOrders(rows);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchOrders();
    const t = setInterval(fetchOrders, 30000);
    return () => clearInterval(t);
  }, [fetchOrders]);

  const loadDetails = async (id) => {
    if (details[id]) return;
    const res = await authedFetch(`/api/admin/orders/${id}`);
    if (res.ok) {
      const d = await res.json();
      setDetails((p) => ({ ...p, [id]: d }));
    }
  };

  const toggle = (id) => {
    const next = expanded === id ? null : id;
    setExpanded(next);
    if (next) loadDetails(id);
  };

  const act = async (id, action, extra = {}) => {
    if (['reject', 'cancel', 'refund'].includes(action)) {
      const reason = await prompt({
        title: `${action.charAt(0).toUpperCase()}${action.slice(1)} order`,
        message: `Reason to ${action} this order:`,
        label: 'Reason',
        required: true,
        multiline: true,
        tone: 'danger',
      });
      if (reason == null || !reason.trim()) return;
      extra.reason = reason.trim();
    }
    setBusy(`${id}:${action}`);
    try {
      const res = await authedFetch(`/api/admin/orders/${id}/transition`, {
        method: 'POST',
        body: JSON.stringify({ action, ...extra }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        setToast(`Order ${action}${action.endsWith('e') ? 'd' : 'ed'}.`);
        setDetails((p) => { const n = { ...p }; delete n[id]; return n; });
        await fetchOrders();
        if (expanded === id) loadDetails(id);
      } else {
        setToast(j.error || 'Action failed.');
      }
    } catch {
      setToast('Network error.');
    } finally {
      setBusy(null);
      setTimeout(() => setToast(''), 3500);
    }
  };

  const activeTab = TABS.find((t) => t.key === tab);
  const filtered = orders.filter((o) => (activeTab.status ? o.status === activeTab.status : true));
  const countFor = (status) => (status ? orders.filter((o) => o.status === status).length : orders.length);

  return (
    <AdminLayout>
      <header className="bg-white border-b border-gray-200 px-4 sm:px-6 lg:px-8 py-5">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-amber-50"><ShoppingBag className="w-6 h-6 text-amber-600" /></div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Online Orders</h1>
            <p className="text-sm text-gray-500 mt-0.5">Orders placed from the public website — accept, prepare, complete or refund.</p>
          </div>
        </div>
      </header>

      <div className="p-4 sm:p-6 lg:p-8 bg-gray-50 min-h-[70vh]">
        {/* Tabs */}
        <div className="flex gap-2 overflow-x-auto pb-3">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`shrink-0 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium border ${tab === t.key ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200'}`}>
              {t.label}
              <span className={`min-w-5 h-5 px-1 rounded-full text-[11px] font-bold flex items-center justify-center ${tab === t.key ? 'bg-white/20' : 'bg-gray-100 text-gray-600'}`}>{countFor(t.status)}</span>
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-center text-gray-500 py-16">Loading orders…</p>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            <ShoppingBag className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No {activeTab.label.toLowerCase()} orders.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((o) => {
              const qrOrder = isQrOrder(o);
              const d = details[o.id];
              const items = d?.items || [];
              const total = d?.order?.total_amount ?? o.total ?? null;
              return (
                <div key={o.id} className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                  <button onClick={() => toggle(o.id)} className="w-full flex items-center gap-3 p-4 text-left">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-gray-900">{o.customer_name || 'Guest'}</span>
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_TONE[o.status] || 'bg-gray-100'}`}>{o.status}</span>
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${PAY_TONE[o.payment_status] || 'bg-gray-100 text-gray-600'}`}>{o.payment_status || 'unpaid'}</span>
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 capitalize">{o.order_type}</span>
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${qrOrder ? 'bg-cyan-100 text-cyan-800' : 'bg-indigo-100 text-indigo-800'}`}>{qrOrder ? 'Table QR' : 'Website'}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                        <span>{compactOrderNumber(o.order_number)}</span>
                        <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" /> {o.customer_phone || '—'}</span>
                        <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" /> {formatNepalTime(o.created_at)}</span>
                        <span>{o.item_count || items.length} item(s)</span>
                      </div>
                    </div>
                    {total != null && <span className="font-bold text-gray-900 tabular-nums">{formatCurrency(total)}</span>}
                    <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${expanded === o.id ? 'rotate-180' : ''}`} />
                  </button>

                  {expanded === o.id && (
                    <div className="border-t border-gray-100 p-4 bg-gray-50/60">
                      {d?.order?.notes && <p className="mb-3 text-sm text-gray-600"><strong>Notes:</strong> {d.order.notes}</p>}
                      <div className="rounded-xl border border-gray-200 bg-white divide-y">
                        {items.length === 0 ? (
                          <p className="p-3 text-sm text-gray-400">Loading items…</p>
                        ) : items.map((it) => (
                          <div key={it.id} className="flex items-center justify-between gap-3 p-2.5 text-sm">
                            <span className="text-gray-800">{it.quantity}× {it.item_name}</span>
                            <span className="tabular-nums text-gray-600">{formatCurrency(it.subtotal ?? it.price * it.quantity)}</span>
                          </div>
                        ))}
                      </div>
                      {Number(d?.order?.discount_amount || o.discount_amount || 0) > 0 && <div className="mt-2 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm"><span className="text-emerald-800">Offer{d?.order?.promotion_code || o.promotion_code ? ` · ${d?.order?.promotion_code || o.promotion_code}` : ''}</span><span className="font-semibold tabular-nums text-emerald-800">−{formatCurrency(d?.order?.discount_amount || o.discount_amount)}</span></div>}
                      {Number(d?.order?.delivery_fee || o.delivery_fee || 0) > 0 && <div className="mt-2 flex items-center justify-between rounded-xl border border-gray-200 bg-white p-3 text-sm"><span className="text-gray-600">Delivery · {d?.order?.delivery_pricing_label || 'Delivery fee'}</span><span className="font-semibold tabular-nums text-gray-900">{formatCurrency(d?.order?.delivery_fee || o.delivery_fee)}</span></div>}

                      {/* Actions per status */}
                      <div className="mt-4 flex flex-wrap gap-2">
                        {qrOrder && !['completed', 'cancelled'].includes(o.status) && (
                          <ActBtn tone="emerald" icon={ChefHat} label="Open in POS / Cut KOT" onClick={() => router.push(`/cashier/pos?order=${o.id}`)} />
                        )}
                        {!qrOrder && o.status === 'pending' && (
                          <>
                            <ActBtn tone="emerald" icon={Check} label="Accept" busy={busy === `${o.id}:accept`} onClick={() => act(o.id, 'accept')} />
                            <ActBtn tone="rose" icon={X} label="Reject" busy={busy === `${o.id}:reject`} onClick={() => act(o.id, 'reject')} />
                          </>
                        )}
                        {!qrOrder && o.status === 'accepted' && (
                          <>
                            <ActBtn tone="violet" icon={ChefHat} label="Mark Ready" busy={busy === `${o.id}:ready`} onClick={() => act(o.id, 'ready')} />
                            <ActBtn tone="gray" icon={Ban} label="Cancel" busy={busy === `${o.id}:cancel`} onClick={() => act(o.id, 'cancel')} />
                          </>
                        )}
                        {!qrOrder && (o.status === 'accepted' || o.status === 'ready') && (
                          <CompleteControl
                            busy={busy?.startsWith(`${o.id}:complete`)}
                            total={Number(total || 0)}
                            customer={d?.customer || null}
                            onComplete={(allocations) => act(o.id, 'complete', {
                              payment_method: allocations.length > 1 ? 'split' : allocations[0]?.method,
                              allocations,
                              idempotency_key: `online-complete-${o.id}`,
                            })}
                          />
                        )}
                        {!qrOrder && o.status === 'ready' && (
                          <ActBtn tone="gray" icon={Ban} label="Cancel" busy={busy === `${o.id}:cancel`} onClick={() => act(o.id, 'cancel')} />
                        )}
                        {!qrOrder && o.status === 'completed' && (
                          <>
                            <ActBtn tone="gray" icon={Printer} label="Print receipt" onClick={() => printReceipt(o)} />
                            <ActBtn tone="rose" icon={RotateCcw} label="Refund" busy={busy === `${o.id}:refund`} onClick={() => act(o.id, 'refund')} />
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 rounded-xl bg-gray-900 text-white px-4 py-2.5 text-sm shadow-lg">{toast}</div>
      )}
    </AdminLayout>
  );
}

function ActBtn({ tone, icon: Icon, label, onClick, busy }) {
  const tones = {
    emerald: 'bg-emerald-600 hover:bg-emerald-700 text-white',
    rose: 'bg-rose-600 hover:bg-rose-700 text-white',
    violet: 'bg-violet-600 hover:bg-violet-700 text-white',
    gray: 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50',
  };
  return (
    <button onClick={onClick} disabled={busy} className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold disabled:opacity-60 ${tones[tone]}`}>
      <Icon className="w-4 h-4" /> {busy ? '…' : label}
    </button>
  );
}

function CompleteControl({ onComplete, busy, total, customer }) {
  const [open, setOpen] = useState(false);
  const [payment, setPayment] = useState(emptySplitPayment);
  const allocations = [
    { method: 'cash', amount: Number(payment.cash), cash_tendered: Number(payment.cashTendered || payment.cash), notes: payment.notes },
    { method: 'online', amount: Number(payment.qr), notes: payment.notes },
    { method: 'credit', amount: Number(payment.credit), due_date: payment.creditDueDate || undefined, notes: payment.notes },
  ].filter((row) => row.amount > 0);
  return (
    <>
      <ActBtn tone="emerald" icon={CheckCircle2} label="Complete & Pay" busy={busy} onClick={() => { setPayment({ ...emptySplitPayment, cash: String(total), cashTendered: String(total) }); setOpen(true); }} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent onClose={() => setOpen(false)}>
          <DialogHeader>
            <DialogTitle>Confirm payment</DialogTitle>
          </DialogHeader>
          <div className="mt-4 space-y-3">
            <SplitPaymentFields total={total} value={payment} onChange={setPayment} customer={customer} />
            <div className="flex gap-2 pt-2">
              <button onClick={() => onComplete(allocations)} disabled={busy || !allocations.length}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{busy ? 'Saving…' : 'Confirm payment'}</button>
              <button onClick={() => setOpen(false)} disabled={busy} className="px-3 text-sm text-gray-500">Cancel</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
