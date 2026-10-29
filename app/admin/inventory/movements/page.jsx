'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowDownUp, RotateCcw, SlidersHorizontal, Wrench } from 'lucide-react';
import AdminLayout from '@/components/admin/admin-layout';
import DataGrid, { StatusBadge } from '@/components/admin/data-grid.jsx';
import DateInput from '@/components/ui/date-input.jsx';
import useServerList from '@/lib/use-server-list.js';
import { useToast } from '@/components/ui/toast.jsx';
import { friendlyFromError } from '@/lib/friendly-message.js';
import { formatNepalDate, formatNepalTime } from '@/lib/time-utils.js';
import StockMovementDrawer from '@/components/inventory/stock-movement-drawer.jsx';

const TYPES = {
  manual_adjustment: 'Manual correction', purchase_receipt: 'Purchase receipt', wastage: 'Wastage',
  order_deduction: 'Sale consumption (−)', order_void: 'Cancel / void restore (+)', transfer: 'Transfer',
  opening_balance: 'Opening balance', manual_restock: 'Legacy purchase', adjustment: 'Legacy adjustment',
  stock_count: 'Stock count', correction: 'Correction',
};
const ADJUSTMENT_TYPES = new Set(['manual_adjustment', 'adjustment', 'stock_count', 'correction']);
const EMPTY_FILTERS = { from: '', to: '', change_type: '', date_basis: 'recorded', item_id: '' };
const CONTROL = 'h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-200';
const quantity = (value) => value == null ? '—' : Number(value).toLocaleString('en-IN', { maximumFractionDigits: 4 });

