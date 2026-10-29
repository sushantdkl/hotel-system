'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardList, Loader2, RefreshCw, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { WASTAGE_REASON_LABELS, WASTAGE_REASONS } from '@/components/inventory/wastage-modal';
import { formatNepalTime } from '@/lib/time-utils';
import DateInput from '@/components/ui/date-input';
import PaginationControls from '@/components/ui/pagination-controls';

const reasonLabel = (reason) => WASTAGE_REASON_LABELS[reason] || String(reason || 'other').replace(/_/g, ' ');
const EMPTY_PAGE = { page: 1, page_size: 10, total: 0, total_pages: 1 };

export default function WastageHistoryModal({ request, onClose }) {
  const requestRef = useRef(request);
  requestRef.current = request;
  const [entries, setEntries] = useState([]);
  const [summary, setSummary] = useState(null);
  const [pagination, setPagination] = useState(EMPTY_PAGE);
  const [filters, setFilters] = useState({ reason: '', from: '', to: '', search: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize), sort: 'created_at', dir: 'desc' });
      Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
      const response = await requestRef.current(`/api/admin/wastage?${params}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not load wastage history.');
      setEntries(body.entries || []);
      setSummary(body.summary || null);
      setPagination(body.pagination || EMPTY_PAGE);
    } catch (loadError) {
      setEntries([]);
      setError(loadError.message || 'Could not load wastage history.');
    } finally {
      setLoading(false);
    }
  }, [filters, page, pageSize]);

  useEffect(() => { load(); }, [load]);

  const change = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };

  const week = summary?.windows?.week || { cost: 0, entries: 0, quantity: 0 };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent onClose={onClose} className="sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ClipboardList className="h-6 w-6 text-rose-600" />Wastage history</DialogTitle>
          <p className="text-sm text-gray-500">Detailed kitchen view of discarded items, cancellation wastage, staff, shifts, and recorded loss.</p>
        </DialogHeader>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3"><p className="text-xs font-semibold uppercase text-gray-500">Last 7 days</p><p className="mt-1 text-xl font-bold text-gray-950">{week.entries} entries</p></div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3"><p className="text-xs font-semibold uppercase text-gray-500">Quantity logged</p><p className="mt-1 text-xl font-bold text-gray-950">{Number(week.quantity || 0).toLocaleString()}</p></div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3"><p className="text-xs font-semibold uppercase text-gray-500">Cost recorded</p><p className="mt-1 text-xl font-bold text-rose-700">Rs {Number(week.cost || 0).toFixed(2)}</p></div>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-2 rounded-xl border border-gray-200 p-3">
          <label className="text-xs font-semibold text-gray-600">Reason<select value={filters.reason} onChange={(event) => change('reason', event.target.value)} className="mt-1 block h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm"><option value="">All reasons</option>{WASTAGE_REASONS.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}</select></label>
          <label className="text-xs font-semibold text-gray-600">From<DateInput value={filters.from} onChange={(value) => change('from', value)} className="mt-1 block h-10 w-40 rounded-lg border border-gray-300 px-3 text-sm" /></label>
          <label className="text-xs font-semibold text-gray-600">To<DateInput value={filters.to} onChange={(value) => change('to', value)} className="mt-1 block h-10 w-40 rounded-lg border border-gray-300 px-3 text-sm" /></label>
          <label className="min-w-52 flex-1 text-xs font-semibold text-gray-600">Search<span className="relative mt-1 block"><Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" /><input value={filters.search} onChange={(event) => change('search', event.target.value)} placeholder="Item, KOT, reason, employee..." className="h-10 w-full rounded-lg border border-gray-300 pl-9 pr-3 text-sm" /></span></label>
          <button type="button" onClick={load} disabled={loading} className="inline-flex h-10 items-center gap-2 rounded-lg border border-gray-300 px-3 text-sm font-semibold text-gray-700"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
        </div>

        {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="mt-4 max-h-[46vh] space-y-3 overflow-y-auto pr-1">
          {loading && entries.length === 0 ? <p className="flex items-center justify-center py-12 text-sm text-gray-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading wastage...</p> : entries.length === 0 ? <p className="py-12 text-center text-sm text-gray-500">No wastage matches these filters.</p> : entries.map((entry) => {
            const itemName = entry.raw_material_name || entry.recipe_name || entry.menu_item_name || 'Unknown item';
            return (
              <article key={entry.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-bold text-gray-950">{itemName}</h3><span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">{reasonLabel(entry.reason)}</span>{entry.source_kot_number && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">KOT {entry.source_kot_number}</span>}</div><p className="mt-1 text-sm text-gray-600"><strong>{Number(entry.quantity || 0).toLocaleString()} {entry.unit || 'units'}</strong>{entry.employee_name ? ` · ${entry.employee_name}` : ''}{entry.shift ? ` · ${entry.shift} shift` : ''}</p></div>
                  <div className="text-right"><p className="text-base font-bold text-rose-700">Rs {Number(entry.total_cost || 0).toFixed(2)}</p><p className="text-xs text-gray-500">{formatNepalTime(entry.created_at)}</p></div>
                </div>
                <div className="mt-3 grid gap-2 border-t border-gray-100 pt-3 text-xs text-gray-600 sm:grid-cols-3"><p><span className="font-semibold text-gray-800">Logged by:</span> {entry.logged_by_name || 'System'}</p><p><span className="font-semibold text-gray-800">Expense:</span> {entry.expense_amount != null ? `Rs ${Number(entry.expense_amount).toFixed(2)} posted` : 'Not costed'}</p><p><span className="font-semibold text-gray-800">Source:</span> {entry.source_kot_number || 'Manual entry'}</p></div>
                {entry.notes && <p className="mt-3 rounded-lg bg-gray-50 p-2 text-sm text-gray-700">{entry.notes}</p>}
              </article>
            );
          })}
        </div>
        <PaginationControls pagination={pagination} loading={loading} pageSizeChoices={[10, 25, 50, 100]} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />
      </DialogContent>
    </Dialog>
  );
}
