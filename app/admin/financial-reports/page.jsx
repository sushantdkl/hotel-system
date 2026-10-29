'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import AdminLayout from '@/components/admin/admin-layout';
import { useToast } from '@/components/ui/toast';
import { friendlyFromError } from '@/lib/friendly-message';
import { apiJson } from '@/lib/authed-fetch';
import { printReport } from '@/lib/print-report.js';
import { money } from '@/components/accounting/ledger-table';
import DateInput from '@/components/ui/date-input.jsx';

const TABS = [
  { id: 'pnl', label: 'Profit & Loss' },
  { id: 'balance-sheet', label: 'Balance Sheet' },
  { id: 'trial-balance', label: 'Trial Balance' },
  { id: 'cash-flow', label: 'Cash Flow' },
];

export default function FinancialReportsPage() { return <Suspense fallback={<p>Loading financial report…</p>}><FinancialReportsRoute /></Suspense>; }
function FinancialReportsRoute() { const params=useSearchParams(); return <FinancialReportsInner key={params.toString()} params={params} />; }
function FinancialReportsInner({params}) {
  const { addToast } = useToast();
  const [tab, setTab] = useState(TABS.some(t=>t.id===params.get('report')) ? params.get('report') : 'pnl');
  const [range, setRange] = useState({ from: params.get('from') || '', to: params.get('to') || '' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const reportRef = useRef(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setData(null);
    const q = new URLSearchParams({ report: tab });
    if ((tab === 'pnl' || tab === 'cash-flow') && range.from) q.set('from', range.from);
    if (range.to) q.set('to', range.to);
    apiJson(`/api/admin/financial-reports?${q}`)
      .then((d) => {
        if (active) setData(d.report || null);
      })
      .catch((e) => {
        if (active) addToast(friendlyFromError(e, 'load_failed'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    // A slower response for the previous tab must never overwrite the current
    // report shape (for example P&L data while Trial Balance is selected).
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, range]);

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Financial Reports</h1>
        <p className="mt-1 text-sm text-gray-500">P&amp;L, Balance Sheet, Trial Balance and Cash Flow — live from the journals.</p>
      </header>

      <div className="space-y-5 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap rounded-lg border border-gray-300 bg-white p-0.5">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} className={`rounded-md px-4 py-1.5 text-sm font-medium ${tab === t.id ? 'bg-gray-900 text-white' : 'text-gray-600'}`}>{t.label}</button>
            ))}
          </div>
          {(tab === 'pnl' || tab === 'cash-flow') && (
            <label className="block"><span className="mb-1 block text-xs font-medium text-gray-500">From</span><DateInput value={range.from} onChange={(v) => setRange((r) => ({ ...r, from: v }))} className="h-10 rounded-lg border border-gray-300 px-3 text-sm" /></label>
          )}
          <label className="block"><span className="mb-1 block text-xs font-medium text-gray-500">{tab === 'pnl' || tab === 'cash-flow' ? 'To' : 'As of'}</span><DateInput value={range.to} onChange={(v) => setRange((r) => ({ ...r, to: v }))} className="h-10 rounded-lg border border-gray-300 px-3 text-sm" /></label>
          <button type="button" onClick={() => printReport(reportRef.current, {
            title: TABS.find((t) => t.id === tab)?.label,
            subtitle: tab === 'pnl' || tab === 'cash-flow' ? `${range.from || 'Start'} – ${range.to || 'Today'}` : `As of ${range.to || 'today'}`,
          })} className="ml-auto h-10 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50">Print / PDF</button>
        </div>

        <div ref={reportRef}>
        {loading ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-gray-500">Building report…</div>
        ) : tab === 'pnl' ? (
          <PnL data={data} showOperating={params.get("focus") === "operating"} />
        ) : tab === 'balance-sheet' ? (
          <BalanceSheet data={data} />
        ) : tab === 'cash-flow' ? (
          <CashFlow data={data} />
        ) : (
          <TrialBalance data={data} />
        )}
        </div>
      </div>
    </AdminLayout>
  );
}

function Section({ title, rows, total, tone }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <div className="border-b border-gray-200 bg-gray-50 px-5 py-3 text-sm font-semibold text-gray-900">{title}</div>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-gray-100">
          {(rows || []).map((r) => (
            <tr key={r.code + r.name}>
              <td className="px-5 py-2 text-gray-500">{r.code !== '—' ? r.code : ''}</td>
              <td className="px-5 py-2 text-gray-900">{r.name}</td>
              <td className="px-5 py-2 text-right tabular-nums text-gray-900">{money(r.amount)}</td>
            </tr>
          ))}
          {(!rows || rows.length === 0) && <tr><td colSpan={3} className="px-5 py-4 text-center text-gray-400">Nothing to show.</td></tr>}
        </tbody>
        <tfoot className={`border-t border-gray-200 font-semibold ${tone || 'text-gray-900'}`}>
          <tr><td className="px-5 py-3" colSpan={2}>Total {title}</td><td className="px-5 py-3 text-right tabular-nums">{money(total)}</td></tr>
        </tfoot>
      </table>
    </div>
  );
}

