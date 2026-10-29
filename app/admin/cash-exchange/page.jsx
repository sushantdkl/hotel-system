'use client';

import { useEffect, useRef, useState } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import { ArrowRight, RotateCcw, X } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import { apiJson } from '@/lib/authed-fetch';
import { formatNepalTime } from '@/lib/time-utils';
import { money } from '@/components/accounting/ledger-table';

const METHODS = ['cash', 'online'];

export default function CashExchangePage() {
  const { addToast } = useToast();
  const [form, setForm] = useState({ from_method: 'online', to_method: 'cash', amount: '', charge: '', note: '' });
  const [recent, setRecent] = useState([]);
  const [busy, setBusy] = useState(false);
  const [selectedExchange, setSelectedExchange] = useState(null);
  const keyRef = useRef(newKey());
  const set = (p) => setForm((f) => ({ ...f, ...p }));

  const load = () => apiJson('/api/admin/cash-exchange').then((d) => setRecent(d.exchanges || [])).catch(() => {});
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!(Number(form.amount) > 0)) { addToast(friendlyMessage('validation', { description: 'Enter an amount.' })); return; }
    if (form.from_method === form.to_method) { addToast(friendlyMessage('validation', { description: 'Pick two different methods.' })); return; }
    setBusy(true);
    try {
      await apiJson('/api/admin/cash-exchange', { method: 'POST', body: JSON.stringify({ ...form, amount: Number(form.amount), charge: Number(form.charge) || 0, external_ref: keyRef.current }) });
      addToast(friendlyMessage('save_success', { description: 'Exchange recorded and journaled.' }));
      keyRef.current = newKey();
      set({ amount: '', charge: '', note: '' });
      load();
    } catch (error) { addToast(friendlyFromError(error, 'save_failed')); }
    finally { setBusy(false); }
  };

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Cash Exchange</h1>
        <p className="mt-1 text-sm text-gray-500">Swap money between media — e.g. a guest pays online but wants cash back. Posts a balanced journal (no sale).</p>
      </header>

      <div className="space-y-6 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-8">
          <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-[1fr_auto_1fr]">
            <label className="block"><span className="mb-1 block text-sm font-medium text-gray-700">Customer gives (received)</span>
              <select value={form.from_method} onChange={(e) => set({ from_method: e.target.value })} className={INPUT}>
                {METHODS.map((m) => <option key={m} value={m} className="capitalize">{m}</option>)}
              </select>
            </label>
            <div className="hidden pb-3 text-gray-400 sm:block"><ArrowRight className="h-5 w-5" /></div>
            <label className="block"><span className="mb-1 block text-sm font-medium text-gray-700">You return (paid out)</span>
              <select value={form.to_method} onChange={(e) => set({ to_method: e.target.value })} className={INPUT}>
                {METHODS.map((m) => <option key={m} value={m} className="capitalize">{m}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="block"><span className="mb-1 block text-sm font-medium text-gray-700">Amount</span><input type="number" min="0" step="any" value={form.amount} onChange={(e) => set({ amount: e.target.value })} className={INPUT} placeholder="0.00" /></label>
            <label className="block"><span className="mb-1 block text-sm font-medium text-gray-700">Charge (optional)</span><input type="number" min="0" step="any" value={form.charge} onChange={(e) => set({ charge: e.target.value })} className={INPUT} placeholder="0" /></label>
            <label className="block"><span className="mb-1 block text-sm font-medium text-gray-700">Note</span><input value={form.note} onChange={(e) => set({ note: e.target.value })} className={INPUT} placeholder="optional" /></label>
          </div>
          {Number(form.amount) > 0 && (
            <p className="mt-3 text-sm text-gray-500">
              Receive <span className="font-medium text-gray-900">{form.from_method}</span> Rs {Number(form.amount).toLocaleString()}, pay out{' '}
              <span className="font-medium text-gray-900">{form.to_method}</span> Rs {(Number(form.amount) - (Number(form.charge) || 0)).toLocaleString()}
              {Number(form.charge) > 0 ? ` (Rs ${Number(form.charge).toLocaleString()} charge kept as income)` : ''}.
            </p>
          )}
          <button disabled={busy} onClick={submit} className="mt-4 h-11 rounded-lg bg-gray-900 px-6 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">{busy ? 'Saving…' : 'Record exchange'}</button>
        </div>

        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-5 py-4">
            <h2 className="text-sm font-semibold text-gray-900">Exchange history</h2>
            <p className="mt-1 text-xs text-gray-500">Cash and online movement are shown separately. Corrections stay visible and are linked to the exchange they reversed.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500"><tr>
                <th className="px-4 py-3 text-left font-semibold">When / details</th>
                <th className="px-4 py-3 text-left font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Cash In</th>
                <th className="px-4 py-3 text-right font-semibold">Cash Out</th>
                <th className="px-4 py-3 text-right font-semibold">Online In</th>
                <th className="px-4 py-3 text-right font-semibold">Online Out</th>
                <th className="px-4 py-3 text-right font-semibold">Charge</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {recent.map((r) => <tr key={r.id} tabIndex={0} role="button" onClick={() => setSelectedExchange(r)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setSelectedExchange(r); }} className={`cursor-pointer focus:outline-none ${r.reversal_id ? 'bg-gray-50 text-gray-500' : 'hover:bg-gray-50 focus:bg-gray-50'}`}>
                  <td className="px-4 py-3"><p className={`font-medium ${r.reversal_id ? 'line-through' : 'text-gray-900'}`}>{r.memo}</p><p className="mt-0.5 text-xs text-gray-500">{formatNepalTime(r.created_at)}{r.by_name ? ` · ${r.by_name}` : ''}</p>{r.is_reversal ? <p className="mt-1 text-xs text-gray-500">Undoing #{r.reversed_journal_id}: {r.original_memo}</p> : null}</td>
                  <td className="px-4 py-3">{r.is_reversal ? <Badge tone="rose"><RotateCcw className="h-3 w-3"/>Reversal</Badge> : r.reversal_id ? <Badge tone="gray">Reversed</Badge> : <Badge tone="green">Posted</Badge>}</td>
                  <MoneyCell value={r.cash_in} tone="green"/><MoneyCell value={r.cash_out} tone="red"/><MoneyCell value={r.online_in} tone="green"/><MoneyCell value={r.online_out} tone="red"/><MoneyCell value={r.charge} tone="green"/>
                </tr>)}
                {recent.length === 0 && <tr><td colSpan={7} className="px-5 py-8 text-center text-sm text-gray-500">No exchanges yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {selectedExchange && <ExchangeDetail row={selectedExchange} onClose={() => setSelectedExchange(null)} />}
    </AdminLayout>
  );
}

const INPUT = 'h-11 w-full rounded-lg border border-gray-300 px-3 text-sm text-gray-900';

function newKey() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.random()}`;
}

function MoneyCell({ value, tone }) {
  const numeric = Number(value || 0);
  const color = numeric < 0 || tone === 'red' ? 'text-rose-700' : 'text-emerald-700';
  return <td className={`px-4 py-3 text-right font-semibold tabular-nums ${numeric ? color : 'text-gray-300'}`}>{numeric ? `${numeric < 0 ? '−' : ''}${money(Math.abs(numeric))}` : '—'}</td>;
}

function Badge({ tone, children }) {
  const colors = tone === 'rose' ? 'bg-rose-100 text-rose-800' : tone === 'green' ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-200 text-gray-700';
  return <span className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-bold uppercase ${colors}`}>{children}</span>;
}

