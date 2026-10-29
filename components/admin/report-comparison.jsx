'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, ArrowRightLeft, CalendarDays, ChevronDown, ChevronRight, GitCompareArrows,
  Maximize2, Minimize2, Search, SlidersHorizontal,
} from 'lucide-react';
import AdminLayout from '@/components/admin/admin-layout';
import DateInput from '@/components/ui/date-input.jsx';
import { DataTable } from '@/components/admin/report-kit.jsx';
import BillInvoiceModal from '@/components/admin/bill-invoice-modal.jsx';
import PurchaseDrawer from '@/components/purchases/purchase-drawer.jsx';
import ExpenseDrawer from '@/components/expenses/expense-drawer.jsx';
import { REPORT_CATALOG, REPORT_PERIODS, reportMeta } from '@/components/admin/report-catalog.jsx';
import { formatCalendarRangeLabel } from '@/lib/calendar-system.js';
import { useCalendarSystem } from '@/lib/calendar-context.jsx';
import { orderTypeLabel } from '@/lib/order-types.js';
import { comparisonTables } from '@/lib/report-shape.js';

const CASHIER_REPORTS = new Set(['sales', 'orders', 'changes', 'menu', 'categories', 'inventory', 'tables', 'reservations']);
const EMPTY_FILTERS = { employeeId: '', paymentMethod: '', orderType: '', search: '' };
const controlClass = 'h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200';

function validReport(value, fallback) {
  return REPORT_CATALOG.some((report) => report.id === value) ? value : fallback;
}

