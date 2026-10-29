'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import AdminLayout from '@/components/admin/admin-layout';
import { Search, X, User, ExternalLink, Wallet, ShieldAlert, ChevronRight, Printer, Pencil } from 'lucide-react';
import { printCreditStatement } from '@/lib/pos-print';
import { useToast } from '@/components/ui/toast';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import { apiJson } from '@/lib/authed-fetch';
import LedgerTable, { money } from '@/components/accounting/ledger-table';
import { adminInputClass } from '@/components/ui/admin-form';
import DateInput from '@/components/ui/date-input.jsx';
import { resolvePeriodRange, formatNepalDisplay } from '@/lib/report-dates';
import { useCalendarSystem } from '@/lib/calendar-context.jsx';
import { useCapabilities } from '@/lib/use-capabilities.js';

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

export default function AccountsReceivablePage() {
  const { calendarSystem } = useCalendarSystem();
  const router = useRouter();
  const pathname = usePathname();
  const isCashier = pathname?.startsWith('/cashier');
  const customerPath = isCashier ? '/cashier/customers' : '/admin/customers';
  const posPath = isCashier ? '/cashier/pos' : '/admin/pos';
  const { addToast } = useToast();
  const { can } = useCapabilities();

  const [overview, setOverview] = useState({ receivables: [], ageing: [], ar_balance: 0, banks: [] });
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState({});

  const [period, setPeriod] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [query, setQuery] = useState('');

  const [tab, setTab] = useState('outstanding'); // 'outstanding' | 'history'
  const [historyPeriod, setHistoryPeriod] = useState('today');
  const [historyFrom, setHistoryFrom] = useState('');
  const [historyTo, setHistoryTo] = useState('');
  const [historyStatus, setHistoryStatus] = useState('all'); // all | charged | paid
  const [historyQuery, setHistoryQuery] = useState('');
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Customer popup
  const [selected, setSelected] = useState(null); // { id, name, phone, is_vip }
  const [detail, setDetail] = useState({ bills: [], statement: [] });
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Order popup, stacked on top of the customer popup
  const [selectedBill, setSelectedBill] = useState(null); // the bill row clicked
  const [orderDetail, setOrderDetail] = useState(null);
  const [loadingOrder, setLoadingOrder] = useState(false);

  // Pay / discount form — { scope: 'customer'|'bill', mode: 'pay'|'writeoff', target }
  const [actionFor, setActionFor] = useState(null);
  const [form, setForm] = useState({ amount: '', discount_amount: '', discount_reason: '', method: 'cash', note: '' });
  const [busy, setBusy] = useState(false);
  const keyRef = useRef(newKey());
  const [methodCorrection, setMethodCorrection] = useState(null);
  const [correctionMethod, setCorrectionMethod] = useState('online');
  const [correctionReason, setCorrectionReason] = useState('');

  const load = async () => {
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      setOverview(await apiJson(`/api/admin/accounts-receivable?${params}`));
    }
    catch (error) { addToast(friendlyFromError(error, 'load_failed')); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps
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
        const d = await apiJson(`/api/admin/accounts-receivable?${params}`);
        setHistory(d.history || []);
      } catch (error) { addToast(friendlyFromError(error, 'load_failed')); }
      finally { setHistoryLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, historyFrom, historyTo, historyStatus, historyQuery]);

  const openCustomer = (c) => { setSelected(c); setSelectedBill(null); setOrderDetail(null); };
  const closeCustomer = () => { setSelected(null); setDetail({ bills: [], statement: [] }); setSelectedBill(null); setOrderDetail(null); };

  useEffect(() => {
    if (!selected) return;
    (async () => {
      setLoadingDetail(true);
      try {
        const params = new URLSearchParams({ customer_id: selected.id });
        if (from) params.set('from', from);
        if (to) params.set('to', to);
        const d = await apiJson(`/api/admin/accounts-receivable?${params}`);
        setDetail({ bills: d.bills || [], statement: d.statement || [] });
      } catch (error) { addToast(friendlyFromError(error, 'load_failed')); }
      finally { setLoadingDetail(false); }
    })();
  }, [selected, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const printStatement = (customer, statement, bills, outstanding, mode = 'full') => {
    const lines = mode === 'due'
      ? (bills || [])
          .filter((b) => Number(b.outstanding_amount || 0) > 0.009)
          .map((b) => ({ date: b.created_at, memo: b.bill_number, due: Number(b.outstanding_amount || 0) }))
      : statement;
    printCreditStatement(
      { kind: 'customer', name: customer.name, phone: customer.phone, outstanding, lines, mode },
      { settings }
    );
  };

  const printRowStatement = async (c, mode = 'full') => {
    try {
      const d = await apiJson(`/api/admin/accounts-receivable?${new URLSearchParams({ customer_id: c.id })}`);
      printStatement(c, d.statement || [], d.bills || [], c.outstanding, mode);
    } catch (error) { addToast(friendlyFromError(error, 'load_failed')); }
  };

  const openOrder = async (bill) => {
    setSelectedBill(bill);
    setOrderDetail(null);
    if (!bill.order_id) return;
    setLoadingOrder(true);
    try {
      const res = await apiJson(`/api/admin/pos/orders/${bill.order_id}`);
      setOrderDetail(res.workspace || null);
    } catch (error) { addToast(friendlyFromError(error, 'load_failed')); }
    finally { setLoadingOrder(false); }
  };
  const closeOrder = () => { setSelectedBill(null); setOrderDetail(null); };

  const refreshAfterMoney = async () => {
    await load();
    if (selected) setSelected((prev) => (prev ? { ...prev } : prev)); // retrigger detail refetch
  };

  const outstandingTotal = detail.bills.reduce((s, b) => s + Number(b.outstanding_amount || 0), 0);

  const openAction = (scope, target = null) => {
    const defaultAmount = scope === 'bill' ? Number(target.outstanding_amount || 0) : outstandingTotal;
    setActionFor({ scope, target });
    setForm({ amount: String(defaultAmount), discount_amount: '', discount_reason: '', method: 'cash', note: '' });
  };

  const submitAction = async () => {
    const paymentAmount = Number(form.amount || 0);
    const discountAmount = Number(form.discount_amount || 0);
    const due = Number(actionFor.scope === 'bill' ? actionFor.target.outstanding_amount : outstandingTotal);
    if (paymentAmount < 0) { addToast(friendlyMessage('validation', { description: 'Payment cannot be negative.' })); return; }
    if (discountAmount < 0) { addToast(friendlyMessage('validation', { description: 'Discount cannot be negative.' })); return; }
    if (!(paymentAmount > 0) && !(discountAmount > 0)) { addToast(friendlyMessage('validation', { description: 'Enter a payment or discount amount.' })); return; }
    if (paymentAmount + discountAmount > due + 0.001) { addToast(friendlyMessage('validation', { description: 'Payment plus discount cannot exceed the outstanding balance.' })); return; }
    if (discountAmount > 0 && !form.discount_reason.trim()) { addToast(friendlyMessage('validation', { description: 'Enter a reason for the discount.' })); return; }
    setBusy(true);
    try {
      const body = actionFor.scope === 'bill'
        ? { bill_id: actionFor.target.id }
        : { customer_id: selected.id };
      body.amount = paymentAmount;
      body.discount_amount = discountAmount;
      body.discount_reason = form.discount_reason.trim();
      body.method = form.method;
      body.note = form.note;
      body.external_ref = keyRef.current;
      const result = await apiJson('/api/admin/accounts-receivable', { method: 'POST', body: JSON.stringify(body) });
      addToast(friendlyMessage('save_success', {
        description: discountAmount > 0 ? 'Payment and discount recorded.' : 'Payment recorded.',
      }));
      keyRef.current = newKey();
      setActionFor(null);
      await refreshAfterMoney();
      // Bill-scoped actions return the bill's fresh outstanding directly —
      // a re-fetch race would otherwise leave the still-open order popup
      // showing the pre-payment amount for a beat (or forever, on a partial).
      if (actionFor.scope === 'bill' && selectedBill) {
        const nextOutstanding = Number(result.outstanding ?? 0);
        if (nextOutstanding <= 0.009) {
          closeOrder();
        } else {
          setSelectedBill((prev) => (prev ? { ...prev, outstanding_amount: nextOutstanding, payment_status: result.status || prev.payment_status } : prev));
        }
      }
    } catch (error) { addToast(friendlyFromError(error, 'save_failed')); }
    finally { setBusy(false); }
  };

  const openMethodCorrection = (payment) => {
    setMethodCorrection(payment);
    setCorrectionMethod(payment.payment_method === 'cash' ? 'online' : 'cash');
    setCorrectionReason('');
  };

  const submitMethodCorrection = async () => {
    if (!correctionReason.trim()) {
      addToast(friendlyMessage('validation', { description: 'Enter why the payment method is being corrected.' }));
      return;
    }
    setBusy(true);
    try {
      const result = await apiJson('/api/admin/accounts-receivable', {
        method: 'PATCH',
        body: JSON.stringify({
          payment_id: methodCorrection.payment_id,
          method: correctionMethod,
          reason: correctionReason.trim(),
          external_ref: newKey(),
        }),
      });
      setHistory((rows) => rows.map((row) => row.payment_id === result.payment_id
        ? { ...row, payment_method: result.method }
        : row));
      setMethodCorrection(null);
      await load();
      addToast(friendlyMessage('save_success', { description: `Payment changed to ${result.method === 'cash' ? 'Cash' : 'Online'}. Customer balance was not changed.` }));
    } catch (error) {
      addToast(friendlyFromError(error, 'save_failed'));
    } finally {
      setBusy(false);
    }
  };

  const visibleCustomers = useMemo(() => {
    const list = overview.receivables || [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) => c.name?.toLowerCase().includes(q) || String(c.phone || '').includes(q));
  }, [overview.receivables, query]);

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Customer Ledger</h1>
        <p className="mt-1 text-sm text-gray-500">Who owes you on a named credit account, how long it has been outstanding, and what they have paid.</p>
      </header>

      <div className="space-y-6 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="rounded-2xl border border-gray-900 bg-gray-900 px-5 py-4 text-white">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Owed on credit accounts</span>
            <span className="text-xl font-bold tabular-nums">{money(overview.ar_balance)}</span>
          </div>
          {/*
            Named so it cannot be mistaken for the Reports figure. This counts
            named credit customers only; Reports &gt; Sales &gt; "Still Owed to You"
            also counts walk-in bills that were part-paid and have no account,
            so that number is legitimately the larger of the two.
          */}
          <p className="mt-1.5 text-xs text-gray-300">
            Named credit customers only. Part-paid walk-in bills have no credit account and are not
            counted here — Reports › Sales shows the combined figure.
          </p>
        </div>

        <ReceivableAgeing rows={overview.ageing} />

        <div className="flex gap-2 border-b border-gray-200">
          <button
            type="button"
            onClick={() => setTab('outstanding')}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px ${tab === 'outstanding' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            Outstanding
          </button>
          <button
            type="button"
            onClick={() => setTab('history')}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px ${tab === 'history' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            History
          </button>
        </div>

        {tab === 'history' ? (
          <div className="space-y-4">
            <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5">
              <div className="flex flex-wrap gap-2">
                {PERIODS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => chooseHistoryPeriod(p.id)}
                    className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                      historyPeriod === p.id ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-600">From</span>
                  <DateInput value={historyFrom} onChange={editHistoryFrom} className={INPUT} />
                </label>
                <span className="pb-2 text-gray-400">—</span>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-600">To</span>
                  <DateInput value={historyTo} onChange={editHistoryTo} className={INPUT} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-600">Status</span>
                  <select value={historyStatus} onChange={(e) => setHistoryStatus(e.target.value)} className={INPUT}>
                    <option value="all">All</option>
                    <option value="charged">Charged</option>
                    <option value="paid">Paid / Cleared</option>
                    <option value="reversed">Reversals</option>
                  </select>
                </label>
              </div>

              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  value={historyQuery}
                  onChange={(e) => setHistoryQuery(e.target.value)}
                  placeholder="Search by customer name..."
                  className={`${INPUT} pl-9`}
                />
              </div>
            </div>

            <Panel title={`Ledger history (${history.length})`}>
              <div className="divide-y divide-gray-100">
                {historyLoading ? (
                  <p className="px-5 py-8 text-center text-sm text-gray-500">Loading…</p>
                ) : history.length === 0 ? (
                  <p className="px-5 py-8 text-center text-sm text-gray-500">No ledger activity in this range.</p>
                ) : (
                  history.map((h) => (
                    <div key={h.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-gray-900">{h.customer_name}</span>
                        <span className="block text-xs text-gray-400">
                          {formatNepalDisplay(String(h.date || '').slice(0, 10))}
                          {h.bill_number ? ` · ${h.bill_number}` : ''}
                          {h.note ? ` — ${h.note}` : ''}
                        </span>
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                        h.status === 'reversed' ? 'bg-amber-100 text-amber-800' : h.status === 'charged' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {h.status}
                      </span>
                      {h.payment_method && (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase text-gray-700">
                          {h.payment_method === 'cash' ? 'Cash' : 'Online'}
                        </span>
                      )}
                      <span className="text-sm font-semibold tabular-nums text-gray-900">
                        {money(h.debit > 0 ? h.debit : h.credit)}
                      </span>
                      {h.can_correct_payment_method && can('credit.payment_method_correct') && (
                        <button
                          type="button"
                          onClick={() => openMethodCorrection(h)}
                          className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                        >
                          <Pencil className="h-3.5 w-3.5" /> Change method
                        </button>
                      )}
                    </div>
                  ))
                )}
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
          <p className="text-xs text-gray-400">Shows customers with ledger activity (charged or paid) in this period — the amount shown is still their current total owed.</p>

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
              placeholder="Search customer by name or phone..."
              className={`${INPUT} pl-9`}
            />
          </div>
        </div>

        {!loading && visibleCustomers.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white px-6 py-16 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100">
              <User className="h-6 w-6 text-gray-400" />
            </div>
            <h3 className="text-base font-bold text-gray-900">{query ? 'No match' : 'No Outstanding Credit'}</h3>
            <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">
              {query ? 'No customer matches that search.' : 'Nobody currently owes the till anything.'}
            </p>
            {!query && (
              <div className="mx-auto mt-6 flex max-w-md flex-col items-center gap-2 sm:flex-row sm:justify-center">
                <span className="inline-flex items-center gap-2 rounded-full bg-gray-50 px-4 py-2 text-xs font-medium text-gray-600"><Wallet className="h-3.5 w-3.5" />Track payments</span>
                <span className="inline-flex items-center gap-2 rounded-full bg-gray-50 px-4 py-2 text-xs font-medium text-gray-600"><ShieldAlert className="h-3.5 w-3.5" />Monitor dues</span>
              </div>
            )}
          </div>
        ) : (
          <Panel title={`Customers with dues (${visibleCustomers.length})`}>
            <div className="divide-y divide-gray-100">
              {visibleCustomers.map((c) => (
                <div
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openCustomer(c)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openCustomer(c); }}
                  className="flex w-full cursor-pointer items-center gap-3 px-5 py-3 text-left hover:bg-gray-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium text-gray-900">
                      {c.name}
                      {c.is_vip ? <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">VIP</span> : null}
                    </p>
                    {c.phone && <p className="text-xs text-gray-400">{c.phone}</p>}
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-rose-700">{money(c.outstanding)}</span>
                  <PrintStatementMenu variant="icon" onPrint={(mode) => printRowStatement(c, mode)} />
                  <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
                </div>
              ))}
            </div>
          </Panel>
        )}
        </>
        )}
      </div>

      {/* Customer popup */}
      {selected && (
        <div className="fixed inset-y-0 left-0 right-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-5 lg:left-[var(--admin-sidebar-offset,5rem)]" role="dialog" aria-modal="true" aria-labelledby="customer-credit-title">
          <div className="flex max-h-[96dvh] w-full max-w-6xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-h-[92dvh] sm:rounded-3xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 sm:px-7 sm:py-5">
              <div>
                <div className="flex items-center gap-2">
                  <h2 id="customer-credit-title" className="text-xl font-bold text-gray-950 sm:text-2xl">{selected.name}</h2>
                  {selected.is_vip ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">VIP</span> : null}
                </div>
                <p className="mt-0.5 text-sm text-gray-500">Customer credit account · {selected.phone || 'No phone on file'}</p>
              </div>
              <button type="button" onClick={closeCustomer} aria-label="Close customer credit details" className="rounded-xl p-2.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X className="h-5 w-5" /></button>
            </div>

            <div className="flex-1 space-y-7 overflow-y-auto p-5 sm:p-7">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 sm:p-5">
                  <p className="text-xs font-bold uppercase tracking-wide text-rose-700">Total still owed</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-rose-800 sm:text-3xl">{money(outstandingTotal)}</p>
                  <p className="mt-1 text-xs text-rose-700">Amount this customer needs to pay</p>
                </div>
                <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
                  <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Open bills</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-gray-950 sm:text-3xl">{detail.bills.length}</p>
                  <p className="mt-1 text-xs text-gray-500">Bills that still have a balance</p>
                </div>
                <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
                  <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Ledger entries</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-gray-950 sm:text-3xl">{detail.statement.length}</p>
                  <p className="mt-1 text-xs text-gray-500">Charges, payments and adjustments</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 border-b border-gray-100 pb-6">
                <Link href={`${customerPath}/${selected.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  <ExternalLink className="h-4 w-4" /> View profile
                </Link>
                <button type="button" disabled={outstandingTotal <= 0} onClick={() => openAction('customer')} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-40">
                  Receive payment
                </button>
                <PrintStatementMenu onPrint={(mode) => printStatement(selected, detail.statement, detail.bills, outstandingTotal, mode)} />
              </div>

              <div>
                <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-gray-950">Bills still awaiting payment</h3>
                    <p className="mt-0.5 text-sm text-gray-500">Select a bill to see its items or record payment for that bill only.</p>
                  </div>
                  <span className="text-xs font-medium text-gray-400">Bill total → amount due</span>
                </div>
                <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200">
                  {detail.bills.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => openOrder(b)}
                      className="flex w-full flex-wrap items-center gap-3 bg-white px-4 py-4 text-left hover:bg-gray-50 sm:px-5"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-gray-900">{b.bill_number}</span>
                        <span className="block text-xs text-gray-400">{formatNepalDisplay(String(b.created_at || '').slice(0, 10))}</span>
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${b.payment_status === 'partial' ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-700'}`}>
                        {b.payment_status || 'unpaid'}
                      </span>
                      <span className="text-sm tabular-nums text-gray-500">{money(b.grand_total)}</span>
                      <span className="text-sm font-semibold tabular-nums text-rose-700">{money(b.outstanding_amount)} due</span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
                    </button>
                  ))}
                  {!loadingDetail && detail.bills.length === 0 && (
                    <p className="bg-white px-4 py-8 text-center text-sm text-gray-500">No open dues for this customer.</p>
                  )}
                </div>
              </div>

              <div>
                <div className="mb-3">
                  <h3 className="text-base font-bold text-gray-950">Credit statement</h3>
                  <p className="mt-0.5 text-sm text-gray-500"><span className="font-semibold text-gray-700">Debit</span> adds to what the customer owes. <span className="font-semibold text-gray-700">Credit</span> is a payment or discount that reduces it.</p>
                </div>
                <LedgerTable
                  lines={detail.statement.map((l) => ({ ...l, entry_date: l.date }))}
                  debitNormal
                  loading={loadingDetail}
                  empty="No transactions in this date range."
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Order popup, stacked above the customer popup */}
      {selectedBill && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{selectedBill.bill_number}</h2>
                <p className="text-sm text-gray-500">{formatNepalDisplay(String(selectedBill.created_at || '').slice(0, 10))}</p>
              </div>
              <button type="button" onClick={closeOrder} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {loadingOrder ? (
                <p className="py-10 text-center text-sm text-gray-500">Loading order…</p>
              ) : orderDetail ? (
                <>
                  <div className="divide-y divide-gray-100 rounded-xl border border-gray-200">
                    {(orderDetail.items || []).map((it) => (
                      <div key={it.order_item_id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                        <span className="text-gray-900">{it.quantity}× {it.item_name}</span>
                        <span className="tabular-nums text-gray-700">{money(it.subtotal ?? it.price * it.quantity)}</span>
                      </div>
                    ))}
                    {!(orderDetail.items || []).length && <p className="px-4 py-6 text-center text-sm text-gray-500">No items on this order.</p>}
                  </div>
                  <div className="rounded-xl bg-gray-50 px-4 py-3 space-y-1.5 text-sm">
                    <div className="flex justify-between"><span className="text-gray-500">Bill total</span><span className="font-semibold tabular-nums text-gray-900">{money(selectedBill.grand_total)}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Outstanding</span><span className="font-bold tabular-nums text-rose-700">{money(selectedBill.outstanding_amount)}</span></div>
                  </div>
                </>
              ) : (
                <p className="py-10 text-center text-sm text-gray-500">Order details unavailable.</p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={Number(selectedBill.outstanding_amount || 0) <= 0}
                  onClick={() => openAction('bill', selectedBill)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-40"
                >
                  Pay this bill
                </button>
                {selectedBill.order_id && (
                  <button
                    type="button"
                    onClick={() => router.push(`${posPath}?order=${selectedBill.order_id}`)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <ExternalLink className="h-4 w-4" /> Open in POS
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pay / discount form, stacked above whichever popup opened it */}
      {actionFor && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 max-h-[94dvh] overflow-y-auto">
            <h3 className="mb-1 text-lg font-bold text-gray-900">
              Receive payment
              {actionFor.scope === 'bill' ? ` — ${actionFor.target.bill_number}` : ` — ${selected?.name}`}
            </h3>
            <p className="mb-4 text-sm text-gray-500">
              Outstanding {money(actionFor.scope === 'bill' ? actionFor.target.outstanding_amount : outstandingTotal)}
            </p>
            <div className="space-y-3">
              <Field label="Amount received">
                <input type="number" min="0" step="any" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className={INPUT} />
              </Field>
                  <Field label="Method">
                    <select value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))} className={INPUT}>
                      <option value="cash">Cash</option>
                      <option value="online">Online</option>
                    </select>
                  </Field>
              <Field label="Payment note">
                <input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} className={INPUT} placeholder="optional" />
              </Field>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="mb-3 text-xs text-amber-800">Optional: forgive part of the remaining balance while recording this payment.</p>
                <div className="space-y-3">
                  <Field label="Discount amount">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={form.discount_amount}
                      onChange={(e) => {
                        const value = e.target.value;
                        const discount = Number(value || 0);
                        const due = Number(actionFor.scope === 'bill' ? actionFor.target.outstanding_amount : outstandingTotal);
                        setForm((current) => ({
                          ...current,
                          discount_amount: value,
                          amount: Number(current.amount || 0) + discount > due ? String(Math.max(0, due - discount)) : current.amount,
                        }));
                      }}
                      className={INPUT}
                      placeholder="0"
                    />
                  </Field>
                  {Number(form.discount_amount || 0) > 0 && (
                    <Field label="Reason for discount">
                      <input value={form.discount_reason} onChange={(e) => setForm((f) => ({ ...f, discount_reason: e.target.value }))} className={INPUT} placeholder="e.g. loyalty discount, goodwill" />
                    </Field>
                  )}
                </div>
              </div>
            </div>
            <div className="mt-6 flex gap-3">
              <button disabled={busy} onClick={submitAction} className="flex-1 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">
                {busy ? 'Saving…' : Number(form.discount_amount || 0) > 0 ? 'Post payment & discount' : 'Post payment'}
              </button>
              <button type="button" onClick={() => setActionFor(null)} className="flex-1 rounded-lg bg-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-300">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {methodCorrection && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Correct payment method</h3>
                <p className="mt-1 text-sm text-gray-500">
                  {methodCorrection.customer_name} · {methodCorrection.bill_number || 'Credit payment'} · {money(methodCorrection.credit)}
                </p>
              </div>
              <button type="button" onClick={() => setMethodCorrection(null)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="mt-5 space-y-4">
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
                This only moves the receipt between Cash and Online. It does not change the amount paid, bill status, revenue, or customer balance.
              </div>
              <Field label="Correct method">
                <select value={correctionMethod} onChange={(event) => setCorrectionMethod(event.target.value)} className={INPUT}>
                  <option value="cash">Cash</option>
                  <option value="online">Online</option>
                </select>
              </Field>
              <Field label="Reason">
                <textarea value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} rows={3} className={INPUT} placeholder="Example: Customer paid Online but it was entered as Cash" />
              </Field>
            </div>
            <div className="mt-6 flex gap-3">
              <button type="button" disabled={busy} onClick={submitMethodCorrection} className="flex-1 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50">{busy ? 'Correcting…' : 'Save correction'}</button>
              <button type="button" disabled={busy} onClick={() => setMethodCorrection(null)} className="rounded-lg bg-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-300 disabled:opacity-50">Cancel</button>
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
 * or just the bills still outstanding. Both come off the same thermal printer.
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
  { key: '0-30', label: '0–30 days', tone: 'text-gray-900' },
  { key: '31-60', label: '31–60 days', tone: 'text-amber-700' },
  { key: '61-90', label: '61–90 days', tone: 'text-orange-700' },
  { key: '90+', label: 'Over 90 days', tone: 'text-rose-700' },
];

/**
 * How long the money has been owed.
 *
 * The API has always returned this; nothing rendered it, so the query ran on
 * every page load and the owner never saw the one thing an ageing report is
 * for — spotting the debt that has quietly gone stale.
 */
function ReceivableAgeing({ rows }) {
  const list = rows || [];
  if (!list.length) return null;

  const totals = AGE_BUCKETS.map((b) => ({
    ...b,
    amount: list.reduce((sum, r) => sum + Number(r[b.key] || 0), 0),
  }));
  const grand = totals.reduce((sum, b) => sum + b.amount, 0);
  if (grand <= 0) return null;

  const estimated = list.filter((r) => r.ageing_estimated);
  const oldest = [...list].sort((a, b) => Number(b['90+'] || 0) - Number(a['90+'] || 0))[0];

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-gray-900">How long it has been owed</h2>
        <p className="mt-0.5 text-sm text-gray-500">
          The same {money(grand)} split by age. Anything past 90 days is unlikely to be collected without chasing.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {totals.map((b) => (
          <div key={b.key} className="rounded-xl border border-gray-200 p-4">
            <p className="text-xs font-medium text-gray-500">{b.label}</p>
            <p className={`mt-1.5 text-lg font-bold tabular-nums ${b.amount > 0 ? b.tone : 'text-gray-300'}`}>
              {money(b.amount)}
            </p>
            <p className="mt-0.5 text-xs text-gray-400">
              {grand ? Math.round((b.amount / grand) * 100) : 0}% of what is owed
            </p>
          </div>
        ))}
      </div>

      {oldest && Number(oldest['90+'] || 0) > 0 && (
        <p className="mt-4 rounded-lg bg-rose-50 px-3.5 py-2.5 text-sm text-rose-800">
          <span className="font-semibold">{oldest.name}</span> has {money(oldest['90+'])} outstanding for more
          than 90 days &mdash; the largest stale balance on the book.
        </p>
      )}

      {estimated.length > 0 && (
        // Surfaced rather than silently rescaled: see receivableAgeing() in
        // lib/accounting-receivables.js.
        <p className="mt-3 text-xs text-amber-700">
          The age split is approximate for {estimated.length} customer(s) &mdash;{' '}
          {estimated.map((r) => r.name).slice(0, 3).join(', ')}
          {estimated.length > 3 ? ` and ${estimated.length - 3} more` : ''} &mdash; because their ledger entries
          do not add up to their current balance. The totals above are correct; only the age bands are
          estimated.
        </p>
      )}
    </section>
  );
}
