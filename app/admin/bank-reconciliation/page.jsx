'use client';

import { useEffect, useState } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import { Upload, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import { apiJson } from '@/lib/authed-fetch';
import { money } from '@/components/accounting/ledger-table';
import { formatNepalDate } from '@/lib/time-utils';

export default function BankReconciliationPage() {
  const { addToast } = useToast();
  const [dashboard, setDashboard] = useState([]);
  const [banks, setBanks] = useState([]);
  const [bankId, setBankId] = useState('');
  const [view, setView] = useState(null);
  const [stmtBalance, setStmtBalance] = useState('');
  const [busy, setBusy] = useState(false);

  const loadDash = async () => {
    try {
      const d = await apiJson('/api/admin/bank-reconciliation');
      setDashboard(d.dashboard || []);
      setBanks(d.banks || []);
      if (!bankId && d.banks?.[0]) setBankId(String(d.banks[0].id));
    } catch (error) { addToast(friendlyFromError(error, 'load_failed')); }
  };
  const loadView = async (id) => {
    if (!id) return;
    try { setView(await apiJson(`/api/admin/bank-reconciliation?bank_account_id=${id}`)); }
    catch (error) { addToast(friendlyFromError(error, 'load_failed')); }
  };

  useEffect(() => { loadDash(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (bankId) loadView(bankId); }, [bankId]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (line) => {
    try {
      await apiJson('/api/admin/bank-reconciliation', { method: 'POST', body: JSON.stringify({ action: 'toggle', line_id: line.id, reconciled: !line.reconciled }) });
      setView((v) => {
        const lines = v.lines.map((l) => (l.id === line.id ? { ...l, reconciled: !l.reconciled } : l));
        return recompute(v, lines);
      });
    } catch (error) { addToast(friendlyFromError(error, 'save_failed')); }
  };

  // Optional CSV import: parse amounts, tick unmatched book lines whose net equals a statement amount.
  const importCsv = async (file) => {
    if (!file) return;
    const text = await file.text();
    const amounts = parseAmounts(text);
    if (!amounts.length) { addToast(friendlyMessage('validation', { description: 'No amounts found in that CSV.' })); return; }
    const pool = [...amounts];
    let matched = 0;
    for (const l of view.lines) {
      if (l.reconciled) continue;
      const net = round2(l.debit - l.credit);
      const idx = pool.findIndex((a) => Math.abs(a - net) < 0.01);
      if (idx >= 0) { pool.splice(idx, 1); await toggle(l); matched += 1; }
    }
    addToast(friendlyMessage('save_success', { description: `Matched ${matched} of ${amounts.length} statement lines.` }));
  };

  const finalize = async () => {
    if (stmtBalance === '') { addToast(friendlyMessage('validation', { description: 'Enter the statement closing balance.' })); return; }
    setBusy(true);
    try {
      const r = await apiJson('/api/admin/bank-reconciliation', { method: 'POST', body: JSON.stringify({ action: 'finalize', bank_account_id: bankId, statement_balance: Number(stmtBalance) }) });
      addToast(friendlyMessage('save_success', { description: Math.abs(r.difference) < 0.01 ? 'Reconciled — no difference.' : `Recorded with a difference of ${money(r.difference)}.` }));
      setStmtBalance('');
      loadDash();
      loadView(bankId);
    } catch (error) { addToast(friendlyFromError(error, 'save_failed')); }
    finally { setBusy(false); }
  };

  const diff = view && stmtBalance !== '' ? round2(Number(stmtBalance) - view.clearedBalance) : null;

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Bank Reconciliation</h1>
        <p className="mt-1 text-sm text-gray-500">Tick off what has cleared the bank, then compare the cleared book balance to your statement.</p>
      </header>

      <div className="space-y-6 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-5 py-4"><h2 className="text-sm font-semibold text-gray-900">Reconciliation dashboard</h2></div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr><th className="px-5 py-3 font-semibold">Bank</th><th className="px-5 py-3 text-right font-semibold">Book</th><th className="px-5 py-3 text-right font-semibold">Cleared</th><th className="px-5 py-3 text-right font-semibold">Unreconciled</th><th className="px-5 py-3 font-semibold">Last reconciled</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {dashboard.map((b) => (
                  <tr key={b.id} className="cursor-pointer hover:bg-gray-50" onClick={() => setBankId(String(b.id))}>
                    <td className="px-5 py-2.5 font-medium text-gray-900">{b.name}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{money(b.bookBalance)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-emerald-700">{money(b.clearedBalance)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{b.unreconciledCount} · {money(b.unreconciledAmount)}</td>
                    <td className="px-5 py-2.5 text-gray-600">{b.lastReconciledDate ? `${formatNepalDate(b.lastReconciledDate)} (${money(b.lastDifference)})` : 'Never'}</td>
                  </tr>
                ))}
                {dashboard.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-500">No bank accounts.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        {view && (
          <section className="rounded-2xl border border-gray-200 bg-white">
            <div className="flex flex-wrap items-end gap-3 border-b border-gray-200 px-5 py-4">
              <label className="block"><span className="mb-1 block text-xs font-medium text-gray-500">Bank account</span>
                <select value={bankId} onChange={(e) => setBankId(e.target.value)} className="h-10 rounded-lg border border-gray-300 px-3 text-sm">
                  {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
              <label className="block"><span className="mb-1 block text-xs font-medium text-gray-500">Statement closing balance</span>
                <input type="number" step="any" value={stmtBalance} onChange={(e) => setStmtBalance(e.target.value)} className="h-10 w-48 rounded-lg border border-gray-300 px-3 text-sm" placeholder="0.00" />
              </label>
              <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50">
                <Upload className="h-4 w-4" /> Import CSV
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => importCsv(e.target.files?.[0])} />
              </label>
              <button disabled={busy} onClick={finalize} className="inline-flex h-10 items-center gap-2 rounded-lg bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">
                <CheckCircle2 className="h-4 w-4" /> Finalize
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 px-5 py-4 sm:grid-cols-4">
              <Stat label="Book balance" value={money(view.bookBalance)} />
              <Stat label="Cleared" value={money(view.clearedBalance)} tone="text-emerald-700" />
              <Stat label="Uncleared" value={money(view.unclearedBalance)} tone="text-amber-700" />
              {diff !== null && <Stat label="Statement − Cleared" value={money(diff)} tone={Math.abs(diff) < 0.01 ? 'text-emerald-700' : 'text-rose-700'} />}
            </div>

            <div className="overflow-x-auto border-t border-gray-100">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr><th className="px-5 py-3 font-semibold">Cleared</th><th className="px-5 py-3 font-semibold">Date</th><th className="px-5 py-3 font-semibold">Details</th><th className="px-5 py-3 text-right font-semibold">In</th><th className="px-5 py-3 text-right font-semibold">Out</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {view.lines.map((l) => (
                    <tr key={l.id} className={l.reconciled ? 'bg-emerald-50/40' : ''}>
                      <td className="px-5 py-2"><input type="checkbox" checked={l.reconciled} onChange={() => toggle(l)} className="h-4 w-4 rounded border-gray-300" /></td>
                      <td className="px-5 py-2 text-gray-600">{l.entry_date ? formatNepalDate(l.entry_date) : '—'}</td>
                      <td className="px-5 py-2 text-gray-900">{l.memo || l.source_type || '—'}</td>
                      <td className="px-5 py-2 text-right tabular-nums text-emerald-700">{l.debit ? money(l.debit) : ''}</td>
                      <td className="px-5 py-2 text-right tabular-nums text-rose-700">{l.credit ? money(l.credit) : ''}</td>
                    </tr>
                  ))}
                  {view.lines.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-500">No bank movements for this account yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </AdminLayout>
  );
}

function recompute(v, lines) {
  const cleared = round2(lines.filter((l) => l.reconciled).reduce((s, l) => s + (l.debit - l.credit), 0));
  return { ...v, lines, clearedBalance: cleared, unclearedBalance: round2(v.bookBalance - cleared) };
}
function parseAmounts(text) {
  const out = [];
  for (const row of text.split(/\r?\n/)) {
    if (!row.trim()) continue;
    for (const cell of row.split(',')) {
      const n = Number(String(cell).replace(/[^0-9.-]/g, ''));
      if (String(cell).replace(/[^0-9.-]/g, '') !== '' && Number.isFinite(n) && n !== 0) { out.push(round2(n)); break; }
    }
  }
  return out;
}
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function Stat({ label, value, tone }) {
  return <div><p className="text-xs font-medium text-gray-500">{label}</p><p className={`mt-0.5 text-base font-bold tabular-nums ${tone || 'text-gray-900'}`}>{value}</p></div>;
}
