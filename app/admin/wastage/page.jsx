'use client';

/**
 * Wastage control. Every entry already deducts stock, writes a movement and
 * posts an `inventory_loss` expense — this page makes that chain visible
 * instead of leaving the owner to guess whether the money was counted.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import AdminLayout from '@/components/admin/admin-layout';
import { Paperclip, Plus } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { friendlyFromError } from '@/lib/friendly-message';
import { authedRequest } from '@/lib/authed-fetch';
import DataGrid, { StatusBadge } from '@/components/admin/data-grid';
import useServerList from '@/lib/use-server-list';
import AttentionBar from '@/components/admin/attention-bar';
import { KpiCards, ChartCard, ChartGrid, TrendChart, RankBars } from '@/components/admin/report-kit';
import WastageModal, { WASTAGE_REASON_LABELS, WASTAGE_REASONS } from '@/components/inventory/wastage-modal';
import { formatNepalTime } from '@/lib/time-utils';
import { nepalDateString } from '@/lib/report-dates';
import { formatCalendarDate } from '@/lib/calendar-system.js';
import DateInput from '@/components/ui/date-input.jsx';
import BillInvoiceModal from '@/components/admin/bill-invoice-modal.jsx';

const reasonLabel = (r) => WASTAGE_REASON_LABELS[r] || String(r || 'other').replace(/_/g, ' ');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const entriesMeta = (n) => `${n} entr${n === 1 ? 'y' : 'ies'}`;

const lostMeta = (bucket) => `Rs ${Number(bucket.total || 0).toFixed(2)} lost · ${entriesMeta(bucket.entries)}`;

export default function WastagePage() {
  const { addToast } = useToast();
  const [logging, setLogging] = useState(false);
  const [invoiceBillId, setInvoiceBillId] = useState(null);
  const [filters, setFilters] = useState({ reason: 'all', from: '', to: '' });

  const {
    rows: entries,
    extra,
    server,
    loading,
    reload: fetchAll,
  } = useServerList({
    url: '/api/admin/wastage',
    key: 'entries',
    filters,
    initialSort: { key: 'created_at', dir: 'desc' },
    onError: (error) => addToast(friendlyFromError(error, 'load_failed')),
  });

  // Every KPI and chart below describes the whole log and is aggregated in SQL.
  // They used to be derived from "all the rows", which only held while the page
  // actually fetched all the rows.
  const summary = extra.summary;

  const rows = useMemo(
    () =>
      entries.map((e) => ({
        ...e,
        item: e.raw_material_name || e.recipe_name || e.menu_item_name || 'Unknown item',
        cost: Number(e.total_cost || 0),
      })),
    [entries]
  );

  // The rolling windows are bucketed server-side — reading the clock during
  // render is impure, and "today" is the server's call anyway.
  const windowOf = (name) => summary?.windows?.[name] || { cost: 0, entries: 0 };

  const totalsByDate = useMemo(() => new Map((summary?.daily || []).map((d) => [d.date, d])), [summary]);

  const weekly = useMemo(() => {
    const days = [];
    const today = nepalDateString();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(`${today}T12:00:00+05:45`);
      d.setUTCDate(d.getUTCDate() - i);
      const key = nepalDateString(d);
      days.push({
        label: d.toLocaleDateString('en-US', { timeZone: 'Asia/Kathmandu', weekday: 'short' }),
        sub: formatCalendarDate(key),
        value: totalsByDate.get(key)?.entries || 0,
      });
    }
    return days;
  }, [totalsByDate]);

  const monthly = useMemo(() => {
    const buckets = new Map();
    for (const d of summary?.daily || []) {
      const key = d.date.slice(0, 7);
      buckets.set(key, (buckets.get(key) || 0) + d.entries);
    }
    return Array.from(buckets, ([key, value]) => ({ label: key.slice(5), sub: key, value })).sort((a, b) =>
      a.sub.localeCompare(b.sub)
    );
  }, [summary]);

  const topItems = useMemo(() => (summary?.byItem || []).map((b) => ({ label: b.label, value: b.quantity, meta: lostMeta(b) })), [summary]);
  const topReasons = useMemo(() => (summary?.byReason || []).map((b) => ({ label: reasonLabel(b.label), value: b.entries, meta: `Rs ${Number(b.total || 0).toFixed(2)} lost` })), [summary]);
  const byEmployee = useMemo(() => (summary?.byEmployee || []).map((b) => ({ label: b.label, value: b.entries, meta: `Rs ${Number(b.total || 0).toFixed(2)} lost` })), [summary]);

  const unlinkedCount = summary?.unlinked || 0;
  const hasAny = (summary?.daily || []).length > 0;

  const columns = useMemo(
    () => [
      {
        key: 'created_at',
        label: 'When',
        value: (r) => r.created_at || '',
        render: (r) => formatNepalTime(r.created_at),
      },
      { key: 'item', label: 'Item', className: 'text-gray-900 font-medium' },
      {
        key: 'quantity',
        label: 'Quantity',
        align: 'right',
        numeric: true,
        render: (r) => `${Number(r.quantity)} ${r.unit || ''}`.trim(),
      },
      { key: 'reason', label: 'Reason', value: (r) => reasonLabel(r.reason), render: (r) => <StatusBadge tone="amber">{reasonLabel(r.reason)}</StatusBadge> },
      { key: 'source_kot_number', label: 'Source', render: (r) => r.source_kot_number ? <span className="rounded-md bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">{r.source_kot_number}</span> : <span className="text-gray-300">Manual</span> },
      { key: 'employee_name', label: 'Employee', render: (r) => r.employee_name || <span className="text-gray-300">Not attributed</span> },
      { key: 'shift', label: 'Shift', render: (r) => (r.shift ? <span className="capitalize">{r.shift}</span> : <span className="text-gray-300">—</span>) },
      {
        key: 'cost',
        label: 'Cost lost',
        align: 'right',
        numeric: true,
        className: 'text-gray-900 font-medium',
        render: (r) => `Rs ${r.cost.toFixed(2)}`,
      },
      {
        key: 'expense_amount',
        label: 'Expense posted',
        numeric: true,
        value: (r) => (r.expense_amount == null ? 'None' : 'Posted'),
        render: (r) =>
          r.expense_amount != null ? (
            <Link href="/admin/expenses" onClick={(event) => event.stopPropagation()} className="inline-flex items-center gap-1 text-sm text-emerald-700 hover:underline">
              <StatusBadge tone="green">Rs {Number(r.expense_amount).toFixed(2)}</StatusBadge>
            </Link>
          ) : (
            <span className="text-gray-300">Not costed</span>
          ),
      },
      {
        key: 'photo_url',
        label: 'Photo',
        sortable: false,
        render: (r) =>
          r.photo_url ? (
            <a href={r.photo_url} target="_blank" rel="noreferrer" className="text-gray-500 hover:text-gray-900" aria-label="Open photo">
              <Paperclip className="h-4 w-4" />
            </a>
          ) : (
            <span className="text-gray-300">—</span>
          ),
      },
      { key: 'logged_by_name', label: 'Logged by', render: (r) => r.logged_by_name || 'System' },
    ],
    []
  );

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Wastage</h1>
            <p className="mt-1 text-sm text-gray-500 sm:text-base">
              What was thrown away, what it cost, and who was on shift when it happened.
            </p>
          </div>
          <button type="button" onClick={() => setLogging(true)} className="inline-flex items-center gap-1.5 self-start rounded-xl bg-gray-900 px-3.5 py-2.5 text-sm font-semibold text-white hover:bg-gray-800">
            <Plus className="h-4 w-4" /> Log wastage
          </button>
        </div>
      </header>

      <div className="space-y-5 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-gray-200 bg-white p-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">Reason</span>
            <select
              value={filters.reason}
              onChange={(e) => setFilters((f) => ({ ...f, reason: e.target.value }))}
              className="h-10 rounded-lg border border-gray-300 px-3 text-sm text-gray-700"
            >
              <option value="all">All reasons</option>
              {WASTAGE_REASONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">From</span>
            <DateInput value={filters.from} onChange={(v) => setFilters((f) => ({ ...f, from: v }))} className="h-10 rounded-lg border border-gray-300 px-3 text-sm text-gray-700" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">To</span>
            <DateInput value={filters.to} onChange={(v) => setFilters((f) => ({ ...f, to: v }))} className="h-10 rounded-lg border border-gray-300 px-3 text-sm text-gray-700" />
          </label>
          {(filters.reason !== 'all' || filters.from || filters.to) && (
            <button type="button" onClick={() => setFilters({ reason: 'all', from: '', to: '' })} className="h-10 rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-600 hover:bg-gray-50">
              Clear
            </button>
          )}
        </div>

        <KpiCards
          kpis={[
            { key: 'today', label: 'Today', value: windowOf('today').cost, format: 'currency', sub: plural(windowOf('today').entries, 'entry', 'entries') },
            { key: 'week', label: 'Last 7 days', value: windowOf('week').cost, format: 'currency', sub: plural(windowOf('week').entries, 'entry', 'entries') },
            { key: 'month', label: 'Last 30 days', value: windowOf('month').cost, format: 'currency', sub: plural(windowOf('month').entries, 'entry', 'entries') },
            { key: 'reason', label: 'Most common reason', value: topReasons[0]?.label || '—', sub: topReasons[0]?.meta },
          ]}
        />

        <AttentionBar
          tone={unlinkedCount ? 'amber' : 'blue'}
          title={
            unlinkedCount
              ? `${plural(unlinkedCount, 'entry', 'entries')} could not be costed`
              : 'Every costed entry is already in your expenses'
          }
          body={
            unlinkedCount
              ? 'A wastage entry only posts an expense when the ingredient had a cost basis at the time. Set a cost on those items so future losses are counted.'
              : 'Wastage is costed and posted as inventory loss. Prepared order cancellations reuse stock already consumed by that order, so they are never deducted twice.'
          }
          action={
            <Link href="/admin/expenses" className="h-9 shrink-0 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium leading-9 text-gray-700 hover:bg-gray-50">
              View expenses
            </Link>
          }
        />

        <ChartGrid>
          <ChartCard title="Last 7 days" hint="Wastage entries logged each day" isEmpty={!hasAny} empty="Nothing has been logged yet, so there is no trend to draw.">
            <TrendChart data={weekly} color="red" format="number" />
          </ChartCard>
          <ChartCard title="By month" hint="Every month with a logged entry" isEmpty={monthly.length < 2} empty="One month of history so far — the monthly trend appears once there are two.">
            <TrendChart data={monthly} color="amber" format="number" />
          </ChartCard>
          <ChartCard title="Most wasted items" isEmpty={!topItems.length} empty="No items logged yet.">
            <RankBars data={topItems} color="red" format="number" limit={8} />
          </ChartCard>
          <ChartCard title="Reasons" isEmpty={!topReasons.length} empty="No reasons recorded yet.">
            <RankBars data={topReasons} color="slate" format="number" limit={8} />
          </ChartCard>
        </ChartGrid>

        <ChartCard
          title="By employee"
          hint="Only entries where an employee was picked"
          isEmpty={!byEmployee.length}
          empty="No entry has an employee attached yet. Pick one when logging so repeat patterns become visible."
        >
          <RankBars data={byEmployee} color="violet" format="number" limit={8} />
        </ChartCard>

        <DataGrid
          title="Wastage log"
          columns={columns}
          rows={rows}
          onRowClick={(row) => { if (row.source_bill_id) setInvoiceBillId(row.source_bill_id); }}
          rowClassName={(row) => row.source_bill_id ? '' : 'cursor-default'}
          server={server}
          csvName="wastage"
          searchPlaceholder="Search items, reasons, staff…"
          empty={loading ? 'Loading wastage log…' : 'Nothing logged yet. That is good news — log the first spoilage when it happens.'}
          footNote="Click a KOT-linked row to inspect its bill here. Manual wastage deducts stock; prepared order cancellations use stock already consumed by the order. CSV and Print cover the whole log."
        />
      </div>

      {logging && <WastageModal request={authedRequest} onClose={() => setLogging(false)} onLogged={fetchAll} />}
      {invoiceBillId && <BillInvoiceModal billId={invoiceBillId} onClose={() => setInvoiceBillId(null)} />}
    </AdminLayout>
  );
}
