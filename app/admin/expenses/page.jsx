'use client';

/**
 * Expenses, including the ones nobody typed.
 *
 * Purchases and wastage now generate their own expense rows (source_type +
 * source_id). The API returns 409 if you try to edit or delete one, so this
 * page never offers the action — it points at the record that owns the row
 * instead. That is the whole difference from the old page.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import AdminLayout from '@/components/admin/admin-layout';
import { Paperclip, Pencil, Plus, Trash2, Truck, Trash } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { friendlyFromError, friendlyMessage } from '@/lib/friendly-message';
import { apiJson, apiJsonRaw } from '@/lib/authed-fetch';
import DataGrid, { StatusBadge } from '@/components/admin/data-grid';
import useServerList from '@/lib/use-server-list';
import { KpiCards, ChartCard, ChartGrid, TrendChart, RankBars } from '@/components/admin/report-kit';
import { nepalDateString, resolvePeriodRange } from '@/lib/report-dates.js';
import { useCalendarSystem } from '@/lib/calendar-context.jsx';
import { formatCalendarDate } from '@/lib/calendar-system.js';
import LogExpenseModal, { EXPENSE_CATEGORIES } from '@/components/expenses/log-expense-modal';
import ExpenseDrawer from '@/components/expenses/expense-drawer.jsx';
import DateInput from '@/components/ui/date-input.jsx';
import { useCapabilities } from '@/lib/use-capabilities.js';

/** Categories the automation writes; they never appear in the manual picker. */
const GENERATED_CATEGORY_LABELS = {
  inventory_purchase: 'Inventory purchase',
  inventory_loss: 'Inventory loss',
};

const SOURCE_META = {
  purchase: { label: 'Purchase', href: '/admin/purchases', Icon: Truck },
  wastage: { label: 'Wastage', href: '/admin/wastage', Icon: Trash },
};

function categoryLabel(value, categories = EXPENSE_CATEGORIES) {
  const key = String(value ?? '').trim();
  if (!key || ['none', 'null', 'undefined'].includes(key.toLowerCase())) return 'Uncategorised';
  return (
    categories.find((c) => c.value === key || c.label === key)?.label ||
    GENERATED_CATEGORY_LABELS[key] ||
    key.replace(/_/g, ' ')
  );
}

function expensePaymentLabel(method) {
  const value = String(method || 'cash').toLowerCase();
  if (value === 'cash') return 'Cash';
  if (['credit', 'due', 'unpaid', 'payable'].includes(value)) return 'Credit';
  if (['owner_pocket', 'business_funding'].includes(value)) return 'Owner / Business Funding';
  return 'Online';
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const DATE_PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'quarter', label: 'Quarter to date' },
  { value: 'custom', label: 'Custom' },
  { value: 'all', label: 'All records' },
];

/*
 * Date presets resolve in the *Nepal* calendar, not the browser's.
 *
 * These used to be built from `new Date()` and getFullYear/getMonth/getDate,
 * which read the viewer's local clock. On a UTC host any time after 18:15 UTC
 * is already the next day in Nepal, so "Today" silently queried yesterday —
 * and an owner checking from abroad got a different day again. Month and
 * quarter boundaries drifted the same way.
 *
 * `shiftNepalDate` walks whole days from a Nepal date string, so no local
 * clock is ever consulted.
 */
const shiftNepalDate = (dateStr, days) => {
  const cursor = new Date(`${dateStr}T12:00:00+05:45`);
  cursor.setDate(cursor.getDate() + days);
  return nepalDateString(cursor);
};

function rangeFor(preset, calendarSystem) {
  const today = nepalDateString();

  if (preset === 'today') return { from: today, to: today };
  if (preset === 'last7') return { from: shiftNepalDate(today, -6), to: today };
  if (['this_month', 'last_month', 'quarter'].includes(preset)) {
    const range = resolvePeriodRange(preset, null, null, { calendarSystem });
    return { from: range.start, to: range.end };
  }
  return { from: '', to: '' };
}

