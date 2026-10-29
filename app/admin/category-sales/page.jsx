'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import { AlertTriangle, Printer, RefreshCw, Wine } from 'lucide-react';
import { apiJson } from '@/lib/authed-fetch';
import { nepalDateString } from '@/lib/report-dates';
import DateInput from '@/components/ui/date-input.jsx';
import { useCalendarSystem } from '@/lib/calendar-context.jsx';
import { formatCurrency } from '@/lib/currency';
import { loadPrintSettings, printThermalItems } from '@/lib/print-report.js';

const PERIODS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['this_week', 'This Week'], ['this_month', 'This Month']];
// Per-device convenience: the categories last picked here (e.g. a "liquor" set) come back next time.
const SAVED_KEY = 'category-sales:categories';
const qty = (n) => Number((Number(n) || 0).toFixed(2)).toLocaleString('en-IN');
/** Stock in the unit people count in: bottles when the item has a purchase unit, else its own unit. */
const inCountUnit = (row, v) => (row.purchase_unit ? `${qty(v / row.factor)} ${row.purchase_unit}` : `${qty(v)} ${row.unit}`.trim());

export default function CategorySalesPage() {
  const { calendarSystem } = useCalendarSystem();
  const today = nepalDateString();
  const [period, setPeriod] = useState('today');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [selected, setSelected] = useState([]);
  const [counted, setCounted] = useState({});
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const latest = useRef(0);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVED_KEY) || '[]');
      if (Array.isArray(saved) && saved.length) setSelected(saved);
    } catch { /* storage blocked: start empty */ }
  }, []);

  const load = useCallback(async () => {
    const request = ++latest.current;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ period, calendarSystem, categories: selected.join(',') });
      if (period === 'custom') { params.set('startDate', from); params.set('endDate', to); }
      const next = await apiJson(`/api/admin/category-sales?${params}`);
      if (request === latest.current) setData(next);
    } catch (e) {
      if (request === latest.current) setError(e.error || e.message || 'Could not load the report.');
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }, [period, from, to, selected, calendarSystem]);

  useEffect(() => { load(); }, [period, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    setSelected(next);
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  };

  const sales = data?.sales;
  const stock = data?.stock;
  // Counted is typed in the count unit; the gap is kept in stock units so it can be valued at cost.
  const gapOf = (row) => {
    const raw = counted[row.id];
    if (raw === undefined || raw === '') return null;
    const units = Number(raw) * (row.purchase_unit ? row.factor : 1);
    return Number.isFinite(units) ? units - row.closing : null;
  };
  const gapValue = (stock?.items || []).reduce((s, row) => s + (gapOf(row) ?? 0) * row.cost_per_unit, 0);
  const chosenNames = (data?.categories || []).filter((c) => selected.includes(c.id)).map((c) => c.name).join(', ');

  const print = async () => {
    const settings = await loadPrintSettings();
    const items = [{ type: 'group', text: 'Sales' }];
    if (sales.categories.length > 1) {
      items.push({ type: 'head', text: 'By category' }, ...sales.categories.map((r) => ({ type: 'row', label: `${r.name} × ${qty(r.quantity)}`, value: formatCurrency(r.amount) })));
    }
    items.push({ type: 'head', text: 'By item' }, ...sales.items.map((r) => ({ type: 'row', label: `${r.name}${r.variant ? ` (${r.variant})` : ''} × ${qty(r.quantity)}`, value: formatCurrency(r.amount) })));
    items.push({ type: 'row', label: `Total · ${sales.totals.bills} bill(s)`, value: formatCurrency(sales.totals.amount), bold: true });
    items.push({ type: 'head', text: 'By customer' }, ...sales.customers.map((r) => ({ type: 'row', label: `${r.name} × ${qty(r.quantity)}`, value: formatCurrency(r.amount) })));
    if (stock.items.length) {
      items.push({ type: 'group', text: 'Stock check' });
      for (const row of stock.items) {
        const gap = gapOf(row);
        const expected = inCountUnit(row, row.closing);
        items.push({
          type: 'row',
          label: row.name,
          value: gap === null ? expected : `${expected} → ${inCountUnit(row, row.closing + gap)} (${gap >= 0 ? '+' : ''}${inCountUnit(row, gap)})`,
          bold: gap !== null && gap < 0,
        });
      }
      if (Object.values(counted).some((v) => v !== '')) items.push({ type: 'row', label: gapValue < 0 ? 'Short (at cost)' : 'Over (at cost)', value: formatCurrency(Math.abs(gapValue)), bold: true });
    }
    if (!printThermalItems({ items, title: 'Category Sales', subtitle: `${chosenNames} · ${data.range.label || `${data.range.start} – ${data.range.end}`}`, settings })) window.print();
  };

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8 print:hidden">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><Wine className="h-6 w-6 text-rose-700" /> Category Sales &amp; Stock</h1>
            <p className="mt-1 text-sm text-gray-500">Pick any categories — what sold, to whom, and whether the stock agrees.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={print} disabled={!sales} className={BTN}><Printer className="h-4 w-4" /> Print summary</button>
            <button type="button" onClick={load} disabled={loading} className={BTN}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          {PERIODS.map(([id, label]) => (
            <button key={id} type="button" onClick={() => setPeriod(id)} className={`${CHIP} ${period === id ? ON : OFF}`}>{label}</button>
          ))}
          <label className="text-xs font-medium text-gray-600">From<DateInput value={from} onChange={setFrom} className={INPUT} /></label>
          <label className="text-xs font-medium text-gray-600">To<DateInput value={to} onChange={setTo} className={INPUT} /></label>
          <button type="button" onClick={() => (period === 'custom' ? load() : setPeriod('custom'))} className={`${CHIP} ${ON}`}>Apply</button>
        </div>
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Categories</p>
          <div className="flex flex-wrap gap-2">
            {(data?.categories || []).map((c) => (
              <button key={c.id} type="button" onClick={() => toggle(c.id)} aria-pressed={selected.includes(c.id)} className={`${CHIP} ${selected.includes(c.id) ? 'border-rose-700 bg-rose-700 text-white' : OFF}`}>{c.name}</button>
            ))}
          </div>
        </div>
      </header>

      <main className="space-y-5 bg-gray-50 p-4 sm:p-6 lg:p-8">
        {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {!selected.length ? (
          <p className="py-16 text-center text-sm text-gray-500">Choose one or more categories above.</p>
        ) : !sales ? (
          <p className="py-16 text-center text-sm text-gray-500">{loading ? 'Building the report…' : 'No data.'}</p>
        ) : (
          <>
            <p className="text-sm text-gray-600">{data.range.label || `${data.range.start} – ${data.range.end}`} · {chosenNames}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Sales" value={formatCurrency(sales.totals.amount)} />
              <Stat label="Quantity sold" value={qty(sales.totals.quantity)} />
              <Stat label="Bills" value={sales.totals.bills} />
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <Table title="By item" head={['Item', 'Qty', 'Amount']} empty="Nothing sold in these categories." rows={sales.items.map((r) => [
                <span key="n">{r.name}{r.variant ? <span className="text-gray-500"> ({r.variant})</span> : null}{sales.categories.length > 1 && <span className="block text-xs text-gray-400">{r.category}</span>}</span>,
                qty(r.quantity), formatCurrency(r.amount),
              ])} />
              <Table title="By customer" head={['Customer', 'Bills', 'Qty', 'Amount']} empty="No customers." rows={sales.customers.map((r) => [r.name, r.bills, qty(r.quantity), formatCurrency(r.amount)])} />
            </div>
            {sales.categories.length > 1 && (
              <Table title="By category" head={['Category', 'Qty', 'Amount']} rows={sales.categories.map((r) => [r.name, qty(r.quantity), formatCurrency(r.amount)])} />
            )}

            <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
              <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
                <h2 className="text-sm font-bold text-gray-900">Stock check</h2>
                <p className="mt-0.5 text-xs text-gray-500">Opening + purchased − sold ± other = what should be on the shelf. Type what you count to see any shortage.</p>
              </div>
              {stock.items.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-gray-500">
                      <tr>{['Item', 'Opening', 'Purchased', 'Sold', 'Other', 'Should have', 'Counted', 'Difference'].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {stock.items.map((row) => {
                        const gap = gapOf(row);
                        const other = row.returned - row.wastage + row.adjusted;
                        return (
                          <tr key={row.id}>
                            <td className="px-3 py-2 font-medium text-gray-900">
                              {row.name}
                              {row.oversold > 0 && <span className="mt-0.5 flex items-center gap-1 text-xs font-normal text-amber-700"><AlertTriangle className="h-3 w-3" /> sold {inCountUnit(row, row.oversold)} more than was in stock</span>}
                            </td>
                            <td className="px-3 py-2 tabular-nums">{inCountUnit(row, row.opening)}</td>
                            <td className="px-3 py-2 tabular-nums text-emerald-700">{row.purchased ? `+${inCountUnit(row, row.purchased)}` : '—'}</td>
                            <td className="px-3 py-2 tabular-nums text-rose-700">{row.sold ? `−${inCountUnit(row, row.sold)}` : '—'}</td>
                            <td className="px-3 py-2 tabular-nums" title={`Voids returned ${qty(row.returned)}, wastage ${qty(row.wastage)}, adjustments ${qty(row.adjusted)} ${row.unit}`}>{other ? `${other > 0 ? '+' : ''}${inCountUnit(row, other)}` : '—'}</td>
                            <td className="px-3 py-2 font-semibold tabular-nums">{inCountUnit(row, row.closing)}</td>
                            <td className="px-3 py-2">
                              <input type="number" step="any" inputMode="decimal" value={counted[row.id] ?? ''} onChange={(e) => setCounted((c) => ({ ...c, [row.id]: e.target.value }))}
                                aria-label={`Counted ${row.name}`} placeholder={row.purchase_unit || row.unit} className="h-9 w-24 rounded-lg border border-gray-300 px-2 text-sm" />
                            </td>
                            <td className={`px-3 py-2 font-semibold tabular-nums ${gap === null ? 'text-gray-400' : gap < -1e-9 ? 'text-rose-700' : gap > 1e-9 ? 'text-emerald-700' : 'text-gray-900'}`}>
                              {gap === null ? '—' : `${gap > 0 ? '+' : ''}${inCountUnit(row, gap)}`}
                              {gap ? <span className="block text-xs font-normal">{formatCurrency(Math.abs(gap * row.cost_per_unit))} at cost</span> : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="px-4 py-6 text-sm text-gray-500">No stock items are linked to these categories yet.</p>
              )}
              {Object.values(counted).some((v) => v !== '') && (
                <p className={`border-t border-gray-200 px-4 py-3 text-sm font-bold ${gapValue < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                  {gapValue < 0 ? 'Short' : 'Over'} by {formatCurrency(Math.abs(gapValue))} at cost
                </p>
              )}
              {stock.unlinked.length > 0 && (
                <p className="border-t border-gray-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                  Not stock-checked (no stock link): {stock.unlinked.join(', ')}. Link them in Products (stock item per variant) or give them a recipe.
                </p>
              )}
            </section>
          </>
        )}
      </main>
    </AdminLayout>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{value}</p>
    </div>
  );
}

function Table({ title, head, rows, empty = 'Nothing to show.' }) {
  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <h2 className="border-b border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold text-gray-900">{title}</h2>
      {rows.length ? (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>{head.map((h, i) => <th key={h} className={`px-4 py-2 font-semibold ${i ? 'text-right' : ''}`}>{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((cells, r) => (
              <tr key={r}>{cells.map((c, i) => <td key={i} className={`px-4 py-2 ${i ? 'text-right tabular-nums' : 'text-gray-900'}`}>{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="px-4 py-6 text-sm text-gray-500">{empty}</p>
      )}
    </section>
  );
}

const BTN = 'inline-flex h-10 items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50';
const CHIP = 'h-9 rounded-full border px-3.5 text-sm font-medium';
const ON = 'border-gray-900 bg-gray-900 text-white';
const OFF = 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50';
const INPUT = 'mt-1 block h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900';
