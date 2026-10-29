'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AdminLayout from '@/components/admin/admin-layout';
import { formatValue } from '@/components/admin/report-kit';
import { formatNepalDateTime, resolvePeriodRange } from '@/lib/report-dates.js';
import {
  Search, RotateCcw, X, ReceiptText, ExternalLink, RefreshCw, AlertCircle, Info,
  CheckCircle2, History, UserCog, Ban, LayoutGrid, ShoppingBag, Bike, Globe, MessageCircle,
} from 'lucide-react';
import { billMessage, openWhatsapp } from '@/lib/whatsapp.js';
import SplitPaymentFields, { emptySplitPayment } from '@/components/billing/split-payment-fields';
import ReviseSettlementForm from '@/components/billing/revise-settlement-form';
import { latestReopenChanges, buildChangeIndex } from '@/lib/reopen-diff.js';
import { useConfirm } from '@/components/ui/confirm';
import PaginationControls from '@/components/ui/pagination-controls';
import { useCapabilities } from '@/lib/use-capabilities.js';
import DateRangeFilter from '@/components/ui/date-range-filter';
import { compactBillNumber, compactOrderNumber } from '@/lib/document-display.js';
import { printFinalBill } from '@/lib/pos-print.js';
import { receiptFromBillDetail } from '@/lib/bill-receipt.js';
import BillFolioLink from '@/components/hotel/bill-folio-link';
import { SittingTime } from '@/components/tables/table-open-duration.jsx';
import { billPaymentHistory } from '@/lib/bill-payment-history.js';

/**
 * Admin Bill Management — /admin/bills
 * Central place to search, inspect and continue bills (counter + online).
 * Reopen sends a completed bill into a fresh active POS checkout session —
 * the original invoice stays intact.
 */

