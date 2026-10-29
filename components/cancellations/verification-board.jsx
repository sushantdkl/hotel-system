'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw, Search, ShieldCheck, XCircle } from 'lucide-react';
import { apiJson } from '@/lib/authed-fetch';
import { formatNepalTime } from '@/lib/time-utils';
import DateInput from '@/components/ui/date-input';
import PaginationControls from '@/components/ui/pagination-controls';

const EMPTY_PAGE = { page: 1, page_size: 25, total: 0, total_pages: 1 };
const INPUT = 'mt-1 h-10 rounded-xl border border-gray-300 bg-white px-3 text-sm outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-100';

function decisionMeta(status) {
  if (status === 'verified') return { label: 'Allowed', tone: 'bg-emerald-100 text-emerald-800' };
  if (status === 'disputed') return { label: 'Not allowed', tone: 'bg-red-100 text-red-800' };
  return { label: 'Pending review', tone: 'bg-amber-100 text-amber-800' };
}

function Decision({ row }) {
  const meta = decisionMeta(row.review_status);
  return <div className="min-w-40 space-y-1"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${meta.tone}`}>{meta.label}</span>{row.reviewed_by_name && <p className="text-xs text-gray-600">{row.reviewed_by_name} · {row.reviewed_by_scope}</p>}{row.reviewed_at && <p className="text-xs text-gray-400">{formatNepalTime(row.reviewed_at)}</p>}{row.review_note && <p className="max-w-xs whitespace-pre-wrap text-xs text-gray-600">{row.review_note}</p>}</div>;
}

export default function VerificationBoard({ kitchen = false }) {
  const [filters, setFilters] = useState({ status: '', from: '', to: '', search: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState({ rows: [], pagination: EMPTY_PAGE });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [note, setNote] = useState('');
  const [history, setHistory] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
      setData(await apiJson(`/api/admin/cancellation-verifications?${params}`));
    } catch (loadError) {
      setError(loadError.message || 'Could not load cancelled KOTs.');
    } finally {
      setLoading(false);
    }
  }, [filters, page, pageSize]);

  useEffect(() => { load(); }, [load]);

  const change = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };

  const openReview = async (row) => {
    setSelected(row);
    setNote('');
    setHistory(null);
    setError('');
    try {
      const response = await apiJson(`/api/admin/cancellation-verifications?document_id=${row.document_id}`);
      setHistory(response.history || []);
    } catch (historyError) {
      setHistory([]);
      setError(historyError.message || 'Could not load decision history.');
    }
  };

  const submit = async (status, row = selected) => {
    if (!row) return;
    setBusyId(row.document_id);
    setError('');
    try {
      await apiJson('/api/admin/cancellation-verifications', {
        method: 'POST',
        body: JSON.stringify({ document_id: row.document_id, status, note: row === selected ? note.trim() : '', request_key: crypto.randomUUID() }),
      });
      if (row === selected) setSelected(null);
      await load();
    } catch (saveError) {
      setError(saveError.message || 'The review decision was not saved.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <header>
        <div className="flex items-center gap-3"><span className="rounded-xl bg-red-50 p-2.5 text-red-700"><ShieldCheck className="h-6 w-6" /></span><div><h1 className="text-2xl font-bold text-gray-950 sm:text-3xl">Cancelled KOT review</h1><p className="mt-1 text-sm text-gray-600">End-of-day verification shared by Admin and Kitchen.</p></div></div>
        <p className="mt-3 max-w-4xl text-sm leading-6 text-gray-600">Whole-ticket cancellations and individual cancelled items appear here. Cancellation remains immediate; allowing or not allowing it records only the audit decision and never restores items or changes stock, payments, or accounting.</p>
      </header>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"><div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-semibold text-gray-600">Review status<select value={filters.status} onChange={(event) => change('status', event.target.value)} className={`${INPUT} block`}><option value="">All statuses</option><option value="unverified">Pending review</option><option value="approved">Allowed</option><option value="disallowed">Not allowed</option></select></label>
        <label className="text-xs font-semibold text-gray-600">Cancelled from<DateInput value={filters.from} onChange={(value) => change('from', value)} className={`${INPUT} block w-40`} /></label>
        <label className="text-xs font-semibold text-gray-600">Cancelled to<DateInput value={filters.to} onChange={(value) => change('to', value)} className={`${INPUT} block w-40`} /></label>
        <label className="min-w-56 flex-1 text-xs font-semibold text-gray-600">Search<span className="relative mt-1 block"><Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" /><input value={filters.search} onChange={(event) => change('search', event.target.value)} className={`${INPUT} mt-0 w-full pl-9`} placeholder="KOT, order, table, reason, staff..." /></span></label>
        <button type="button" onClick={load} disabled={loading} className="inline-flex h-10 items-center gap-2 rounded-xl border border-gray-300 px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
      </div></section>

      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}

      {selected && <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5 shadow-sm" aria-label="Review cancelled KOT">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-bold text-gray-950">Review {selected.document_number}</h2><p className="mt-1 text-sm text-gray-700">Reason: {selected.reason || 'Not recorded'}</p></div><Decision row={selected} /></div>
        <label className="mt-4 block text-sm font-semibold text-gray-700">Review note (optional)<textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} rows={3} className="mt-1 block w-full rounded-xl border border-gray-300 bg-white p-3 text-sm" placeholder="What did you check, or why should this cancellation not be allowed?" /></label>
        <div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={Boolean(busyId)} onClick={() => submit('approved')} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"><CheckCircle2 className="h-4 w-4" />Allow cancellation</button><button type="button" disabled={Boolean(busyId)} onClick={() => submit('disallowed')} className="inline-flex items-center gap-2 rounded-xl bg-red-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"><XCircle className="h-4 w-4" />Don&apos;t allow</button><button type="button" disabled={Boolean(busyId)} onClick={() => setSelected(null)} className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold">Close</button>{busyId && <Loader2 className="my-auto h-5 w-5 animate-spin" />}</div>
        <div className="mt-5 border-t border-amber-200 pt-4"><h3 className="text-sm font-bold">Decision history</h3>{history === null ? <p className="mt-2 text-sm text-gray-500">Loading history...</p> : history.length === 0 ? <p className="mt-2 text-sm text-gray-500">No earlier decisions.</p> : <ol className="mt-2 space-y-2">{history.map((event) => { const meta = decisionMeta(event.status); return <li key={event.id} className="rounded-xl border bg-white p-3 text-sm"><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${meta.tone}`}>{meta.label}</span><span className="ml-2">{event.verifier_name} ({event.reviewer_scope}) · {formatNepalTime(event.verified_at)}</span>{event.note && <p className="mt-1 text-gray-600">{event.note}</p>}</li>; })}</ol>}</div>
      </section>}

      {loading && data.rows.length === 0 ? <div className="flex justify-center py-20 text-gray-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading cancelled KOTs...</div> : data.rows.length === 0 ? <div className="rounded-2xl border border-dashed border-gray-300 bg-white py-16 text-center text-sm text-gray-500">No cancelled KOTs match these filters.</div> : <section className={`grid gap-3 lg:grid-cols-2 ${loading ? 'opacity-60' : ''}`}>{data.rows.map((row) => {
        const rowBusy = busyId === row.document_id;
        return <article key={`${row.document_type || 'kot'}:${row.document_id}`} className="rounded-2xl border border-red-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h2 className="text-lg font-bold text-gray-950">{row.document_number}</h2><span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase text-red-800">{row.cancellation_kind === 'item' ? 'Item cancellation' : 'Whole KOT cancelled'}</span></div><p className="mt-1 text-sm text-gray-500">{row.table_number ? `Table ${row.table_number}` : 'Takeaway / no table'} · Order #{row.order_id}{row.amends_kot_number ? ` · From ${row.amends_kot_number}` : ''}</p><p className="text-xs text-gray-400">{row.cancelled_at ? formatNepalTime(row.cancelled_at) : 'Time not recorded'} · {row.cancelled_by_name || 'Staff not recorded'}</p></div><Decision row={row} /></div>
          <ul className="mt-3 max-h-32 space-y-1 overflow-y-auto border-t border-red-100 pt-3 text-sm">{(row.items || []).map((item, index) => <li key={`${item.item_name}-${index}`} className="flex justify-between gap-3 text-red-800"><span className="line-through">{item.item_name}{item.variant_name ? ` (${item.variant_name})` : ''}</span><strong>{Number(item.quantity || 0).toLocaleString()}x</strong></li>)}{!row.items?.length && <li className="text-gray-400">No ticket snapshot items</li>}</ul>
          <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-800"><strong>Reason:</strong> {row.reason || 'No reason recorded'}<span className="mt-1 block text-xs text-red-600">{row.cancellation_kind === 'item' ? `Cancelled item ticket${row.amends_kot_number ? ` for ${row.amends_kot_number}` : ''}` : `Previous kitchen status: ${row.previous_status || 'Not recorded'}`}</span></div>
          <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" disabled={Boolean(busyId)} onClick={() => submit('approved', row)} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs font-bold text-emerald-800 hover:border-emerald-400 disabled:opacity-40">{rowBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Allow cancellation</button><button type="button" disabled={Boolean(busyId)} onClick={() => submit('disallowed', row)} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-bold text-red-800 hover:border-red-400 disabled:opacity-40"><XCircle className="h-4 w-4" />Don&apos;t allow</button><button type="button" onClick={() => openReview(row)} className="col-span-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700">Add note / view history</button></div>
        </article>;
      })}</section>}

      <PaginationControls pagination={data.pagination || EMPTY_PAGE} loading={loading} pageSizeChoices={[10, 25, 50, 100]} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />
      <p className="text-xs text-gray-500">Shared {kitchen ? 'Kitchen' : 'Admin'} view: the latest decision from either workspace appears in both.</p>
    </div>
  );
}
