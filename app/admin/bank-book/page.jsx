'use client';

import { useEffect, useState } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import { useToast } from '@/components/ui/toast';
import { friendlyFromError } from '@/lib/friendly-message';
import { apiJson } from '@/lib/authed-fetch';
import LedgerTable from '@/components/accounting/ledger-table';
import DateInput from '@/components/ui/date-input.jsx';

export default function BankBookPage() {
  const { addToast } = useToast();
  const [banks, setBanks] = useState([]);
  const [bankId, setBankId] = useState('');
  const [range, setRange] = useState({ from: '', to: '' });
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiJson('/api/admin/ledger?view=meta').then((d) => setBanks(d.banks || [])).catch((e) => addToast(friendlyFromError(e, 'load_failed')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setLoading(true);
    const q = new URLSearchParams({ view: 'bankbook' });
    if (bankId) q.set('bank_account_id', bankId);
    if (range.from) q.set('from', range.from);
    if (range.to) q.set('to', range.to);
    apiJson(`/api/admin/ledger?${q}`).then((d) => setLines(d.lines || [])).catch(() => setLines([])).finally(() => setLoading(false));
  }, [bankId, range]);

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Bank Book</h1>
        <p className="mt-1 text-sm text-gray-500">Deposits, withdrawals, transfers and settled digital payments per bank account.</p>
      </header>
      <div className="space-y-5 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block"><span className="mb-1 block text-xs font-medium text-gray-500">Bank account</span>
            <select value={bankId} onChange={(e) => setBankId(e.target.value)} className="h-10 rounded-lg border border-gray-300 px-3 text-sm text-gray-700">
              <option value="">All banks</option>
              {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-gray-500">From</span><DateInput value={range.from} onChange={(v) => setRange((r) => ({ ...r, from: v }))} className="h-10 rounded-lg border border-gray-300 px-3 text-sm" /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-gray-500">To</span><DateInput value={range.to} onChange={(v) => setRange((r) => ({ ...r, to: v }))} className="h-10 rounded-lg border border-gray-300 px-3 text-sm" /></label>
        </div>
        <LedgerTable lines={lines} debitNormal loading={loading} empty="No bank movements in range." />
      </div>
    </AdminLayout>
  );
}
