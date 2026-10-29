'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BellRing, Check, CheckCircle2, Clock3, Droplets, Loader2,
  ReceiptText, RefreshCw, Search, Utensils, X,
} from 'lucide-react';
import { apiJson } from '@/lib/authed-fetch';
import { useToast } from '@/components/ui/toast';
import { formatNepalDateTime } from '@/lib/report-dates.js';

const TYPE_ICON = {
  service: BellRing,
  order: Utensils,
  bill: ReceiptText,
  water: Droplets,
};

function elapsed(timestamp, now) {
  const value = new Date(timestamp).getTime();
  if (!Number.isFinite(value)) return 'Just now';
  const minutes = Math.max(0, Math.floor((now - value) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
}

const statusTone = {
  pending: 'bg-amber-100 text-amber-900',
  acknowledged: 'bg-blue-100 text-blue-900',
  completed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-gray-100 text-gray-600',
};

export default function WaiterRequestsBoard({ compactHeader = false }) {
  const { addToast } = useToast();
  const [requests, setRequests] = useState([]);
  const [counts, setCounts] = useState({ active: 0, pending: 0, acknowledged: 0, completed: 0 });
  const [tab, setTab] = useState('active');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setRefreshing(true);
    try {
      const data = await apiJson(`/api/waiter-requests?status=${tab}&limit=200`);
      setRequests(data.requests || []);
      setCounts(data.counts || {});
    } catch (error) {
      if (!quiet) addToast({ variant: 'error', title: 'Could not load calls', description: error.error || 'Please try again.' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tab, addToast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const poll = setInterval(() => load({ quiet: true }), 10000);
    const clock = setInterval(() => setNow(Date.now()), 30000);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, [load]);

  const act = async (request, action) => {
    setBusy(`${request.id}:${action}`);
    try {
      await apiJson('/api/waiter-requests', {
        method: 'PATCH',
        body: JSON.stringify({ id: request.id, action }),
      });
      addToast({
        variant: 'success',
        title: action === 'acknowledge' ? `Heading to ${request.table_number}` : 'Call completed',
        description: action === 'acknowledge' ? 'The guest can now see that someone is on the way.' : `${request.table_number} was cleared from active calls.`,
      });
      await load({ quiet: true });
    } catch (error) {
      addToast({ variant: 'error', title: 'Could not update call', description: error.error || 'Please try again.' });
    } finally {
      setBusy(null);
    }
  };

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return requests;
    return requests.filter((request) => [
      request.table_number, request.floor, request.section,
      request.request_label, request.acknowledged_by_name,
    ].some((value) => String(value || '').toLowerCase().includes(query)));
  }, [requests, search]);

  const tabs = [
    ['active', 'Active', counts.active],
    ['pending', 'Waiting', counts.pending],
    ['acknowledged', 'On the way', counts.acknowledged],
    ['completed', 'Completed', counts.completed],
    ['all', 'All', null],
  ];

  return (
    <div className={compactHeader ? 'space-y-4' : 'space-y-5'}>
      {!compactHeader && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Guest service</p>
            <h1 className="mt-1 text-2xl font-bold text-gray-950">Waiter Calls</h1>
            <p className="mt-1 text-sm text-gray-500">Live requests sent from table QR menus.</p>
          </div>
          <button type="button" onClick={() => load()} disabled={refreshing} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 active:scale-[0.98] disabled:opacity-60">
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      )}

      <div className="overflow-x-auto border-b border-gray-200" role="tablist" aria-label="Waiter call status">
        <div className="flex min-w-max gap-1">
          {tabs.map(([id, label, count]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`inline-flex h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-[border-color,color,transform] duration-150 active:scale-[0.98] ${tab === id ? 'border-gray-950 text-gray-950' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
              {label}
              {count != null && <span className={`min-w-5 rounded-full px-1.5 py-0.5 text-center text-[11px] font-bold ${id === 'pending' && Number(count) > 0 ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-600'}`}>{Number(count) || 0}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search table, floor or request" className="h-10 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-gray-400" />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-sm text-gray-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading calls…</div>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white py-16 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" />
          <p className="mt-3 font-semibold text-gray-900">No calls here</p>
          <p className="mt-1 text-sm text-gray-500">New table requests will appear automatically.</p>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {visible.map((request) => {
            const Icon = TYPE_ICON[request.request_type] || BellRing;
            const isPending = request.status === 'pending';
            const isActive = ['pending', 'acknowledged'].includes(request.status);
            return (
              <article key={request.id} className={`rounded-lg border bg-white p-4 shadow-sm ${isPending ? 'border-amber-300' : 'border-gray-200'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${isPending ? 'bg-amber-100 text-amber-800' : request.status === 'acknowledged' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600'}`}><Icon className="h-5 w-5" /></span>
                    <div className="min-w-0">
                      <h2 className="text-lg font-bold text-gray-950">Table {request.table_number}</h2>
                      <p className="truncate text-xs text-gray-500">{[request.floor, request.section].filter(Boolean).join(' · ') || 'Restaurant floor'}</p>
                    </div>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[11px] font-semibold capitalize ${statusTone[request.status] || statusTone.cancelled}`}>{request.status.replace('_', ' ')}</span>
                </div>

                <div className="mt-4 border-y border-gray-100 py-3">
                  <p className="font-semibold text-gray-900">{request.request_label}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-500"><Clock3 className="h-3.5 w-3.5" /> {elapsed(request.requested_at, now)} · {formatNepalDateTime(request.requested_at)}</p>
                  {request.acknowledged_by_name && <p className="mt-2 text-xs font-medium text-blue-700">Handled by {request.acknowledged_by_name}</p>}
                  {request.completed_by_name && <p className="mt-2 text-xs text-emerald-700">Completed by {request.completed_by_name}</p>}
                </div>

                {isActive && (
                  <div className="mt-3 flex gap-2">
                    {isPending && (
                      <button type="button" disabled={Boolean(busy)} onClick={() => act(request, 'acknowledge')} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700 active:scale-[0.98] disabled:opacity-60">
                        <BellRing className="h-4 w-4" /> I&apos;m going
                      </button>
                    )}
                    <button type="button" disabled={Boolean(busy)} onClick={() => act(request, 'complete')} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-60">
                      <Check className="h-4 w-4" /> Done
                    </button>
                    <button type="button" disabled={Boolean(busy)} onClick={() => act(request, 'cancel')} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 active:scale-[0.98] disabled:opacity-60" title="Cancel call" aria-label="Cancel call">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
