'use client';

/**
 * Order history — server-paginated, auto-refreshes so live table/POS orders
 * appear without a manual reload. Timestamps use Asia/Kathmandu (NPT).
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AdminLayout from '@/components/admin/admin-layout';
import { Eye, Filter, Printer, ExternalLink, Ban, LayoutGrid, ShoppingBag, Bike } from 'lucide-react';
import DataGrid, { StatusBadge } from '@/components/admin/data-grid';
import DateRangeFilter from '@/components/ui/date-range-filter';
import useServerList from '@/lib/use-server-list';
import { formatCurrency } from '@/lib/currency';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { friendlyFromError } from '@/lib/friendly-message';
import { formatNepalDateTime, resolvePeriodRange } from '@/lib/report-dates.js';
import { compactOrderNumber } from '@/lib/document-display.js';
import { printFinalBill } from '@/lib/pos-print.js';
import { receiptFromOrderDetail } from '@/lib/bill-receipt.js';
import { orderTypeLabel, normalizedOrderType } from '@/lib/order-types.js';
import { SittingTime } from '@/components/tables/table-open-duration.jsx';

const CHANNEL_ICON = { dine_in: LayoutGrid, takeaway: ShoppingBag, delivery: Bike };
const CHANNEL_ICON_TONE = { dine_in: 'text-slate-500', takeaway: 'text-sky-600', delivery: 'text-orange-600' };
function ChannelIcon({ order }) {
  const type = normalizedOrderType(order);
  const Icon = CHANNEL_ICON[type] || ShoppingBag;
  return <Icon className={`h-3.5 w-3.5 shrink-0 ${CHANNEL_ICON_TONE[type] || 'text-slate-400'}`} />;
}

const STATUS_TONE = {
  pending: 'amber',
  preparing: 'blue',
  cooking: 'blue',
  ready: 'green',
  dining: 'blue',
  served: 'blue',
  awaiting_payment: 'amber',
  completed: 'gray',
  cancelled: 'red',
  refunded: 'red',
  partially_refunded: 'amber',
  voided: 'red',
};

const PAY_TONE = {
  paid: 'green',
  unpaid: 'amber',
  partial: 'blue',
  credit: 'violet',
  due: 'red',
  refunded: 'gray',
  partially_refunded: 'amber',
  voided: 'red',
};

const STATUSES = [
  'all',
  'pending',
  'preparing',
  'ready',
  'dining',
  'awaiting_payment',
  'completed',
  'refunded',
  'partially_refunded',
  'voided',
  'cancelled',
];

function payLabel(o) {
  const status = String(o.financial_payment_status || o.payment_status || '').toLowerCase();
  if (status === 'refunded') return 'Refunded';
  if (status === 'partially_refunded') return 'Partially refunded';
  if (status === 'voided') return 'Voided';
  const outstanding = Number(o.outstanding_amount || 0);
  if (status === 'paid' || (o.status === 'completed' && outstanding <= 0.009)) return 'Paid';
  if (outstanding > 0.009 && (status === 'partial' || status === 'credit')) return 'Due / Credit';
  if (status === 'unpaid' || !status) return o.status === 'completed' ? 'Unpaid' : 'Open';
  return status.replace(/_/g, ' ');
}

export default function AdminOrders() {
  const router = useRouter();
  const { addToast } = useToast();
  const { confirm, prompt, alert } = useConfirm();
  const [statusFilter, setStatusFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('all');
  const [dateRange, setDateRange] = useState(() => {
    const range = resolvePeriodRange('today');
    return { period: 'today', from: range.start, to: range.end };
  });
  const [busyId, setBusyId] = useState(null);
  const [paySettings, setPaySettings] = useState({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = localStorage.getItem('pos_token');
        const res = await fetch('/api/admin/settings', { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setPaySettings(data.settings || data || {});
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const filters = useMemo(
    () => ({ status: statusFilter, order_type: channelFilter, from: dateRange.from, to: dateRange.to }),
    [statusFilter, channelFilter, dateRange]
  );

  const { rows, extra, server, loading, reload } = useServerList({
    url: '/api/admin/orders',
    key: 'orders',
    filters,
    initialSort: { key: 'created_at', dir: 'desc' },
    onError: (error) => addToast(friendlyFromError(error, 'load_failed')),
  });

  // Live refresh so open POS orders appear without leaving the page.
  useEffect(() => {
    const id = setInterval(() => reload(), 12000);
    return () => clearInterval(id);
  }, [reload]);

  const voidOrder = async (o) => {
    const reason = await prompt({
      title: `Void order ${o.order_number}?`,
      message: 'This cancels the order and restores any stock. Enter a reason to continue.',
      label: 'Reason',
      placeholder: 'e.g. Customer left / Wrong order',
      confirmLabel: 'Void order',
      tone: 'danger',
      required: true,
      multiline: true,
    });
    if (reason == null) return;
    setBusyId(o.id);
    try {
      const token = localStorage.getItem('pos_token');
      const res = await fetch(`/api/admin/orders/${o.id}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'void', reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Void failed');
      addToast({ description: data.message || 'Order voided.', variant: 'success' });
      reload();
    } catch (e) {
      await alert({ title: 'Could not void', message: e.message, tone: 'danger' });
    } finally {
      setBusyId(null);
    }
  };

  const printBill = async (o) => {
    setBusyId(o.id);
    try {
      const token = localStorage.getItem('pos_token');
      const res = await fetch(`/api/admin/orders/${o.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load order');
      if (!data.order?.bill_id && !data.order?.bill_number) {
        await alert({
          title: 'No bill yet',
          message: 'This order has no bill to print. Open it in POS and complete payment first.',
          tone: 'warning',
        });
        return;
      }
      const receipt = receiptFromOrderDetail({ ...data, settings: paySettings });
      if (!receipt?.items?.length) {
        await alert({ title: 'Empty bill', message: 'There are no items on this bill to print.', tone: 'warning' });
        return;
      }
      printFinalBill(receipt, { size: paySettings?.receipt_paper_size || '80', reprint: true, settings: paySettings });
    } catch (e) {
      await alert({ title: 'Print failed', message: e.message, tone: 'danger' });
    } finally {
      setBusyId(null);
    }
  };

  const summary = extra.summary;

  // Compact columns — keep the important signals visible without horizontal scroll.
  const columns = useMemo(
    () => [
      {
        key: 'order_number',
        label: 'Order',
        className: 'text-gray-900 font-medium',
        render: (o) => (
          <div className="min-w-0">
            <div className="truncate font-semibold text-gray-900">{compactOrderNumber(o.order_number)}</div>
            <div className="truncate text-[11px] text-gray-400">{formatNepalDateTime(o.created_at)}</div>
          </div>
        ),
      },
      {
        key: 'customer_name',
        label: 'Customer / Table',
        render: (o) => (
          <div className="min-w-0">
            <div className="truncate text-gray-900">{o.customer_name || 'Walk-in'}</div>
            <div className="flex items-center gap-1 truncate text-[11px] text-gray-400">
              <ChannelIcon order={o} />
              {o.table_number
                ? `Table ${o.table_number}${o.party_label ? ` · ${o.party_label}` : ''}`
                : orderTypeLabel(o)}
            </div>
          </div>
        ),
      },
      {
        key: 'sitting',
        label: 'At table',
        render: (o) => (
          <SittingTime
            openedAt={o.created_at}
            closedAt={o.paid_at}
            status={o.financial_status || o.status}
            dineIn={normalizedOrderType(o) === 'dine_in'}
          />
        ),
      },
      {
        key: 'item_count',
        label: 'Items',
        align: 'right',
        render: (o) => o.item_count ?? '—',
      },
      {
        key: 'total',
        label: 'Total',
        align: 'right',
        numeric: true,
        className: 'text-gray-900 font-semibold',
        render: (o) => formatCurrency(o.total || 0),
      },
      {
        key: 'financial_payment_status',
        label: 'Pay',
        render: (o) => {
          const label = payLabel(o);
          const tone =
            label === 'Paid' ? 'green'
              : label.includes('Due') || label.includes('Credit') ? 'violet'
                : label === 'Unpaid' ? 'amber'
                  : 'gray';
          return <StatusBadge tone={PAY_TONE[o.financial_payment_status] || PAY_TONE[o.payment_status] || tone}>{label}</StatusBadge>;
        },
      },
      {
        key: 'financial_status',
        label: 'Status',
        render: (o) => (
          <StatusBadge tone={STATUS_TONE[o.financial_status] || STATUS_TONE[o.status] || 'gray'}>
            {String(o.financial_status || o.status || 'unknown').replace(/_/g, ' ')}
          </StatusBadge>
        ),
      },
    ],
    []
  );

  const tiles = [
    { label: 'Total Orders', value: summary ? summary.orders.toLocaleString() : '—' },
    { label: 'Gross Sales', value: summary ? formatCurrency(summary.grossRevenue) : '—' },
    { label: 'Refunds', value: summary ? formatCurrency(summary.refunds) : '—' },
    { label: 'Voided Value', value: summary ? formatCurrency(summary.voids) : '—' },
    { label: 'Net Revenue', value: summary ? formatCurrency(summary.revenue) : '—' },
    { label: 'Completed Orders', value: summary ? summary.completed.toLocaleString() : '—' },
  ];

  return (
    <AdminLayout>
      <header className="bg-white border-b border-gray-200 px-4 sm:px-6 lg:px-8 py-5 sm:py-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Orders</h1>
        <p className="text-gray-500 mt-1 text-sm">
          Live and historical orders. Times shown in Nepal Standard Time (Asia/Kathmandu). Auto-refreshes every 12s.
        </p>
      </header>

      <div className="space-y-5 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3 xl:grid-cols-6">
          {tiles.map((t) => {
            const len = String(t.value).length;
            const sizeClass = len > 12 ? 'text-base sm:text-lg' : len > 8 ? 'text-lg sm:text-xl' : 'text-xl sm:text-2xl';
            return (
              <div key={t.label} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
                <p className="text-xs font-medium text-gray-500 sm:text-sm">{t.label}</p>
                <h3 className={`mt-2 truncate font-bold tabular-nums text-gray-900 ${sizeClass}`}>{t.value}</h3>
              </div>
            );
          })}
        </div>

        <DataGrid
          title="Order history"
          columns={columns}
          rows={rows}
          server={server}
          csvName="orders"
          minTableWidth="min-w-[720px]"
          searchPlaceholder="Search order #, customer, table, bill…"
          empty="No orders match these filters yet."
          onRowClick={(o) => router.push(`/admin/orders/${o.id}`)}
          toolbar={
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-2">
                <Filter className="h-4 w-4 text-gray-400" />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 capitalize"
                  aria-label="Filter by status"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s} className="capitalize">
                      {s === 'all' ? 'All statuses' : s.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </label>
              <select
                value={channelFilter}
                onChange={(e) => setChannelFilter(e.target.value)}
                className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700"
                aria-label="Filter by channel"
              >
                <option value="all">All channels</option>
                <option value="dine_in">Table</option>
                <option value="takeaway">Takeaway</option>
                <option value="delivery">Delivery</option>
              </select>
              <DateRangeFilter value={dateRange} onChange={setDateRange} />
            </div>
          }
          renderActions={(o) => {
            const cancelled = ['cancelled', 'canceled'].includes(String(o.status || ''));
            const correctionFinal = ['refunded', 'voided'].includes(String(o.financial_status || ''));
            const hasRefund = Number(o.refunded_amount || 0) > 0;
            const busy = busyId === o.id;
            return (
              <>
                <button
                  type="button"
                  onClick={() => router.push(`/admin/orders/${o.id}`)}
                  className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                  title="View details"
                >
                  <Eye className="h-4 w-4" />
                </button>
                {!correctionFinal && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => router.push(`/admin/pos?order=${o.id}`)}
                    className="rounded-lg p-2 text-emerald-600 hover:bg-emerald-50 disabled:opacity-40"
                    title="Edit in POS / KOT"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </button>
                )}
                {!cancelled && !correctionFinal && !hasRefund && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => voidOrder(o)}
                    className="rounded-lg p-2 text-red-600 hover:bg-red-50 disabled:opacity-40"
                    title="Void / cancel order"
                  >
                    <Ban className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => printBill(o)}
                  className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-40"
                  title="Print bill"
                >
                  <Printer className="h-4 w-4" />
                </button>
              </>
            );
          }}
          footNote={loading ? 'Loading…' : 'CSV exports every order matching the filters above. Print on a row prints that bill receipt.'}
        />
      </div>
    </AdminLayout>
  );
}
