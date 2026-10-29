'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import AdminLayout from '@/components/admin/admin-layout';
import {
  Calendar, RotateCcw, Search, GitCompareArrows,
} from 'lucide-react';
import { DataTable } from '@/components/admin/report-kit';
import { orderTypeLabel } from '@/lib/order-types.js';
import DateInput from '@/components/ui/date-input.jsx';
import BillInvoiceModal from '@/components/admin/bill-invoice-modal.jsx';
import PurchaseDrawer from '@/components/purchases/purchase-drawer';
import ExpenseDrawer from '@/components/expenses/expense-drawer.jsx';
import { formatCalendarDate, formatCalendarRangeLabel } from '@/lib/calendar-system.js';
import { useCalendarSystem } from '@/lib/calendar-context.jsx';
import { REPORT_CATALOG as TABS, REPORT_PERIODS as PERIODS } from '@/components/admin/report-catalog.jsx';

/**
 * Every report tab already has its own colour in the sidebar (admin-layout.jsx)
 * — that identity used to vanish the moment you opened the page, leaving 13
 * different reports rendered in the same undifferentiated gray. Reusing the
 * exact same colour per tab here (icon chip + a top accent on each table) is
 * the one signal that makes "which report am I in" legible at a glance,
 * without inventing a second colour language.
 */
// Menu category / master-category are no longer per-report filters — the
// dedicated Category Report answers that in full instead.
const ALL_FILTERS = ['businessDayId', 'employeeId', 'paymentMethod', 'orderType', 'search'];
const TAB_FILTERS = {
  sales: ALL_FILTERS,
  finance: ALL_FILTERS,
  expenses: ALL_FILTERS,
  purchases: ['businessDayId', 'employeeId', 'paymentMethod', 'search'],
  orders: ALL_FILTERS,
  menu: ALL_FILTERS,
  categories: ALL_FILTERS,
  customers: ALL_FILTERS,
  employees: ALL_FILTERS,
  tables: ALL_FILTERS,
  inventory: ['businessDayId', 'employeeId', 'search'],
  reservations: ['businessDayId', 'search'],
  suppliers: ['businessDayId', 'paymentMethod', 'search'],
  changes: ['businessDayId'],
};

const EMPTY_FILTERS = {
  businessDayId: '', employeeId: '',
  paymentMethod: '', orderType: '', search: '',
};

const controlClass = 'h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700';

// Keep the on-screen reports glanceable. The complete columns remain available
// in CSV exports and the row detail view.
const TABLE_COLUMNS = {
  'sales:transactions': ['created_at', 'bill_number', 'table_number', 'customer_name', 'payment', 'grand_total'],
  'finance:ledger': ['spent_on', 'description', 'category', 'supplier', 'payment_method', 'amount'],
  'expenses:ledger': ['spent_on', 'description', 'category', 'supplier', 'payment_method', 'amount'],
  'orders:orders': ['created_at', 'order_number', 'status', 'table_number', 'sitting_minutes', 'order_value'],
  'orders:cancelled-kots': ['printed_at', 'kot_number', 'order_number', 'quantity', 'issued_by_name', 'reason'],
  'orders:voided-bills': ['voided_at', 'bill_number', 'status', 'payment_method', 'reason', 'grand_total'],
  'menu:detail': ['name', 'category_name', 'quantity', 'revenue', 'profit', 'margin'],
  'categories:category-summary': ['category', 'master_category', 'quantity', 'revenue', 'profit', 'share'],
  'categories:master-category-summary': ['master_category', 'quantity', 'revenue', 'profit', 'share'],
  'inventory:inventory': ['item_name', 'quantity', 'unit', 'min_level', 'value', 'stock_status'],
  'customers:detail': ['name', 'phone', 'is_vip', 'orders', 'spending', 'last_visit'],
  'tables:table-performance': ['table_number', 'section', 'current_status', 'orders', 'revenue', 'avg_minutes'],
  'tables:served-orders': ['created_at', 'paid_at', 'table_number', 'order_number', 'sitting_minutes', 'grand_total'],
  'reservations:detail': ['date', 'time', 'name', 'party_size', 'status', 'table_number'],
  'suppliers:supplier-ledger': ['supplier', 'purchases', 'amount', 'share', 'stock_value', 'last_purchase'],
  'changes:cancelled-orders': ['cancelled_at', 'order_number', 'order_type', 'value', 'cancelled_by', 'reason'],
  'changes:item-changes': ['created_at', 'order_number', 'item', 'action', 'value_difference', 'reason'],
  'changes:voids-refunds': ['created_at', 'type', 'bill_number', 'original_amount', 'amount', 'reason'],
  'changes:bill-revisions': ['created_at', 'bill_number', 'status', 'original_total', 'new_total', 'reason'],
  'changes:discounted-bills': ['created_at', 'bill_number', 'order_type', 'gross', 'discount', 'net_items'],
  'purchases:purchases': ['invoice_date', 'recorded_at', 'invoice_number', 'supplier', 'status', 'payment_method', 'total'],
};