function ExchangeDetail({ row, onClose }) {
  return <div className="fixed inset-0 z-[110] flex items-center justify-center bg-gray-950/50 p-4" role="dialog" aria-modal="true" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="w-full max-w-2xl rounded-2xl border border-gray-200 bg-white shadow-2xl">
      <div className="flex items-start justify-between border-b border-gray-200 px-5 py-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Journal #{row.id}</p><h3 className="mt-1 text-lg font-bold text-gray-950">{row.is_reversal ? 'Exchange reversal' : 'Money exchange details'}</h3></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"><X className="h-4 w-4"/></button></div>
      <div className="space-y-5 p-5">
        <p className="rounded-xl bg-gray-50 p-4 text-sm leading-6 text-gray-800">{row.memo}</p>
        <div className="grid gap-4 sm:grid-cols-3"><ExchangeField label="When" value={formatNepalTime(row.created_at)}/><ExchangeField label="Recorded by" value={row.by_name || 'Not recorded'}/><ExchangeField label="Status" value={row.is_reversal ? 'Reversal / correction' : row.reversal_id ? 'Reversed' : 'Posted'}/></div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5"><ExchangeAmount label="Cash In" value={row.cash_in} tone="green"/><ExchangeAmount label="Cash Out" value={row.cash_out} tone="red"/><ExchangeAmount label="Online In" value={row.online_in} tone="green"/><ExchangeAmount label="Online Out" value={row.online_out} tone="red"/><ExchangeAmount label="Charge" value={row.charge} tone={Number(row.charge) < 0 ? 'red' : 'green'}/></div>
        {row.is_reversal ? <div className="border-l-4 border-rose-500 bg-rose-50 p-3 text-sm text-rose-900"><strong>Undoing exchange journal #{row.reversed_journal_id}</strong><p className="mt-1">{row.original_memo}</p></div> : null}
        {row.reversal_id ? <div className="border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-900">Reversed by journal <strong>#{row.reversal_id}</strong>. This exchange is excluded from the net summary and analytics totals.</div> : null}
      </div>
    </div>
  </div>;
}

function ExchangeField({ label, value }) {
  return <div><p className="text-xs font-medium text-gray-500">{label}</p><p className="mt-1 text-sm font-semibold text-gray-900">{value}</p></div>;
}

function ExchangeAmount({ label, value, tone }) {
  const numeric = Number(value || 0);
  return <div className={`rounded-xl p-3 ${tone === 'red' ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800'}`}><p className="text-[10px] font-bold uppercase">{label}</p><p className="mt-1 text-sm font-bold tabular-nums">{numeric < 0 ? '−' : ''}{money(Math.abs(numeric))}</p></div>;
}