export default function MovementReport() {
  const pathname = usePathname();
  const base = pathname?.startsWith('/cashier') ? '/cashier' : '/admin';
  const { addToast } = useToast();
  const [view, setView] = useState('all');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [detailMovement, setDetailMovement] = useState(null);
  const requestFilters = useMemo(() => ({ ...filters, adjustments_only: view === 'adjustments' ? '1' : '' }), [filters, view]);
  const { rows, server, loading } = useServerList({
    url: '/api/admin/stock-movements', key: 'movements', filters: requestFilters,
    initialSort: { key: 'created_at', dir: 'desc' }, initialPageSize: 50,
    onError: (error) => addToast(friendlyFromError(error, 'load_failed')),
  });
  const change = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const reset = () => setFilters(EMPTY_FILTERS);

  const columns = useMemo(() => [
    { key: 'report_date', label: 'Report date', sortable: false, render: (row) => formatNepalDate(row.report_date) },
    { key: 'created_at', label: 'Recorded', render: (row) => formatNepalTime(row.created_at) },
    { key: 'item_name', label: 'Inventory item', className: 'font-medium text-gray-950', render: (row) => <Link href={`${base}/inventory/${row.inventory_item_id}`} onClick={(event) => event.stopPropagation()} className="hover:underline">{row.item_name || `Item ${row.inventory_item_id}`}</Link> },
    { key: 'change_type', label: 'Movement', render: (row) => <StatusBadge tone={ADJUSTMENT_TYPES.has(row.change_type) ? 'violet' : row.change_type === 'wastage' || row.change_type === 'order_deduction' ? 'red' : 'blue'}>{TYPES[row.change_type] || String(row.change_type || '').replace(/_/g, ' ')}</StatusBadge> },
    { key: 'balance_before', label: 'Before', align: 'right', numeric: true, render: (row) => quantity(row.balance_before) },
    { key: 'quantity_changed', label: 'Change', align: 'right', numeric: true, className: 'font-semibold', render: (row) => <span className={Number(row.quantity_changed) < 0 ? 'text-red-700' : 'text-emerald-700'}>{Number(row.quantity_changed) > 0 ? '+' : ''}{quantity(row.quantity_changed)}</span> },
    { key: 'balance_after', label: 'After', align: 'right', numeric: true, className: 'font-semibold text-gray-950', render: (row) => quantity(row.balance_after) },
    { key: 'unit', label: 'Unit', sortable: false, render: (row) => row.unit || '—' },
    { key: 'unit_cost', label: 'Unit cost', align: 'right', numeric: true, render: (row) => row.unit_cost == null ? '—' : `Rs ${Number(row.unit_cost).toFixed(2)}` },
    { key: 'movement_value', label: 'Value', align: 'right', numeric: true, sortable: false, value: (row) => Math.abs(Number(row.quantity_changed || 0) * Number(row.unit_cost || 0)), render: (row) => row.unit_cost == null ? '—' : `Rs ${Math.abs(Number(row.quantity_changed || 0) * Number(row.unit_cost || 0)).toFixed(2)}` },
    { key: 'reason', label: 'Reason', wrap: true, sortable: false, render: (row) => <span className="block min-w-[220px] whitespace-normal">{row.reason || '—'}</span> },
    { key: 'performed_by_name', label: 'Performed by', sortable: false, render: (row) => row.performed_by_name || (row.performed_by ? `User ${row.performed_by}` : 'Not recorded') },
    { key: 'reference_id', label: 'Source / reference', sortable: false, render: (row) => {
      if (!row.reference_id) return '—';
      if (['purchase_receipt', 'manual_restock'].includes(row.change_type)) return <Link href={`${base}/purchases?purchase=${row.reference_id}`} onClick={(event) => event.stopPropagation()} className="font-medium text-blue-700 hover:underline">{row.invoice_number || `Purchase #${row.reference_id}`}</Link>;
      if (['order_deduction', 'order_void'].includes(row.change_type)) return <Link href={`${base}/orders/${row.reference_id}`} onClick={(event) => event.stopPropagation()} className="font-medium text-blue-700 hover:underline">Order #{row.reference_id}</Link>;
      if (row.change_type === 'wastage') return <Link href={`${base}/wastage`} onClick={(event) => event.stopPropagation()} className="font-medium text-blue-700 hover:underline">Wastage #{row.reference_id}</Link>;
      return row.reference_id;
    } },
    { key: 'business_date', label: 'Business day', sortable: false, render: (row) => row.business_date ? formatNepalDate(row.business_date) : 'Not attributed' },
  ], [base]);

  return <AdminLayout>
    <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8"><div className="flex items-start gap-3"><span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700"><ArrowDownUp className="h-5 w-5" /></span><div><h1 className="text-2xl font-bold text-gray-950 sm:text-3xl">Stock movement report</h1><p className="mt-1 max-w-3xl text-sm text-gray-500">The complete inventory audit ledger: purchases, sales consumption, wastage, restorations, opening balances and manual stock-count corrections.</p><p className="mt-2 max-w-3xl text-xs text-gray-500"><span className="font-semibold text-red-700">Red (−)</span> sale consumption lowers on-hand. <span className="font-semibold text-emerald-700">Green (+)</span> with type “Cancel / void restore” puts stock back after a cancel, qty reduce, or void — it is not a purchase and not a flipped sale.</p></div></div></header>
    <main className="min-h-screen space-y-5 bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="inline-flex w-full rounded-xl border border-gray-200 bg-white p-1 sm:w-auto">
        <button type="button" onClick={() => setView('all')} className={`inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold sm:flex-none ${view === 'all' ? 'bg-gray-950 text-white' : 'text-gray-600 hover:bg-gray-50'}`}><ArrowDownUp className="h-4 w-4" /> All movements</button>
        <button type="button" onClick={() => { setView('adjustments'); change('change_type', ''); }} className={`inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold sm:flex-none ${view === 'adjustments' ? 'bg-violet-700 text-white' : 'text-gray-600 hover:bg-gray-50'}`}><Wrench className="h-4 w-4" /> Stock adjustments</button>
      </div>
      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-gray-400" /><h2 className="text-sm font-semibold text-gray-950">Report filters</h2></div><button type="button" onClick={reset} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-gray-600 hover:bg-gray-100"><RotateCcw className="h-3.5 w-3.5" /> Reset</button></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-xs font-semibold text-gray-600">From<DateInput value={filters.from} onChange={(value) => change('from', value)} className={`mt-1 ${CONTROL}`} /></label>
          <label className="text-xs font-semibold text-gray-600">To<DateInput value={filters.to} onChange={(value) => change('to', value)} className={`mt-1 ${CONTROL}`} /></label>
          <label className="text-xs font-semibold text-gray-600">Date basis<select value={filters.date_basis} onChange={(event) => change('date_basis', event.target.value)} className={`mt-1 ${CONTROL}`}><option value="recorded">Actual recorded date</option><option value="business">Business / report date</option></select></label>
          {view === 'all' ? <label className="text-xs font-semibold text-gray-600">Movement type<select value={filters.change_type} onChange={(event) => change('change_type', event.target.value)} className={`mt-1 ${CONTROL}`}><option value="">All movement types</option>{Object.entries(TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label> : <div className="rounded-lg border border-violet-100 bg-violet-50 px-3 py-2 text-xs leading-5 text-violet-800 lg:self-end">Includes manual corrections, stock counts and legacy adjustments.</div>}
          <label className="text-xs font-semibold text-gray-600">Inventory item ID<input type="number" min="1" value={filters.item_id} onChange={(event) => change('item_id', event.target.value)} placeholder="All items" className={`mt-1 ${CONTROL}`} /></label>
        </div>
      </section>
      <DataGrid title={view === 'adjustments' ? 'Stock adjustment history' : 'Complete stock movement history'} columns={columns} rows={rows} server={server} onRowClick={setDetailMovement} csvName={view === 'adjustments' ? 'stock-adjustments' : 'stock-movements'} searchPlaceholder="Search item, reason, actor or reference…" empty={loading ? 'Loading stock movements…' : view === 'adjustments' ? 'No stock adjustments match these filters.' : 'No stock movements match these filters.'} minTableWidth="min-w-[1600px]" maxHeight="max-h-[68vh]" footNote="Click a row for the complete audit detail. CSV and Print include every record matching the active filters. Use Rows below to show 25, 50, 100 or 200 records per page." />
    </main>
    {detailMovement && <StockMovementDrawer movement={detailMovement} onClose={() => setDetailMovement(null)} />}
  </AdminLayout>;
}
