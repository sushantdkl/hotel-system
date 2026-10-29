'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Plus, Printer, RefreshCw, Search } from 'lucide-react';
import AdminLayout from '@/components/admin/admin-layout';
import DateInput from '@/components/ui/date-input.jsx';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AdminField,
  adminBtnPrimary,
  adminBtnSecondary,
  adminDialogMd,
  adminInputClass,
  adminTextareaClass,
} from '@/components/ui/admin-form.jsx';
import { apiJson } from '@/lib/authed-fetch';
import { printReport } from '@/lib/print-report.js';
import { nepalDateString, resolvePeriodRange } from '@/lib/report-dates';
import { useCalendarSystem } from '@/lib/calendar-context.jsx';
import { useToast } from '@/components/ui/toast';
import { formatCalendarDate } from '@/lib/calendar-system.js';
import { toCsv } from '@/lib/csv';

const money = (n) =>
  `Rs ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const TYPE_LABEL = {
  bank: 'Bank',
  sahakari: 'Sahakari',
  fixed_deposit: 'Fixed deposit',
};

const SOURCE_LABEL = {
  cash: 'Cash in hand',
  online: 'Online / bank',
};

const nepalToday = () => nepalDateString();
const shiftNepalDate = (dateStr, days) => {
  const cursor = new Date(`${dateStr}T12:00:00+05:45`);
  cursor.setDate(cursor.getDate() + days);
  return nepalDateString(cursor);
};

function dates(range, calendarSystem) {
  const today = nepalToday();
  if (range === 'today') return { from: today, to: today };
  if (range === 'last7') return { from: shiftNepalDate(today, -6), to: today };
  if (range === 'all') return { from: '2000-01-01', to: '2999-12-31' };
  const resolved = resolvePeriodRange('this_month', null, null, { calendarSystem });
  return { from: resolved.start, to: resolved.end };
}

const emptyForm = () => ({
  deposit_date: nepalDateString(),
  deposit_type: 'bank',
  destination_name: '',
  source_account: 'cash',
  amount: '',
  reference_number: '',
  notes: '',
});

export default function SavingsPage() {
  const { calendarSystem } = useCalendarSystem();
  const { addToast } = useToast();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(false);
  const [detail, setDetail] = useState(null);
  const [filter, setFilter] = useState({
    search: '',
    type: 'all',
    source: 'all',
    status: 'active',
    range: 'this_month',
    page: 1,
    pageSize: 50,
  });
  const [form, setForm] = useState(emptyForm);

  const query = useMemo(() => {
    const r = dates(filter.range, calendarSystem);
    return new URLSearchParams({ ...filter, from: r.from, to: r.to }).toString();
  }, [filter, calendarSystem]);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData(await apiJson(`/api/admin/savings?${query}`));
    } catch (e) {
      addToast({ type: 'error', title: 'Could not load savings', description: e.message });
    } finally {
      setBusy(false);
    }
  }, [query, addToast]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiJson('/api/admin/savings', {
        method: 'POST',
        body: JSON.stringify({ ...form, amount: Number(form.amount) }),
      });
      setModal(false);
      setForm(emptyForm());
      addToast({
        type: 'success',
        title: 'Deposit recorded',
        description: 'The transfer was posted to Savings & Deposits.',
      });
      await load();
    } catch (err) {
      addToast({ type: 'error', title: 'Could not record deposit', description: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function voidRow(row) {
    const reason = window.prompt(`Reason for voiding the ${money(row.amount)} deposit to ${row.destination_name}?`);
    if (!reason) return;
    try {
      await apiJson(`/api/admin/savings/${row.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason }),
      });
      setDetail(null);
      await load();
    } catch (e) {
      addToast({ type: 'error', title: 'Could not void deposit', description: e.message });
    }
  }

  function exportCsv() {
    const headers = ['Date', 'Type', 'Destination', 'Source', 'Amount', 'Reference', 'Status', 'Notes'];
    const rows = (data?.rows || []).map((r) => ({
      Date: formatCalendarDate(r.deposit_date),
      Type: TYPE_LABEL[r.deposit_type] || r.deposit_type,
      Destination: r.destination_name,
      Source: SOURCE_LABEL[r.source_account] || r.source_account,
      Amount: money(r.amount),
      Reference: r.reference_number,
      Status: r.status,
      Notes: r.notes,
    }));
    const url = URL.createObjectURL(new Blob([toCsv(headers, rows)], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `savings-${nepalDateString()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const periods = data?.periods || {};
  const periodCards = [
    ['Today', periods.today],
    ['Last 3 Days', periods.last3],
    ['Last 7 Days', periods.last7],
    ['This Month', periods.month],
  ];

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8 print:hidden">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-sky-700">Savings transfer · not an expense</p>
            <h1 className="mt-1 text-2xl font-bold text-gray-900 sm:text-3xl">Savings & Deposits</h1>
            <p className="mt-1 max-w-3xl text-sm text-gray-500">
              Move cash or online balance into a bank, Sahakari, or fixed deposit. These are internal fund transfers — they never hit operating expenses.
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={load} className={BTN}>
              <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button type="button" onClick={() => setModal(true)} className={PRIMARY}>
              <Plus className="h-4 w-4" />
              Add Savings Deposit
            </button>
          </div>
        </div>
      </header>

      <main className="space-y-5 bg-gray-50 p-4 sm:p-6 lg:p-8 print:bg-white print:p-0">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {periodCards.map(([label, period]) => (
            <div key={label} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <div data-print-row className="flex items-start justify-between gap-2">
                <h2 className="text-sm font-bold text-gray-900">{label}</h2>
                <span className="text-right text-[11px] leading-snug text-gray-500">
                  {period ? `${formatCalendarDate(period.start)} – ${formatCalendarDate(period.end)}` : '—'}
                </span>
              </div>
              <p className="mt-3 text-2xl font-bold tabular-nums text-gray-950">{money(period?.total)}</p>
              <div className="mt-4 grid grid-cols-3 gap-2 border-t border-gray-100 pt-3 text-xs">
                <MiniStat label="From cash" value={money(period?.cash)} />
                <MiniStat label="From online" value={money(period?.online)} />
                <MiniStat label="Deposits" value={period?.count || 0} />
              </div>
            </div>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <BalanceCard label="Net Cash in Hand" value={money(data?.balances?.cash)} hint="Ledger cash available to deposit from" />
          <BalanceCard label="Net Online Balance" value={money(data?.balances?.online)} hint="Online / bank clearing available" />
          <BalanceCard label="Savings Balance" value={money(data?.balances?.savings)} hint="Total held in Savings & Deposits" tone="text-sky-700" />
        </div>

        <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="space-y-3 border-b border-gray-200 p-4 print:hidden">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <label className="relative block">
                <span className="mb-1 block text-xs font-medium text-gray-600">Search</span>
                <Search className="pointer-events-none absolute left-3 top-9 h-4 w-4 text-gray-400" />
                <input
                  value={filter.search}
                  onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value, page: 1 }))}
                  placeholder="Bank, reference, notes…"
                  className={`${INPUT} pl-9`}
                />
              </label>
              <FilterSelect
                label="Deposit type"
                value={filter.type}
                onChange={(v) => setFilter((f) => ({ ...f, type: v, page: 1 }))}
                options={[
                  ['all', 'All deposit types'],
                  ['bank', 'Bank'],
                  ['sahakari', 'Sahakari'],
                  ['fixed_deposit', 'Fixed deposit'],
                ]}
              />
              <FilterSelect
                label="Source account"
                value={filter.source}
                onChange={(v) => setFilter((f) => ({ ...f, source: v, page: 1 }))}
                options={[
                  ['all', 'All source accounts'],
                  ['cash', 'Cash'],
                  ['online', 'Online / bank'],
                ]}
              />
              <FilterSelect
                label="Status"
                value={filter.status}
                onChange={(v) => setFilter((f) => ({ ...f, status: v, page: 1 }))}
                options={[
                  ['active', 'Active'],
                  ['voided', 'Voided'],
                  ['all', 'All'],
                ]}
              />
              <FilterSelect
                label="Range"
                value={filter.range}
                onChange={(v) => setFilter((f) => ({ ...f, range: v, page: 1 }))}
                options={[
                  ['this_month', 'This Month'],
                  ['today', 'Today'],
                  ['last7', 'Last 7 Days'],
                  ['all', 'All Time'],
                ]}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
            <div>
              <h2 className="text-sm font-bold text-gray-900">Savings Deposits</h2>
              <p className="text-xs text-gray-500">
                {data?.pagination?.total || 0} rows · Listed total {money(data?.listed_total)}
                <span className="ml-1 text-gray-400">· Click a row for full details</span>
              </p>
            </div>
            <div className="flex gap-2 print:hidden">
              <button type="button" onClick={exportCsv} className={ICON} title="Export CSV">
                <Download className="h-4 w-4" />
              </button>
              <button type="button" onClick={(e) => printReport(e.currentTarget.closest('main'), { title: 'Savings & Deposits' })} className={ICON} title="Print">
                <Printer className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  {['Date', 'Destination', 'Type', 'Source', 'Reference', 'Amount', 'Status', ''].map((h) => (
                    <th key={h || 'actions'} className="px-4 py-3 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(data?.rows || []).map((row) => (
                  <tr
                    key={row.id}
                    className="cursor-pointer transition-colors hover:bg-sky-50/60"
                    onClick={() => setDetail(row)}
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-gray-700">{formatCalendarDate(row.deposit_date)}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-gray-950">{row.destination_name}</p>
                      {row.notes ? (
                        <p className="mt-0.5 line-clamp-1 text-xs text-gray-500">{row.notes}</p>
                      ) : (
                        <p className="mt-0.5 text-xs text-gray-400">No notes — click for details</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{TYPE_LABEL[row.deposit_type] || row.deposit_type}</td>
                    <td className="px-4 py-3 text-gray-700">{SOURCE_LABEL[row.source_account] || row.source_account}</td>
                    <td className="px-4 py-3 text-gray-500">{row.reference_number || '—'}</td>
                    <td className="px-4 py-3 font-bold tabular-nums text-gray-950">{money(row.amount)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                          row.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 print:hidden" onClick={(e) => e.stopPropagation()}>
                      {row.status === 'active' ? (
                        <button
                          type="button"
                          onClick={() => voidRow(row)}
                          className="text-xs font-medium text-red-600 hover:underline"
                        >
                          Void
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data?.rows?.length ? (
              <p className="px-4 py-16 text-center text-sm text-gray-500">No savings deposits in this range.</p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-4 py-3 text-sm text-gray-600 print:hidden">
            <label className="inline-flex items-center gap-2">
              Rows
              <select
                value={filter.pageSize}
                onChange={(e) => setFilter((f) => ({ ...f, pageSize: Number(e.target.value), page: 1 }))}
                className="h-9 rounded-lg border border-gray-300 bg-white px-2"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={filter.page <= 1}
                onClick={() => setFilter((f) => ({ ...f, page: f.page - 1 }))}
                className={PAGE}
              >
                Previous
              </button>
              <span>
                Page {data?.pagination?.page || 1} of {data?.pagination?.pages || 1}
              </span>
              <button
                type="button"
                disabled={filter.page >= (data?.pagination?.pages || 1)}
                onClick={() => setFilter((f) => ({ ...f, page: f.page + 1 }))}
                className={PAGE}
              >
                Next
              </button>
            </div>
          </div>
        </section>
      </main>

      {modal ? (
        <Dialog open onOpenChange={(open) => !open && setModal(false)}>
          <DialogContent onClose={() => setModal(false)} className={adminDialogMd}>
            <DialogHeader>
              <DialogTitle>Add Savings Deposit</DialogTitle>
              <p className="text-sm text-gray-500">Records an internal transfer, not an expense.</p>
            </DialogHeader>
            <form onSubmit={submit} className="mt-4 space-y-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <AdminField label="Deposit date" required>
                  <DateInput
                    required
                    value={form.deposit_date}
                    onChange={(deposit_date) => setForm({ ...form, deposit_date })}
                    className={adminInputClass}
                  />
                </AdminField>
                <AdminField label="Deposit type" required>
                  <select
                    value={form.deposit_type}
                    onChange={(e) => setForm({ ...form, deposit_type: e.target.value })}
                    className={adminInputClass}
                  >
                    <option value="bank">Bank</option>
                    <option value="sahakari">Sahakari</option>
                    <option value="fixed_deposit">Fixed deposit</option>
                  </select>
                </AdminField>
                <AdminField label="Bank / Sahakari name" required>
                  <input
                    required
                    value={form.destination_name}
                    onChange={(e) => setForm({ ...form, destination_name: e.target.value })}
                    className={adminInputClass}
                    placeholder="e.g. Nabil Bank, local Sahakari"
                  />
                </AdminField>
                <AdminField label="Source account" required>
                  <select
                    value={form.source_account}
                    onChange={(e) => setForm({ ...form, source_account: e.target.value })}
                    className={adminInputClass}
                  >
                    <option value="cash">Cash in hand</option>
                    <option value="online">Online / bank</option>
                  </select>
                </AdminField>
                <AdminField label="Amount" required>
                  <input
                    required
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    className={adminInputClass}
                  />
                </AdminField>
                <AdminField label="Reference">
                  <input
                    value={form.reference_number}
                    onChange={(e) => setForm({ ...form, reference_number: e.target.value })}
                    className={adminInputClass}
                    placeholder="Slip / voucher no."
                  />
                </AdminField>
              </div>
              <AdminField label="Notes / description" hint="Shown when you open the deposit from the list.">
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className={adminTextareaClass}
                  placeholder="Why this deposit was made, account holder, etc."
                />
              </AdminField>
              <DialogFooter>
                <button type="button" onClick={() => setModal(false)} className={adminBtnSecondary}>
                  Cancel
                </button>
                <button type="submit" disabled={busy} className={adminBtnPrimary}>
                  {busy ? 'Saving…' : 'Record Deposit'}
                </button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}

      {detail ? (
        <Dialog open onOpenChange={(open) => !open && setDetail(null)}>
          <DialogContent onClose={() => setDetail(null)} className={adminDialogMd}>
            <DialogHeader>
              <DialogTitle>{detail.destination_name}</DialogTitle>
              <p className="text-sm text-gray-500">
                {TYPE_LABEL[detail.deposit_type] || detail.deposit_type} · {formatCalendarDate(detail.deposit_date)}
              </p>
            </DialogHeader>
            <div className="mt-4 space-y-4">
              <p className="text-3xl font-bold tabular-nums text-gray-950">{money(detail.amount)}</p>
              <dl className="grid gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm sm:grid-cols-2">
                <DetailItem label="Source" value={SOURCE_LABEL[detail.source_account] || detail.source_account} />
                <DetailItem label="Status" value={detail.status} />
                <DetailItem label="Reference" value={detail.reference_number || '—'} />
                <DetailItem label="Recorded by" value={detail.created_by_name || '—'} />
              </dl>
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Description / notes</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
                  {detail.notes?.trim() || 'No description was added for this deposit.'}
                </p>
              </div>
              {detail.status === 'voided' && detail.void_reason ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Void reason</p>
                  <p className="mt-2 text-sm text-rose-900">{detail.void_reason}</p>
                </div>
              ) : null}
            </div>
            <DialogFooter>
              {detail.status === 'active' ? (
                <button type="button" onClick={() => voidRow(detail)} className={adminBtnSecondary}>
                  Void deposit
                </button>
              ) : null}
              <button type="button" onClick={() => setDetail(null)} className={adminBtnPrimary}>
                Close
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </AdminLayout>
  );
}

function MiniStat({ label, value }) {
  return (
    <div data-print-row>
      <p className="text-gray-500">{label}</p>
      <p className="mt-1 font-semibold tabular-nums text-gray-900">{value}</p>
    </div>
  );
}

function BalanceCard({ label, value, hint, tone = 'text-gray-900' }) {
  return (
    <div data-print-row className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`mt-2 text-xl font-bold tabular-nums ${tone}`}>{value}</p>
      {hint ? <p data-print-skip className="mt-1 text-xs text-gray-400">{hint}</p> : null}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <label className="block text-xs font-medium text-gray-600">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${INPUT} mt-1`}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function DetailItem({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="mt-0.5 font-medium capitalize text-gray-900">{value}</dd>
    </div>
  );
}

const BTN =
  'inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50';
const PRIMARY =
  'inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-gray-950 bg-gray-950 px-4 text-sm font-semibold text-white hover:bg-black disabled:opacity-50';
const ICON =
  'inline-flex h-9 w-9 items-center justify-center rounded-xl border border-gray-300 text-gray-600 hover:bg-gray-50';
const INPUT = 'h-10 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm text-gray-900';
const PAGE = 'rounded-lg border border-gray-300 px-3 py-1.5 disabled:opacity-40';