export default function ExpensesPage() {
  const { calendarSystem } = useCalendarSystem();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isCashier = pathname?.startsWith('/cashier');
  const { can } = useCapabilities();
  const canCorrectPayment = can('expenses.payment_method_correct');
  const focusedExpenseId = Number(searchParams.get('expense')) || null;
  const { addToast } = useToast();
  const { confirm } = useConfirm();
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [originFilter, setOriginFilter] = useState('all');
  const [datePreset, setDatePreset] = useState(focusedExpenseId ? 'all' : 'today');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [modal, setModal] = useState(null); // { expense?, payroll? }
  const [detailsExpense, setDetailsExpense] = useState(null);
  const [managedCats, setManagedCats] = useState([]);

  const { from, to } = datePreset === 'custom' ? { from: customFrom, to: customTo } : rangeFor(datePreset, calendarSystem);
  const selectedPeriod = DATE_PRESETS.find((preset) => preset.value === datePreset)?.label || 'Selected range';
  const rangeLabel = !from || !to
    ? (datePreset === 'all' ? 'All recorded dates' : 'Choose both dates')
    : from === to
      ? formatCalendarDate(from)
      : `${formatCalendarDate(from)} – ${formatCalendarDate(to)}`;

  const filters = useMemo(
    () => ({ category: categoryFilter, origin: originFilter, from, to, id: focusedExpenseId }),
    [categoryFilter, originFilter, from, to, focusedExpenseId]
  );

  const {
    rows,
    extra,
    server,
    loading,
    reload: fetchExpenses,
  } = useServerList({
    url: '/api/admin/expenses',
    key: 'expenses',
    filters,
    initialSort: { key: 'purchase_date', dir: 'desc' },
    onError: (error) => addToast(friendlyFromError(error, 'load_failed')),
  });

  // Tiles and charts describe the whole filtered range and are aggregated in
  // SQL — totalling the fifty rows on screen would understate the spend.
  const summary = extra.summary;

  useEffect(() => {
    apiJson('/api/admin/expense-categories')
      .then((data) => setManagedCats(data.categories || []))
      .catch(() => setManagedCats([]));
  }, []);

  useEffect(() => {
    if (!focusedExpenseId || !rows.length) return;
    const expense = rows.find((row) => Number(row.id) === focusedExpenseId);
    if (expense) queueMicrotask(() => setDetailsExpense(expense));
  }, [focusedExpenseId, rows]);

  const manualCategoryOptions = useMemo(() => {
    const options = [...EXPENSE_CATEGORIES];
    for (const cat of managedCats) {
      const name = String(cat.name || '').trim();
      if (!name) continue;
      if (options.some((option) => option.value === name || option.label === name)) continue;
      options.push({ value: name, label: name });
    }
    return options;
  }, [managedCats]);

  const allCategoryOptions = useMemo(
    () => [
      ...manualCategoryOptions,
      ...Object.entries(GENERATED_CATEGORY_LABELS).map(([value, label]) => ({ value, label })),
    ],
    [manualCategoryOptions]
  );

  async function handleDelete(expense) {
    if (expense.source_type) return; // never offered, but belt and braces
    const confirmed = await confirm({
      title: `Delete "${expense.description}"?`,
      tone: 'delete',
    });
    if (!confirmed) return;
    const { ok, status, data } = await apiJsonRaw(`/api/admin/expenses?id=${expense.id}`, { method: 'DELETE' });
    if (ok) {
      addToast(friendlyMessage('delete_success'));
      fetchExpenses();
      return;
    }
    addToast(
      status === 409
        ? friendlyMessage('validation', { description: data.error })
        : friendlyFromError(data, 'delete_failed')
    );
  }

  const byCategory = useMemo(
    () => (summary?.byCategory || []).map((r) => ({ label: categoryLabel(r.category, allCategoryOptions), value: r.total })),
    [summary, allCategoryOptions]
  );

  const daily = useMemo(
    () => (summary?.daily || []).map((r) => ({ label: formatCalendarDate(r.date), sub: formatCalendarDate(r.date), value: r.total })),
    [summary]
  );

  const columns = useMemo(
    () => [
      {
        key: 'purchase_date',
        label: 'Date',
        value: (e) => e.purchase_date || e.expense_date || '',
        render: (e) => {
          const date = String(e.purchase_date || e.expense_date || '').slice(0, 10);
          return date ? formatCalendarDate(date) : '—';
        },
      },
      {
        key: 'description',
        label: 'Description',
        wrap: true,
        className: 'text-gray-900 font-medium',
        render: (e) => {
          const meta = SOURCE_META[e.source_type];
          return (
            <div className="min-w-[220px]">
              <p>{e.description}</p>
              {meta && (
                <Link href={meta.href} onClick={(event) => event.stopPropagation()} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-900 hover:underline">
                  <meta.Icon className="h-3 w-3" />
                  Generated from {meta.label} #{e.source_id}
                </Link>
              )}
            </div>
          );
        },
      },
      {
        key: 'category',
        label: 'Category',
        value: (e) => categoryLabel(e.category, allCategoryOptions),
        render: (e) => <StatusBadge tone={e.source_type ? 'blue' : 'gray'}>{categoryLabel(e.category, allCategoryOptions)}</StatusBadge>,
      },
      {
        key: 'amount',
        label: 'Amount',
        align: 'right',
        numeric: true,
        className: 'text-gray-900 font-medium',
        value: (e) => Number(e.amount || 0),
        render: (e) => `Rs ${Number(e.amount || 0).toFixed(2)}`,
      },
      {
        key: 'origin',
        label: 'Origin',
        value: (e) => (e.source_type ? 'Automatic' : 'Manual'),
        render: (e) =>
          e.source_type ? <StatusBadge tone="violet">Automatic</StatusBadge> : <StatusBadge tone="gray">Manual</StatusBadge>,
      },
      { key: 'payment_method', label: 'Method', render: (e) => <span>{expensePaymentLabel(e.payment_method)}</span> },
      { key: 'supplier', label: 'Paid to', render: (e) => e.supplier || <span className="text-gray-300">—</span> },
      { key: 'logged_by_name', label: 'Logged by', render: (e) => e.logged_by_name || <span className="text-gray-300">System</span> },
      {
        key: 'receipt_url',
        label: 'Receipt',
        sortable: false,
        render: (e) =>
          e.receipt_url ? (
            <a href={e.receipt_url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} className="text-gray-500 hover:text-gray-900" aria-label="Open receipt">
              <Paperclip className="h-4 w-4" />
            </a>
          ) : (
            <span className="text-gray-300">—</span>
          ),
      },
    ],
    [allCategoryOptions]
  );

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Expenses</h1>
            <p className="mt-1 text-sm text-gray-500 sm:text-base">
              What you spent — including the purchases and wastage that book themselves.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!isCashier && (
              <button type="button" onClick={() => setModal({ payroll: true })} className="inline-flex items-center gap-1.5 rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                <Plus className="h-4 w-4" /> Salary
              </button>
            )}
            <button type="button" onClick={() => setModal({})} className="inline-flex items-center gap-1.5 rounded-xl bg-gray-900 px-3.5 py-2.5 text-sm font-semibold text-white hover:bg-gray-800">
              <Plus className="h-4 w-4" /> Log expense
            </button>
          </div>
        </div>
      </header>

      <div className="space-y-5 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="flex flex-wrap gap-2" aria-label="Expense reporting period">
          {DATE_PRESETS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              aria-pressed={datePreset === preset.value}
              onClick={() => setDatePreset(preset.value)}
              className={`h-9 rounded-lg px-3 text-sm font-medium ${
                datePreset === preset.value ? 'bg-gray-900 text-white' : 'border border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {preset.label}
            </button>
          ))}
          {datePreset === 'custom' && (
            <>
              <DateInput value={customFrom} onChange={setCustomFrom} className="h-9 rounded-lg border border-gray-300 px-2 text-sm" aria-label="From" />
              <DateInput value={customTo} onChange={setCustomTo} className="h-9 rounded-lg border border-gray-300 px-2 text-sm" aria-label="To" />
            </>
          )}
        </div>

        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950" role="status">
          <span className="font-semibold">Viewing {selectedPeriod}</span>
          <span className="mx-2 text-blue-300">•</span>
          <span>{rangeLabel}</span>
          <p className="mt-1 text-xs text-blue-700">Totals, charts, the ledger, CSV and Print all use this complete period.</p>
        </div>

        <KpiCards
          kpis={[
            { key: 'total', label: 'Total spend', value: summary?.total || 0, format: 'currency', sub: `${plural(summary?.entries || 0, 'entry', 'entries')} · ${rangeLabel}` },
            { key: 'purchases', label: 'Inventory purchases', value: summary?.purchases || 0, format: 'currency', sub: 'Booked by deliveries' },
            { key: 'loss', label: 'Inventory loss', value: summary?.losses || 0, format: 'currency', sub: 'Booked by wastage' },
            { key: 'operating', label: 'Operating expenses', value: summary?.operating || 0, format: 'currency', sub: 'Entered by hand' },
          ]}
        />

        <ChartGrid>
          <ChartCard title="Spend over the range" isEmpty={!daily.length} empty="No expenses fall in this date range yet.">
            <TrendChart data={daily} color="slate" format="currency" />
          </ChartCard>
          <ChartCard title="Where the money went" isEmpty={!byCategory.length} empty="Nothing to break down in this range.">
            <RankBars data={byCategory} color="slate" format="currency" limit={10} />
          </ChartCard>
        </ChartGrid>

        <DataGrid
          title="Expense ledger"
          columns={columns}
          rows={rows}
          server={server}
          csvName="expenses"
          searchPlaceholder="Search description, supplier…"
          empty={loading ? 'Loading expenses…' : 'No expenses in this range. Change the dates, or log one.'}
          footNote="Rows marked Automatic belong to a purchase or a wastage entry — open that record to change them. CSV and Print cover every row in the range, not just this page."
          rowClassName={(row) => Number(row.id) === focusedExpenseId ? 'bg-blue-50/70 ring-1 ring-inset ring-blue-200' : ''}
          onRowClick={setDetailsExpense}
          toolbar={
            <>
              <select value={originFilter} onChange={(e) => setOriginFilter(e.target.value)} className={SELECT}>
                <option value="all">All origins</option>
                <option value="manual">Manual only</option>
                <option value="purchase">From purchases</option>
                <option value="wastage">From wastage</option>
              </select>
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className={SELECT}>
                <option value="all">All categories</option>
                {manualCategoryOptions.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
                {Object.entries(GENERATED_CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </>
          }
          renderActions={(e) => {
            const meta = SOURCE_META[e.source_type];
            if (isCashier) return null;
            if (meta) {
              return (
                <Link
                  href={meta.href}
                  title={`Edit this on the ${meta.label.toLowerCase()} it came from`}
                  className="whitespace-nowrap rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                >
                  Open {meta.label.toLowerCase()}
                </Link>
              );
            }
            return (
              <>
                <button type="button" title={e.business_day_status === 'closed' ? 'Correct closed expense' : 'Edit expense'} aria-label={e.business_day_status === 'closed' ? 'Correct closed expense' : 'Edit expense'} onClick={() => setModal({ expense: e, payroll: e.category === 'salaries' })} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-900">
                  <Pencil className="h-4 w-4" />
                </button>
                {e.business_day_status !== 'closed' ? <button type="button" title="Delete expense" aria-label="Delete expense" onClick={() => handleDelete(e)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-red-600">
                  <Trash2 className="h-4 w-4" />
                </button> : null}
              </>
            );
          }}
        />
      </div>

      {modal && (
        <LogExpenseModal
          editingExpense={modal.expense || null}
          payrollMode={Boolean(modal.payroll)}
          onClose={() => setModal(null)}
          onSaved={fetchExpenses}
        />
      )}
      {detailsExpense && (
        <ExpenseDrawer
          expense={detailsExpense}
          category={categoryLabel(detailsExpense.category, allCategoryOptions)}
          onClose={() => setDetailsExpense(null)}
          onEdit={!isCashier && !detailsExpense.source_type ? (expense) => { setDetailsExpense(null); setModal({ expense, payroll: expense.category === 'salaries' }); } : null}
          onChanged={fetchExpenses}
          canCorrectPayment={canCorrectPayment}
        />
      )}
    </AdminLayout>
  );
}

const SELECT = 'h-10 rounded-lg border border-gray-300 px-3 text-sm text-gray-700';
