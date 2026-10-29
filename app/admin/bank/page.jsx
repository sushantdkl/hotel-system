'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import { ArrowDownToLine, ArrowUpFromLine, CirclePlus, CircleMinus } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import { apiJson } from '@/lib/authed-fetch';
import { formatNepalDateTime } from '@/lib/report-dates.js';
import HistoryFilters from '@/components/accounting/history-filters.jsx';
import PaginationControls from '@/components/ui/pagination-controls.jsx';

const KINDS = [
  { id: 'deposit', label: 'Deposit (cash → bank)', icon: ArrowDownToLine },
  { id: 'withdrawal', label: 'Withdraw (bank → cash)', icon: ArrowUpFromLine },
  { id: 'online_in', label: 'Online Money In', icon: CirclePlus },
  { id: 'online_out', label: 'Online Money Out', icon: CircleMinus },
];

const ONLINE_TYPES = {
  online_in: [
    { id: 'owner_contribution', label: 'Owner contribution' },
    { id: 'business_funding', label: 'Transfer from Business Funding' },
    { id: 'other', label: 'Other / correction' },
  ],
  online_out: [
    { id: 'owner_withdrawal', label: 'Owner withdrawal' },
    { id: 'return_to_funding', label: 'Return to Business Funding' },
    { id: 'other', label: 'Other / correction' },
  ],
};

