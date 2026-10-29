'use client';

import { AlertTriangle, CheckCircle2, CircleDollarSign, CreditCard, FileWarning, ShieldCheck } from 'lucide-react';
import { formatValue } from '@/components/admin/report-kit';
import { clickableRowClass, useAnalyticsRecords } from './analytics-record-viewer';

const money = (value) => formatValue(value, 'currency');
const number = (value) => formatValue(value, 'number');
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

const resultMeta = {
  balanced: ['Balanced', 'bg-emerald-50 text-emerald-700'],
  excess: ['Excess payment', 'bg-rose-50 text-rose-700'],
  missing: ['Missing settlement', 'bg-amber-50 text-amber-700'],
  voided_payment: ['Voided payment active', 'bg-rose-50 text-rose-700'],
  voided_clear: ['Voided and cleared', 'bg-gray-100 text-gray-600'],
};

function Metric({ label, value, detail, tone = 'neutral', icon: Icon }) {
  const styles = tone === 'danger'
    ? 'border-rose-200 bg-rose-50 text-rose-800'
    : tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : tone === 'blue'
        ? 'border-blue-200 bg-blue-50 text-blue-900'
        : 'border-gray-200 bg-white text-gray-950';
  return <div className={`rounded-xl border p-4 ${styles}`}>
    <div className="flex items-center gap-2"><Icon className="h-4 w-4 shrink-0 opacity-70" /><p className="text-xs font-semibold">{label}</p></div>
    <p className="mt-2 text-xl font-bold tabular-nums">{money(value)}</p>
    <p className="mt-1 text-xs opacity-70">{detail}</p>
  </div>;
}

