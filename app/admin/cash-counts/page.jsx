'use client';

import { useCallback, useEffect, useState } from 'react';
import { Banknote, CalendarDays, ChevronDown, ChevronUp, Loader2, RefreshCw, Scale } from 'lucide-react';
import AdminLayout from '@/components/admin/admin-layout';

const money = (value) => `Rs ${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const LABELS = {
  opening_cash: 'Opening cash', cash_collections: 'Cash sales collected', credit_collections: 'Credit collections',
  cash_in: 'Other cash in', cash_expenses: 'Cash expenses', cash_refunds: 'Cash refunds',
  supplier_payments: 'Supplier payments', cash_withdrawals: 'Cash withdrawals', money_exchange_in: 'Money exchange in',
  money_exchange_out: 'Money exchange out', void_returns: 'Void returns', other_cash_out: 'Other cash out',
};
const positiveKeys = new Set(['opening_cash', 'cash_collections', 'credit_collections', 'cash_in', 'money_exchange_in']);

export default function CashCountsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [date, setDate] = useState('');
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('pos_token');
      const query = date ? `?date=${encodeURIComponent(date)}` : '';
      const response = await fetch(`/api/admin/cash-counts${query}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not load cash counts.');
      setRows(data.rows || []);
    } catch (loadError) { setError(loadError.message); }
    finally { setLoading(false); }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const shortage = rows.filter((row) => row.difference < -0.005).reduce((sum, row) => sum + Math.abs(row.difference), 0);
  const overage = rows.filter((row) => row.difference > 0.005).reduce((sum, row) => sum + row.difference, 0);

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div><h1 className="text-2xl font-bold text-gray-950 sm:text-3xl">Scheduled Cash Counts</h1><p className="mt-1 text-sm text-gray-500">Blind cashier counts reconciled against the system cash position at submission time.</p></div>
          <div className="flex gap-2"><input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="h-11 rounded-xl border border-gray-300 bg-white px-3 text-sm" /><button type="button" onClick={load} className="flex h-11 items-center gap-2 rounded-xl border border-gray-300 px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"><RefreshCw className="h-4 w-4" /> Refresh</button></div>
        </div>
      </header>
      <main className="bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-7xl space-y-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat icon={Banknote} label="Counts submitted" value={rows.length.toLocaleString()} />
            <Stat icon={Scale} label="Total shortage" value={money(shortage)} tone="rose" />
            <Stat icon={Scale} label="Total overage" value={money(overage)} tone="emerald" />
          </div>
          {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700">{error}</p>}
          <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            {loading ? <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-gray-400" /></div> : !rows.length ? (
              <div className="flex min-h-64 flex-col items-center justify-center px-4 text-center"><CalendarDays className="h-10 w-10 text-gray-300" /><p className="mt-3 font-semibold text-gray-800">No cash counts found</p><p className="mt-1 text-sm text-gray-500">Submitted cashier counts will appear here.</p></div>
            ) : (
              <div className="divide-y divide-gray-100">
                {rows.map((row) => <CountRow key={row.id} row={row} open={expanded === row.id} onToggle={() => setExpanded(expanded === row.id ? null : row.id)} />)}
              </div>
            )}
          </section>
        </div>
      </main>
    </AdminLayout>
  );
}

function CountRow({ row, open, onToggle }) {
  const breakdown = row.expectedBreakdown?.cash?.breakdown || {};
  const varianceTone = row.difference < -0.005 ? 'text-rose-700 bg-rose-50' : row.difference > 0.005 ? 'text-amber-700 bg-amber-50' : 'text-emerald-700 bg-emerald-50';
  return <article>
    <button type="button" onClick={onToggle} className="grid w-full grid-cols-2 gap-4 p-4 text-left hover:bg-gray-50 sm:grid-cols-[1.2fr_1fr_1fr_1fr_auto] sm:items-center sm:px-6">
      <div><p className="font-semibold text-gray-950">{row.cashier}</p><p className="mt-0.5 text-xs text-gray-500">{row.countDate} · scheduled {row.scheduledTime} NPT</p></div>
      <Value label="Expected" value={money(row.expectedCash)} />
      <Value label="Counted" value={money(row.countedCash)} />
      <div><p className="text-xs text-gray-500">Difference</p><span className={`mt-1 inline-flex rounded-lg px-2 py-1 text-sm font-bold ${varianceTone}`}>{row.difference > 0 ? '+' : ''}{money(row.difference)}</span></div>
      <span className="ml-auto text-gray-400">{open ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}</span>
    </button>
    {open && <div className="border-t border-gray-100 bg-gray-50 px-4 py-5 sm:px-6">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-4"><h3 className="text-sm font-bold text-gray-900">Expected cash calculation</h3><p className="mt-1 text-xs text-gray-500">Opening cash plus recorded cash inflows, less recorded cash outflows, at the exact submission time.</p><div className="mt-4 space-y-2">{Object.entries(LABELS).map(([key, label]) => { const raw = Number(breakdown[key] || 0); const effective = (positiveKeys.has(key) ? 1 : -1) * raw; return <div key={key} className="flex justify-between gap-3 text-sm"><span className="text-gray-600">{label}</span><span className="font-medium text-gray-900">{effective >= 0 ? '+' : '−'} {money(Math.abs(effective))}</span></div>; })}<div className="flex justify-between border-t border-gray-200 pt-3 text-sm font-bold"><span>Expected cash</span><span>{money(row.expectedCash)}</span></div></div></div>
        <div className="rounded-xl border border-gray-200 bg-white p-4"><h3 className="text-sm font-bold text-gray-900">Cashier denomination count</h3><p className="mt-1 text-xs text-gray-500">Submitted {new Date(row.submittedAt).toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' })} NPT</p><div className="mt-4 space-y-2">{Object.entries(row.denominations || {}).sort((a, b) => Number(b[0]) - Number(a[0])).map(([denomination, quantity]) => <div key={denomination} className="flex justify-between text-sm"><span className="text-gray-600">Rs {Number(denomination).toLocaleString('en-IN')} × {quantity}</span><span className="font-medium text-gray-900">{money(Number(denomination) * Number(quantity))}</span></div>)}<div className="flex justify-between border-t border-gray-200 pt-3 text-sm font-bold"><span>Counted cash</span><span>{money(row.countedCash)}</span></div></div></div>
      </div>
    </div>}
  </article>;
}

function Value({ label, value }) { return <div><p className="text-xs text-gray-500">{label}</p><p className="mt-1 text-sm font-bold text-gray-900">{value}</p></div>; }
function Stat({ icon: Icon, label, value, tone = 'gray' }) { const colors = tone === 'rose' ? 'bg-rose-100 text-rose-700' : tone === 'emerald' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-700'; return <div className="rounded-2xl border border-gray-200 bg-white p-4"><div className="flex items-center gap-3"><span className={`flex h-10 w-10 items-center justify-center rounded-xl ${colors}`}><Icon className="h-5 w-5" /></span><div><p className="text-xs font-medium text-gray-500">{label}</p><p className="mt-0.5 text-xl font-bold text-gray-950">{value}</p></div></div></div>; }