function PnL({ data, showOperating }) {
  if (!data) return null;
  return (
    <div className="space-y-5">
      {showOperating && <Section title="Operating expenses" rows={(data.expense || []).filter(r=>r.code !== '5010')} total={Number(data.totalExpense || 0) - Number((data.expense || []).find(r=>r.code==='5010')?.amount || 0)} tone="text-rose-700" />}
      <Section title="Income" rows={data.income} total={data.totalIncome} tone="text-emerald-700" />
      <Section title="Expenses" rows={data.expense} total={data.totalExpense} tone="text-rose-700" />
      <div className="rounded-2xl border border-gray-900 bg-gray-900 px-5 py-4 text-white">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Net {data.netProfit >= 0 ? 'Profit' : 'Loss'}</span>
          <span className="text-xl font-bold tabular-nums">{money(data.netProfit)}</span>
        </div>
      </div>
    </div>
  );
}

function BalanceSheet({ data }) {
  if (!data) return null;
  return (
    <div className="space-y-5">
      <Section title="Assets" rows={data.assets} total={data.totalAssets} />
      <Section title="Liabilities" rows={data.liabilities} total={data.totalLiabilities} />
      <Section title="Equity" rows={data.equity} total={data.totalEquity} />
      <div className={`rounded-2xl border px-5 py-3 text-sm ${data.balanced ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-300 bg-rose-50 text-rose-800'}`}>
        {data.balanced
          ? `Balanced — Assets ${money(data.totalAssets)} = Liabilities + Equity ${money(data.totalLiabilities + data.totalEquity)}`
          : `Out of balance by ${money(data.totalAssets - data.totalLiabilities - data.totalEquity)} — investigate.`}
      </div>
    </div>
  );
}

function TrialBalance({ data }) {
  if (!data) return null;
  const lines = Array.isArray(data.lines) ? data.lines : [];
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr><th className="px-5 py-3 font-semibold">Code</th><th className="px-5 py-3 font-semibold">Account</th><th className="px-5 py-3 text-right font-semibold">Debit</th><th className="px-5 py-3 text-right font-semibold">Credit</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {lines.map((l) => (
              <tr key={l.code}>
                <td className="px-5 py-2 text-gray-500">{l.code}</td>
                <td className="px-5 py-2 text-gray-900">{l.name}</td>
                <td className="px-5 py-2 text-right tabular-nums">{l.debit ? money(l.debit) : ''}</td>
                <td className="px-5 py-2 text-right tabular-nums">{l.credit ? money(l.credit) : ''}</td>
              </tr>
            ))}
            {lines.length === 0 && <tr><td colSpan={4} className="px-5 py-8 text-center text-gray-400">No trial-balance entries in this period.</td></tr>}
          </tbody>
          <tfoot className={`border-t-2 font-semibold ${data.balanced ? 'border-gray-300 text-gray-900' : 'border-rose-300 text-rose-700'}`}>
            <tr><td className="px-5 py-3" colSpan={2}>Totals {data.balanced ? '(balanced)' : '(OUT OF BALANCE)'}</td><td className="px-5 py-3 text-right tabular-nums">{money(data.totalDebit)}</td><td className="px-5 py-3 text-right tabular-nums">{money(data.totalCredit)}</td></tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function CashFlowBucket({ title, bucket }) {
  if (!bucket) return null;
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <div className="border-b border-gray-200 bg-gray-50 px-5 py-3 text-sm font-semibold text-gray-900">{title}</div>
      <div className="grid gap-4 p-5 md:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase text-emerald-700">Inflows</p>
          {(bucket.inflows || []).length === 0 ? <p className="text-sm text-gray-400">None</p> : bucket.inflows.map((r, i) => (
            <div key={i} className="flex justify-between py-1 text-sm"><span className="text-gray-700">{r.name}</span><span className="tabular-nums">{money(r.amount)}</span></div>
          ))}
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase text-rose-700">Outflows</p>
          {(bucket.outflows || []).length === 0 ? <p className="text-sm text-gray-400">None</p> : bucket.outflows.map((r, i) => (
            <div key={i} className="flex justify-between py-1 text-sm"><span className="text-gray-700">{r.name}</span><span className="tabular-nums">{money(r.amount)}</span></div>
          ))}
        </div>
      </div>
      <div className="border-t border-gray-100 px-5 py-3 text-sm font-semibold flex justify-between">
        <span>Net {title}</span>
        <span className="tabular-nums">{money(bucket.net)}</span>
      </div>
    </div>
  );
}

function CashFlow({ data }) {
  if (!data) return null;
  return (
    <div className="space-y-5">
      <CashFlowBucket title="Operating activities" bucket={data.operating} />
      <CashFlowBucket title="Investing activities" bucket={data.investing} />
      <CashFlowBucket title="Financing activities" bucket={data.financing} />
      <div className="rounded-2xl border border-gray-900 bg-gray-900 px-5 py-4 text-white">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Net change in cash &amp; bank</span>
          <span className="text-xl font-bold tabular-nums">{money(data.netChange)}</span>
        </div>
      </div>
    </div>
  );
}