function tabFromSearchParams(searchParams) {
  const requested = searchParams.get('tab');
  return TABS.some((item) => item.id === requested) ? requested : 'sales';
}

/**
 * Refresh used to blank the body: tab always started as "sales", then a
 * useEffect flipped it to ?tab=… and kicked a second fetch. Whichever reply
 * landed last won — a late "sales" payload left data.tab !== tab, so
 * currentData stayed null, loading false, and main rendered nothing.
 * Reading the URL up front + aborting the previous fetch closes that race.
 */
function ReportsPageInner() {
  const { calendarSystem } = useCalendarSystem();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [tab, setTab] = useState(() => tabFromSearchParams(searchParams));
  const [periods, setPeriods] = useState(() => ({ [tabFromSearchParams(searchParams)]: searchParams.get('period') || 'today' }));
  const [customRanges, setCustomRanges] = useState(() => ({ [tabFromSearchParams(searchParams)]: { start: searchParams.get('startDate') || '', end: searchParams.get('endDate') || '' } }));
  const [filterSets, setFilterSets] = useState(() => ({ [tabFromSearchParams(searchParams)]: { ...EMPTY_FILTERS, ...Object.fromEntries(ALL_FILTERS.map((key) => [key, searchParams.get(key) || ''])) } }));
  const [searchDrafts, setSearchDrafts] = useState({});
  const [options, setOptions] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [invoiceBillId, setInvoiceBillId] = useState(null);
  const [purchaseDrawerId, setPurchaseDrawerId] = useState(null);
  const [expenseDrawer, setExpenseDrawer] = useState(null);
  const [tablePages, setTablePages] = useState({});
  const [tablePageSizes, setTablePageSizes] = useState({});


  const period = periods[tab] || 'today';
  const custom = customRanges[tab] || { start: '', end: '' };
  const filters = filterSets[tab] || EMPTY_FILTERS;
  const searchDraft = searchDrafts[tab] ?? filters.search ?? '';
  const supported = TAB_FILTERS[tab] || ALL_FILTERS;
  const activeTab = TABS.find((item) => item.id === tab) || TABS[0];
  const activeFilterCount = supported.filter((key) => Boolean(filters[key])).length;

  const setPeriod = (value) => {
    setPeriods((current) => ({ ...current, [tab]: value }));
    setFilterSets((current) => ({
      ...current,
      [tab]: { ...(current[tab] || EMPTY_FILTERS), businessDayId: '' },
    }));
    setTablePages((current) => ({ ...current, [tab]: {} }));
  };
  const setCustom = (next) => {
    setCustomRanges((current) => ({ ...current, [tab]: next }));
    setTablePages((current) => ({ ...current, [tab]: {} }));
  };
  const setFilter = (key, value) => {
    setFilterSets((current) => ({
      ...current,
      [tab]: { ...(current[tab] || EMPTY_FILTERS), [key]: value },
    }));
    setTablePages((current) => ({ ...current, [tab]: {} }));
  };
  const setSearchDraft = (value) => setSearchDrafts((current) => ({ ...current, [tab]: value }));
  const resetFilters = () => {
    setFilterSets((current) => ({ ...current, [tab]: { ...EMPTY_FILTERS } }));
    setSearchDrafts((current) => ({ ...current, [tab]: '' }));
    setTablePages((current) => ({ ...current, [tab]: {} }));
  };

  const query = useMemo(() => {
    const params = new URLSearchParams({ tab, period, withOptions: '1', calendarSystem });
    if (period === 'custom' && custom.start && custom.end) {
      params.set('startDate', custom.start);
      params.set('endDate', custom.end);
    }
    supported.forEach((key) => {
      if (filters[key]) params.set(key, filters[key]);
    });
    const tabPages = tablePages[tab];
    const tabSizes = tablePageSizes[tab];
    if (tabPages && Object.keys(tabPages).length) {
      params.set('table_pages', JSON.stringify(tabPages));
    }
    if (tabSizes && Object.keys(tabSizes).length) {
      params.set('table_page_sizes', JSON.stringify(tabSizes));
    }
    return params.toString();
  }, [tab, period, custom.start, custom.end, filters, supported, tablePages, tablePageSizes, calendarSystem]);

  const customMissing = period === 'custom' && (!custom.start || !custom.end);
  const load = useCallback(async (signal) => {
    if (customMissing) return;
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('pos_token');
      const response = await fetch(`/api/admin/reports?${query}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'The report could not be built.');
      setData(body);
      if (body.options) setOptions(body.options);
    } catch (loadError) {
      if (loadError?.name === 'AbortError') return;
      setError(loadError.message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [customMissing, query]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const currentData = data?.tab === tab ? data : null;
  const tables = useMemo(() => {
    if (!currentData) return [];
    return currentData.tables || (currentData.table ? [{ id: 'detail', ...currentData.table }] : []);
  }, [currentData]);
  const recordTables = tables;

  const setTablePage = useCallback((tableId, page) => {
    setTablePages((current) => ({
      ...current,
      [tab]: { ...(current[tab] || {}), [tableId]: page },
    }));
  }, [tab]);

  const setTablePageSize = useCallback((tableId, pageSize) => {
    setTablePageSizes((current) => ({
      ...current,
      [tab]: { ...(current[tab] || {}), [tableId]: pageSize },
    }));
    setTablePages((current) => ({
      ...current,
      [tab]: { ...(current[tab] || {}), [tableId]: 1 },
    }));
  }, [tab]);

  const fetchFullTable = useCallback(async (tableId) => {
    const token = localStorage.getItem('pos_token');
    const response = await fetch(`/api/admin/reports?${query}&export=1`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'The CSV could not be built.');
    const fullTables = body.tables || (body.table ? [{ id: 'detail', ...body.table }] : []);
    return (fullTables.find((item) => item.id === tableId) || fullTables[0])?.rows || [];
  }, [query]);

  const openExpenseDrawer = useCallback(async (expenseId, fallback = null) => {
    if (!expenseId) return;
    if (fallback) setExpenseDrawer({ ...fallback, id: expenseId });
    const token = localStorage.getItem('pos_token');
    const response = await fetch(`/api/admin/expenses?id=${encodeURIComponent(expenseId)}&status=all&page_size=1`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'The expense details could not be loaded.');
    if (body.expenses?.[0]) setExpenseDrawer(body.expenses[0]);
  }, []);

  const filtersBar = (
    <ReportFilters
      period={period}
      setPeriod={setPeriod}
      custom={custom}
      setCustom={setCustom}
      filters={filters}
      setFilter={setFilter}
      supported={supported}
      options={options}
      searchDraft={searchDraft}
      setSearchDraft={setSearchDraft}
      activeFilterCount={activeFilterCount}
      resetFilters={resetFilters}
    />
  );

  return (
    <AdminLayout>
      <header className={`border-b border-gray-200 border-t-4 bg-white px-4 py-5 sm:px-6 lg:px-8 ${activeTab.accent}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-start gap-3">
            <span className={`mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${activeTab.chip}`}>
              <activeTab.icon className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-2xl font-bold text-gray-950 sm:text-3xl">{activeTab.label}</h1>
              <p className="mt-1 text-sm text-gray-500">{activeTab.blurb}</p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
            <p className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
              <Calendar className="h-3.5 w-3.5" />
              {currentData?.range ? formatCalendarRangeLabel(currentData.range) : 'Select the reporting period below'}
            </p>
            <Link
              href={`${pathname.startsWith('/cashier') ? '/cashier' : '/admin'}/reports/compare?left=${tab}&period=${period}${period === 'custom' ? `&startDate=${encodeURIComponent(custom.start)}&endDate=${encodeURIComponent(custom.end)}` : ''}`}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-700 shadow-sm transition-[transform,background-color,border-color] duration-150 active:scale-[0.97] hover:border-gray-400 hover:bg-gray-50"
            >
              <GitCompareArrows className="h-4 w-4" />
              Compare report
            </Link>
          </div>
        </div>
      </header>

      <main className="min-h-screen space-y-5 bg-gray-50 p-4 sm:p-6 lg:p-8">
        {/* Period controls must stay visible even when the fetch race leaves no rows yet. */}
        {(!currentData || customMissing || !recordTables.length) && (
          <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">{filtersBar}</section>
        )}
        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error} <button type="button" onClick={() => load()} className="ml-2 font-semibold underline">Try again</button></div>}
        {loading && !currentData && !customMissing && <RecordsSkeleton />}

        {currentData && !customMissing && (
          <div className={`space-y-5 transition-opacity ${loading ? 'opacity-60' : ''}`}>
            {!recordTables.length ? (
              <EmptyMessage>No {activeTab.label.toLowerCase()} records match this period and these filters.</EmptyMessage>
            ) : null}

            {recordTables.map((table) => (
              <DataTable
                key={`${tab}-${table.id}`}
                title={table.title || `${activeTab.label} details`}
                accentClass={activeTab.accent}
                columns={table.columns}
                rows={table.rows || []}
                empty={table.empty || 'No records match this report.'}
                pagination={table.pagination}
                tableTotals={table.totals}
                paymentTotals={table.paymentTotals}
                pageLoading={loading}
                onPageChange={(page) => setTablePage(table.id, page)}
                onPageSizeChange={(pageSize) => setTablePageSize(table.id, pageSize)}
                onExportAll={() => fetchFullTable(table.id)}
                csvName={`${tab}-${table.id}-${currentData.range?.start || 'records'}`}
                visibleColumnKeys={TABLE_COLUMNS[`${tab}:${table.id}`]}
                onBillClick={(billId) => setInvoiceBillId(billId)}
                onEntityClick={(link) => {
                  if (link.type === 'bill') { setInvoiceBillId(link.id); return true; }
                  if (link.type === 'purchase') { setPurchaseDrawerId(link.id); return true; }
                  if (link.type === 'expense') { openExpenseDrawer(link.id).catch((drawerError) => setError(drawerError.message)); return true; }
                  return false;
                }}
                onRowClick={tab === 'purchases'
                  ? (row) => setPurchaseDrawerId(row._record_id || row.id)
                  : (tab === 'expenses' || (tab === 'finance' && table.id === 'ledger'))
                    ? (row) => openExpenseDrawer(row._record_id || row.id, row).catch((drawerError) => setError(drawerError.message))
                    : undefined}
                toolbar={filtersBar}
                detailContext={tab === 'purchases' ? null : { tab, tableId: table.id, range: currentData.range, filters }}
              />
            ))}
          </div>
        )}
      </main>
      {invoiceBillId && <BillInvoiceModal billId={invoiceBillId} onClose={() => setInvoiceBillId(null)} />}
      {purchaseDrawerId && (
        <PurchaseDrawer
          purchaseId={purchaseDrawerId}
          onClose={() => setPurchaseDrawerId(null)}
          onChanged={load}
        />
      )}
      {expenseDrawer && <ExpenseDrawer expense={expenseDrawer} category={String(expenseDrawer.category || 'Other').replace(/_/g, ' ')} onClose={() => setExpenseDrawer(null)} />}
    </AdminLayout>
  );
}

