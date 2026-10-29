'use client';

/**
 * Admin KOT board — active & completed kitchen tickets with quick actions
 * into POS (add items / bill checkout) and print helpers.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AdminLayout from '@/components/admin/admin-layout';
import {
  ChefHat, Loader2, Plus, CreditCard, Printer, FileText, RefreshCw, Search,
  XCircle,
  ShieldCheck,
} from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import PaginationControls from '@/components/ui/pagination-controls';
import DateRangeFilter from '@/components/ui/date-range-filter';
import { formatNepalDateTime, resolvePeriodRange } from '@/lib/report-dates.js';
import { compactOrderNumber } from '@/lib/document-display.js';
import { printKot, printProforma } from '@/lib/pos-print.js';
import BillInvoiceModal from '@/components/admin/bill-invoice-modal.jsx';

function token() {
  return typeof window === 'undefined' ? '' : localStorage.getItem('pos_token') || '';
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token()}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

const STATUS_TONE = {
  pending: 'bg-amber-100 text-amber-900',
  preparing: 'bg-blue-100 text-blue-900',
  ready: 'bg-emerald-100 text-emerald-900',
  completed: 'bg-slate-100 text-slate-700',
  cancelled: 'bg-red-100 text-red-700',
};

const panelPosPath = () => typeof window !== 'undefined' && window.location.pathname.startsWith('/cashier')
  ? '/cashier/pos'
  : '/admin/pos';
const panelCancellationsPath = () => typeof window !== 'undefined' && window.location.pathname.startsWith('/cashier')
  ? '/cashier/cancellations'
  : '/admin/cancellations';
export default function AdminKotPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { addToast } = useToast();
  const notify = useCallback((description, variant = 'default') => addToast({ description, variant }), [addToast]);

  const [tab, setTab] = useState('active');
  const [kots, setKots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [logAsWastage, setLogAsWastage] = useState(false);
  const [search, setSearch] = useState(() => searchParams.get('search') || '');

  useEffect(() => {
    const requested = searchParams.get('search');
    if (requested) setSearch(requested);
  }, [searchParams]);
  const [dateRange, setDateRange] = useState(() => {
    const range = resolvePeriodRange('today');
    return { period: 'today', from: range.start, to: range.end };
  });
  const [paperSize, setPaperSize] = useState('80');
  const [printSettings, setPrintSettings] = useState({});
  const [counts, setCounts] = useState({ active: 0, completed: 0, cancelled: 0, all: 0 });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 50, total: 0, totalPages: 1 });
  const [invoiceBillId, setInvoiceBillId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ tab, page: String(page), pageSize: String(pageSize) });
      if (search.trim()) q.set('search', search.trim());
      if (dateRange.from) q.set('from', dateRange.from);
      if (dateRange.to) q.set('to', dateRange.to);
      const data = await api(`/api/admin/kots?${q}`);
      setKots(data.kots || []);
      setCounts(data.counts || { active: 0, completed: 0, cancelled: 0, all: 0 });
      setPagination(data.pagination || { page, pageSize, total: 0, totalPages: 1 });
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [tab, page, pageSize, search, dateRange, notify]);

  useEffect(() => {
    setPage(1);
  }, [tab, search, dateRange, pageSize]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    (async () => {
      try {
        const data = await api('/api/admin/settings');
        const s = data.settings || data || {};
        const size = String(s.receipt_paper_size || s.paper_size || '80').replace('mm', '');
        setPaperSize(['58', '80'].includes(size) ? size : '80');
        setPrintSettings(s);
      } catch { /* defaults */ }
    })();
  }, []);

  const reprintKot = async (kot) => {
    setBusyId(kot.kot_id || kot.id);
    try {
      const data = await api(`/api/admin/pos/kots/${kot.kot_id || kot.id}/reprint`, { method: 'POST' });
      const payload = data.kot || { ...kot, is_reprint: true };
      const ok = printKot(payload, { size: paperSize, reprint: true, settings: printSettings });
      if (!ok) notify('Print was blocked by the browser.', 'warning');
      else notify(`Reprinted ${payload.kot_number}.`, 'success');
      await load();
    } catch (e) {
      // Fallback: print the local snapshot if reprint endpoint fails.
      try {
        printKot({ ...kot, is_reprint: true }, { size: paperSize, reprint: true, settings: printSettings });
        notify('Printed local KOT snapshot.', 'success');
      } catch {
        notify(e.message, 'error');
      }
    } finally {
      setBusyId(null);
    }
  };

  const printKotBill = async (kot) => {
    if (!kot.order_id) {
      notify('No order linked to this KOT.', 'warning');
      return;
    }
    setBusyId(kot.kot_id || kot.id);
    try {
      const data = await api(`/api/admin/pos/orders/${kot.order_id}/bill`);
      const ok = printProforma(data.proforma, { size: paperSize, settings: printSettings });
      if (!ok) notify('Print was blocked by the browser.', 'warning');
      else notify('Order bill printed (preview).', 'success');
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const cancelKot = async () => {
    const kot = cancelTarget;
    if (!kot || !cancelReason.trim()) return;
    const id = kot.kot_id || kot.id;
    setBusyId(id);
    try {
      await api(`/api/admin/pos/kots/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ reason: cancelReason.trim(), prepared: logAsWastage }),
      });
      notify(`${kot.kot_number} cancelled${logAsWastage ? ' and logged as wastage' : ''}.`, 'success');
      setCancelTarget(null);
      setCancelReason('');
      setLogAsWastage(false);
      await load();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AdminLayout>
      <header className="bg-white border-b border-gray-200 px-4 sm:px-6 lg:px-8 py-5 sm:py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-amber-50 p-2.5">
              <ChefHat className="h-6 w-6 text-amber-600" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">KOT</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                Active tickets for open tables. Paid orders move to Completed automatically.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {String(printSettings.kot_cancellation_approval_enabled) === 'true' && <button type="button" onClick={() => router.push(panelCancellationsPath())} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 hover:bg-red-100"><ShieldCheck className="h-4 w-4" />Cancelled KOT review</button>}
            <button type="button" onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
          </div>
        </div>
      </header>

      <div className="space-y-4 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-xl border border-gray-200 bg-white p-1">
            {[
              { id: 'active', label: 'Active' },
              { id: 'completed', label: 'Completed' },
              { id: 'cancelled', label: 'Cancelled' },
              { id: 'all', label: 'All' },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                  tab === t.id ? 'bg-amber-500 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {t.label}
                <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] ${
                  tab === t.id ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'
                }`}>
                  {counts[t.id] ?? 0}
                </span>
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search KOT #, order, table…"
              className="w-full rounded-xl border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm"
            />
          </div>
          <DateRangeFilter value={dateRange} onChange={setDateRange} />
        </div>

        {loading && !kots.length ? (
          <div className="flex items-center justify-center py-20 text-gray-500">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading KOTs…
          </div>
        ) : !kots.length ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white py-16 text-center text-sm text-gray-400">
            No KOTs in this view yet.
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {kots.map((kot) => {
              const id = kot.kot_id || kot.id;
              const busy = busyId === id;
              const isCancelled = String(kot.status || '').toLowerCase() === 'cancelled'
                || Number(kot.voided || 0) === 1
                || kot.kot_type === 'cancellation';
              const isCancellationNotice = kot.kot_type === 'cancellation';
              const canCancel = !isCancelled
                && ['pending', 'preparing'].includes(String(kot.status || 'pending').toLowerCase())
                && !['completed', 'cancelled'].includes(String(kot.order_status || '').toLowerCase())
                && kot.kot_type !== 'cancellation';
              return (
                <div
                  key={id}
                  className={`rounded-2xl border p-4 shadow-sm ${isCancelled ? 'border-red-200 bg-red-50/30' : 'border-gray-200 bg-white'}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-bold text-gray-900">{kot.kot_number}</h3>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${isCancelled ? 'bg-red-100 text-red-800' : STATUS_TONE[kot.status] || 'bg-gray-100'}`}>
                          {isCancellationNotice ? 'cancellation notice' : kot.status}
                        </span>
                        {kot.kot_type && kot.kot_type !== 'new' && (
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${isCancellationNotice ? 'bg-red-100 text-red-800' : 'bg-violet-100 text-violet-800'}`}>
                            {kot.kot_type}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-gray-500">
                        {kot.table_number ? `Table ${kot.table_number}` : kot.order_type === 'delivery' ? 'Delivery' : 'Takeaway'}
                        {kot.party_label ? ` · ${kot.party_label}` : ''}
                        {kot.order_number && <>{' · '}<button type="button" onClick={() => kot.bill_id ? setInvoiceBillId(kot.bill_id) : router.push(`${panelPosPath()}?order=${kot.order_id}`)} className="rounded-md bg-blue-50 px-2 py-0.5 font-bold text-blue-700 ring-1 ring-blue-200 hover:bg-blue-100" title={kot.bill_id ? 'Show bill details here' : 'Open order in POS'}>{compactOrderNumber(kot.order_number)}</button></>}
                      </p>
                      <p className="text-xs text-gray-400">
                        {formatNepalDateTime(kot.printed_at || kot.created_at)}
                        {kot.issued_by_name ? ` · ${kot.issued_by_name}` : ''}
                      </p>
                    </div>
                    <p className={`text-sm font-semibold ${isCancelled ? 'text-red-800' : 'text-gray-700'}`}>
                      {kot.item_count || (kot.items || []).length} items · {kot.total_qty || 0} qty
                    </p>
                  </div>

                  <ul className={`mt-3 max-h-28 overflow-y-auto space-y-1 border-t pt-2 text-sm ${isCancelled ? 'border-red-100' : 'border-gray-100'}`}>
                    {(kot.items || []).slice(0, 8).map((it) => (
                      <li key={it.id} className={`flex justify-between gap-2 ${isCancelled ? 'text-red-800' : 'text-gray-700'}`}>
                        <span className={isCancelled || it.is_cancellation ? 'line-through text-red-700' : ''}>
                          {it.item_name || `Item #${it.menu_item_id}`}
                          {it.variant_name ? ` (${it.variant_name})` : ''}
                        </span>
                        <span className="font-semibold tabular-nums">{it.quantity}×</span>
                      </li>
                    ))}
                    {(kot.items || []).length > 8 && (
                      <li className="text-xs text-gray-400">+{(kot.items || []).length - 8} more</li>
                    )}
                  </ul>

                  {kot.order_notes && !isCancelled && (
                    <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      <span className="font-semibold">KOT note:</span> {kot.order_notes}
                    </div>
                  )}

                  {isCancelled && (kot.cancel_reason || kot.void_reason || kot.order_notes) && (
                    <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
                      <span className="font-semibold">{isCancellationNotice ? 'Cancellation notice:' : 'Cancellation reason:'}</span> {kot.cancel_reason || kot.void_reason || kot.order_notes}
                      {kot.cancelled_at && (
                        <span className="block text-red-600/80">Cancelled {formatNepalDateTime(kot.cancelled_at)}</span>
                      )}
                    </div>
                  )}

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={!kot.order_id || isCancelled}
                      onClick={() => router.push(`${panelPosPath()}?order=${kot.order_id}`)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800 hover:border-blue-400 disabled:opacity-40"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add items
                    </button>
                    <button
                      type="button"
                      disabled={!kot.order_id || isCancelled}
                      onClick={() => router.push(`${panelPosPath()}?order=${kot.order_id}&pay=1`)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 hover:border-emerald-400 disabled:opacity-40"
                    >
                      <CreditCard className="h-3.5 w-3.5" /> Bill checkout
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => reprintKot(kot)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900 hover:border-amber-400 disabled:opacity-40"
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
                      Print KOT
                    </button>
                    <button
                      type="button"
                      disabled={busy || !kot.order_id}
                      onClick={() => printKotBill(kot)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-800 hover:border-slate-400 disabled:opacity-40"
                    >
                      <FileText className="h-3.5 w-3.5" /> Print bill
                    </button>
                    <button
                      type="button"
                      disabled={busy || !canCancel}
                      onClick={() => { setCancelTarget(kot); setCancelReason(''); setLogAsWastage(false); }}
                      className="col-span-2 inline-flex items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-800 hover:border-red-400 disabled:opacity-40"
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                      Cancel KOT
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {!loading && (
          <PaginationControls
            pagination={pagination}
            loading={loading}
            pageSizeChoices={[25, 50, 80, 100]}
            onPageChange={setPage}
            onPageSizeChange={(next) => {
              setPageSize(next);
              setPage(1);
            }}
          />
        )}
      </div>
      {cancelTarget && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !busyId) setCancelTarget(null); }}>
          <div role="dialog" aria-modal="true" aria-label="Cancel KOT" className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div><h2 className="text-lg font-bold text-gray-950">Cancel {cancelTarget.kot_number}</h2><p className="mt-1 text-sm text-gray-500">The ticket stays in history with its items and reason.</p></div>
              <button type="button" disabled={Boolean(busyId)} onClick={() => setCancelTarget(null)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"><XCircle className="h-5 w-5" /></button>
            </div>
            <label className="mt-4 block"><span className="mb-1.5 block text-sm font-semibold text-gray-800">Cancellation reason</span><textarea autoFocus required rows={3} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Example: Customer changed order" className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:border-red-500" /></label>
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><input type="checkbox" checked={logAsWastage} onChange={(event) => setLogAsWastage(event.target.checked)} className="mt-0.5 h-4 w-4" /><span><strong className="block">Already prepared — log as wastage</strong><span className="mt-0.5 block text-xs text-amber-800">Records these prepared items on the Wastage page. Leave off when kitchen preparation had not started.</span></span></label>
            <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={Boolean(busyId)} onClick={() => setCancelTarget(null)} className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">Keep KOT</button><button type="button" disabled={Boolean(busyId) || !cancelReason.trim()} onClick={cancelKot} className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-40">{busyId ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}Cancel KOT</button></div>
          </div>
        </div>
      )}
      {invoiceBillId && <BillInvoiceModal billId={invoiceBillId} onClose={() => setInvoiceBillId(null)} />}
    </AdminLayout>
  );
}
