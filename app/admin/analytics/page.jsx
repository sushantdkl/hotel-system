'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  AlertCircle, CalendarDays, ClipboardList, Download, PackageSearch, Plus,
  RefreshCw, UtensilsCrossed,
} from 'lucide-react';
import AdminLayout from '@/components/admin/admin-layout';
import { analyticsReportHref } from '@/lib/analytics-links';
import OverviewDashboard from '@/components/analytics/overview-dashboard';
import { formatNepalDateTime } from '@/lib/report-dates';
import { formatNepalDate } from '@/lib/time-utils.js';
import { orderTypeLabel } from '@/lib/order-types.js';
import DateInput from '@/components/ui/date-input.jsx';
import { formatCalendarRangeLabel } from '@/lib/calendar-system.js';
import { useCalendarSystem } from '@/lib/calendar-context.jsx';

const PERIODS = [
  ['today', 'Today'], ['yesterday', 'Yesterday'], ['last3', 'Last 3 Days'],
  ['last7', 'Last 7 Days'], ['last30', 'Last 30 Days'], ['this_week', 'This Week'],
  ['this_month', 'This Month'], ['last_month', 'Last Month'], ['custom', 'Custom Range'],
];

function todayNepal() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu' }).format(new Date());
}

export default function AnalyticsPage() {
  const { calendarSystem } = useCalendarSystem();
  const pathname = usePathname();
  const panelPrefix = pathname?.startsWith('/cashier') ? '/cashier' : '/admin';
  const [period, setPeriod] = useState('today');
  const [startDate, setStartDate] = useState(todayNepal());
  const [endDate, setEndDate] = useState(todayNepal());
  const [transactionPage, setTransactionPage] = useState(1);
  const [transactionPageSize, setTransactionPageSize] = useState(25);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        period,
        calendarSystem,
        transactionPage: String(transactionPage),
        transactionPageSize: String(transactionPageSize),
      });
      if (period === 'custom') {
        params.set('startDate', startDate);
        params.set('endDate', endDate);
      }
      const token = localStorage.getItem('pos_token');
      const response = await fetch(`/api/admin/analytics?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not load restaurant analytics.');
      setData(body);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [period, startDate, endDate, transactionPage, transactionPageSize, calendarSystem]);

  useEffect(() => { loadOverview(); }, [loadOverview]);

  const choosePeriod = (id) => {
    setPeriod(id);
    setTransactionPage(1);
  };

  const exportTransactions = async () => {
    if (!data) return;
    const params = new URLSearchParams({ period, export: 'transactions', calendarSystem });
    if (period === 'custom') {
      params.set('startDate', startDate);
      params.set('endDate', endDate);
    }
    const token = localStorage.getItem('pos_token');
    const response = await fetch(`/api/admin/analytics?${params}`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Could not export transactions.');
    downloadTransactionWorkbook(body.range || data.range, body.transactions?.rows || []);
  };

  return (
    <AdminLayout>
      <div className="min-h-screen bg-gray-50">
        <header className="border-b border-gray-200 bg-white">
          <div className="mx-auto max-w-[1680px] px-4 py-5 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-bold text-gray-950">Restaurant Analytics</h1>
                  <span className="inline-flex items-center rounded bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">LIVE</span>
                </div>
                <p className="mt-1 text-sm text-gray-500">Sales, collections, orders, kitchen performance, inventory and restaurant health for the selected period.</p>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                  <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" /> {data?.range ? formatCalendarRangeLabel(data.range) : 'Select a reporting period'}</span>
                  {data?.generatedAt && <span>Updated {formatNepalDateTime(data.generatedAt)} NPT</span>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href={`${panelPrefix}/pos`} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-gray-950 px-3 text-sm font-medium text-white active:scale-[0.98]"><Plus className="h-4 w-4" /> New Order</Link>
                <Link href={`${panelPrefix}/billing`} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 active:scale-[0.98]"><ClipboardList className="h-4 w-4" /> New Bill</Link>
                <Link href={`${panelPrefix}/leads`} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 active:scale-[0.98]"><UtensilsCrossed className="h-4 w-4" /> Reservations</Link>
                <Link href={analyticsReportHref('Table / bill duration', data?.range, panelPrefix)} className="inline-flex h-9 items-center rounded-md border border-gray-300 bg-white px-3 text-sm">Table / bill duration</Link>
                <Link href={`${panelPrefix}/inventory`} title="Inventory" className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-700 active:scale-[0.98]"><PackageSearch className="h-4 w-4" /></Link>
                <button type="button" onClick={exportTransactions} disabled={!data} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 active:scale-[0.98] disabled:opacity-40"><Download className="h-4 w-4" /> Export</button>
                <button type="button" onClick={loadOverview} title="Refresh analytics" className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-700 active:scale-[0.98]"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
              </div>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full min-w-0 max-w-[1680px] px-3 py-5 sm:px-6 lg:px-8">
          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-1.5">
              {PERIODS.map(([id, label]) => <button key={id} type="button" onClick={() => choosePeriod(id)} className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-[background-color,color,border-color,transform] duration-150 active:scale-[0.98] ${period === id ? 'bg-gray-950 text-white shadow-sm' : 'border border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'}`}>{label}</button>)}
            </div>
            {period === 'custom' && <div className="flex items-center gap-2"><DateInput value={startDate} max={endDate} onChange={(v) => { setStartDate(v); setTransactionPage(1); }} className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm" /><span className="text-xs text-gray-400">to</span><DateInput value={endDate} min={startDate} max={todayNepal()} onChange={(v) => { setEndDate(v); setTransactionPage(1); }} className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm" /></div>}
          </div>

          {error ? <ErrorState message={error} retry={loadOverview} /> : loading && !data ? <LoadingState /> : data ? (
          <OverviewDashboard
            data={data}
            panelPrefix={panelPrefix}
              transactionLoading={loading}
              onTransactionPageChange={setTransactionPage}
              onTransactionPageSizeChange={(size) => { setTransactionPageSize(size); setTransactionPage(1); }}
              onExportTransactions={exportTransactions}
            />
          ) : null}
        </main>
      </div>
    </AdminLayout>
  );
}