export default function BankPage() {
  const { addToast } = useToast();
  const [banks, setBanks] = useState([]);
  const [movements, setMovements] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ action: 'deposit', amount: '', bank_account_id: '', to_bank_account_id: '', movement_type: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState({ search: '', from: '', to: '', selectValue: '', bankId: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [pagination, setPagination] = useState({ page: 1, page_size: 25, total: 0, total_pages: 1 });
  const keyRef = useRef(newKey());

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      if (filters.search) q.set('search', filters.search);
      if (filters.from) q.set('from', filters.from);
      if (filters.to) q.set('to', filters.to);
      if (filters.selectValue) q.set('direction', filters.selectValue);
      if (filters.bankId) q.set('bank_id', filters.bankId);
      const d = await apiJson(`/api/admin/bank?${q}`);
      setBanks(d.banks || []);
      setMovements(d.movements || []);
      setPagination(d.pagination || { page, page_size: pageSize, total: 0, total_pages: 1 });
      setForm((f) => ({ ...f, bank_account_id: f.bank_account_id || String(d.banks?.[0]?.id || '') }));
    } catch (error) { addToast(friendlyFromError(error, 'load_failed')); }
    finally { setLoading(false); }
  }, [addToast, filters, page, pageSize]);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!(Number(form.amount) > 0)) { addToast(friendlyMessage('validation', { description: 'Enter an amount.' })); return; }
    setBusy(true);
    try {
      await apiJson('/api/admin/bank', { method: 'POST', body: JSON.stringify({ ...form, amount: Number(form.amount), external_ref: keyRef.current }) });
      addToast(friendlyMessage('save_success', { description: 'Recorded and journaled.' }));
      keyRef.current = newKey();
      setForm((f) => ({ ...f, amount: '', note: '' }));
      await load();
    } catch (error) { addToast(friendlyFromError(error, 'save_failed')); }
    finally { setBusy(false); }
  };

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Online</h1>
        <p className="mt-1 text-sm text-gray-500">All non-cash payments use this one Online balance. No provider selection or settlement is required.</p>
      </header>

      <div className="space-y-6 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {banks.map((b) => (
            <div key={b.id} className="rounded-2xl border border-gray-200 bg-white p-4">
              <p className="font-semibold text-gray-900">{b.name}</p>
              <p className="text-xs text-gray-500">{b.account_number || 'No account number'}</p>
              <p className={`mt-3 text-lg font-bold tabular-nums ${Number(b.balance) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>Rs {Number(b.balance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
            </div>
          ))}
          {!loading && banks.length === 0 && <p className="text-sm text-gray-500">No bank accounts yet.</p>}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Record a movement</h2>
          <div className="mb-4 flex flex-wrap gap-2">
            {KINDS.map((k) => (
              <button key={k.id} onClick={() => setForm((f) => ({ ...f, action: k.id, movement_type: ONLINE_TYPES[k.id]?.[0]?.id || '' }))} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${form.action === k.id ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
                <k.icon className="h-4 w-4" /> {k.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block"><span className="mb-1 block text-sm font-medium text-gray-700">{form.action === 'transfer' ? 'From bank' : 'Bank account'}</span>
              <select value={form.bank_account_id} onChange={(e) => setForm((f) => ({ ...f, bank_account_id: e.target.value }))} className={INPUT}>
                {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            {form.action === 'transfer' && (
              <label className="block"><span className="mb-1 block text-sm font-medium text-gray-700">To bank</span>
                <select value={form.to_bank_account_id} onChange={(e) => setForm((f) => ({ ...f, to_bank_account_id: e.target.value }))} className={INPUT}>
                  <option value="">Select…</option>
                  {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
            )}
            {ONLINE_TYPES[form.action] && (
              <label className="block"><span className="mb-1 block text-sm font-medium text-gray-700">{form.action === 'online_in' ? 'Money came from' : 'Money went to'}</span>
                <select value={form.movement_type} onChange={(e) => setForm((f) => ({ ...f, movement_type: e.target.value }))} className={INPUT}>
                  {ONLINE_TYPES[form.action].map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
                </select>
              </label>
            )}
            <label className="block"><span className="mb-1 block text-sm font-medium text-gray-700">Amount</span><input type="number" min="0" step="any" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className={INPUT} placeholder="0.00" /></label>
            <label className="block"><span className="mb-1 block text-sm font-medium text-gray-700">Reason / note</span><input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} className={INPUT} placeholder={ONLINE_TYPES[form.action] ? 'required' : 'optional'} /></label>
          </div>
          <button disabled={busy || !banks.length} onClick={submit} className="mt-4 h-11 rounded-lg bg-gray-900 px-5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">{busy ? 'Saving…' : 'Record'}</button>
        </div>

        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-5 py-4"><h2 className="text-lg font-semibold text-gray-900">Online history</h2><p className="text-xs text-gray-500">Green adds to Online; red removes from it. Click a row for the full journal.</p></div>
          <HistoryFilters
            search={filters.search}
            from={filters.from}
            to={filters.to}
            selectValue={filters.selectValue}
            selectLabel="Direction"
            selectOptions={[{ value: '', label: 'Money in & out' }, { value: 'in', label: 'Money in' }, { value: 'out', label: 'Money out' }]}
            searchPlaceholder="Details, journal, bank, or employee…"
            onChange={(patch) => { setFilters((value) => ({ ...value, ...patch })); setPage(1); }}
          />
          {banks.length > 1 && (
            <div className="border-b border-gray-200 px-4 py-3">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-gray-600">Bank
                <select value={filters.bankId} onChange={(event) => { setFilters((value) => ({ ...value, bankId: event.target.value })); setPage(1); }} className="h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900">
                  <option value="">All bank accounts</option>
                  {banks.map((bank) => <option key={bank.id} value={bank.id}>{bank.name}</option>)}
                </select>
              </label>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm"><thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-4 py-3 text-left">Date</th><th className="px-4 py-3 text-left">Details</th><th className="px-4 py-3 text-left">Bank</th><th className="px-4 py-3 text-right">Change</th></tr></thead>
              <tbody>{movements.map((row) => <tr key={`${row.journal_id}-${row.bank_account_id}`} onClick={() => setSelected(row)} className="cursor-pointer border-t border-gray-100 hover:bg-gray-50"><td className="whitespace-nowrap px-4 py-3 text-gray-500">{formatNepalDateTime(row.created_at)}</td><td className="px-4 py-3"><p className="font-medium text-gray-900">{row.memo}</p><p className="text-xs text-gray-500">Journal #{row.journal_id}{row.source_type === 'reversal' ? ` · reverses #${row.reversed_journal_id}` : ''}</p></td><td className="px-4 py-3 text-gray-600">{row.bank_name || 'Unassigned bank'}</td><td className={`px-4 py-3 text-right font-semibold tabular-nums ${Number(row.bank_delta) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{Number(row.bank_delta) >= 0 ? '+' : '−'} Rs {Math.abs(Number(row.bank_delta || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td></tr>)}</tbody>
            </table>
            {!movements.length && <p className="px-5 py-10 text-center text-sm text-gray-500">No bank or online movements recorded yet.</p>}
          </div>
          <div className="px-4 pb-4"><PaginationControls pagination={pagination} loading={loading} onPageChange={setPage} onPageSizeChange={(value) => { setPageSize(value); setPage(1); }} /></div>
        </div>

        {selected && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={() => setSelected(null)}><div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-xl" onMouseDown={(event) => event.stopPropagation()}><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Journal #{selected.journal_id}</p><h2 className="mt-1 text-lg font-semibold text-gray-900">{selected.memo}</h2><p className="mt-1 text-sm text-gray-500">{formatNepalDateTime(selected.created_at)} · {selected.created_by_name || 'System'}</p></div><button onClick={() => setSelected(null)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">Close</button></div>{selected.source_type === 'reversal' && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">This correction reverses journal #{selected.reversed_journal_id}: {selected.original_memo}</p>}<div className="mt-4 overflow-hidden rounded-xl border border-gray-200"><table className="w-full text-sm"><thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="px-3 py-2 text-left">Account</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th><th className="px-3 py-2 text-right">Effect</th></tr></thead><tbody>{selected.lines.map((line, index) => { const effect = accountEffect(line); return <tr key={index} className="border-t border-gray-100"><td className="px-3 py-2"><span className="font-medium">{line.code}</span> {line.name}{line.bank_name ? <span className="block text-xs text-gray-500">{line.bank_name}</span> : null}</td><td className="px-3 py-2 text-right tabular-nums text-gray-600">{Number(line.debit) ? `Rs ${Number(line.debit).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}</td><td className="px-3 py-2 text-right tabular-nums text-gray-600">{Number(line.credit) ? `Rs ${Number(line.credit).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}</td><td className={`px-3 py-2 text-right font-semibold tabular-nums ${effect < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{effect >= 0 ? '+' : '−'} Rs {Math.abs(effect).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td></tr>; })}</tbody></table></div></div></div>}
      </div>
    </AdminLayout>
  );
}

const INPUT = 'h-11 w-full rounded-lg border border-gray-300 px-3 text-sm text-gray-900';

// Idempotency key: same value on a double-submit/retry, fresh per new operation.
function newKey() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.random()}`;
}

function accountEffect(line) {
  const debitNormal = line.type === 'asset' || line.type === 'expense';
  return debitNormal ? Number(line.debit || 0) - Number(line.credit || 0) : Number(line.credit || 0) - Number(line.debit || 0);
}