const TABS = [
  { id: 'active', label: 'Open Orders' },
  { id: 'pending', label: 'Pending Payment' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled / Void' },
  { id: 'all', label: 'All Bills' },
];

const PAY_BADGE = {
  paid: 'bg-emerald-100 text-emerald-700',
  partial: 'bg-amber-100 text-amber-700',
  unpaid: 'bg-red-100 text-red-700',
};
const BILL_BADGE = {
  open_order: 'bg-sky-100 text-sky-700',
  open: 'bg-sky-100 text-sky-700',
  unpaid: 'bg-amber-100 text-amber-700',
  paid: 'bg-emerald-100 text-emerald-700',
  partially_paid: 'bg-amber-100 text-amber-700',
  reopened: 'bg-blue-100 text-blue-700',
  voided: 'bg-red-100 text-red-700',
  void: 'bg-red-100 text-red-700',
  cancelled: 'bg-red-100 text-red-700',
  canceled: 'bg-red-100 text-red-700',
};
const CHANNEL_BADGE = {
  counter: 'bg-slate-100 text-slate-700',
  takeaway: 'bg-sky-100 text-sky-700',
  delivery: 'bg-orange-100 text-orange-700',
  online: 'bg-indigo-100 text-indigo-700',
};
const CHANNEL_LABEL = {
  counter: 'Table',
  takeaway: 'Takeaway',
  delivery: 'Delivery',
  online: 'Online',
};
const CHANNEL_ICON = {
  counter: LayoutGrid,
  takeaway: ShoppingBag,
  delivery: Bike,
  online: Globe,
};
function ChannelBadge({ channel }) {
  const Icon = CHANNEL_ICON[channel] || ShoppingBag;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${CHANNEL_BADGE[channel] || 'bg-gray-100 text-gray-700'}`}>
      <Icon className="h-3 w-3" /> {CHANNEL_LABEL[channel] || channel}
    </span>
  );
}

function authHeaders() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('pos_token') : null;
  return { Authorization: `Bearer ${token}` };
}

function docNumber(value, fallback = '—') {
  const str = String(value || '').trim();
  if (!str) return fallback;
  return str;
}

const shortBillNumber = (value) => docNumber(compactBillNumber(value), 'Open order');
const shortOrderNumber = (value) => docNumber(compactOrderNumber(value));
const prettyStatus = (value) => String(value || '').replace(/_/g, ' ');
const panelPosPath = () => typeof window !== 'undefined' && window.location.pathname.startsWith('/cashier')
  ? '/cashier/pos'
  : '/admin/pos';
const panelOrdersPath = () => typeof window !== 'undefined' && window.location.pathname.startsWith('/cashier')
  ? '/cashier/orders'
  : '/admin/orders';

export default function BillsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState('active');
  const [search, setSearch] = useState('');
  const [channel, setChannel] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [dateRange, setDateRange] = useState(() => {
    const range = resolvePeriodRange('today');
    return { period: 'today', from: range.start, to: range.end };
  });
  const { from, to } = dateRange;
  const [reopenedOnly, setReopenedOnly] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  // Open orders may be cancelled with a reason; their records remain in history.
  const { can } = useCapabilities();
  const [deleteReason, setDeleteReason] = useState('');

  useEffect(() => {
    const requestedBill = Number(searchParams.get('bill'));
    if (requestedBill > 0) setSelectedId(requestedBill);
  }, [searchParams]);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ tab, page: String(page), pageSize: String(pageSize) });
      if (search) qs.set('search', search);
      if (channel) qs.set('channel', channel);
      if (paymentStatus) qs.set('paymentStatus', paymentStatus);
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      if (reopenedOnly) qs.set('reopened', '1');
      const res = await fetch(`/api/admin/bills?${qs}`, { headers: authHeaders() });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `Request failed (${res.status})`);
      setData(await res.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [tab, page, pageSize, search, channel, paymentStatus, from, to, reopenedOnly]);

  useEffect(() => {
    setPage(1);
  }, [tab, search, channel, paymentStatus, from, to, reopenedOnly, pageSize]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  // Auto-refresh Active tab so open table orders stay visible.
  useEffect(() => {
    if (tab !== 'active' && tab !== 'all') return undefined;
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [tab, load]);

  const openRow = (b) => {
    const liveStatuses = ['pending', 'confirmed', 'preparing', 'cooking', 'ready', 'dining', 'served', 'awaiting_payment'];
    if (
      b.isOpenOrder
      || String(b.id).startsWith('order-')
      || (b.orderId && liveStatuses.includes(String(b.orderStatus || '')))
    ) {
      const posPath = panelPosPath();
      router.push(b.orderId ? `${posPath}?order=${b.orderId}` : posPath);
      return;
    }
    setSelectedId(b.id);
  };

  const cancelActiveOrder = async () => {
    if (!deleteTarget?.orderId || !String(deleteReason || '').trim()) return;
    setDeleteBusy(true);
    setError(null);
    try {
      const headers = { ...authHeaders(), 'Content-Type': 'application/json' };
      const cancelRes = await fetch(`/api/admin/orders/${deleteTarget.orderId}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'cancel', reason: deleteReason }),
      });
      const cancelJson = await cancelRes.json().catch(() => ({}));
      if (!cancelRes.ok) throw new Error(cancelJson.error || 'Could not cancel the order.');

      setDeleteTarget(null);
      setDeleteReason('');
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setDeleteBusy(false);
    }
  };

  const counts = data?.counts || {};

  return (
    <AdminLayout>
      <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Bills</h1>
            <p className="mt-1 text-sm text-gray-500">Open table orders, pending payments and invoice history (times in Nepal / Kathmandu).</p>
          </div>
          <button type="button" onClick={load} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <RotateCcw className="h-4 w-4" /> Refresh
          </button>
        </div>

        {/* Tabs */}
        <div className="mt-4 overflow-x-auto border-b border-gray-200">
          <div className="flex gap-1 pb-2">
            {TABS.map((t) => (
              <button key={t.id} type="button" onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${tab === t.id ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
                {t.label}
                {counts[t.id === 'all' ? 'all' : t.id] != null && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[11px] ${tab === t.id ? 'bg-white/20' : 'bg-gray-100 text-gray-600'}`}>
                    {counts[t.id === 'all' ? 'all' : t.id]}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-gray-50/70 p-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Bill #, order #, customer, phone…"
              className="h-9 w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-gray-400" />
          </div>
          <select value={channel} onChange={(e) => setChannel(e.target.value)} className="h-9 min-w-[132px] rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-700 outline-none focus:border-gray-400">
            <option value="">All channels</option>
            <option value="counter">Table orders</option>
            <option value="takeaway">Takeaway</option>
            <option value="delivery">Delivery</option>
            <option value="online">Online</option>
          </select>
          <select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)} className="h-9 min-w-[164px] rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-700 outline-none focus:border-gray-400">
            <option value="">Any payment status</option>
            <option value="paid">Paid</option>
            <option value="partial">Partial</option>
            <option value="unpaid">Unpaid</option>
          </select>
          <DateRangeFilter value={dateRange} onChange={setDateRange} compact />
        </div>
        <label className="mt-2 inline-flex items-center gap-2 text-xs text-gray-600">
          <input type="checkbox" checked={reopenedOnly} onChange={(e) => setReopenedOnly(e.target.checked)} /> Reopened bills only
        </label>

        {error ? (
          <div className="mt-16 flex flex-col items-center text-center">
            <AlertCircle className="h-10 w-10 text-red-400" />
            <p className="mt-3 text-sm text-gray-700">{error}</p>
            <button onClick={load} className="mt-4 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white">Try again</button>
          </div>
        ) : loading ? (
          <div className="mt-6 h-96 animate-pulse rounded-2xl bg-gray-100" />
        ) : !data?.bills?.length ? (
          <div className="mt-16 flex flex-col items-center text-center text-gray-500">
            <Info className="h-10 w-10 text-gray-300" />
            <p className="mt-3 text-sm">No bills match these filters.</p>
          </div>
        ) : (
          <BillTable bills={data.bills} onSelect={openRow} onOpenOrder={(bill) => bill.orderId && router.push(`${panelOrdersPath()}/${bill.orderId}`)} canCancel={can('orders.cancel')} onCancelActive={(bill) => {
            setDeleteTarget(bill);
            setDeleteReason('');
          }} />
        )}
        {!loading && !error && data && (
          <PaginationControls
            pagination={{
              page: data.page,
              pageSize: data.pageSize,
              total: data.total,
              totalPages: Math.max(1, Math.ceil(Number(data.total || 0) / Number(data.pageSize || pageSize || 1))),
            }}
            loading={loading}
            onPageChange={setPage}
            onPageSizeChange={(next) => {
              setPageSize(next);
              setPage(1);
            }}
          />
        )}
      </div>

      {selectedId && !String(selectedId).startsWith('order-') && (
        <BillDetailPanel id={selectedId} onClose={() => setSelectedId(null)} onChanged={load} />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Cancel active order</h2>
                <p className="mt-1 text-sm text-gray-500">
                  {deleteTarget.orderNumber ? shortOrderNumber(deleteTarget.orderNumber) : `Order #${deleteTarget.orderId}`}
                  {deleteTarget.tableNumber ? ` - Table ${deleteTarget.tableNumber}` : ''}
                </p>
              </div>
              <button type="button" onClick={() => setDeleteTarget(null)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <label className="mt-4 block text-sm font-medium text-gray-700">Reason (required)</label>
            <textarea
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              rows={3}
              className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              placeholder="e.g. Duplicate order opened by mistake"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteTarget(null)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteBusy || !deleteReason.trim()}
                onClick={cancelActiveOrder}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white ${deleteReason.trim() ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-300'}`}
              >
                <Ban className="h-4 w-4" /> {deleteBusy ? 'Cancelling...' : 'Cancel order'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

function BillTable({ bills, onSelect, onOpenOrder, onCancelActive, canCancel = false }) {
  const canCancelActive = (b) => canCancel && b.orderId && b.tab === 'active' && b.isOpenOrder;
  return (
    <>
      {/* Desktop table */}
      <div className="mt-6 hidden overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm lg:block">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Bill / Order</th>
              <th className="px-4 py-3">Channel</th>
              <th className="px-4 py-3">Customer / Table</th>
              <th className="px-4 py-3">At table</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3 text-right">Paid</th>
              <th className="px-4 py-3 text-right">Balance</th>
              <th className="px-4 py-3">Bill Status</th>
              <th className="px-4 py-3">Payment</th>
              <th className="px-4 py-3">Updated (NPT)</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {bills.map((b) => (
              <tr key={b.id} className="cursor-pointer hover:bg-gray-50" onClick={() => onSelect(b)}>
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">
                    {b.billNumber ? shortBillNumber(b.billNumber) : (b.isOpenOrder ? 'Open order' : '—')}
                    {b.isOpenOrder && (
                      <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-sky-700">live</span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-xs text-gray-400">
                    {b.orderNumber ? <button type="button" onClick={(event) => { event.stopPropagation(); onOpenOrder?.(b); }} className="rounded-md bg-blue-50 px-2 py-0.5 font-bold text-blue-700 ring-1 ring-blue-200 hover:bg-blue-100">{shortOrderNumber(b.orderNumber)}</button> : '—'}
                    {b.orderStatus ? ` · ${prettyStatus(b.orderStatus)}` : ''}
                    {b.reopened && <span className="ml-1 rounded bg-blue-100 px-1 text-blue-600">reopened</span>}
                  </div>
                </td>
                <td className="px-4 py-3"><ChannelBadge channel={b.channel} /></td>
                <td className="px-4 py-3 text-gray-700">
                  {b.customerName || '—'}
                  {b.tableNumber ? <span className="block text-xs text-gray-400">Table {b.tableNumber}</span> : null}
                </td>
                <td className="px-4 py-3 text-sm text-gray-700">
                  <SittingTime
                    openedAt={b.openedAt || b.createdAt}
                    closedAt={b.paidAt}
                    status={b.orderStatus || b.billStatus}
                    dineIn={Boolean(b.tableNumber)}
                  />
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{formatValue(b.total, 'currency')}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-600">{formatValue(b.paid, 'currency')}</td>
                <td className={`px-4 py-3 text-right tabular-nums ${b.balance > 0 ? 'text-amber-600' : 'text-gray-400'}`}>{formatValue(b.balance, 'currency')}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs capitalize ${BILL_BADGE[b.billStatus] || 'bg-gray-100 text-gray-700'}`}>
                    {prettyStatus(b.billStatus)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs capitalize ${PAY_BADGE[b.paymentStatus] || PAY_BADGE.unpaid}`}>{b.paymentStatus}</span>
                  {b.lastMethod ? <span className="mt-0.5 block text-[11px] text-gray-400">{b.lastMethod === 'cash' ? 'Cash' : b.lastMethod === 'credit' ? 'Credit' : 'Online'}</span> : null}
                </td>
                <td className="px-4 py-3 text-xs text-gray-400">{formatNepalDateTime(b.updatedAt)}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    {canCancelActive(b) && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onCancelActive?.(b);
                        }}
                        className="rounded-lg border border-red-200 p-1.5 text-red-600 hover:bg-red-50"
                        title="Cancel active order with reason"
                      >
                        <Ban className="h-4 w-4" />
                      </button>
                    )}
                    <ExternalLink className="h-4 w-4 text-gray-300" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="mt-6 grid gap-3 lg:hidden">
        {bills.map((b) => (
          <div key={b.id} className="rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm">
            <div role="button" tabIndex={0} onClick={() => onSelect(b)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onSelect(b); }} className="block w-full cursor-pointer text-left">
            <div className="flex items-center justify-between">
              <span className="font-medium text-gray-900">{b.billNumber ? shortBillNumber(b.billNumber) : 'Open order'}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs capitalize ${BILL_BADGE[b.billStatus] || 'bg-gray-100 text-gray-700'}`}>{prettyStatus(b.billStatus)}</span>
            </div>
            <div className="mt-1 flex items-center gap-1 text-xs text-gray-400">{b.orderNumber ? <button type="button" onClick={(event) => { event.stopPropagation(); onOpenOrder?.(b); }} className="rounded-md bg-blue-50 px-2 py-0.5 font-bold text-blue-700 ring-1 ring-blue-200">{shortOrderNumber(b.orderNumber)}</button> : '—'} · <ChannelBadge channel={b.channel} />{b.tableNumber ? ` · Table ${b.tableNumber}` : ''}{b.reopened && ' · reopened'}</div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-gray-500">{b.customerName || '—'}</span>
              <span className="font-semibold tabular-nums">{formatValue(b.total, 'currency')}</span>
            </div>
            <div className="mt-1 text-[11px] text-gray-400">
              {formatNepalDateTime(b.updatedAt)}
              {b.tableNumber ? (
                <>
                  {' · '}
                  <SittingTime
                    openedAt={b.openedAt || b.createdAt}
                    closedAt={b.paidAt}
                    status={b.orderStatus || b.billStatus}
                    dineIn
                  />
                </>
              ) : null}
            </div>
            </div>
            {canCancelActive(b) && (
              <button
                type="button"
                onClick={() => onCancelActive?.(b)}
                className="mt-3 inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
              >
                <Ban className="h-4 w-4" /> Cancel order
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function BillDetailPanel({ id, onClose, onChanged }) {
  const router = useRouter();
  const { alert } = useConfirm();
  const [bill, setBill] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('view'); // view | reopen
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState(null); // 'void' | 'refund' | 'complete_payment' | 'revise_settlement'
  const [actionReason, setActionReason] = useState('');
  const [actionAmount, setActionAmount] = useState('');
  const [actionMethod, setActionMethod] = useState('cash');
  const [actionSplit, setActionSplit] = useState(emptySplitPayment);
  const [paySettings, setPaySettings] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/bills/${id}`, { headers: authHeaders() });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Failed');
      setBill((await res.json()).bill);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/settings', { headers: authHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setPaySettings(data.settings || data || {});
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const startReopen = async () => {
    if (!String(reason || '').trim()) {
      await alert({ title: 'Reason required', message: 'Enter a reason before reopening this bill.', tone: 'warning' });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/bills/${id}/reopen`, {
        method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Reopen failed');
      onChanged?.();
      router.push(`${panelPosPath()}?order=${j.orderId}`);
    } catch (e) {
      await alert({ title: 'Could not reopen', message: e.message, tone: 'danger' });
    } finally { setBusy(false); }
  };

  const runAction = async (payload) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/bills/${id}`, {
        method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Action failed');
      setAction(null); setActionReason(''); setActionAmount('');
      onChanged?.();
      load();
      return true;
    } catch (e) {
      await alert({ title: 'Action failed', message: e.message, tone: 'danger' });
      return false;
    } finally { setBusy(false); }
  };

  const reprint = async (kind) => {
    if (!bill) return;
    const ok = await runAction({ action: 'reprint', kind });
    if (!ok) return;
    const receipt = receiptFromBillDetail(bill, paySettings);
    if (!receipt?.items?.length) {
      await alert({ title: 'Empty bill', message: 'There are no items on this bill to print.', tone: 'warning' });
      return;
    }
    printFinalBill(receipt, { size: paySettings?.receipt_paper_size || '80', reprint: true, settings: paySettings });
  };

  const voidRefundByMethod = Object.entries((bill?.payments || []).reduce((totals, payment) => {
    if (['voided', 'cancelled', 'failed'].includes(String(payment.settlementStatus || 'received').toLowerCase())) return totals;
    const method = String(payment.method || 'other').toLowerCase();
    totals[method] = Number(totals[method] || 0) + Number(payment.amount || 0);
    return totals;
  }, {}));
  const paymentHistory = bill ? billPaymentHistory(bill.payments, bill.allocations) : [];

  return (
    <div className="fixed inset-0 z-[80] flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-5 py-4">
          <h2 className="flex items-center gap-2 font-semibold text-gray-900"><ReceiptText className="h-5 w-5 text-emerald-600" /> Bill details</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-gray-100"><X className="h-5 w-5" /></button>
        </div>

        {loading ? (
          <div className="p-5"><div className="h-96 animate-pulse rounded-2xl bg-gray-100" /></div>
        ) : error ? (
          <div className="p-5 text-sm text-red-600">{error}</div>
        ) : !bill ? null : (
          <div className="space-y-5 p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-lg font-bold text-gray-900">{shortBillNumber(bill.billNumber)}</p>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-400"><button type="button" onClick={() => bill.orderId && router.push(`${panelOrdersPath()}/${bill.orderId}`)} className="rounded-md bg-blue-50 px-2 py-0.5 font-bold text-blue-700 ring-1 ring-blue-200 hover:bg-blue-100">{shortOrderNumber(bill.orderNumber)}</button> · <ChannelBadge channel={bill.channel} /></p>
              </div>
              <div className="text-right">
                <span className={`rounded-full px-2 py-0.5 text-xs capitalize ${BILL_BADGE[bill.billStatus] || 'bg-gray-100 text-gray-700'}`}>{prettyStatus(bill.billStatus)}</span>
                <span className={`ml-1 rounded-full px-2 py-0.5 text-xs capitalize ${PAY_BADGE[bill.paymentStatus] || PAY_BADGE.unpaid}`}>{bill.paymentStatus}</span>
                <p className="mt-1 text-xs text-gray-400">{formatNepalDateTime(bill.createdAt)}</p>
              </div>
            </div>

            <BillFolioLink billId={id} />

            {bill.voided?.reason && (
              <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
                <span className="font-semibold">Void reason:</span> {bill.voided.reason}
                {bill.voided.at && <span className="block text-xs text-red-600/80">Voided {formatNepalDateTime(bill.voided.at)}</span>}
              </div>
            )}

            {bill.customer && <p className="text-sm text-gray-600">Customer: <span className="font-medium">{bill.customer.name}</span>{bill.customer.phone ? ` · ${bill.customer.phone}` : ''}</p>}
            {(bill.legacy.tableNumber || bill.legacy.cashierName) && (
              <p className="text-xs text-gray-400">
                {bill.legacy.tableNumber ? `Table ${bill.legacy.tableNumber}` : ''}
                {bill.legacy.cashierName ? ` · ${bill.legacy.cashierName}` : ''}
                {bill.legacy.tableNumber ? (
                  <>
                    {' · '}
                    <SittingTime
                      openedAt={bill.openedAt || bill.createdAt}
                      closedAt={bill.paidAt}
                      status={bill.orderStatus || bill.billStatus}
                      dineIn
                    />
                    {bill.openedAt ? ` seated ${formatNepalDateTime(bill.openedAt)}` : ''}
                    {bill.paidAt ? ` · paid ${formatNepalDateTime(bill.paidAt)}` : ''}
                  </>
                ) : null}
              </p>
            )}

            {/* Items */}
            <BillItemsSection bill={bill} />

            {/* Totals */}
            <Section title="Totals">
              <Row label="Subtotal" value={bill.totals.subtotal} />
              {bill.totals.deliveryFee > 0 && <Row label="Delivery" value={bill.totals.deliveryFee} />}
              {bill.totals.discount > 0 && <Row label="Discount" value={-bill.totals.discount} />}
              {bill.totals.tax > 0 && <Row label="Tax / VAT" value={bill.totals.tax} />}
              {bill.totals.serviceCharge > 0 && <Row label="Service charge" value={bill.totals.serviceCharge} />}
              <Row label="Grand total" value={bill.totals.grandTotal} bold />
              <Row label="Paid" value={bill.totals.paid} />
              {bill.totals.balance > 0 && <Row label="Balance" value={bill.totals.balance} amber />}
            </Section>

            {/* Payments */}
            <Section title="Payment history">
              {paymentHistory.length ? paymentHistory.map((p) => (
                <div key={`${p.method}-${p.id}`} className="flex items-center justify-between py-1 text-sm">
                  <span className="text-gray-600">{p.method === 'cash' ? 'Cash' : p.method === 'credit' ? 'Credit / Due' : 'Online'}{p.reference ? ` · ${p.reference}` : ''}</span>
                  <span className="tabular-nums">{formatValue(p.amount, 'currency')}</span>
                </div>
              )) : <p className="text-sm text-gray-400">No payments recorded.</p>}
            </Section>

            {/* Revisions */}
            {bill.revisions.length > 0 && (
              <Section title="Reopen revisions">
                {bill.revisions.map((r) => (
                  <div key={r.id} className="flex items-center justify-between py-1 text-sm">
                    <span className="text-gray-600">#{r.id} · {String(r.status).replace(/_/g, ' ')}</span>
                    <span className="tabular-nums text-gray-500">{r.deltaAmount ? formatValue(r.deltaAmount, 'currency') : '—'}</span>
                  </div>
                ))}
              </Section>
            )}

            {/* Activity */}
            <Section title="Activity timeline">
              {bill.activity.length ? bill.activity.map((a) => (
                <div key={a.id} className="flex items-start gap-2 py-1.5 text-xs">
                  <History className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-300" />
                  <div className="min-w-0 flex-1">
                    <p className="text-gray-700">{String(a.event).replace(/_/g, ' ')}{a.actor ? ` · ${a.actor}` : ''}</p>
                    {a.reason && <p className="text-gray-400">“{a.reason}”</p>}
                    <ReopenActivityDetail value={a.newValue} />
                    <p className="text-gray-300">{formatNepalDateTime(a.createdAt)}</p>
                  </div>
                </div>
              )) : <p className="text-sm text-gray-400">No activity recorded.</p>}
            </Section>

            {/* Actions / reopen flow */}
            <div className="border-t border-gray-200 pt-4">
              {mode === 'view' && (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <a href={`${panelOrdersPath()}/${bill.orderId}`} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                      <ExternalLink className="h-4 w-4" /> View order
                    </a>
                    {bill.orderId && bill.tab !== 'cancelled' && (
                      <button
                        type="button"
                        onClick={() => router.push(`${panelPosPath()}?order=${bill.orderId}`)}
                        className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
                      >
                        <ExternalLink className="h-4 w-4" /> Edit in POS
                      </button>
                    )}
                    <button onClick={() => reprint('final')} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                      <ReceiptText className="h-4 w-4" /> Reprint receipt
                    </button>
                    <button onClick={() => openWhatsapp(bill.customer?.phone, billMessage(bill, paySettings?.restaurant_name))} className="inline-flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm font-medium text-green-800 hover:bg-green-100">
                      <MessageCircle className="h-4 w-4" /> WhatsApp bill
                    </button>
                    {bill.tab === 'pending' && (
                      <button onClick={() => { const balance=String(bill.totals.balance); setAction('complete_payment'); setActionAmount(balance); setActionSplit({ ...emptySplitPayment, cash: balance, cashTendered: balance }); }} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700">
                        <CheckCircle2 className="h-4 w-4" /> Complete payment
                      </button>
                    )}
                    {bill.canReopen && (
                      <button onClick={() => setMode('reopen')} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">
                        <RefreshCw className="h-4 w-4" /> Reopen
                      </button>
                    )}
                    {(bill.tab === 'completed' || bill.tab === 'pending' || bill.paymentStatus === 'paid' || bill.paymentStatus === 'partial') && (
                      <button
                        type="button"
                        onClick={() => setAction('revise_settlement')}
                        className="inline-flex items-center gap-2 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-800 hover:bg-indigo-100"
                      >
                        <UserCog className="h-4 w-4" /> Edit payment / customer
                      </button>
                    )}
                    {bill.tab === 'completed' && (
                      <button onClick={() => setAction('refund')} className="inline-flex items-center gap-2 rounded-lg border border-amber-300 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50">
                        <RefreshCw className="h-4 w-4" /> Refund
                      </button>
                    )}
                    {bill.tab !== 'cancelled' && (
                      <button onClick={() => setAction('void')} className="inline-flex items-center gap-2 rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50">
                        <X className="h-4 w-4" /> Void
                      </button>
                    )}
                  </div>

                  {action === 'complete_payment' && (
                    <ActionForm title="Complete payment" tone="emerald" busy={busy} onCancel={() => setAction(null)}
                      onConfirm={() => {
                        const allocations = actionMethod === 'split'
                          ? [
                              { method: 'cash', amount: Number(actionSplit.cash), cash_tendered: Number(actionSplit.cashTendered || actionSplit.cash) },
                              { method: 'online', amount: Number(actionSplit.qr), verified: true },
                            ].filter((p) => p.amount > 0)
                          : [{ method: actionMethod, amount: Number(actionAmount), cash_tendered: actionMethod === 'cash' ? Number(actionAmount) : undefined, verified: true }];
                        runAction({ action: 'complete_payment', amount: Number(actionAmount), method: actionMethod, allocations, idempotency_key: globalThis.crypto?.randomUUID?.() || `collect-${id}-${Date.now()}` });
                      }}
                      confirmLabel={`Collect ${formatValue(Number(actionAmount) || 0, 'currency')}`}>
                      <MethodSelect value={actionMethod} onChange={setActionMethod} />
                      {actionMethod === 'split' ? (
                        <SplitPaymentFields total={Number(actionAmount)} value={actionSplit} onChange={setActionSplit} customer={bill.customer} allowCredit={false} settings={paySettings} />
                      ) : (
                        <div className="space-y-2">
                          <input type="number" value={actionAmount} onChange={(e) => setActionAmount(e.target.value)} className="w-32 rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
                        </div>
                      )}
                    </ActionForm>
                  )}
                  {action === 'void' && (
                    <ActionForm title="Void bill" tone="red" busy={busy} requireReason reason={actionReason} setReason={setActionReason} onCancel={() => setAction(null)}
                      onConfirm={() => runAction({ action: 'void', reason: actionReason })}
                      confirmLabel="Void bill & reverse sale">
                      <div className="space-y-2 text-xs text-gray-600">
                        <p>Reverses the sale, every later credit collection/write-off, customer balance and stock movement. This cannot be undone.</p>
                        {voidRefundByMethod.length > 0 && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2"><p className="font-semibold text-red-800">Return or reverse this received money:</p>{voidRefundByMethod.map(([method, amount]) => <div key={method} className="mt-1 flex items-center justify-between gap-4 capitalize text-red-700"><span>{method.replaceAll('_', ' ')}</span><strong className="tabular-nums">{formatValue(amount, 'currency')}</strong></div>)}</div>}
                        {!voidRefundByMethod.length && <p className="rounded-lg bg-gray-50 px-3 py-2 text-gray-500">No cash or digital money was received on this bill.</p>}
                      </div>
                    </ActionForm>
                  )}
                </div>
              )}

              {mode === 'reopen' && (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-gray-700">Reason for reopening (required)</p>
                  <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="e.g. Customer wants to add more items" />
                  <div className="flex gap-2">
                    <button disabled={busy || !reason.trim()} onClick={startReopen} className={`rounded-lg px-4 py-2 text-sm font-medium text-white ${reason.trim() ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-300'}`}>
                      {busy ? 'Opening…' : 'Open in POS'}
                    </button>
                    <button onClick={() => setMode('view')} className="rounded-lg border border-gray-200 px-4 py-2 text-sm">Cancel</button>
                  </div>
                  <p className="text-xs text-gray-400">
                    Opens this same order in POS with all previous items loaded so you can edit them. The original payment stays on file — Complete Sale only settles any difference.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {bill && action === 'revise_settlement' && (
        <ActionPopup title="Edit payment / customer" onClose={() => setAction(null)}>
          <ReviseSettlementForm
            billTotal={Number(bill.totals?.grandTotal || bill.totals?.paid || 0)}
            initialCustomer={bill.customer}
            settings={paySettings}
            busy={busy}
            onCancel={() => setAction(null)}
            onSubmit={async (result) => {
              if (result?.error) {
                await alert({ title: 'Check details', message: result.error, tone: 'warning' });
                return;
              }
              await runAction({
                action: 'revise_settlement',
                reason: result.reason,
                allocations: result.allocations,
                customer_id: result.customer_id,
                customer_name: result.customer_name,
                customer_phone: result.customer_phone,
              });
            }}
          />
        </ActionPopup>
      )}
      {bill && action === 'refund' && (
        <ActionPopup title="Refund bill" onClose={() => setAction(null)}>
          <ActionForm title="Refund bill" tone="amber" busy={busy} requireReason reason={actionReason} setReason={setActionReason} onCancel={() => setAction(null)}
            onConfirm={() => runAction({ action: 'refund', amount: Number(actionAmount) || undefined, full: !actionAmount, method: actionMethod, reason: actionReason })}
            confirmLabel={actionAmount ? `Refund ${formatValue(Number(actionAmount), 'currency')}` : 'Refund full amount'}>
            <div className="flex flex-wrap items-center gap-2">
              <input type="number" placeholder="Amount (blank = full)" value={actionAmount} onChange={(e) => setActionAmount(e.target.value)} className="w-40 rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
              <MethodSelect value={actionMethod} onChange={setActionMethod} allowSplit={false} />
            </div>
          </ActionForm>
        </ActionPopup>
      )}
    </div>
  );
}

function MethodSelect({ value, onChange, allowSplit = true }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm">
      <option value="cash">Cash</option>
      <option value="online">Online</option>
      {allowSplit && <option value="split">Split Cash + Online</option>}
    </select>
  );
}

const TONE = {
  emerald: 'bg-emerald-600 hover:bg-emerald-700',
  amber: 'bg-amber-600 hover:bg-amber-700',
  red: 'bg-red-600 hover:bg-red-700',
};

function ActionForm({ title, tone = 'emerald', children, onConfirm, onCancel, confirmLabel, busy, requireReason, reason, setReason }) {
  const blocked = requireReason && !String(reason || '').trim();
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
      <p className="mb-2 text-sm font-semibold text-gray-900">{title}</p>
      <div className="space-y-2">
        {children}
        {requireReason && (
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason (required)"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
        )}
        <div className="flex gap-2">
          <button disabled={busy || blocked} onClick={onConfirm}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white ${blocked ? 'bg-gray-300' : TONE[tone]}`}>
            {confirmLabel}
          </button>
          <button onClick={onCancel} className="rounded-lg border border-gray-200 px-4 py-2 text-sm">Cancel</button>
        </div>
      </div>
    </div>
  );
}

function ActionPopup({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[80vh] overflow-y-auto p-5">
          {children}
        </div>
      </div>
    </div>
  );
}

/** Items list with reopen cut/added effects merged in from the activity log. */
function BillItemsSection({ bill }) {
  const changes = latestReopenChanges(bill.activity);
  const { map, removed, changeKey } = buildChangeIndex(changes);
  return (
    <Section title="Items">
      <div className="divide-y divide-gray-100">
        {bill.items.map((it, i) => {
          const chg = map.get(changeKey(it));
          return (
            <div key={i} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span className="flex flex-wrap items-center gap-1.5 text-gray-700">
                <span>{it.quantity}× {it.name}{it.variant ? ` (${it.variant})` : ''}</span>
                {chg?.kind === 'added' && <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">Added</span>}
                {chg?.kind === 'increased' && <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">+{chg.deltaQty} ({chg.fromQty}→{chg.toQty})</span>}
                {chg?.kind === 'decreased' && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Cut {chg.fromQty}→{chg.toQty}</span>}
              </span>
              <span className="tabular-nums text-gray-600">{formatValue(it.total, 'currency')}</span>
            </div>
          );
        })}
        {removed.map((r, i) => (
          <div key={`rm-${i}`} className="flex items-center justify-between gap-2 py-2 text-sm text-red-500">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="line-through">{r.fromQty}× {r.name}{r.variant ? ` (${r.variant})` : ''}</span>
              <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">Removed</span>
            </span>
            <span className="tabular-nums line-through">{formatValue(r.total, 'currency')}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Section({ title, children }) {
  return (
    <div className="rounded-xl border border-gray-200 p-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</p>
      {children}
    </div>
  );
}

function Row({ label, value, bold, amber }) {
  return (
    <div className="flex items-center justify-between py-0.5 text-sm">
      <span className={bold ? 'font-semibold text-gray-900' : 'text-gray-500'}>{label}</span>
      <span className={`tabular-nums ${bold ? 'font-semibold text-gray-900' : amber ? 'text-amber-600' : 'text-gray-600'}`}>{formatValue(value, 'currency')}</span>
    </div>
  );
}

/** Renders the item-change log + prior/new payment split stored on reopen audit. */
function ReopenActivityDetail({ value }) {
  if (!value || typeof value !== 'object') return null;
  const ch = value.changes;
  const prior = (value.priorPayments || []).filter((p) => Number(p.amount) > 0);
  const next = (value.newPayments || []).filter((p) => Number(p.amount) > 0);
  const rows = [];
  if (ch) {
    for (const r of ch.added || []) rows.push({ k: `add-${r.name}`, cls: 'text-emerald-600', txt: `+ ${r.toQty}× ${r.name}${r.variant ? ` (${r.variant})` : ''}` });
    for (const r of ch.changed || []) rows.push({ k: `chg-${r.name}`, cls: r.deltaQty > 0 ? 'text-emerald-600' : 'text-amber-600', txt: `${r.fromQty}→${r.toQty}× ${r.name}${r.variant ? ` (${r.variant})` : ''}` });
    for (const r of ch.removed || []) rows.push({ k: `rem-${r.name}`, cls: 'text-red-500 line-through', txt: `${r.fromQty}× ${r.name}${r.variant ? ` (${r.variant})` : ''}` });
  }
  const payLabel = (m) => ({ cash: 'Cash', credit: 'Credit' }[m] || 'Online');
  const hasMoney = Number(value.alreadyPaid) > 0 || next.length || Number(value.refundDue) > 0;
  if (!rows.length && !hasMoney) return null;
  return (
    <div className="my-1 rounded-lg border border-gray-100 bg-gray-50 px-2 py-1.5">
      {rows.length > 0 && (
        <div className="mb-1 space-y-0.5">
          {rows.map((r) => <p key={r.k} className={r.cls}>{r.txt}</p>)}
        </div>
      )}
      {Number(value.alreadyPaid) > 0 && (
        <p className="text-gray-500">Previously paid {formatValue(value.alreadyPaid, 'currency')}{prior.length ? ` · ${prior.map((p) => `${payLabel(p.method)} ${formatValue(p.amount, 'currency')}`).join(', ')}` : ''}</p>
      )}
      {next.length > 0 && (
        <p className="text-gray-500">New payment {next.map((p) => `${payLabel(p.method)} ${formatValue(p.amount, 'currency')}`).join(', ')}</p>
      )}
      {Number(value.refundDue) > 0 && (
        <p className="text-amber-600">Refunded {formatValue(value.refundDue, 'currency')}</p>
      )}
    </div>
  );
}
