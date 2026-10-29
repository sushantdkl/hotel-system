'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import AdminLayout from '@/components/admin/admin-layout';
import { Search, X, Building2, ExternalLink, Wallet, ShieldAlert, ChevronRight, Printer } from 'lucide-react';
import { printCreditStatement } from '@/lib/pos-print';
import { useToast } from '@/components/ui/toast';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import { apiJson } from '@/lib/authed-fetch';
import LedgerTable, { money } from '@/components/accounting/ledger-table';
import { adminInputClass } from '@/components/ui/admin-form';
import DateInput from '@/components/ui/date-input.jsx';
import { resolvePeriodRange, formatNepalDisplay } from '@/lib/report-dates';
import { useCalendarSystem } from '@/lib/calendar-context.jsx';

const PERIODS = [
  { id: 'all', label: 'All Time' },
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'this_week', label: 'This Week' },
  { id: 'this_month', label: 'This Month' },
  { id: 'year', label: 'This Year' },
];

function newKey() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.random()}`;
}

export default function AccountsPayablePage() {
  const { calendarSystem } = useCalendarSystem();
  const pathname = usePathname();
  const suppliersPath = pathname?.startsWith('/cashier') ? '/cashier/suppliers' : '/admin/suppliers';
  const { addToast } = useToast();

  const [overview, setOverview] = useState({ payables: [], ageing: [], liabilities: [], banks: [], business_funding_available: 0 });
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState({});

  const [period, setPeriod] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('outstanding');
  const [historyPeriod, setHistoryPeriod] = useState('today');
  const [historyFrom, setHistoryFrom] = useState('');
  const [historyTo, setHistoryTo] = useState('');
  const [historyStatus, setHistoryStatus] = useState('all');
  const [historyQuery, setHistoryQuery] = useState('');
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [selected, setSelected] = useState(null); // { id, name, phone? }
  const [detail, setDetail] = useState({ invoices: [], statement: [] });
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [selectedInvoice, setSelectedInvoice] = useState(null); // stacked popup

  const [payFor, setPayFor] = useState(null);
  const [form, setForm] = useState({ amount: '', method: 'cash', bank_account_id: '', note: '' });
  const [busy, setBusy] = useState(false);
  const keyRef = useRef(newKey());

  const load = async () => {
    try { setOverview(await apiJson('/api/admin/accounts-payable')); }
    catch (error) { addToast(friendlyFromError(error, 'load_failed')); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    apiJson('/api/admin/settings').then((r) => setSettings(r.settings || {})).catch(() => {});
  }, []);

  const choosePeriod = (id) => {
    setPeriod(id);
    if (id === 'all') { setFrom(''); setTo(''); return; }
    const range = resolvePeriodRange(id, null, null, { calendarSystem });
    setFrom(range.start); setTo(range.end);
  };
  const editFrom = (v) => { setFrom(v); setPeriod('custom'); };
  const editTo = (v) => { setTo(v); setPeriod('custom'); };

  const chooseHistoryPeriod = (id) => {
    setHistoryPeriod(id);
    if (id === 'all') { setHistoryFrom(''); setHistoryTo(''); return; }
    const range = resolvePeriodRange(id, null, null, { calendarSystem });
    setHistoryFrom(range.start); setHistoryTo(range.end);
  };
  const editHistoryFrom = (v) => { setHistoryFrom(v); setHistoryPeriod('custom'); };
  const editHistoryTo = (v) => { setHistoryTo(v); setHistoryPeriod('custom'); };

  useEffect(() => {
    if (tab !== 'history') return;
    if (!historyFrom && !historyTo && historyPeriod !== 'all') { chooseHistoryPeriod(historyPeriod); return; }
    (async () => {
      setHistoryLoading(true);
      try {
        const params = new URLSearchParams({ view: 'history', status: historyStatus });
        if (historyFrom) params.set('from', historyFrom);
        if (historyTo) params.set('to', historyTo);
        if (historyQuery.trim()) params.set('search', historyQuery.trim());
        const data = await apiJson(`/api/admin/accounts-payable?${params}`);
        setHistory(data.history || []);
      } catch (error) { addToast(friendlyFromError(error, 'load_failed')); }
      finally { setHistoryLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, historyFrom, historyTo, historyStatus, historyQuery]);

  const openSupplier = (s) => { setSelected(s); setSelectedInvoice(null); };
  const closeSupplier = () => { setSelected(null); setDetail({ invoices: [], statement: [] }); setSelectedInvoice(null); };

  useEffect(() => {
    if (!selected) return;
    (async () => {
      setLoadingDetail(true);
      try {
        const params = new URLSearchParams({ supplier_id: selected.id });
        if (from) params.set('from', from);
        if (to) params.set('to', to);
        const d = await apiJson(`/api/admin/accounts-payable?${params}`);
        setDetail({ invoices: d.invoices || [], statement: d.statement || [] });
      } catch (error) { addToast(friendlyFromError(error, 'load_failed')); }
      finally { setLoadingDetail(false); }
    })();
  }, [selected, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const outstandingTotal = detail.invoices.reduce((s, i) => s + Number(i.outstanding || 0), 0);

  // Supplier statement lines carry no running balance (credit increases what we
  // owe, same convention as LedgerTable's debitNormal={false}) — build it here.
  const withRunningBalance = (lines) => {
    let bal = 0;
    return lines.map((l) => {
      bal += Number(l.credit || 0) - Number(l.debit || 0);
      return { date: l.entry_date, memo: l.memo, debit: l.debit, credit: l.credit, balance: bal };
    });
  };

  const printStatement = (supplier, statement, invoices, outstanding, mode = 'full') => {
    const lines = mode === 'due'
      ? (invoices || [])
          .filter((inv) => Number(inv.outstanding || 0) > 0.009)
          .map((inv) => ({
            date: inv.date,
            memo: inv.invoice_number || inv.description || `Purchase #${inv.purchase_id || '—'}`,
            due: Number(inv.outstanding || 0),
          }))
      : withRunningBalance(statement);
    printCreditStatement(
      { kind: 'supplier', name: supplier.name, phone: supplier.phone, outstanding, lines, mode },
      { settings }
    );
  };

  const printRowStatement = async (s, mode = 'full') => {
    try {
      const d = await apiJson(`/api/admin/accounts-payable?${new URLSearchParams({ supplier_id: s.id })}`);
      printStatement(s, d.statement || [], d.invoices || [], s.outstanding, mode);
    } catch (error) { addToast(friendlyFromError(error, 'load_failed')); }
  };

  const openPay = () => {
    if (!selected) return;
    setPayFor(selected);
    setForm({ amount: String(outstandingTotal), method: 'cash', bank_account_id: String(overview.banks?.[0]?.id || ''), note: '' });
  };

  const pay = async () => {
    if (!(Number(form.amount) > 0)) { addToast(friendlyMessage('validation', { description: 'Enter an amount.' })); return; }
    setBusy(true);
    try {
      await apiJson('/api/admin/accounts-payable', {
        method: 'POST',
        body: JSON.stringify({
          supplier_id: payFor.id,
          amount: Number(form.amount),
          method: form.method,
          bank_account_id: form.method === 'online' ? form.bank_account_id : null,
          note: form.note,
          external_ref: keyRef.current,
        }),
      });
      addToast(friendlyMessage('save_success', { description: 'Supplier payment posted.' }));
      keyRef.current = newKey();
      setPayFor(null);
      setSelectedInvoice(null);
      load();
      setSelected((prev) => (prev ? { ...prev } : prev)); // retrigger detail refetch
    } catch (error) { addToast(friendlyFromError(error, 'save_failed')); }
    finally { setBusy(false); }
  };

  const visibleSuppliers = useMemo(() => {
    const list = overview.payables || [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((s) => s.name?.toLowerCase().includes(q));
  }, [overview.payables, query]);

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Supplier Ledger</h1>
        <p className="mt-1 text-sm text-gray-500">Manage supplier statements and payments.</p>
      </header>

      <div className="space-y-6 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="rounded-2xl border border-gray-900 bg-gray-900 px-5 py-4 text-white">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Total outstanding to suppliers</span>
            <span className="text-xl font-bold tabular-nums">{money(overview.payables.reduce((s, p) => s + Number(p.outstanding || 0), 0))}</span>
          </div>
        </div>

        <PayableAgeing rows={overview.ageing} />

        <div className="flex gap-2 border-b border-gray-200">
          <button type="button" onClick={() => setTab('outstanding')} className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${tab === 'outstanding' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            Outstanding
          </button>
          <button type="button" onClick={() => setTab('history')} className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${tab === 'history' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            History
          </button>
        </div>

        {tab === 'history' ? (
          <div className="space-y-4">
            <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5">
              <div className="flex flex-wrap gap-2">
                {PERIODS.map((p) => (
                  <button key={p.id} type="button" onClick={() => chooseHistoryPeriod(p.id)} className={`rounded-full border px-3.5 py-1.5 text-sm font-medium ${historyPeriod === p.id ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">From</span><DateInput value={historyFrom} onChange={editHistoryFrom} className={INPUT} /></label>
                <span className="pb-2 text-gray-400">—</span>
                <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">To</span><DateInput value={historyTo} onChange={editHistoryTo} className={INPUT} /></label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-600">Status</span>
                  <select value={historyStatus} onChange={(e) => setHistoryStatus(e.target.value)} className={INPUT}>
                    <option value="all">All</option>
                    <option value="charged">Purchases / Charges</option>
                    <option value="paid">Payments</option>
                    <option value="reversed">Reversals</option>
                  </select>
                </label>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input value={historyQuery} onChange={(e) => setHistoryQuery(e.target.value)} placeholder="Search by supplier name..." className={`${INPUT} pl-9`} />
              </div>
            </div>

            <Panel title={`Ledger history (${history.length})`}>
              <div className="divide-y divide-gray-100">
                {historyLoading ? (
                  <p className="px-5 py-8 text-center text-sm text-gray-500">Loading…</p>
                ) : history.length === 0 ? (
                  <p className="px-5 py-8 text-center text-sm text-gray-500">No supplier ledger activity in this range.</p>
                ) : history.map((row) => (
                  <div key={row.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-gray-900">{row.supplier_name}</span>
                      <span className="block text-xs text-gray-400">{formatNepalDisplay(String(row.date || '').slice(0, 10))}{row.memo ? ` — ${row.memo}` : ''}</span>
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${row.status === 'reversed' ? 'bg-amber-100 text-amber-800' : row.status === 'charged' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      {row.status}
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-gray-900">{money(row.debit > 0 ? row.debit : row.credit)}</span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        ) : (
        <>

        <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex flex-wrap gap-2">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => choosePeriod(p.id)}
                className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  period === p.id ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400">Applies to the statement inside each supplier&rsquo;s ledger — the list below is everyone currently owed.</p>

          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-600">From</span>
              <DateInput value={from} onChange={editFrom} className={INPUT} />
            </label>
            <span className="pb-2 text-gray-400">—</span>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-600">To</span>
              <DateInput value={to} onChange={editTo} className={INPUT} />
            </label>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search supplier by name..."
              className={`${INPUT} pl-9`}
            />
          </div>
        </div>

        {!loading && visibleSuppliers.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white px-6 py-16 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100">
              <Building2 className="h-6 w-6 text-gray-400" />
            </div>
            <h3 className="text-base font-bold text-gray-900">{query ? 'No match' : 'No Outstanding Payables'}</h3>
            <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">
              {query ? 'No supplier matches that search.' : "You don't owe any supplier anything right now."}
            </p>
            {!query && (
              <div className="mx-auto mt-6 flex max-w-md flex-col items-center gap-2 sm:flex-row sm:justify-center">
                <span className="inline-flex items-center gap-2 rounded-full bg-gray-50 px-4 py-2 text-xs font-medium text-gray-600"><Wallet className="h-3.5 w-3.5" />Track payments</span>
                <span className="inline-flex items-center gap-2 rounded-full bg-gray-50 px-4 py-2 text-xs font-medium text-gray-600"><ShieldAlert className="h-3.5 w-3.5" />Monitor dues</span>
              </div>
            )}
          </div>
        ) : (
          <Panel title={`Suppliers with dues (${visibleSuppliers.length})`}>
            <div className="divide-y divide-gray-100">
              {visibleSuppliers.map((s) => (
                <div
                  key={s.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openSupplier(s)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openSupplier(s); }}
                  className="flex w-full cursor-pointer items-center gap-3 px-5 py-3 text-left hover:bg-gray-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900">{s.name}</p>
                    {s.phone && <p className="text-xs text-gray-400">{s.phone}</p>}
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-rose-700">{money(s.outstanding)}</span>
                  <PrintStatementMenu variant="icon" onPrint={(mode) => printRowStatement(s, mode)} />
                  <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
                </div>
              ))}
            </div>
          </Panel>
        )}
        </>
        )}
      </div>

      {/* Supplier popup */}
      {selected && (
        <div className="fixed inset-y-0 left-0 right-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-5 lg:left-[var(--admin-sidebar-offset,5rem)]" role="dialog" aria-modal="true" aria-labelledby="supplier-credit-title">
          <div className="flex max-h-[96dvh] w-full max-w-6xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-h-[92dvh] sm:rounded-3xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 sm:px-7 sm:py-5">
              <div>
                <h2 id="supplier-credit-title" className="text-xl font-bold text-gray-950 sm:text-2xl">{selected.name}</h2>
                <p className="mt-0.5 text-sm text-gray-500">Supplier credit account · {selected.phone || 'No phone on file'}</p>
              </div>
              <button type="button" onClick={closeSupplier} aria-label="Close supplier credit details" className="rounded-xl p-2.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X className="h-5 w-5" /></button>
            </div>

            <div className="flex-1 space-y-7 overflow-y-auto p-5 sm:p-7">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 sm:p-5">
                  <p className="text-xs font-bold uppercase tracking-wide text-rose-700">Total we still owe</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-rose-800 sm:text-3xl">{money(outstandingTotal)}</p>
                  <p className="mt-1 text-xs text-rose-700">Amount to pay this supplier</p>
                </div>
                <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
                  <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Open invoices</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-gray-950 sm:text-3xl">{detail.invoices.length}</p>
                  <p className="mt-1 text-xs text-gray-500">Purchases that still have a balance</p>
                </div>
                <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
                  <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Ledger entries</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-gray-950 sm:text-3xl">{detail.statement.length}</p>
                  <p className="mt-1 text-xs text-gray-500">Invoices, payments and adjustments</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 border-b border-gray-100 pb-6">
                <Link href={`${suppliersPath}/${selected.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  <ExternalLink className="h-4 w-4" /> View supplier profile
                </Link>
                <button type="button" disabled={outstandingTotal <= 0} onClick={openPay} className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-40">
                  Pay supplier
                </button>
                <PrintStatementMenu onPrint={(mode) => printStatement(selected, detail.statement, detail.invoices, outstandingTotal, mode)} />
              </div>

              <div>
                <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-gray-950">Invoices still awaiting payment</h3>
                    <p className="mt-0.5 text-sm text-gray-500">Select an invoice to see its balance and how supplier payments are applied.</p>
                  </div>
                  <span className="text-xs font-medium text-gray-400">Invoice total → amount due</span>
                </div>
                <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200">
                  {detail.invoices.map((inv, i) => (
                    <button
                      key={inv.purchase_id || i}
                      type="button"
                      onClick={() => setSelectedInvoice(inv)}
                      className="flex w-full flex-wrap items-center gap-3 bg-white px-4 py-4 text-left hover:bg-gray-50 sm:px-5"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-gray-900">{inv.invoice_number || inv.description || `Purchase #${inv.purchase_id || '—'}`}</span>
                        <span className="block text-xs text-gray-400">{formatNepalDisplay(String(inv.date || '').slice(0, 10))}</span>
                      </span>
                      <span className="text-sm tabular-nums text-gray-500">{money(inv.total)}</span>
                      <span className="text-sm font-semibold tabular-nums text-rose-700">{money(inv.outstanding)} due</span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
                    </button>
                  ))}
                  {!loadingDetail && detail.invoices.length === 0 && (
                    <p className="bg-white px-4 py-8 text-center text-sm text-gray-500">No open invoices for this supplier.</p>
                  )}
                </div>
              </div>

              <div>
                <div className="mb-3">
                  <h3 className="text-base font-bold text-gray-950">Supplier statement</h3>
                  <p className="mt-0.5 text-sm text-gray-500"><span className="font-semibold text-gray-700">Credit</span> adds to what we owe the supplier. <span className="font-semibold text-gray-700">Debit</span> is a payment or adjustment that reduces it.</p>
                </div>
                <LedgerTable
                  lines={detail.statement}
                  debitNormal={false}
                  loading={loadingDetail}
                  empty="No transactions in this date range."
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Invoice popup, stacked above the supplier popup — view-only: supplier
          payments settle oldest-invoice-first, there's no per-invoice ledger to pay against. */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white overflow-hidden">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{selectedInvoice.invoice_number || selectedInvoice.description || `Purchase #${selectedInvoice.purchase_id || '—'}`}</h2>
                <p className="text-sm text-gray-500">{formatNepalDisplay(String(selectedInvoice.date || '').slice(0, 10))}</p>
              </div>
              <button type="button" onClick={() => setSelectedInvoice(null)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="rounded-xl bg-gray-50 px-4 py-3 space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Invoice total</span><span className="font-semibold tabular-nums text-gray-900">{money(selectedInvoice.total)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Outstanding</span><span className="font-bold tabular-nums text-rose-700">{money(selectedInvoice.outstanding)}</span></div>
              </div>
              <p className="text-xs text-gray-400">Supplier payments settle the oldest open invoice first, so paying here pays the supplier, applied automatically starting with this or an older invoice.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={outstandingTotal <= 0} onClick={openPay} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-40">
                  Pay supplier
                </button>
                {selectedInvoice.purchase_id && (
                  <Link href="/admin/purchases" className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                    <ExternalLink className="h-4 w-4" /> Open in Purchases
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {payFor && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-t-2xl bg-white p-6 sm:rounded-2xl sm:p-8 max-h-[94dvh] overflow-y-auto">
            <h3 className="mb-1 text-lg font-bold text-gray-900">Pay {payFor.name}</h3>
            <p className="mb-4 text-sm text-gray-500">Outstanding {money(outstandingTotal)}</p>
            <div className="space-y-3">
              <Field label="Amount"><input type="number" min="0" step="any" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className={INPUT} /></Field>
              <Field label="Method">
                <select value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))} className={INPUT}>
                  <option value="cash">Cash</option>
                  <option value="online">Online</option>
                  <option value="business_funding">Business Funding</option>
                </select>
              </Field>
              {form.method === 'business_funding' && (
                <p className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-800">
                  Available Business Funding: {money(overview.business_funding_available)}
                </p>
              )}
              <Field label="Note"><input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} className={INPUT} placeholder="optional" /></Field>
            </div>
            <div className="mt-6 flex gap-3">
              <button disabled={busy} onClick={pay} className="flex-1 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">
                {busy ? 'Saving…' : 'Post payment'}
              </button>
              <button type="button" onClick={() => setPayFor(null)} className="flex-1 rounded-lg bg-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-300">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

function Panel({ title, children }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-5 py-4"><h2 className="text-sm font-semibold text-gray-900">{title}</h2></div>
      {children}
    </section>
  );
}

/**
 * Print statement in one of two shapes: the full running ledger (paid + due),
 * or just the invoices still outstanding. Both come off the same thermal printer.
 */
function PrintStatementMenu({ onPrint, variant = 'button' }) {
  const [open, setOpen] = useState(false);
  const pick = (mode) => (e) => { e.stopPropagation(); setOpen(false); onPrint(mode); };
  return (
    <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
      {variant === 'icon' ? (
        <button type="button" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700" title="Print statement">
          <Printer className="h-4 w-4" />
        </button>
      ) : (
        <button type="button" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
          <Printer className="h-4 w-4" /> Print statement
        </button>
      )}
      {open && (
        <>
          <div className="fixed inset-0 z-[80]" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <div className="absolute right-0 z-[90] mt-1 w-56 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
            <button type="button" onClick={pick('full')} className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50">All transactions (paid &amp; due)</button>
            <button type="button" onClick={pick('due')} className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50">Only what&rsquo;s due</button>
          </div>
        </>
      )}
    </div>
  );
}
function Field({ label, children }) {
  return <label className="block"><span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>{children}</label>;
}
const INPUT = adminInputClass;

const AGE_BUCKETS = [
  { key: '0-30', label: '0–30 days', tone: 'text-emerald-700' },
  { key: '31-60', label: '31–60 days', tone: 'text-amber-700' },
  { key: '61-90', label: '61–90 days', tone: 'text-orange-700' },
  { key: '90+', label: 'Over 90 days', tone: 'text-rose-700' },
];

function PayableAgeing({ rows }) {
  const list = rows || [];
  if (!list.length) return null;
  const totals = AGE_BUCKETS.map((bucket) => ({
    ...bucket,
    amount: list.reduce((sum, row) => sum + Number(row[bucket.key] || 0), 0),
  }));
  const grand = totals.reduce((sum, bucket) => sum + bucket.amount, 0);
  if (grand <= 0) return null;
  const oldest = [...list].sort((a, b) => Number(b['90+'] || 0) - Number(a['90+'] || 0))[0];

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-gray-900">How long supplier balances have been owed</h2>
        <p className="mt-0.5 text-sm text-gray-500">The same {money(grand)} split by age, so overdue supplier balances are easy to spot.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {totals.map((bucket) => (
          <div key={bucket.key} className="rounded-xl border border-gray-200 p-4">
            <p className="text-xs font-medium text-gray-500">{bucket.label}</p>
            <p className={`mt-1.5 text-lg font-bold tabular-nums ${bucket.amount > 0 ? bucket.tone : 'text-gray-300'}`}>{money(bucket.amount)}</p>
            <p className="mt-0.5 text-xs text-gray-400">{grand ? Math.round((bucket.amount / grand) * 100) : 0}% of what is owed</p>
          </div>
        ))}
      </div>
      {oldest && Number(oldest['90+'] || 0) > 0 && (
        <p className="mt-4 rounded-lg bg-rose-50 px-3.5 py-2.5 text-sm text-rose-800">
          <span className="font-semibold">{oldest.name}</span> has {money(oldest['90+'])} outstanding for more than 90 days.
        </p>
      )}
    </section>
  );
}