function ReportsRoute() {
  const params = useSearchParams();
  return <ReportsPageInner key={params.toString()} />;
}

export default function ReportsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gray-50 text-gray-500">
          Loading report…
        </div>
      }
    >
      <ReportsRoute />
    </Suspense>
  );
}

function ReportFilters({
  period, setPeriod, custom, setCustom, filters, setFilter, supported, options,
  searchDraft, setSearchDraft, activeFilterCount, resetFilters,
}) {
  const enabled = (key) => supported.includes(key);
  return <div className="space-y-4 p-4 sm:p-5">
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Period</p>
      <div className="flex flex-wrap gap-2">
        {PERIODS.map((item) => <button key={item.id} type="button" onClick={() => setPeriod(item.id)} className={`rounded-lg px-3 py-2 text-sm font-medium ${period === item.id ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>{item.label}</button>)}
        {period === 'custom' && <div className="flex flex-wrap items-center gap-2">
          <DateInput value={custom.start} onChange={(value) => setCustom({ ...custom, start: value })} className={controlClass} />
          <span className="text-sm text-gray-400">to</span>
          <DateInput value={custom.end} onChange={(value) => setCustom({ ...custom, end: value })} className={controlClass} />
        </div>}
      </div>
    </div>

    <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
      {enabled('businessDayId') && <select value={filters.businessDayId} onChange={(event) => setFilter('businessDayId', event.target.value)} className={controlClass}>
        <option value="">Calendar date range</option>
        {(options?.businessDays || []).map((day) => <option key={day.id} value={day.id}>Business Day {formatCalendarDate(day.business_date)} · {day.status}</option>)}
      </select>}
      {enabled('employeeId') && <select value={filters.employeeId} onChange={(event) => setFilter('employeeId', event.target.value)} className={controlClass}>
        <option value="">All employees</option>
        {(options?.employees || []).map((employee) => <option key={employee.id} value={employee.id}>{employee.name} · {employee.role}</option>)}
      </select>}
      {enabled('paymentMethod') && <select value={filters.paymentMethod} onChange={(event) => setFilter('paymentMethod', event.target.value)} className={controlClass}>
        <option value="">All payment methods</option>
        {(options?.paymentMethods || []).map((method) => {
          const value = typeof method === 'string' ? method : method.id;
          const label = typeof method === 'string' ? method : method.label;
          return <option key={value} value={value}>{label}</option>;
        })}
      </select>}
      {enabled('orderType') && <select value={filters.orderType} onChange={(event) => setFilter('orderType', event.target.value)} className={controlClass}>
        <option value="">All order types</option>
        {(options?.orderTypes || []).map((type) => <option key={type} value={type}>{orderTypeLabel(type)}</option>)}
      </select>}
      {enabled('search') && <form onSubmit={(event) => { event.preventDefault(); setFilter('search', searchDraft.trim()); }} className="relative min-w-[210px] flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input type="search" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} onBlur={() => setFilter('search', searchDraft.trim())} placeholder="Search these records…" className="h-10 w-full rounded-lg border border-gray-300 pl-9 pr-3 text-sm text-gray-900" />
      </form>}
      {activeFilterCount > 0 && <button type="button" onClick={resetFilters} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-600 hover:bg-gray-50"><RotateCcw className="h-3.5 w-3.5" />Clear {activeFilterCount}</button>}
    </div>
  </div>;
}

function EmptyMessage({ children }) {
  return <div className="rounded-2xl border border-gray-200 bg-white px-5 py-12 text-center text-sm text-gray-500">{children}</div>;
}

function RecordsSkeleton() {
  return <div className="space-y-5 animate-pulse"><div className="h-12 rounded-xl border border-gray-200 bg-white" /><div className="h-96 rounded-2xl border border-gray-200 bg-white" /></div>;
}