function LoadingState() {
  return <div className="space-y-5"><div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-24 animate-pulse rounded-lg bg-gray-200" />)}</div><div className="h-64 animate-pulse rounded-lg bg-gray-200" /></div>;
}

function ErrorState({ message, retry }) {
  return <div className="flex flex-col items-center rounded-lg border border-red-200 bg-red-50 px-5 py-16 text-center"><AlertCircle className="h-8 w-8 text-red-500" /><p className="mt-3 text-sm text-red-800">{message}</p><button type="button" onClick={retry} className="mt-4 rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white">Try again</button></div>;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function number(value) {
  return Number(value || 0);
}

function dateLabel(value) {
  if (!value) return '';
  // formatNepalDate, not `new Date(value)`: a bare SQLite timestamp parses as
  // browser-local, so the exported date differed from the screen — and differed
  // per viewer. Same rule the on-screen table uses.
  return formatNepalDate(value);
}

function downloadTransactionWorkbook(range, rows) {
  const totals = rows.reduce((sum, row) => ({
    subtotal: sum.subtotal + number(row.subtotal),
    discount: sum.discount + number(row.discount_amount),
    cash: sum.cash + number(row.cash_amount),
    qr: sum.qr + number(row.qr_amount),
    credit: sum.credit + number(row.credit_amount),
    food: sum.food + number(row.food_amount),
    beverage: sum.beverage + number(row.beverage_amount),
    tobacco: sum.tobacco + number(row.tobacco_amount),
    other: sum.other + number(row.other_amount),
    final: sum.final + number(row.final_total),
  }), { subtotal: 0, discount: 0, cash: 0, qr: 0, credit: 0, food: 0, beverage: 0, tobacco: 0, other: 0, final: 0 });
  const headers = ['Date', 'Bill', 'Order', 'Table / Channel', 'Customer', 'Cashier', 'Payment', 'Subtotal', 'Discount', 'Cash', 'Online', 'Credit', 'Food', 'Beverage', 'Tobacco', 'Other', 'Final Total'];
  const bodyRows = rows.map((row) => [
    dateLabel(row.created_at), row.bill_number, row.order_number, row.table_number ? `Table ${row.table_number}` : orderTypeLabel(row), row.customer_name || 'Walk-in',
    row.cashier, row.payment, row.subtotal, row.discount_amount, row.cash_amount, row.qr_amount, row.credit_amount,
    row.food_amount, row.beverage_amount, row.tobacco_amount, row.other_amount, row.final_total,
  ]);
  bodyRows.push(['', '', '', '', '', 'TOTAL', '', totals.subtotal, totals.discount, totals.cash, totals.qr, totals.credit, totals.food, totals.beverage, totals.tobacco, totals.other, totals.final]);
  const categoryRows = [
    ['Food', totals.food],
    ['Beverage', totals.beverage],
    ['Tobacco', totals.tobacco],
    ['Other', totals.other],
  ];
  const paymentRows = [
    ['Cash', totals.cash],
    ['Online', totals.qr],
    ['Credit', totals.credit],
    ['Total Received / Due', totals.cash + totals.qr + totals.credit],
  ];
  const title = 'Transaction Report';
  const dateRange = `${dateLabel(range?.start)} - ${dateLabel(range?.end)}`;
  const html = `<!doctype html><html><head><meta charset="utf-8" /></head><body>
    <table>
      <tr><td colspan="17" style="font-size:18px;font-weight:bold">${title}</td></tr>
      <tr><td style="font-weight:bold">Transaction Report</td><td>${escapeHtml(formatCalendarRangeLabel(range, 'Transaction report'))}</td></tr>
      <tr><td style="font-weight:bold">Date Range</td><td>${escapeHtml(dateRange)}</td></tr>
      <tr></tr>
      <tr>${headers.map((header) => `<th style="font-weight:bold;background:#eeeeee">${escapeHtml(header)}</th>`).join('')}</tr>
      ${bodyRows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}
      <tr></tr>
      <tr><td style="font-weight:bold">Master Category</td><td style="font-weight:bold">Amount</td></tr>
      ${categoryRows.map((row) => `<tr><td>${escapeHtml(row[0])}</td><td>${escapeHtml(row[1])}</td></tr>`).join('')}
      <tr></tr>
      <tr><td style="font-weight:bold">Payment Method</td><td style="font-weight:bold">Amount</td></tr>
      ${paymentRows.map((row) => `<tr><td>${escapeHtml(row[0])}</td><td>${escapeHtml(row[1])}</td></tr>`).join('')}
    </table>
  </body></html>`;
  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `transaction-report-${range?.start || 'export'}.xls`;
  link.click();
  URL.revokeObjectURL(url);
}
