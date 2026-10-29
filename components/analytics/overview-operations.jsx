'use client';

import { useEffect, useState } from 'react';
import Link from '@/components/admin/panel-link';
import {
  AlertTriangle, Award, ArrowRight, CheckCircle2, ChefHat, CircleDollarSign,
  Clock3, Download, Info, LayoutGrid, PackageSearch, ReceiptText, Search, ShieldAlert, Users, X,
} from 'lucide-react';
import { ChartCard, RankBars } from '@/components/admin/report-kit';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import PaginationControls from '@/components/ui/pagination-controls';
import { apiJson } from '@/lib/authed-fetch';
import { formatNepalDisplay } from '@/lib/report-dates';
import {
  DashboardSection, Metric, NepalTime, SectionHeading, StatCell, StatusPill, TableWrap,
  money, percent,
} from './analytics-ui';
import { compactBillNumber, compactOrderNumber } from '@/lib/document-display';
import { orderTypeLabel } from '@/lib/order-types.js';
import { formatCalendarDate, formatCalendarRangeLabel } from '@/lib/calendar-system.js';
import { clickableRowClass, useAnalyticsRecords } from './analytics-record-viewer';

// Driven by the Analytics page's own period filter (data.range) — no second
// picker here. Two independent date pickers on one page (one above, one
// inside this card) looked like a duplicate and made this section look
// "not dynamic" when only one of them was wired to what you were toggling.
function CustomerCreditLedger({ range }) {
  const [statusFilter, setStatusFilter] = useState('all'); // all | charged | paid
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(null); // selected row for the detail popup

  const from = range?.start || '';
  const to = range?.end || '';

  /*
   * Fetch the whole period unfiltered by status — the two totals need both
   * buckets at once, and the status pills below just filter this in memory.
   *
   * The work runs inside an async callback rather than straight in the effect
   * body (which set state synchronously on every render pass), and a `cancelled`
   * flag drops responses that arrive after the inputs have moved on — typing in
   * the search box used to let a slow earlier request overwrite a newer result.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const params = new URLSearchParams({ view: 'history' });
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (query.trim()) params.set('search', query.trim());
      try {
        const d = await apiJson(`/api/admin/accounts-receivable?${params}`);
        if (!cancelled) setRows(d.history || []);
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [from, to, query]);

  const charged = rows.filter((r) => r.status === 'charged');
  const paid = rows.filter((r) => r.status !== 'charged');
  const chargedTotal = charged.reduce((s, r) => s + Number(r.debit || 0), 0);
  const paidTotal = paid.reduce((s, r) => s + Number(r.credit || 0), 0);
  const visible = statusFilter === 'charged' ? charged : statusFilter === 'paid' ? paid : rows;

  return (
    <div className="mt-5 rounded-2xl border border-gray-200 bg-white p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-950">Customer credit ledger</h3>
          <p className="text-xs text-gray-500">Every charge and payment for {range ? formatCalendarRangeLabel(range) : 'the selected period'} — uses the date range above.</p>
        </div>
        <Link href="/admin/accounts-receivable" className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800">
          Full Customer Ledger <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="relative mb-4 w-full sm:w-64">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by customer name..."
          className="w-full rounded-lg border border-gray-300 py-1.5 pl-8 pr-3 text-xs"
        />
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === 'charged' ? 'all' : 'charged')}
          className={`rounded-xl border p-4 text-left transition-colors ${
            statusFilter === 'charged' ? 'border-rose-400 bg-rose-50 ring-1 ring-rose-300' : 'border-gray-200 bg-gray-50 hover:border-rose-200 hover:bg-rose-50/40'
          }`}
        >
          <p className="text-xs font-medium uppercase tracking-wide text-rose-700">Credited{range ? ` · ${formatCalendarRangeLabel(range)}` : ''}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-rose-800">{money(chargedTotal)}</p>
          <p className="mt-0.5 text-xs text-rose-600">{charged.length} {charged.length === 1 ? 'entry' : 'entries'}</p>
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === 'paid' ? 'all' : 'paid')}
          className={`rounded-xl border p-4 text-left transition-colors ${
            statusFilter === 'paid' ? 'border-emerald-400 bg-emerald-50 ring-1 ring-emerald-300' : 'border-gray-200 bg-gray-50 hover:border-emerald-200 hover:bg-emerald-50/40'
          }`}
        >
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">Paid{range ? ` · ${formatCalendarRangeLabel(range)}` : ''}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-800">{money(paidTotal)}</p>
          <p className="mt-0.5 text-xs text-emerald-600">{paid.length} {paid.length === 1 ? 'entry' : 'entries'}</p>
        </button>
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Net movement</p>
          <p className={`mt-1 text-2xl font-bold tabular-nums ${chargedTotal - paidTotal >= 0 ? 'text-gray-900' : 'text-emerald-800'}`}>{money(chargedTotal - paidTotal)}</p>
          <p className="mt-0.5 text-xs text-gray-500">Credited minus paid, this period</p>
        </div>
      </div>

      {statusFilter !== 'all' && (
        <button type="button" onClick={() => setStatusFilter('all')} className="mb-2 text-xs font-medium text-gray-500 hover:text-gray-800">
          &times; Clear filter ({statusFilter === 'charged' ? 'Credited' : 'Paid'} only)
        </button>
      )}

      <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200">
        {loading ? (
          <p className="py-8 text-center text-sm text-gray-400">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">No ledger activity in this range.</p>
        ) : (
          visible.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => setActive(h)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-gray-50"
            >
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                h.status === 'charged' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
              }`}>
                {h.customer_name?.[0]?.toUpperCase() || '?'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-gray-900">{h.customer_name}</span>
                <span className="block text-xs text-gray-400">
                  {formatNepalDisplay(String(h.date || '').slice(0, 10))}{h.bill_number ? ` · ${h.bill_number}` : ''}
                </span>
              </span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                h.status === 'charged' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
              }`}>
                {h.status}
              </span>
              <span className="w-24 shrink-0 text-right tabular-nums font-semibold text-gray-900">{money(h.debit > 0 ? h.debit : h.credit)}</span>
            </button>
          ))
        )}
      </div>

      {active && <CreditEntryModal entry={active} onClose={() => setActive(null)} />}
    </div>
  );
}

function CreditEntryModal({ entry, onClose }) {
  const amount = entry.debit > 0 ? entry.debit : entry.credit;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
              entry.status === 'charged' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
            }`}>
              {entry.customer_name?.[0]?.toUpperCase() || '?'}
            </span>
            <div>
              <p className="text-base font-bold text-gray-900">{entry.customer_name}</p>
              {entry.customer_phone && <p className="text-xs text-gray-500">{entry.customer_phone}</p>}
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-4 rounded-xl bg-gray-50 p-4">
          <div className="flex items-center justify-between">
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase ${
              entry.status === 'charged' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
            }`}>
              {entry.status}
            </span>
            <span className="text-xl font-bold tabular-nums text-gray-900">{money(amount)}</span>
          </div>
          <p className="mt-2 text-xs text-gray-500">{formatNepalDisplay(String(entry.date || '').slice(0, 10))} · {new Date(entry.date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</p>
          {entry.bill_number && <p className="mt-1 text-xs text-gray-500">Bill {entry.bill_number}</p>}
          {entry.note && <p className="mt-2 text-sm text-gray-700">{entry.note}</p>}
        </div>

        <div className="flex flex-wrap gap-2">
          {entry.order_id && (
            <Link
              href={`/admin/orders/${entry.order_id}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800"
            >
              View order <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
          {entry.customer_id && (
            <Link
              href={`/admin/customers/${entry.customer_id}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              View profile <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
          <Link
            href="/admin/accounts-receivable"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Open ledger
          </Link>
        </div>
      </div>
    </div>
  );
}

export function LiveStatus({ data }) {
  const live = data.live;
  const items = [
    ['Tables Occupied', live.occupiedTables], ['Tables Available', live.availableTables],
    ['Orders Open', live.openOrders], ['Open Orders Value', money(live.openOrdersValue)],
    ['KOTs Preparing', live.preparingKots],
    ['KOTs Ready', live.readyKots], ['Pending Payments', live.pendingPayments],
    ['Reservations Soon', live.upcomingReservations],
  ];
  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-950 px-5 py-5 text-white shadow-sm sm:px-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="flex min-w-[190px] items-center gap-2">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-400" />
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-400">{live.label}</p>
            <p className="mt-0.5 text-sm text-gray-400">Current operational state</p>
          </div>
        </div>
        <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 xl:grid-cols-7">
          {items.map(([label, value]) => <div key={label}><p className="text-xs text-gray-400">{label}</p><p className="mt-0.5 text-xl font-semibold tabular-nums">{value}</p></div>)}
        </div>
      </div>
    </section>
  );
}

const SEVERITY = {
  critical: { Icon: ShieldAlert, wrap: 'border-red-200 bg-red-50', icon: 'text-red-600', badge: 'negative' },
  warning: { Icon: AlertTriangle, wrap: 'border-amber-200 bg-amber-50', icon: 'text-amber-600', badge: 'warning' },
  info: { Icon: Info, wrap: 'border-blue-200 bg-blue-50', icon: 'text-blue-600', badge: 'info' },
  clear: { Icon: CheckCircle2, wrap: 'border-emerald-200 bg-emerald-50', icon: 'text-emerald-600', badge: 'positive' },
};

export function AttentionCenter({ rows }) {
  return (
    <DashboardSection className="!p-6 sm:!p-8">
      <SectionHeading eyebrow="Attention center" title="What needs management action" description="Rule-based alerts only. Normal operations remain quiet." />
      <div className="grid gap-3 lg:grid-cols-2">
        {(rows || []).map((row, index) => {
          const meta = SEVERITY[row.severity] || SEVERITY.info;
          const body = <div className={`flex gap-3 rounded-lg border p-3 ${meta.wrap}`}><meta.Icon className={`mt-0.5 h-4 w-4 shrink-0 ${meta.icon}`} /><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3"><p className="text-sm font-semibold text-gray-900">{row.title}</p><StatusPill tone={meta.badge}>{row.severity}</StatusPill></div><p className="mt-1 text-xs text-gray-600">{row.detail}</p></div></div>;
          return row.href ? <Link key={`${row.type}-${index}`} href={row.href}>{body}</Link> : <div key={`${row.type}-${index}`}>{body}</div>;
        })}
      </div>
    </DashboardSection>
  );
}

export function LifecycleKitchen({ data }) {
  const life = data.lifecycle;
  const kitchen = data.kitchen;
  const lifecycleRows = [
    ['Orders created', life.ordersCreated], ['KOTs sent', life.kotsSent], ['Preparing', life.preparing], ['Ready', life.ready],
    ['Completed bills', life.completedBills], ['Cancelled orders', life.cancelledOrders], ['Cancelled KOTs', life.cancelledKots], ['Voided bills', life.voidedBills],
  ];
  const cancellationBars = (kitchen.cancellationReasons || []).map((row) => ({ label: row.reason, value: row.count }));
  return (
    <DashboardSection>
      <SectionHeading icon={ChefHat} tone="orange" eyebrow="Order flow" title="Lifecycle and kitchen health" description="Order, KOT, bill, and payment states remain separate so bottlenecks are visible." action={<Link href="/admin/reports?tab=orders" className="inline-flex items-center gap-1 text-sm font-medium text-gray-700">Orders analytics <ArrowRight className="h-4 w-4" /></Link>} />
      <div className="grid gap-3 sm:grid-cols-4 xl:grid-cols-8">
        {lifecycleRows.map(([label, value]) => <StatCell key={label} label={label} value={value} />)}
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_1.15fr]">
        <div className="grid grid-cols-2 gap-4 rounded-xl border border-gray-100 bg-gray-50 p-4 sm:grid-cols-3">
          <Metric label="KOTs Generated" value={kitchen.generated} />
          <Metric label="Completed" value={kitchen.completed} tone="positive" />
          <Metric label="Cancelled" value={kitchen.cancelled} tone={kitchen.cancelled ? 'negative' : 'default'} />
          <Metric label="Avg Prep" value={kitchen.averagePrepMinutes} format="minutes" />
          <Metric label="Median Prep" value={kitchen.medianPrepMinutes} format="minutes" />
          <Metric label="Over 25 min" value={kitchen.overTarget} tone={kitchen.overTarget ? 'warning' : 'default'} />
          <Metric label="Current Backlog" value={kitchen.backlog} tone={kitchen.backlog ? 'warning' : 'default'} />
          <Metric label="Completion Rate" value={life.completionRate} format="percent" />
          <Metric label="KOT Cancel Rate" value={life.kotCancellationRate} format="percent" />
        </div>
        <ChartCard title="KOT Cancellation Reasons" isEmpty={!cancellationBars.length} empty="No cancelled KOTs in this period."><RankBars data={cancellationBars} color="red" format="number" /></ChartCard>
      </div>
      {kitchen.slowest?.length > 0 && <div className="mt-5"><h3 className="mb-2 text-sm font-semibold text-gray-900">Slowest completed KOTs</h3><TableWrap minWidth="620px"><thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-400"><tr><th className="px-4 py-2.5">KOT</th><th className="px-4 py-2.5">Order</th><th className="px-4 py-2.5">Table</th><th className="px-4 py-2.5 text-right">Items</th><th className="px-4 py-2.5 text-right">Prep time</th></tr></thead><tbody className="divide-y divide-gray-100">{kitchen.slowest.map((row) => <tr key={row.id}><td className="px-4 py-3 font-medium">{row.kot_number || row.id}</td><td className="px-4 py-3">{row.order_number}</td><td className="px-4 py-3">{row.table_number || '-'}</td><td className="px-4 py-3 text-right tabular-nums">{row.item_count}</td><td className="px-4 py-3 text-right font-medium tabular-nums">{Math.round(row.prep_minutes)} min</td></tr>)}</tbody></TableWrap></div>}
    </DashboardSection>
  );
}

export function FloorAndReservations({ data }) {
  const table = data.tables;
  const reservations = data.reservations;
  return (
    <DashboardSection>
      <SectionHeading icon={LayoutGrid} tone="cyan" eyebrow="Floor" title="Tables and reservations" description="Historical table results use the table snapshot saved on each order; live occupancy uses current table state." />
      <div className="grid min-w-0 gap-5 xl:grid-cols-[1.35fr_0.65fr] [&>*]:min-w-0">
        <TablePaymentChart rows={table.paymentMix || []} />
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 rounded-xl border border-gray-100 bg-gray-50 p-4 sm:grid-cols-3">
            <Metric label="Occupancy Now" value={table.occupancy} format="percent" />
            <Metric label="Occupied" value={table.occupied} />
            <Metric label="Available" value={table.available} />
            <Metric label="Avg sitting" value={table.averageDiningMinutes} format="minutes" />
            <Metric label="Reservations" value={reservations.total} />
            <Metric label="Guests Expected" value={reservations.guests} />
          </div>
          {(table.rows || []).length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-gray-900">Sitting time by table</h3>
              <div className="space-y-2 sm:hidden">
                {table.rows.map((row) => (
                  <div key={row.table_number} className="rounded-xl border border-gray-200 bg-white p-3">
                    <p className="font-semibold text-gray-900">Table {row.table_number}</p>
                    <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      <div><dt className="text-gray-400">Orders</dt><dd className="mt-0.5 font-semibold tabular-nums text-gray-800">{row.orders}</dd></div>
                      <div><dt className="text-gray-400">Revenue</dt><dd className="mt-0.5 font-semibold tabular-nums text-emerald-700">{money(row.revenue)}</dd></div>
                      <div className="text-right"><dt className="text-gray-400">Avg sitting</dt><dd className="mt-0.5 font-semibold tabular-nums text-gray-800">{row.dining_minutes ? `${Math.round(row.dining_minutes)} min` : '—'}</dd></div>
                    </dl>
                  </div>
                ))}
              </div>
              <div className="hidden sm:block">
                <TableWrap minWidth="480px">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-400">
                  <tr>
                    <th className="px-4 py-2.5">Table</th>
                    <th className="px-4 py-2.5 text-right">Orders</th>
                    <th className="px-4 py-2.5 text-right">Revenue</th>
                    <th className="px-4 py-2.5 text-right">Avg sitting</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {table.rows.map((row) => (
                    <tr key={row.table_number}>
                      <td className="px-4 py-2.5 font-medium">Table {row.table_number}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{row.orders}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{money(row.revenue)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{row.dining_minutes ? `${Math.round(row.dining_minutes)} min` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                </TableWrap>
              </div>
            </div>
          )}
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900"><Users className="h-4 w-4" /> Upcoming reservations</h3>
            <div className="mt-2 divide-y divide-gray-100">{reservations.upcoming?.length ? reservations.upcoming.map((row) => <div key={row.id} className="flex items-center justify-between gap-4 py-2.5 text-sm"><div><p className="font-medium text-gray-900">{row.name}</p><p className="text-xs text-gray-400">{formatCalendarDate(row.date)} {row.time || ''} | {row.party_size || 0} guests</p></div><span className="text-gray-600">{row.table_number ? `Table ${row.table_number}` : 'Unassigned'}</span></div>) : <p className="py-6 text-center text-sm text-gray-400">No upcoming reservations.</p>}</div>
          </div>
        </div>
      </div>
    </DashboardSection>
  );
}

function TablePaymentChart({ rows = [] }) {
  const height = Math.max(360, rows.length * 54);
  return (
    <ChartCard title="Table revenue by payment method" hint="Every ordered table · cash, online, and credit collections" isEmpty={!rows.length} empty="No settled dine-in bills in this period.">
      <div className="space-y-2 md:hidden">
        {rows.map((row) => (
          <div key={row.table_number} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <div className="flex items-center justify-between gap-3"><span className="font-semibold text-gray-900">Table {row.table_number}</span><span className="font-semibold tabular-nums text-gray-900">{money(row.total)}</span></div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
              <span className="text-emerald-700">Cash <strong className="block tabular-nums">{money(row.cash)}</strong></span>
              <span className="text-blue-700">Online <strong className="block tabular-nums">{money(row.online)}</strong></span>
              <span className="text-right text-violet-700">Credit <strong className="block tabular-nums">{money(row.credit)}</strong></span>
            </div>
          </div>
        ))}
      </div>
      <div className="hidden md:block">
        <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-gray-600"><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Cash</span><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-blue-500" /> Online</span><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-violet-500" /> Credit</span></div>
        <div style={{ height }}><ResponsiveContainer width="100%" height="100%"><BarChart data={rows} layout="vertical" margin={{ top: 4, right: 22, left: 4, bottom: 4 }} barCategoryGap="22%"><CartesianGrid horizontal={false} stroke="#e5e7eb" /><XAxis type="number" tickFormatter={(value) => `Rs ${(Number(value) / 1000).toFixed(Number(value) >= 10000 ? 0 : 1)}k`} tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} /><YAxis type="category" dataKey="table_number" width={76} tickFormatter={(value) => `Table ${value}`} tick={{ fontSize: 12, fill: '#374151', fontWeight: 600 }} axisLine={false} tickLine={false} /><Tooltip cursor={{ fill: '#f8fafc' }} content={<TablePaymentTooltip />} /><Legend wrapperStyle={{ display: 'none' }} /><Bar dataKey="cash" stackId="payments" fill="#10b981" radius={[0, 0, 0, 0]} /><Bar dataKey="online" stackId="payments" fill="#3b82f6" /><Bar dataKey="credit" stackId="payments" fill="#8b5cf6" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></div>
      </div>
    </ChartCard>
  );
}

function TablePaymentTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const values = Object.fromEntries(payload.map((item) => [item.dataKey, Number(item.value || 0)]));
  const total = Number(values.cash || 0) + Number(values.online || 0) + Number(values.credit || 0);
  return <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-xs shadow-lg"><p className="mb-2 font-semibold text-gray-900">Table {label}</p><div className="space-y-1.5"><p className="flex justify-between gap-5 text-emerald-700"><span>Cash</span><span className="font-semibold tabular-nums">{money(values.cash)}</span></p><p className="flex justify-between gap-5 text-blue-700"><span>Online</span><span className="font-semibold tabular-nums">{money(values.online)}</span></p><p className="flex justify-between gap-5 text-violet-700"><span>Credit</span><span className="font-semibold tabular-nums">{money(values.credit)}</span></p><p className="flex justify-between gap-5 border-t border-gray-100 pt-1.5 font-semibold text-gray-900"><span>Total</span><span className="tabular-nums">{money(total)}</span></p></div></div>;
}

export function InventorySupplier({ data }) {
  const inv = data.inventory;
  const suppliers = data.suppliers;
  const supplierBars = (suppliers.top || []).map((row) => ({ label: row.supplier, value: row.spend, meta: `${row.purchases} purchases` }));
  return (
    <DashboardSection className="!p-6 sm:!p-8">
      <PurchasingDetails data={suppliers.purchasing} range={data.range} />
      <div className="mt-12 border-t border-gray-200 pt-10">
      <SectionHeading icon={PackageSearch} tone="teal" eyebrow="Stock and purchasing" title="Inventory and supplier health" description="Current stock health is live; movement, wastage, and purchasing totals use the selected period." />
      <div className="mt-2 grid gap-8 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-5 rounded-2xl border border-gray-100 bg-gray-50/70 p-5 sm:grid-cols-3 sm:p-6">
            <Metric label="Inventory Value" value={inv.value} format="currency" />
            <Metric label="Low Stock" value={inv.low} tone={inv.low ? 'warning' : 'default'} />
            <Metric label="Out of Stock" value={inv.out} tone={inv.out ? 'negative' : 'default'} />
            <Metric label="Consumption" value={inv.consumptionValue} format="currency" />
            <Metric label="Wastage" value={inv.wastageValue} format="currency" />
            <Metric label="Purchases" value={inv.purchaseValue} format="currency" />
          </div>
          <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-5 sm:p-6">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><PackageSearch className="h-4 w-4" /> Stock alerts</h3>
            <div className="mt-2 divide-y divide-gray-100">{inv.alerts?.length ? inv.alerts.map((row) => <div key={row.id} className="flex items-center justify-between py-2.5 text-sm"><span className="font-medium text-gray-800">{row.name}</span><StatusPill tone={row.status === 'out' ? 'negative' : 'warning'}>{row.quantity} {row.unit || ''}</StatusPill></div>) : <p className="py-5 text-center text-sm text-gray-400">All tracked stock is above reorder level.</p>}</div>
          </div>
        </div>
        <div className="space-y-6">
          <ChartCard title="Top Suppliers by Spend" isEmpty={!supplierBars.length} empty="No purchases recorded in this period."><RankBars data={supplierBars} color="blue" format="currency" /></ChartCard>
          <div className="grid grid-cols-3 gap-5 rounded-2xl border border-gray-100 bg-gray-50/70 p-5 sm:p-6">
            <Metric label="Purchase Records" value={suppliers.purchases} />
            <Metric label="Purchase Value" value={suppliers.purchaseValue} format="currency" />
            <Metric label="Outstanding AP" value={suppliers.outstandingPayables} format="currency" tone={suppliers.outstandingPayables ? 'warning' : 'default'} />
          </div>
        </div>
      </div>
      </div>
    </DashboardSection>
  );
}

function PurchasingDetails({ data, range }) {
  if (!data) return null;
  const purchases = data.purchases || {};
  const expenses = data.expenses || {};
  return <div className="space-y-12">
    <div className="rounded-2xl border border-gray-200 bg-slate-50/50 p-5 sm:p-7"><DetailTitle eyebrow="Purchasing" title="Purchase summary" range={range} description="Purchases are grouped by the payment method saved on their linked expense record." /><SummaryTable rows={[["Cash purchases", purchases.cash], ["Online purchases", purchases.online], ["Owner / funding purchases", purchases.funding], ["Credit purchases", purchases.credit]]} totalLabel="Total purchases" total={purchases.total} totalTransactions={purchases.transactions} /><div className="mt-8 grid gap-7 xl:grid-cols-2"><CategoryTable rows={purchases.categories} /><PurchaseTable title="Cash purchases" rows={purchases.cash?.rows} /><PurchaseTable title="Online purchases" rows={purchases.online?.rows} /><PurchaseTable title="Owner / funding purchases" rows={purchases.funding?.rows} /><PurchaseTable title="Credit purchases" rows={purchases.credit?.rows} /></div></div>
    <div className="rounded-2xl border border-gray-200 bg-slate-50/50 p-5 sm:p-7"><DetailTitle eyebrow="Operating costs" title="Expense summary" range={range} description="Manual and non-purchase expenses, separated by how they were paid." /><SummaryTable rows={[["Cash expenses", expenses.cash], ["Online expenses", expenses.online], ["Owner / funding expenses", expenses.funding], ["Cheque expenses", expenses.cheque], ["Credit expenses (outstanding)", expenses.credit]]} totalLabel="Total expenses" total={expenses.total} totalTransactions={expenses.transactions} /><div className="mt-8 grid gap-7 xl:grid-cols-2"><ExpenseTable title="Cash expenses" rows={expenses.cash?.rows} /><ExpenseTable title="Online expenses" rows={expenses.online?.rows} /><ExpenseTable title="Owner / funding expenses" rows={expenses.funding?.rows} /><ExpenseTable title="Cheque expenses" rows={expenses.cheque?.rows} /><ExpenseTable title="Credit expenses" rows={expenses.credit?.rows} /></div></div>
  </div>;
}

function DetailTitle({ eyebrow, title, range, description }) {
  return <div className="mb-6"><p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">{eyebrow}</p><h3 className="mt-1 text-lg font-semibold text-gray-950">{title}</h3><p className="mt-1.5 text-sm text-gray-500">{range?.start} to {range?.end} · {description}</p></div>;
}

function SummaryTable({ rows, totalLabel, total, totalTransactions }) {
  return <TableWrap minWidth="500px"><thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-400"><tr><th className="px-4 py-2.5">Payment type</th><th className="px-4 py-2.5 text-right">Amount</th><th className="px-4 py-2.5 text-right">Transactions</th></tr></thead><tbody className="divide-y divide-gray-100">{rows.map(([label, value]) => <tr key={label}><td className="px-4 py-3 font-medium text-gray-800">{label}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{money(value?.amount)}</td><td className="px-4 py-3 text-right tabular-nums text-gray-600">{value?.transactions || 0}</td></tr>)}</tbody><tfoot className="border-t-2 border-gray-900 bg-gray-50"><tr><td className="px-4 py-3 font-semibold text-gray-950">{totalLabel}</td><td className="px-4 py-3 text-right font-bold tabular-nums text-gray-950">{money(total)}</td><td className="px-4 py-3 text-right font-bold tabular-nums text-gray-950">{totalTransactions || 0}</td></tr></tfoot></TableWrap>;
}

function CategoryTable({ rows = [] }) {
  return <TableWrap minWidth="440px"><thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-400"><tr><th className="px-4 py-2.5">Purchase category</th><th className="px-4 py-2.5 text-right">Amount</th><th className="px-4 py-2.5 text-right">% of total</th></tr></thead><tbody className="divide-y divide-gray-100">{rows.map((row) => <tr key={row.category}><td className="px-4 py-3 font-medium text-gray-800">{row.category}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{money(row.amount)}</td><td className="px-4 py-3 text-right tabular-nums text-gray-600">{percent(row.share)}</td></tr>)}</tbody></TableWrap>;
}

function PurchaseTable({ title, rows = [] }) {
  const { openPurchase } = useAnalyticsRecords();
  return <div className="overflow-hidden rounded-xl border border-gray-200"><div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-3"><h4 className="text-sm font-semibold text-gray-950">{title} <span className="text-gray-400">({rows.length})</span></h4><span className="font-semibold tabular-nums text-gray-900">{money(rows.reduce((sum, row) => sum + Number(row.total || 0), 0))}</span></div><div className="max-h-[340px] overflow-auto"><table className="w-full min-w-[580px] text-left text-sm"><thead className="sticky top-0 bg-white text-xs uppercase tracking-wide text-gray-400"><tr><th className="px-4 py-2.5">PO #</th><th className="px-4 py-2.5">Date</th><th className="px-4 py-2.5">Supplier</th><th className="px-4 py-2.5 text-right">Amount</th></tr></thead><tbody className="divide-y divide-gray-100">{rows.map((row) => <tr key={row.id} className={clickableRowClass} onClick={() => openPurchase(row.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openPurchase(row.id); } }} tabIndex={0} role="button"><td className="px-4 py-3 font-medium text-gray-900">{row.invoice_number || `PO-${row.id}`}</td><td className="px-4 py-3 text-gray-600">{formatNepalDisplay(row.invoice_date)}</td><td className="px-4 py-3 text-gray-700">{row.supplier}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{money(row.total)}</td></tr>)}</tbody></table>{!rows.length && <p className="py-8 text-center text-sm text-gray-400">No {title.toLowerCase()} in this period.</p>}</div></div>;
}

function ExpenseTable({ title, rows = [] }) {
  const { openExpense } = useAnalyticsRecords();
  return <div className="overflow-hidden rounded-xl border border-gray-200"><div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-3"><h4 className="text-sm font-semibold text-gray-950">{title} <span className="text-gray-400">({rows.length})</span></h4><span className="font-semibold tabular-nums text-gray-900">{money(rows.reduce((sum, row) => sum + Number(row.amount || 0), 0))}</span></div><div className="max-h-[340px] overflow-auto"><table className="w-full min-w-[460px] text-left text-sm"><thead className="sticky top-0 bg-white text-xs uppercase tracking-wide text-gray-400"><tr><th className="px-4 py-2.5">Title</th><th className="px-4 py-2.5">Date</th><th className="px-4 py-2.5 text-right">Amount</th></tr></thead><tbody className="divide-y divide-gray-100">{rows.map((row) => <tr key={row.id} className={clickableRowClass} onClick={() => openExpense(row)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openExpense(row); } }} tabIndex={0} role="button"><td className="px-4 py-3 font-medium text-gray-800">{row.description || 'Untitled expense'}</td><td className="px-4 py-3 text-gray-600">{formatNepalDisplay(row.expense_date)}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{money(row.amount)}</td></tr>)}</tbody></table>{!rows.length && <p className="py-8 text-center text-sm text-gray-400">No {title.toLowerCase()} in this period.</p>}</div></div>;
}

export function PeoplePerformance({ data }) {
  const customers = data.customers;
  const waiterBars = (data.staff.waiters || []).map((row) => ({ label: row.name, value: row.sales, meta: `${row.orders} orders` }));
  return (
    <DashboardSection>
      <SectionHeading icon={Users} tone="violet" eyebrow="People" title="Customers and staff" description="Anonymous walk-ins are excluded from repeat-customer metrics. Staff sales are attributed only through saved waiter/cashier IDs." />
      <CustomerCreditLedger range={data.range} />
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Metric label="Identified Customers" value={customers.identified} />
            <Metric label="Repeat Customers" value={customers.repeatCustomers} />
            <Metric label="Repeat Rate" value={customers.repeatRate} format="percent" />
            <Metric label="Average Spend" value={customers.averageSpend} format="currency" />
            <Metric label="Anonymous Bills" value={customers.anonymousBills} />
            <Metric label="Customer Credit" value={customers.receivables} format="currency" />
          </div>
          <div className="mt-4 divide-y divide-gray-100">{customers.top?.map((row) => <div key={row.id ?? `customer:${row.name}`} className="flex justify-between py-2 text-sm"><span className="font-medium text-gray-800">{row.name}</span><span className="tabular-nums text-gray-600">{money(row.spend)} | {row.bills} bills</span></div>)}</div>
        </div>
        <ChartCard title="Waiter Sales Attribution" isEmpty={!waiterBars.length} empty="No settled bills are attributed to a waiter."><RankBars data={waiterBars} color="emerald" format="currency" /></ChartCard>
      </div>
    </DashboardSection>
  );
}

export function Controls({ data }) {
  const c = data.controls;
  const reasonRows = [...(c.reasons.orders || []).map((r) => ({ label: `Order: ${r.reason}`, value: r.count })), ...(c.reasons.kots || []).map((r) => ({ label: `KOT: ${r.reason}`, value: r.count })), ...(c.reasons.bills || []).map((r) => ({ label: `Bill: ${r.reason}`, value: r.count }))];
  return (
    <DashboardSection>
      <SectionHeading icon={ShieldAlert} tone="rose" eyebrow="Management control" title="Discounts, refunds, voids and cancellations" description="A compact fraud/control view backed by persisted reasons and audit history." />
      <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['Discount', c.discounts, 'currency'], ['Discounted Bills', c.discountedBills, 'number'], ['Refunds', c.refunds, 'currency'], ['Refund Count', c.refundCount, 'number'],
            ['Cancelled Orders', c.cancelledOrders, 'number'], ['Cancelled KOTs', c.cancelledKots, 'number'], ['Voided Bills', c.voidedBills, 'number'], ['Value Voided', c.voidedValue, 'currency'],
          ].map(([label, value, format]) => <StatCell key={label} label={label} value={value} format={format} tone={value ? 'negative' : 'default'} />)}
        </div>
        <ChartCard title="Top Recorded Reasons" isEmpty={!reasonRows.length} empty="No cancellation or void reasons in this period."><RankBars data={reasonRows.slice(0, 8)} color="red" format="number" /></ChartCard>
      </div>
    </DashboardSection>
  );
}

export function RecentActivity({ data, pagination, loading = false, onPageChange, onPageSizeChange, onExportTransactions }) {
  const { openBill, openKot } = useAnalyticsRecords();
  return (
    <DashboardSection>
      <SectionHeading
        icon={CircleDollarSign}
        tone="slate"
        eyebrow="Transactions"
        title="Paged transaction report"
        description="Transactions are loaded page by page so longer periods stay fast. Export downloads the full selected period. Click a row to open the bill."
        action={<button type="button" onClick={onExportTransactions} className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"><Download className="h-4 w-4" /> Excel export</button>}
      />
      <div className="space-y-5">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><CircleDollarSign className="h-4 w-4" /> Transactions</h3>
            <Link href="/admin/bills" className="text-xs font-medium text-gray-600">View bills</Link>
          </div>
          <TableWrap minWidth="1360px">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-4 py-2.5">Time</th><th className="px-4 py-2.5">Bill / Order</th><th className="px-4 py-2.5">Table / Channel</th><th className="px-4 py-2.5">Customer</th><th className="px-4 py-2.5">Cashier</th><th className="px-4 py-2.5">Payment</th>
                <th className="px-4 py-2.5 text-right">Subtotal</th><th className="px-4 py-2.5 text-right">Discount</th><th className="px-4 py-2.5 text-right">Cash</th><th className="px-4 py-2.5 text-right">Digital</th><th className="px-4 py-2.5">Digital Via</th>
                <th className="px-4 py-2.5 text-right">Food</th><th className="px-4 py-2.5 text-right">Beverage</th><th className="px-4 py-2.5 text-right">Tobacco</th><th className="px-4 py-2.5 text-right">Final Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.recentTransactions?.map((row) => (
                <tr
                  key={row.id}
                  className={clickableRowClass}
                  onClick={() => openBill(row.id)}
                  onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openBill(row.id); } }}
                  tabIndex={0}
                  role="button"
                >
                  <td className="px-4 py-3 text-gray-500"><NepalTime value={row.paid_at || row.created_at} /></td>
                  <td className="px-4 py-3"><p className="font-medium">{compactBillNumber(row.bill_number)}</p><p className="text-xs text-gray-400">{compactOrderNumber(row.order_number)}</p></td>
                  <td className="px-4 py-3">{row.table_number ? `Table ${row.table_number}` : orderTypeLabel(row)}</td>
                  <td className="px-4 py-3">{row.customer_name || 'Walk-in'}</td>
                  <td className="px-4 py-3">{row.cashier}</td>
                  <td className="px-4 py-3 capitalize">{row.payment}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(row.subtotal)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(row.discount_amount)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(row.cash_amount)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(row.qr_amount)}</td>
                  <td className="px-4 py-3">{row.qr_type || 'Not recorded'}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(row.food_amount)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(row.beverage_amount)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(row.tobacco_amount)}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{money(row.final_total || row.grand_total)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <PaginationControls pagination={pagination} loading={loading} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} />
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><ChefHat className="h-4 w-4" /> Recent KOT activity</h3>
            <Link href="/admin/kot" className="text-xs font-medium text-gray-600">View KOT history</Link>
          </div>
          <TableWrap minWidth="760px">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-4 py-2.5">Created</th><th className="px-4 py-2.5">KOT</th><th className="px-4 py-2.5">Order</th><th className="px-4 py-2.5">Table</th>
                <th className="px-4 py-2.5 text-right">Items</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5 text-right">Prep</th><th className="px-4 py-2.5">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.recentKots?.map((row, i) => (
                <tr
                  key={`${row.id || row.kot_number}-${i}`}
                  className={row.id ? clickableRowClass : undefined}
                  onClick={() => row.id && openKot(row.id)}
                  onKeyDown={(event) => { if (row.id && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openKot(row.id); } }}
                  tabIndex={row.id ? 0 : undefined}
                  role={row.id ? 'button' : undefined}
                >
                  <td className="px-4 py-3 text-gray-500"><NepalTime value={row.printed_at} /></td>
                  <td className="px-4 py-3 font-medium">{row.kot_number || '-'}</td>
                  <td className="px-4 py-3">{row.order_number}</td>
                  <td className="px-4 py-3">{row.table_number || '-'}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{row.item_count}</td>
                  <td className="px-4 py-3"><StatusPill tone={row.status === 'completed' ? 'positive' : row.status === 'cancelled' ? 'negative' : 'warning'}>{row.status}</StatusPill></td>
                  <td className="px-4 py-3 text-right tabular-nums">{row.prep_minutes == null ? '-' : `${Math.round(row.prep_minutes)} min`}</td>
                  <td className="px-4 py-3 text-gray-500">{row.cancel_reason || '-'}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </div>
      </div>
    </DashboardSection>
  );
}

export function ManagementSummary({ data }) {
  const best = data.bestWorst;
  const rows = [
    ['Best selling item', best.bestItem?.item, best.bestItem ? `${best.bestItem.quantity} sold` : null],
    ['Lowest selling item', best.lowestItem?.item, best.lowestItem ? `${best.lowestItem.quantity} sold` : null],
    ['Highest revenue category', best.bestCategory?.category, best.bestCategory ? money(best.bestCategory.revenue) : null],
    ['Best performing waiter', best.bestWaiter?.name, best.bestWaiter ? money(best.bestWaiter.sales) : null],
    ['Highest revenue table', best.bestTable?.table_number ? `Table ${best.bestTable.table_number}` : null, best.bestTable ? money(best.bestTable.revenue) : null],
    ['Peak sales hour', best.peakHour ? `${String(best.peakHour.hour).padStart(2, '0')}:00` : null, best.peakHour ? money(best.peakHour.sales) : null],
    ['Slowest KOT', best.slowestKot?.kot_number, best.slowestKot ? `${Math.round(best.slowestKot.prep_minutes)} min` : null],
  ].filter((row) => row[1]);
  return (
    <DashboardSection className="pb-8">
      <SectionHeading icon={Award} tone="indigo" eyebrow="Business overview" title="Best and worst performance summary" description="A concise owner handoff for the selected period." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{rows.map(([label, value, detail]) => <div key={label} className="rounded-xl border border-gray-100 bg-gray-50 p-4"><p className="text-xs text-gray-500">{label}</p><p className="mt-1 truncate text-sm font-semibold text-gray-900">{value}</p><p className="mt-0.5 text-xs text-gray-400">{detail}</p></div>)}</div>
      {data.limitations?.length > 0 && <div className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-4"><p className="text-xs font-semibold uppercase text-gray-500">Data notes</p><ul className="mt-2 space-y-1 text-xs text-gray-600">{data.limitations.map((note) => <li key={note}>- {note}</li>)}</ul></div>}
    </DashboardSection>
  );
}