export function ReconciliationSummary({ data }) {
  const report = data?.paymentReconciliation;
  if (!report) return null;
  const attention = report.status === 'attention';
  return <section aria-label="Money reconciliation" className={`overflow-hidden rounded-xl border ${attention ? 'border-rose-200' : 'border-emerald-200'} bg-white shadow-sm`}>
    <div className={`flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-5 ${attention ? 'border-rose-100 bg-rose-50/70' : 'border-emerald-100 bg-emerald-50/70'}`}>
      <div><div className="flex items-center gap-2">{attention ? <AlertTriangle className="h-4 w-4 text-rose-600" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}<h2 className="text-sm font-semibold text-gray-950">Money reconciliation</h2></div><p className="mt-0.5 text-xs text-gray-600">Bill cohort resolution to date—not a second sales total.</p></div>
      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${attention ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>{attention ? 'Needs attention' : 'Reconciled'}</span>
    </div>
    <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Verified Money Received" value={report.totals.verifiedReceived} detail="Valid cash and digital receipts" tone="success" icon={ShieldCheck} />
      <Metric label="Needs Investigation" value={report.totals.needsAttention} detail={`${number(report.exceptions.length)} affected bills`} tone={attention ? 'danger' : 'success'} icon={FileWarning} />
      <Metric label="Credit Collected" value={report.credit.collected} detail="Already included in money received" tone="blue" icon={CreditCard} />
      <Metric label="Still Owed" value={report.credit.outstanding} detail="Current unpaid amount for these bills" tone="blue" icon={CircleDollarSign} />
    </div>
  </section>;
}

function Waterfall({ title, caption, rows, result }) {
  const maximum = Math.max(1, ...rows.map((row) => Math.abs(num(row.value))), Math.abs(num(result.value)));
  return <section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
    <h3 className="text-sm font-semibold text-gray-950">{title}</h3><p className="mt-1 text-xs text-gray-500">{caption}</p>
    <div className="mt-5 space-y-3">{rows.map((row) => <div key={row.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1"><div className="flex min-w-0 items-center gap-2"><span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs font-bold ${row.sign === '−' ? 'bg-rose-100 text-rose-700' : 'bg-gray-100 text-gray-600'}`}>{row.sign || '•'}</span><span className="truncate text-xs font-medium text-gray-700">{row.label}</span></div><span className={`text-xs font-semibold tabular-nums ${row.sign === '−' ? 'text-rose-700' : 'text-gray-950'}`}>{money(row.value)}</span><div className="col-span-2 ml-7 h-1.5 overflow-hidden rounded-full bg-gray-100"><div className={`h-full rounded-full ${row.sign === '−' ? 'bg-rose-400' : 'bg-blue-500'}`} style={{ width: `${Math.max(2, Math.abs(num(row.value)) / maximum * 100)}%` }} /></div></div>)}</div>
    <div className="mt-5 flex items-center justify-between border-t-2 border-gray-900 pt-3"><span className="text-sm font-semibold text-gray-950">{result.label}</span><span className="text-lg font-bold tabular-nums text-emerald-700">{money(result.value)}</span></div>
  </section>;
}

function CreditLifecycle({ credit }) {
  const total = Math.max(0, num(credit.sold));
  const parts = [
    ['Collected', credit.collected, 'bg-emerald-500'],
    ['Written off', credit.writtenOff, 'bg-amber-400'],
    ['Still owed', credit.outstanding, 'bg-blue-500'],
  ];
  return <section className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-blue-950">Credit lifecycle</h3><p className="mt-1 text-xs text-blue-700">Credit sold must equal collected + written off + still owed.</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${credit.reconciled ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{credit.reconciled ? 'Balanced' : `${money(Math.abs(num(credit.difference)))} difference`}</span></div>
    <div className="mt-5"><div className="flex items-center justify-between text-xs"><span className="font-semibold text-blue-900">Sold on credit</span><span className="font-bold tabular-nums text-blue-950">{money(total)}</span></div><div className="mt-2 flex h-4 overflow-hidden rounded-full bg-blue-100">{parts.map(([label, value, color]) => total > 0 && num(value) > 0 ? <span key={label} className={color} style={{ width: `${Math.min(100, num(value) / total * 100)}%` }} title={`${label}: ${money(value)}`} /> : null)}</div></div>
    <div className="mt-4 grid gap-2 sm:grid-cols-3">{parts.map(([label, value, color]) => <div key={label} className="rounded-lg border border-blue-100 bg-white px-3 py-3"><div className="flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-sm ${color}`} /><span className="text-xs font-medium text-gray-600">{label}</span></div><p className="mt-1.5 text-base font-bold tabular-nums text-gray-950">{money(value)}</p><p className="mt-0.5 text-[11px] text-gray-400">{total ? `${(num(value) / total * 100).toFixed(1)}% of credit sales` : 'No credit sales'}</p></div>)}</div>
  </section>;
}

export function PaymentReconciliationPanel({ data }) {
  const report = data?.paymentReconciliation;
  if (!report) return null;
  const t = report.totals;
  const expectedReceived = Math.max(0, num(t.activeBillValue) - num(report.credit.writtenOff) - num(report.credit.outstanding));
  return <section className="space-y-4" aria-label="Payment reconciliation detail">
    <div><p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">Reconciliation center</p><h2 className="mt-1 text-lg font-semibold text-gray-950">Prove where every rupee went</h2><p className="mt-1 text-sm text-gray-500">{report.basis}</p></div>
    <ReconciliationSummary data={data} />
    <div className="grid gap-4 xl:grid-cols-2">
      <Waterfall title="From raw records to verified receipts" caption="Credit is not received money; voided and excess records are isolated for review." rows={[
        { label: 'Raw payment and allocation rows', value: t.rawPaymentRows },
        { label: 'Sold-on-credit allocations', value: report.credit.sold, sign: '−' },
        { label: 'Payments on voided bills', value: t.voidedPayments, sign: '−' },
        { label: 'Excess / orphan payments', value: t.excessPayments, sign: '−' },
      ]} result={{ label: 'Verified money received', value: t.verifiedReceived }} />
      <Waterfall title="How active bills were resolved" caption="Money received, write-offs and outstanding credit together must resolve finalized bills." rows={[
        { label: 'Active finalized bill value', value: t.activeBillValue },
        { label: 'Credit written off', value: report.credit.writtenOff, sign: '−' },
        { label: 'Still outstanding', value: report.credit.outstanding, sign: '−' },
      ]} result={{ label: 'Expected money received', value: expectedReceived }} />
    </div>
    <CreditLifecycle credit={report.credit} />
    <BillIntegrityTable rows={report.exceptions} />
  </section>;
}

function BillIntegrityTable({ rows = [] }) {
  const { openBill } = useAnalyticsRecords();
  return <section className="overflow-hidden rounded-xl border border-gray-200 bg-white"><div className="border-b border-gray-200 px-4 py-3 sm:px-5"><h3 className="text-sm font-semibold text-gray-950">Bills needing investigation</h3><p className="mt-0.5 text-xs text-gray-500">Difference = received + written off + outstanding − bill total. Click a row to open the bill.</p></div>
    {!rows.length ? <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />Every bill in this cohort balances.</div> : <div className="overflow-x-auto"><table className="min-w-full text-left text-xs"><thead className="bg-gray-50 text-gray-500"><tr>{['Bill','Status','Bill total','Cash','Online','Written off','Outstanding','Difference','Result'].map((label) => <th key={label} className="whitespace-nowrap px-4 py-3 font-semibold">{label}</th>)}</tr></thead><tbody className="divide-y divide-gray-100">{rows.map((row) => { const meta = resultMeta[row.result] || [row.result, 'bg-gray-100 text-gray-600']; return <tr key={row.billId} className={`${clickableRowClass} text-gray-700`} onClick={() => openBill(row.billId)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openBill(row.billId); } }} tabIndex={0} role="button"><td className="whitespace-nowrap px-4 py-3 font-semibold text-gray-950">{row.billNumber || `#${row.billId}`}</td><td className="whitespace-nowrap px-4 py-3 capitalize">{String(row.billStatus).replaceAll('_',' ')}</td><td className="whitespace-nowrap px-4 py-3 tabular-nums">{money(row.billTotal)}</td><td className="whitespace-nowrap px-4 py-3 tabular-nums">{money(row.cashReceived)}</td><td className="whitespace-nowrap px-4 py-3 tabular-nums">{money(row.digitalReceived)}</td><td className="whitespace-nowrap px-4 py-3 tabular-nums">{money(row.writtenOff)}</td><td className="whitespace-nowrap px-4 py-3 tabular-nums">{money(row.outstanding)}</td><td className={`whitespace-nowrap px-4 py-3 font-bold tabular-nums ${num(row.difference) ? 'text-rose-700' : 'text-emerald-700'}`}>{money(row.difference)}</td><td className="whitespace-nowrap px-4 py-3"><span className={`rounded-full px-2 py-1 font-semibold ${meta[1]}`}>{meta[0]}</span></td></tr>; })}</tbody></table></div>}
  </section>;
}

export function VoidedPaymentControl({ data }) {
  const report = data?.paymentReconciliation;
  if (!report) return null;
  const rows = report.exceptions.filter((row) => row.result === 'voided_payment');
  const amount = rows.reduce((sum, row) => sum + num(row.received), 0);
  return <section className={`overflow-hidden rounded-xl border ${rows.length ? 'border-rose-200' : 'border-emerald-200'} bg-white`}><div className={`border-b px-4 py-3 sm:px-5 ${rows.length ? 'border-rose-100 bg-rose-50' : 'border-emerald-100 bg-emerald-50'}`}><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-gray-950">Voided-payment control</h2><p className="mt-0.5 text-xs text-gray-600">A voided bill must have zero active payment rows.</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${rows.length ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>{rows.length ? `${money(amount)} unreversed` : 'All cleared'}</span></div></div>{rows.length ? <BillIntegrityTable rows={rows} /> : <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />No active payments remain on voided bills.</div>}</section>;
}
