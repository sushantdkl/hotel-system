'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import AdminLayout from '@/components/admin/admin-layout';
import { formatValue } from '@/components/admin/report-kit';
import { formatNepalDateTime } from '@/lib/report-dates.js';
import { formatCalendarRangeLabel } from '@/lib/calendar-system.js';
import { useCalendarSystem } from '@/lib/calendar-context.jsx';
import {
  Package, AlertTriangle, XCircle, CheckCircle2, TrendingUp, TrendingDown,
  RotateCcw, Search, Trash2, ArrowDownUp, PackagePlus, AlertCircle, Info, ExternalLink,
} from 'lucide-react';

/**
 * Inventory Dashboard — /admin/inventory/dashboard
 * Read-only overview. Data from /api/admin/inventory/dashboard. Incompatible
 * units are never summed — cards show SKU/status counts and monetary value only.
 */

const PRESETS = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'This Week' },
  { id: 'month', label: 'This Month' },
  { id: 'year', label: 'This Year' },
];

const STATUS_META = {
  in: { label: 'In Stock', cls: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  low: { label: 'Low Stock', cls: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  out: { label: 'Out of Stock', cls: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
};

export default function InventoryDashboardPage() {
  const { calendarSystem } = useCalendarSystem();
  const pathname = usePathname();
  const inventoryBase = pathname?.startsWith('/cashier') ? '/cashier/inventory' : '/admin/inventory';
  const [period, setPeriod] = useState('week');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('pos_token') : null;
      const qs = new URLSearchParams({ period, calendarSystem });
      if (category) qs.set('category', category);
      if (status) qs.set('status', status);
      if (search) qs.set('search', search);
      const res = await fetch(`/api/admin/inventory/dashboard?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `Request failed (${res.status})`);
      setData(await res.json());
    } catch (e) {
      setError(e.message || 'Failed to load inventory dashboard.');
    } finally {
      setLoading(false);
    }
  }, [period, category, status, search, calendarSystem]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  return (
    <AdminLayout>
      <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Inventory Dashboard</h1>
            <p className="mt-1 text-sm text-gray-500">{data?.range ? formatCalendarRangeLabel(data.range) : 'Loading…'}</p>
          </div>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <RotateCcw className="h-4 w-4" /> Refresh
          </button>
        </div>

        {/* Filters */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search items…"
              className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm"
            />
          </div>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
            <option value="">All categories</option>
            {(data?.filterOptions?.categories || []).map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
            <option value="">All statuses</option>
            <option value="in">In stock</option>
            <option value="low">Low stock</option>
            <option value="out">Out of stock</option>
          </select>
          <select value={period} onChange={(e) => setPeriod(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>

        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : loading ? (
          <LoadingSkeleton />
        ) : !data ? (
          <EmptyState />
        ) : (
          <div className="mt-6 space-y-6">
            <SummaryCards s={data.summary} />
            <CategoryCards categories={data.categories} />
            <div className="grid items-start gap-4 lg:grid-cols-2">
              <LowStockPanel items={data.panels.lowStockAlerts} inventoryBase={inventoryBase} />
              <OutOfStockPanel items={data.panels.outOfStock} inventoryBase={inventoryBase} />
              <MoversPanel title="Top-Moving Items" icon={TrendingUp} items={data.panels.topMoving} kind="top" />
              <MoversPanel title="Slow-Moving Items" icon={TrendingDown} items={data.panels.slowMoving} kind="slow" />
              <ReceiptsPanel items={data.panels.recentReceipts} />
              <AdjustedPanel items={data.panels.recentlyAdjusted} />
              <WastagePanel items={data.panels.wastage} />
              <MovementsPanel items={data.panels.recentMovements} />
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

function SummaryCards({ s }) {
  const cards = [
    { label: 'Active SKUs', value: s.totalSkus, icon: Package, tone: 'text-gray-700' },
    { label: 'In Stock', value: s.inStock, icon: CheckCircle2, tone: 'text-emerald-600' },
    { label: 'Low Stock', value: s.lowStock, icon: AlertTriangle, tone: 'text-amber-600' },
    { label: 'Out of Stock', value: s.outOfStock, icon: XCircle, tone: 'text-red-600' },
    { label: 'Stock Value', value: formatValue(s.stockValue, 'currency'), icon: Package, tone: 'text-indigo-600' },
    { label: 'Wastage Value', value: formatValue(s.wastageValue, 'currency'), icon: Trash2, tone: 'text-rose-600' },
    { label: 'Movements', value: s.recentMovements, icon: ArrowDownUp, tone: 'text-sky-600' },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
      {cards.map((c) => (
        <div key={c.label} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-gray-500">{c.label}</p>
            <c.icon className={`h-4 w-4 ${c.tone}`} />
          </div>
          <p className="mt-2 truncate text-xl font-bold tabular-nums text-gray-900">{c.value}</p>
        </div>
      ))}
    </div>
  );
}

function CategoryCards({ categories }) {
  if (!categories?.length) return null;
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-gray-700">Categories</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {categories.map((c) => {
          const meta = STATUS_META[c.badge];
          return (
            <div key={c.category} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <h3 className="truncate font-semibold text-gray-900" title={c.category}>{c.category}</h3>
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${meta.cls}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} /> {meta.label}
                </span>
              </div>
              <p className="mt-3 text-2xl font-bold tabular-nums text-gray-900">{c.skus} <span className="text-sm font-normal text-gray-400">SKUs</span></p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {c.low > 0 && <span className="text-amber-600">{c.low} low</span>}
                {c.out > 0 && <span className="text-red-600">{c.out} out of stock</span>}
                {c.low === 0 && c.out === 0 && <span className="text-emerald-600">All healthy</span>}
                <span className="text-gray-500">{formatValue(c.value, 'currency')} value</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Panel({ title, icon: Icon, count, children, accent = 'text-gray-500' }) {
  return (
    <div className="flex h-[22rem] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Icon className={`h-4 w-4 ${accent}`} /> {title}
        </h3>
        {count != null && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{count}</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{children}</div>
    </div>
  );
}

function Empty({ text }) {
  return <p className="py-4 text-center text-sm text-gray-400">{text}</p>;
}

function LowStockPanel({ items, inventoryBase }) {
  return (
    <Panel title="Low-Stock Alerts" icon={AlertTriangle} count={items.length} accent="text-amber-500">
      {!items.length ? <Empty text="No items below their reorder threshold." /> : (
        <ul className="divide-y divide-gray-100">
          {items.map((i) => (
            <li key={i.id} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">{i.name}</p>
                <p className="text-xs text-gray-500">
                  {i.category} · updated {i.updated_at ? formatNepalDateTime(i.updated_at) : '—'}
                  {i.daysLeft != null && <> · ~{i.daysLeft}d left</>}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold tabular-nums text-amber-600">{i.quantity} {i.unit}</p>
                <p className="text-xs text-gray-500">need {i.shortage} {i.unit} (min {i.threshold})</p>
                <Link href={`${inventoryBase}/${i.id}`} className="mt-0.5 inline-flex items-center gap-0.5 text-xs text-indigo-600 hover:underline">
                  Adjust <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function OutOfStockPanel({ items, inventoryBase }) {
  return (
    <Panel title="Out-of-Stock Alerts" icon={XCircle} count={items.length} accent="text-red-500">
      {!items.length ? <Empty text="Nothing is fully out of stock." /> : (
        <ul className="divide-y divide-gray-100">
          {items.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">{i.name}</p>
                <p className="text-xs text-gray-500">{i.category} · min {i.threshold} {i.unit}</p>
              </div>
              <Link href={`${inventoryBase}/${i.id}`} className="shrink-0 rounded-lg bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-100">
                Restock
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function MoversPanel({ title, icon, items, kind }) {
  return (
    <Panel title={title} icon={icon} count={items.length} accent={kind === 'top' ? 'text-emerald-500' : 'text-gray-400'}>
      {!items.length ? <Empty text={kind === 'top' ? 'No consumption recorded in this period.' : 'No slow-moving stock to show.'} /> : (
        <ul className="divide-y divide-gray-100">
          {items.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">{i.name}</p>
                <p className="text-xs text-gray-500">{i.category}</p>
              </div>
              <div className="shrink-0 text-right text-xs">
                <p className="font-semibold tabular-nums text-gray-900">Stock: {i.stock} {i.unit}</p>
                {kind === 'top'
                  ? <p className="text-gray-500">Used: {i.used} {i.unit}</p>
                  : <p className="text-gray-500">{formatValue(i.value, 'currency')}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ReceiptsPanel({ items }) {
  return (
    <Panel title="Recent Purchases / Receipts" icon={PackagePlus} count={items.length} accent="text-teal-500">
      {!items.length ? <Empty text="No stock receipts recorded." /> : (
        <ul className="divide-y divide-gray-100">
          {items.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span className="min-w-0 truncate text-gray-900">{i.name}</span>
              <span className="shrink-0 text-right text-xs text-gray-500">
                +{Math.abs(i.quantity_changed)} {i.unit} · {formatNepalDateTime(i.created_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function AdjustedPanel({ items }) {
  return (
    <Panel title="Recently Adjusted" icon={ArrowDownUp} count={items.length} accent="text-violet-500">
      {!items.length ? <Empty text="No adjustments recorded." /> : (
        <ul className="divide-y divide-gray-100">
          {items.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span className="min-w-0 truncate text-gray-900">{i.name}</span>
              <span className="shrink-0 text-right text-xs text-gray-500">
                {i.quantity_changed > 0 ? '+' : ''}{i.quantity_changed} {i.unit} · {formatNepalDateTime(i.created_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function WastagePanel({ items }) {
  return (
    <Panel title="Wastage" icon={Trash2} count={items.length} accent="text-rose-500">
      {!items.length ? <Empty text="No wastage logged in this period." /> : (
        <ul className="divide-y divide-gray-100">
          {items.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="truncate text-gray-900">{i.name}</p>
                {i.reason && <p className="text-xs text-gray-500">{i.reason}</p>}
              </div>
              <span className="shrink-0 text-right text-xs">
                <span className="font-medium text-rose-600">{i.quantity} {i.unit}</span>
                <span className="block text-gray-500">{formatValue(i.cost, 'currency')}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function MovementsPanel({ items }) {
  return (
    <Panel title="Stock Movement History" icon={ArrowDownUp} count={items.length} accent="text-sky-500">
      {!items.length ? <Empty text="No movements yet." /> : (
        <ul className="divide-y divide-gray-100">
          {items.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="truncate text-gray-900">{i.name}</p>
                <p className="text-xs text-gray-500">{String(i.change_type || '').replace(/_/g, ' ')}</p>
              </div>
              <span className="shrink-0 text-right text-xs">
                <span className={`font-medium tabular-nums ${i.quantity_changed < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                  {i.quantity_changed > 0 ? '+' : ''}{i.quantity_changed} {i.unit}
                </span>
                <span className="block text-gray-400">{formatNepalDateTime(i.created_at)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function LoadingSkeleton() {
  return (
    <div className="mt-6 space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-gray-100" />)}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-gray-100" />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-56 animate-pulse rounded-2xl bg-gray-100" />)}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mt-16 flex flex-col items-center text-center text-gray-500">
      <Info className="h-10 w-10 text-gray-300" />
      <p className="mt-3 text-sm">No inventory data available.</p>
    </div>
  );
}

function ErrorState({ message, onRetry }) {
  return (
    <div className="mt-16 flex flex-col items-center text-center">
      <AlertCircle className="h-10 w-10 text-red-400" />
      <p className="mt-3 text-sm text-gray-700">{message}</p>
      <button type="button" onClick={onRetry} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800">
        <RotateCcw className="h-4 w-4" /> Try again
      </button>
    </div>
  );
}