function useReportData({ report, period, custom, filters, withOptions, tablePages, tablePageSizes, revision }) {
  const { calendarSystem } = useCalendarSystem();
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const query = useMemo(() => {
    const params = new URLSearchParams({ tab: report, period, detail_limit: '8', calendarSystem });
    if (withOptions) params.set('withOptions', '1');
    if (period === 'custom' && custom.start && custom.end) {
      params.set('startDate', custom.start);
      params.set('endDate', custom.end);
    }
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    if (Object.keys(tablePages).length) params.set('table_pages', JSON.stringify(tablePages));
    if (Object.keys(tablePageSizes).length) params.set('table_page_sizes', JSON.stringify(tablePageSizes));
    return params.toString();
  }, [calendarSystem, custom.end, custom.start, filters, period, report, tablePageSizes, tablePages, withOptions]);

  useEffect(() => {
    if (period === 'custom' && (!custom.start || !custom.end)) {
      setState((current) => ({ ...current, loading: false }));
      return undefined;
    }
    const controller = new AbortController();
    setState((current) => ({ ...current, error: null, loading: true }));
    (async () => {
      try {
        const token = localStorage.getItem('pos_token');
        const response = await fetch(`/api/admin/reports?${query}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'This report could not be loaded.');
        setState({ data: body, error: null, loading: false });
      } catch (error) {
        if (error?.name !== 'AbortError') setState((current) => ({ ...current, error: error.message, loading: false }));
      }
    })();
    return () => controller.abort();
  }, [custom.end, custom.start, period, query, revision]);

  const fetchFullTable = async (tableId) => {
    const token = localStorage.getItem('pos_token');
    const response = await fetch(`/api/admin/reports?${query}&export=1`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'The CSV could not be built.');
    const tables = body.tables || (body.table ? [{ id: 'detail', ...body.table }] : []);
    return (tables.find((table) => table.id === tableId) || tables[0])?.rows || [];
  };

  return { ...state, fetchFullTable };
}

export default function ReportComparison() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const isCashier = pathname.startsWith('/cashier');
  const routeBase = isCashier ? '/cashier/reports' : '/admin/reports';
  const initialLeft = validReport(searchParams.get('left'), 'sales');
  const initialRight = validReport(searchParams.get('right'), initialLeft === 'expenses' ? 'sales' : 'expenses');
  const initialPeriod = REPORT_PERIODS.some((item) => item.id === searchParams.get('period')) ? searchParams.get('period') : 'month';
  const [capabilities, setCapabilities] = useState(null);

  const availableReports = useMemo(
    () => REPORT_CATALOG.filter((report) => !isCashier || (capabilities
      ? capabilities[`report.${report.id}.view`] === true
      : CASHIER_REPORTS.has(report.id))),
    [capabilities, isCashier]
  );
  const [leftReport, setLeftReport] = useState(initialLeft);
  const [rightReport, setRightReport] = useState(() => {
    return initialRight === initialLeft ? (isCashier ? 'orders' : 'expenses') : initialRight;
  });
  const [sharedPeriod, setSharedPeriod] = useState(initialPeriod);
  const [sidePeriods, setSidePeriods] = useState({ left: initialPeriod, right: initialPeriod === 'last_month' ? 'month' : 'last_month' });
  const [customRanges, setCustomRanges] = useState({
    shared: { start: searchParams.get('startDate') || '', end: searchParams.get('endDate') || '' },
    left: { start: '', end: '' }, right: { start: '', end: '' },
  });
  const [independent, setIndependent] = useState(false);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [searchDraft, setSearchDraft] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [mobileSide, setMobileSide] = useState('left');
  const [tablePages, setTablePages] = useState({ left: {}, right: {} });
  const [tablePageSizes, setTablePageSizes] = useState({ left: {}, right: {} });
  const [invoiceBillId, setInvoiceBillId] = useState(null);
  const [purchaseDrawerId, setPurchaseDrawerId] = useState(null);
  const [expenseDrawer, setExpenseDrawer] = useState(null);
  const [dataRevision, setDataRevision] = useState(0);

  useEffect(() => {
    if (!isCashier) return;
    const token = localStorage.getItem('pos_token');
    fetch('/api/auth/capabilities', { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => response.ok ? response.json() : null)
      .then((body) => {
        const next = body?.capabilities || {};
        const ids = REPORT_CATALOG.filter((report) => next[`report.${report.id}.view`] === true).map((report) => report.id);
        setCapabilities(next);
        if (!ids.length) return;
        setLeftReport((current) => ids.includes(current) ? current : ids[0]);
        setRightReport((current) => ids.includes(current) ? current : (ids.find((id) => id !== ids[0]) || ids[0]));
      })
      .catch(() => setCapabilities({}));
  }, [isCashier]);

  const leftPeriod = independent ? sidePeriods.left : sharedPeriod;
  const rightPeriod = independent ? sidePeriods.right : sharedPeriod;
  const leftCustom = independent ? customRanges.left : customRanges.shared;
  const rightCustom = independent ? customRanges.right : customRanges.shared;
  const left = useReportData({ report: leftReport, period: leftPeriod, custom: leftCustom, filters, withOptions: true, tablePages: tablePages.left, tablePageSizes: tablePageSizes.left, revision: dataRevision });
  const right = useReportData({ report: rightReport, period: rightPeriod, custom: rightCustom, filters, withOptions: false, tablePages: tablePages.right, tablePageSizes: tablePageSizes.right, revision: dataRevision });
  const leftData = left.data?.tab === leftReport ? left.data : null;
  const options = leftData?.options;

  const swap = () => {
    setLeftReport(rightReport);
    setRightReport(leftReport);
    if (independent) setSidePeriods(({ left: oldLeft, right: oldRight }) => ({ left: oldRight, right: oldLeft }));
    if (independent) setCustomRanges((ranges) => ({ ...ranges, left: ranges.right, right: ranges.left }));
    setMobileSide((side) => side === 'left' ? 'right' : 'left');
    setTablePages(({ left: oldLeft, right: oldRight }) => ({ left: oldRight, right: oldLeft }));
    setTablePageSizes(({ left: oldLeft, right: oldRight }) => ({ left: oldRight, right: oldLeft }));
  };

  const selectReport = (side, report) => {
    if (side === 'left') setLeftReport(report);
    else setRightReport(report);
    setTablePages((current) => ({ ...current, [side]: {} }));
    setTablePageSizes((current) => ({ ...current, [side]: {} }));
  };

  const setTablePage = (side, tableId, page) => setTablePages((current) => ({
    ...current, [side]: { ...current[side], [tableId]: page },
  }));
  const setTablePageSize = (side, tableId, pageSize) => {
    setTablePageSizes((current) => ({ ...current, [side]: { ...current[side], [tableId]: pageSize } }));
    setTablePages((current) => ({ ...current, [side]: { ...current[side], [tableId]: 1 } }));
  };

  const openExpenseDrawer = async (expenseId, fallback = null) => {
    if (!expenseId) return;
    if (fallback) setExpenseDrawer({ ...fallback, id: expenseId });
    const token = localStorage.getItem('pos_token');
    const response = await fetch(`/api/admin/expenses?id=${encodeURIComponent(expenseId)}&status=all&page_size=1`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'The expense details could not be loaded.');
    if (body.expenses?.[0]) setExpenseDrawer(body.expenses[0]);
  };

  const periodControl = (side) => {
    const value = independent ? sidePeriods[side] : sharedPeriod;
    const rangeKey = independent ? side : 'shared';
    const setValue = (next) => independent
      ? setSidePeriods((current) => ({ ...current, [side]: next }))
      : setSharedPeriod(next);
    return (
      <div className="w-full min-w-0 flex-1 sm:w-auto sm:min-w-[10rem]">
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">{independent ? `${side === 'left' ? 'Report A' : 'Report B'} period` : 'Period · Both reports'}</label>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
        <select aria-label={`${side} reporting period`} value={value} onChange={(event) => setValue(event.target.value)} className={`${controlClass} min-w-0 flex-1 sm:flex-none`}>
          {REPORT_PERIODS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        {value === 'custom' && (
          <>
            <DateInput value={customRanges[rangeKey].start} onChange={(start) => setCustomRanges((current) => ({ ...current, [rangeKey]: { ...current[rangeKey], start } }))} className={controlClass} />
            <span className="text-sm text-gray-400">to</span>
            <DateInput value={customRanges[rangeKey].end} onChange={(end) => setCustomRanges((current) => ({ ...current, [rangeKey]: { ...current[rangeKey], end } }))} className={controlClass} />
          </>
        )}
        </div>
      </div>
    );
  };

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700">
              <GitCompareArrows className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">Compare Reports</h1>
              <p className="mt-1 text-sm text-gray-500">Two focused views, one set of filters, and the useful difference between them.</p>
            </div>
          </div>
          <Link href={`${routeBase}?tab=${leftReport}`} className="inline-flex h-10 items-center gap-2 self-start rounded-lg border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-700 shadow-sm transition-transform duration-150 active:scale-[0.97]">
            <ArrowLeft className="h-4 w-4" /> Back to {reportMeta(leftReport).shortLabel}
          </Link>
        </div>
      </header>

      <main className="min-h-screen space-y-5 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <section className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm sm:p-4">
          <div className="flex flex-col gap-3">
              <div className="grid items-end gap-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                <ReportSelector side="left" label="Report A · Left side" report={leftReport} otherReport={rightReport} reports={availableReports} onChange={(report) => selectReport('left', report)} />
                <button type="button" onClick={swap} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-gray-950 px-3 text-sm font-semibold text-white shadow-sm transition-transform duration-150 active:scale-[0.97]" title="Swap Report A and Report B">
                  <ArrowRightLeft className="h-4 w-4" /> <span className="md:hidden xl:inline">Swap sides</span>
                </button>
                <ReportSelector side="right" label="Report B · Right side" report={rightReport} otherReport={leftReport} reports={availableReports} onChange={(report) => selectReport('right', report)} />
              </div>

            <div className="flex min-w-0 flex-wrap items-end gap-2 border-t border-gray-100 pt-3">
              <CalendarDays className="mb-3 hidden h-4 w-4 shrink-0 text-gray-400 sm:block" />
              <div className={`contents`}>
                {periodControl('left')}
                {independent && periodControl('right')}
              </div>
              <label className="inline-flex h-10 w-full cursor-pointer items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 sm:w-auto sm:shrink-0">
                <input type="checkbox" checked={independent} onChange={(event) => setIndependent(event.target.checked)} className="h-4 w-4 rounded border-gray-300 accent-indigo-600" />
                Different periods
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
              <SlidersHorizontal className="hidden h-4 w-4 text-gray-400 sm:block" />
              <select aria-label="Employee filter" value={filters.employeeId} onChange={(event) => setFilters((current) => ({ ...current, employeeId: event.target.value }))} className={`${controlClass} min-w-0 flex-1`}>
                <option value="">All employees</option>
                {(options?.employees || []).map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
              </select>
              <select aria-label="Payment method filter" value={filters.paymentMethod} onChange={(event) => setFilters((current) => ({ ...current, paymentMethod: event.target.value }))} className={`${controlClass} min-w-0 flex-1`}>
                <option value="">All payment methods</option>
                {(options?.paymentMethods || []).map((method) => {
                  const value = typeof method === 'string' ? method : method.id;
                  const label = typeof method === 'string' ? method : method.label;
                  return <option key={value} value={value}>{label}</option>;
                })}
              </select>
              <select aria-label="Order type filter" value={filters.orderType} onChange={(event) => setFilters((current) => ({ ...current, orderType: event.target.value }))} className={`${controlClass} min-w-0 flex-1`}>
                <option value="">All order types</option>
                {(options?.orderTypes || []).map((type) => <option key={type} value={type}>{orderTypeLabel(type)}</option>)}
              </select>
              <form onSubmit={(event) => { event.preventDefault(); setFilters((current) => ({ ...current, search: searchDraft.trim() })); }} className="relative w-full min-w-0 flex-1 sm:min-w-[210px]">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} onBlur={() => setFilters((current) => ({ ...current, search: searchDraft.trim() }))} type="search" placeholder="Search both reports…" className={`${controlClass} w-full pl-9`} />
              </form>
            </div>
          </div>
        </section>

        <div className="flex rounded-xl border border-gray-200 bg-white p-1 lg:hidden" role="tablist" aria-label="Compared reports">
          {['left', 'right'].map((side) => {
            const id = side === 'left' ? leftReport : rightReport;
            return <button key={side} type="button" role="tab" aria-selected={mobileSide === side} onClick={() => setMobileSide(side)} className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-[transform,background-color,color] duration-150 active:scale-[0.97] ${mobileSide === side ? 'bg-gray-900 text-white' : 'text-gray-600'}`}>{reportMeta(id).shortLabel}</button>;
          })}
        </div>

        <div className={`grid items-start gap-5 ${expanded ? 'grid-cols-1' : 'lg:grid-cols-2'}`}>
          <div className={`${expanded === 'right' ? 'hidden' : ''} ${mobileSide !== 'left' ? 'hidden lg:block' : ''} order-1`}>
            <ReportPanel side="left" report={leftReport} state={left} routeBase={routeBase} filters={filters} expanded={expanded === 'left'} onExpand={() => setExpanded((value) => value === 'left' ? null : 'left')} onPageChange={(tableId, page) => setTablePage('left', tableId, page)} onPageSizeChange={(tableId, pageSize) => setTablePageSize('left', tableId, pageSize)} onBillClick={setInvoiceBillId} onPurchaseClick={setPurchaseDrawerId} onExpenseClick={openExpenseDrawer} />
          </div>

          <div className={`${expanded === 'left' ? 'hidden' : ''} ${mobileSide !== 'right' ? 'hidden lg:block' : ''} order-2`}>
            <ReportPanel side="right" report={rightReport} state={right} routeBase={routeBase} filters={filters} expanded={expanded === 'right'} onExpand={() => setExpanded((value) => value === 'right' ? null : 'right')} onPageChange={(tableId, page) => setTablePage('right', tableId, page)} onPageSizeChange={(tableId, pageSize) => setTablePageSize('right', tableId, pageSize)} onBillClick={setInvoiceBillId} onPurchaseClick={setPurchaseDrawerId} onExpenseClick={openExpenseDrawer} />
          </div>
        </div>
      </main>
      {invoiceBillId && <BillInvoiceModal billId={invoiceBillId} onClose={() => setInvoiceBillId(null)} />}
      {purchaseDrawerId && <PurchaseDrawer purchaseId={purchaseDrawerId} onClose={() => setPurchaseDrawerId(null)} onChanged={() => setDataRevision((value) => value + 1)} />}
      {expenseDrawer && <ExpenseDrawer expense={expenseDrawer} category={String(expenseDrawer.category || 'Other').replace(/_/g, ' ')} onClose={() => setExpenseDrawer(null)} />}
    </AdminLayout>
  );
}

function ReportSelector({ side, label, report, otherReport, reports, onChange }) {
  const meta = reportMeta(report);
  return (
    <label htmlFor={`${side}-report`} className="group block min-w-0">
      <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-indigo-600">{label}</span>
      <span className="flex min-w-0 items-center gap-2">
        <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${meta.chip}`}><meta.icon className="h-4 w-4" /></span>
        <span className="relative min-w-0 flex-1">
          <select id={`${side}-report`} value={report} onChange={(event) => onChange(event.target.value)} className="h-10 w-full cursor-pointer appearance-none rounded-lg border border-gray-300 bg-white pl-3 pr-9 text-sm font-bold text-gray-950 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100">
            {reports.map((item) => <option key={item.id} value={item.id} disabled={item.id === otherReport}>{item.label}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
        </span>
      </span>
    </label>
  );
}

function ReportPanel({ side, report, state, routeBase, filters, expanded, onExpand, onPageChange, onPageSizeChange, onBillClick, onPurchaseClick, onExpenseClick }) {
  const meta = reportMeta(report);
  const data = state.data?.tab === report ? state.data : null;
  const tables = comparisonTables(data);
  return (
    <article className={`rounded-2xl border border-t-4 border-gray-200 bg-white shadow-sm ${meta.accent}`}>
      <div className="border-b border-gray-100 p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${meta.chip}`}><meta.icon className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{side === 'left' ? 'Report A' : 'Report B'}</p>
            <h2 className="mt-0.5 truncate text-base font-bold text-gray-950">{meta.label}</h2>
          </div>
          <button type="button" onClick={onExpand} aria-label={expanded ? 'Restore split view' : `Expand ${meta.label}`} title={expanded ? 'Restore split view' : 'Expand report'} className="hidden h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition-[transform,background-color] duration-150 active:scale-[0.97] hover:bg-gray-100 lg:inline-flex">
            {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
        <p className="mt-3 text-xs text-gray-500">{data?.range ? formatCalendarRangeLabel(data.range) : meta.blurb}</p>
      </div>

      <div className="space-y-5 p-4 sm:p-5">
        {state.error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{state.error}</div>}
        {state.loading && !data && <PanelSkeleton />}
        {data && (
          <>
            <div className="space-y-5">
              {tables.map((table) => (
                <DataTable
                  key={`${report}-${table.id}`}
                  title={table.title || `${meta.label} details`}
                  accentClass={meta.accent}
                  columns={table.columns || []}
                  rows={table.rows || []}
                  empty={table.empty || 'No records match this report.'}
                  pagination={table.pagination}
                  tableTotals={table.totals}
                  paymentTotals={table.paymentTotals}
                  pageLoading={state.loading}
                  onPageChange={(page) => onPageChange(table.id, page)}
                  onPageSizeChange={(pageSize) => onPageSizeChange(table.id, pageSize)}
                  onExportAll={() => state.fetchFullTable(table.id)}
                  csvName={`comparison-${report}-${table.id}-${data.range?.start || 'records'}`}
                  onBillClick={onBillClick}
                  onEntityClick={(link) => {
                    if (link.type === 'bill') { onBillClick(link.id); return true; }
                    if (link.type === 'purchase') { onPurchaseClick(link.id); return true; }
                    if (link.type === 'expense') { onExpenseClick(link.id).catch(() => {}); return true; }
                    return false;
                  }}
                  onRowClick={report === 'purchases'
                    ? (row) => onPurchaseClick(row._record_id || row.id)
                    : (report === 'expenses' || (report === 'finance' && table.id === 'ledger'))
                      ? (row) => onExpenseClick(row._record_id || row.id, row).catch(() => {})
                      : undefined}
                  detailContext={['purchases', 'expenses'].includes(report) || (report === 'finance' && table.id === 'ledger') ? null : { tab: report, tableId: table.id, range: data.range, filters }}
                />
              ))}
            </div>
            <Link href={`${routeBase}?tab=${report}`} className="inline-flex items-center gap-1 text-sm font-semibold text-gray-700 hover:text-gray-950">Open full {meta.shortLabel} report <ChevronRight className="h-4 w-4" /></Link>
          </>
        )}
      </div>
    </article>
  );
}

function PanelSkeleton() {
  return <div className="animate-pulse space-y-3"><div className="h-10 rounded-lg bg-gray-100" /><div className="h-80 rounded-xl bg-gray-100" /></div>;
}
