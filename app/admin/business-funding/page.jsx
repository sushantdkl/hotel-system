'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, RefreshCw, X, ArrowRightLeft, Eye } from 'lucide-react';
import AdminLayout from '@/components/admin/admin-layout';
import DateInput from '@/components/ui/date-input.jsx';
import { apiJson } from '@/lib/authed-fetch';
import { friendlyFromError, friendlyMessage } from '@/lib/friendly-message';
import { nepalDateString } from '@/lib/report-dates.js';
import { useToast } from '@/components/ui/toast';
import { formatCalendarDate } from '@/lib/calendar-system.js';

const money = (value) => `Rs ${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const REASON_OPTIONS = [
  ['', 'All reasons'],
  ['cash_reserve', 'Cash Reserve / Safe'],
  ['bank_deposit', 'Bank Deposit'],
  ['bank_withdrawal', 'Bank Withdrawal'],
  ['owner_withdrawal', 'Owner Withdrawal'],
  ['owner_contribution', 'Owner Contribution'],
  ['other', 'Other'],
];

export default function BusinessFundingPage() {
  const { addToast } = useToast();
  const [tab, setTab] = useState('funding');
  const [profile, setProfile] = useState(null);
  const [opening, setOpening] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState({ id: null, date: nepalDateString(), amount: '', note: '' });
  const [filters, setFilters] = useState({ from: '', to: '', reason: '', direction: '', q: '' });
  const [selectedIds, setSelectedIds] = useState([]);

  const loadFunding = useCallback(async () => {
    setProfile(await apiJson('/api/admin/business-funding'));
  }, []);

  const loadOpening = useCallback(async (next = filters) => {
    const query = new URLSearchParams({ tab: 'opening_cash' });
    if (next.from) query.set('from', next.from);
    if (next.to) query.set('to', next.to);
    if (next.reason) query.set('reason', next.reason);
    if (next.direction) query.set('direction', next.direction);
    if (next.q) query.set('q', next.q);
    setOpening(await apiJson(`/api/admin/business-funding?${query}`));
  }, [filters]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'funding') await loadFunding();
      else await loadOpening();
    } catch (error) {
      addToast(friendlyFromError(error, 'load_failed'));
    } finally {
      setLoading(false);
    }
  }, [tab, loadFunding, loadOpening, addToast]);

  useEffect(() => { load(); }, [load]);

  async function submit(event) {
    event.preventDefault();
    if (!form.id && !(Number(form.amount) > 0)) {
      addToast(friendlyMessage('validation', { description: 'Investment amount must be greater than zero.' }));
      return;
    }
    setSaving(true);
    try {
      await apiJson('/api/admin/business-funding', {
        method: form.id ? 'PUT' : 'POST',
        body: JSON.stringify({ ...form, amount: Number(form.amount) }),
      });
      addToast(friendlyMessage('save_success', { description: form.id ? 'Investment date corrected.' : 'Owner investment added to Business Funding.' }));
      setForm({ id: null, date: nepalDateString(), amount: '', note: '' });
      setModal(false);
      await loadFunding();
    } catch (error) {
      addToast(friendlyFromError(error, 'save_failed'));
    } finally {
      setSaving(false);
    }
  }

  async function openDetail(id) {
    try {
      setDetail(await apiJson(`/api/admin/business-funding?tab=opening_cash&journal_id=${id}`));
    } catch (error) {
      addToast(friendlyFromError(error, 'load_failed'));
    }
  }

  async function transferIds(ids) {
    if (!ids?.length) {
      addToast(friendlyMessage('validation', { description: 'Select at least one Cash Reserve row to transfer.' }));
      return;
    }
    setSaving(true);
    try {
      const result = await apiJson('/api/admin/business-funding', {
        method: 'POST',
        body: JSON.stringify({ action: 'transfer_opening_reserve', journal_ids: ids }),
      });
      addToast(friendlyMessage('save_success', { description: result.message || 'Transferred to Business Funding.' }));
      setDetail(null);
      setSelectedIds([]);
      await loadOpening();
      await loadFunding();
    } catch (error) {
      addToast(friendlyFromError(error, 'save_failed'));
    } finally {
      setSaving(false);
    }
  }

  const transferableIds = useMemo(
    () => (opening?.movements || []).filter((row) => row.transferable).map((row) => row.id),
    [opening]
  );

  const selectedTransferableIds = useMemo(
    () => selectedIds.filter((id) => transferableIds.includes(id)),
    [selectedIds, transferableIds]
  );

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => transferableIds.includes(id)));
  }, [transferableIds]);

  function toggleSelected(id) {
    setSelectedIds((current) => (
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    ));
  }

  function toggleSelectAllTransferable() {
    setSelectedIds((current) => (
      transferableIds.length && transferableIds.every((id) => current.includes(id))
        ? []
        : [...transferableIds]
    ));
  }

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-violet-700">Owner capital · not revenue</p>
            <h1 className="mt-1 text-2xl font-bold text-gray-900 sm:text-3xl">Business Funding</h1>
            <p className="mt-1 max-w-3xl text-sm text-gray-500">
              Permanent capital available to cover cash or bank shortfalls on dated purchases and expenses.
              Available funding can be used for previous-day purchases; the funding use is dated today.
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={load} className={BUTTON}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            {tab === 'funding' && (
              <button
                type="button"
                onClick={() => {
                  setForm({ id: null, date: nepalDateString(), amount: '', note: '' });
                  setModal(true);
                }}
                className={PRIMARY}
              >
                <Plus className="h-4 w-4" />
                Add Investment
              </button>
            )}
            {tab === 'opening_cash' && selectedTransferableIds.length > 0 && (
              <button
                type="button"
                disabled={saving}
                onClick={() => transferIds(selectedTransferableIds)}
                className={PRIMARY}
              >
                <ArrowRightLeft className="h-4 w-4" />
                Send selected to Funding ({selectedTransferableIds.length})
              </button>
            )}
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <TabButton active={tab === 'funding'} onClick={() => setTab('funding')}>Funding</TabButton>
          <TabButton active={tab === 'opening_cash'} onClick={() => setTab('opening_cash')}>Opening cash moves</TabButton>
        </div>
      </header>

      <main className="space-y-5 bg-gray-50 p-4 sm:p-6 lg:p-8">
        {tab === 'funding' ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label="Available now" value={money(profile?.availableBalance)} tone="text-emerald-700" />
              <Metric label="Total invested" value={money(profile?.totalInvested)} />
              <Metric label="Used for shortfalls" value={money(profile?.totalUsed)} />
            </div>
            <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
              <div className="border-b border-gray-200 px-4 py-3">
                <h2 className="font-bold text-gray-900">Funding history</h2>
                <p className="text-xs text-gray-500">Every investment, reserve transfer, and automatic shortfall use.</p>
                <p className="mt-2 text-xs text-violet-700">
                  Past purchases can use the funding available now. The purchase stays on its invoice date; the funding top-up is recorded today.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                    <tr>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Activity</th>
                      <th className="px-4 py-3">Details</th>
                      <th className="px-4 py-3">By</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(profile?.history || []).map((row) => (
                      <tr key={row.id}>
                        <td className="whitespace-nowrap px-4 py-3">{formatCalendarDate(row.entry_date)}</td>
                        <td className="px-4 py-3 font-medium">
                          {row.source_type === 'business_funding_investment' || row.source_type === 'business_funding_deposit'
                            ? 'Investment'
                            : row.source_type === 'opening_reserve_to_funding'
                              ? 'From cash reserve'
                              : row.source_type === 'reversal'
                                ? 'Funding returned'
                                : 'Used for shortfall'}
                        </td>
                        <td className="px-4 py-3 text-gray-600">{row.memo || '—'}</td>
                        <td className="px-4 py-3 text-gray-500">{row.created_by_name || 'System'}</td>
                        <td className={`px-4 py-3 text-right font-bold tabular-nums ${Number(row.amount) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {Number(row.amount) >= 0 ? '+' : '−'}{money(Math.abs(row.amount))}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {row.source_type === 'business_funding_investment' ? (
                            <button
                              type="button"
                              className={BUTTON}
                              onClick={() => {
                                setForm({
                                  id: Number(row.source_id),
                                  date: String(row.entry_date).slice(0, 10),
                                  amount: String(Math.abs(Number(row.amount))),
                                  note: String(row.memo || '').replace(/^Owner investment(?: — )?/, ''),
                                });
                                setModal(true);
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Edit date
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!loading && !profile?.history?.length && (
                  <p className="py-14 text-center text-sm text-gray-500">No investments yet.</p>
                )}
              </div>
            </section>
          </>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Removed from drawer" value={money(opening?.totals?.removed)} tone="text-rose-700" />
              <Metric label="Added to drawer" value={money(opening?.totals?.added)} tone="text-emerald-700" />
              <Metric label="Transferable to Funding" value={money(opening?.totals?.transferable)} tone="text-violet-700" />
              <Metric label="Cash Reserve now" value={money(opening?.reserve_balance)} />
            </div>

            <section className="rounded-2xl border border-gray-200 bg-white p-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Field label="From">
                  <DateInput value={filters.from} onChange={(from) => setFilters((v) => ({ ...v, from }))} className={INPUT} />
                </Field>
                <Field label="To">
                  <DateInput value={filters.to} onChange={(to) => setFilters((v) => ({ ...v, to }))} className={INPUT} />
                </Field>
                <Field label="Reason">
                  <select
                    value={filters.reason}
                    onChange={(e) => setFilters((v) => ({ ...v, reason: e.target.value }))}
                    className={INPUT}
                  >
                    {REASON_OPTIONS.map(([value, label]) => (
                      <option key={value || 'all'} value={value}>{label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Direction">
                  <select
                    value={filters.direction}
                    onChange={(e) => setFilters((v) => ({ ...v, direction: e.target.value }))}
                    className={INPUT}
                  >
                    <option value="">All</option>
                    <option value="out">Removed from drawer</option>
                    <option value="in">Added to drawer</option>
                  </select>
                </Field>
                <Field label="Search">
                  <input
                    value={filters.q}
                    onChange={(e) => setFilters((v) => ({ ...v, q: e.target.value }))}
                    className={INPUT}
                    placeholder="Note or reference"
                  />
                </Field>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={PRIMARY} onClick={() => loadOpening(filters)}>Apply filters</button>
                <button
                  type="button"
                  className={BUTTON}
                  onClick={() => {
                    const cleared = { from: '', to: '', reason: '', direction: '', q: '' };
                    setFilters(cleared);
                    loadOpening(cleared);
                  }}
                >
                  Clear
                </button>
              </div>
              <p className="mt-3 text-xs text-gray-500">
                Only <strong>Cash Reserve</strong> removals can move into Business Funding. Bank deposits already sit in Bank;
                owner withdrawals are equity and are listed for audit only.
              </p>
            </section>

            <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1000px] text-left text-sm">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                    <tr>
                      <th className="px-4 py-3">
                        <input
                          type="checkbox"
                          aria-label="Select all transferable rows"
                          checked={transferableIds.length > 0 && transferableIds.every((id) => selectedIds.includes(id))}
                          disabled={!transferableIds.length}
                          onChange={toggleSelectAllTransferable}
                          className="h-4 w-4 rounded border-gray-300"
                        />
                      </th>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Direction</th>
                      <th className="px-4 py-3">Reason</th>
                      <th className="px-4 py-3">Went to / from</th>
                      <th className="px-4 py-3">By</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(opening?.movements || []).map((row) => (
                      <tr key={row.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          {row.transferable ? (
                            <input
                              type="checkbox"
                              aria-label={`Select movement ${row.id}`}
                              checked={selectedIds.includes(row.id)}
                              onChange={() => toggleSelected(row.id)}
                              className="h-4 w-4 rounded border-gray-300"
                            />
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <div className="font-medium">{formatCalendarDate(row.entry_date)}</div>
                          {row.business_date && (
                            <div className="text-xs text-gray-500">Day {formatCalendarDate(row.business_date)}</div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${row.direction === 'out' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
                            {row.direction === 'out' ? 'Removed' : row.direction === 'in' ? 'Added' : 'Flat'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium">{row.reason_label}</div>
                          <div className="max-w-xs truncate text-xs text-gray-500">{row.memo || '—'}</div>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{row.destination_name || '—'}{row.destination_code ? ` (${row.destination_code})` : ''}</td>
                        <td className="px-4 py-3 text-gray-500">{row.created_by_name}</td>
                        <td className="px-4 py-3 text-right font-bold tabular-nums">{money(row.amount)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex gap-2">
                            <button type="button" className={BUTTON} onClick={() => openDetail(row.id)}>
                              <Eye className="h-3.5 w-3.5" />
                              Details
                            </button>
                            {row.transferable && (
                              <button type="button" disabled={saving} className={PRIMARY} onClick={() => transferIds([row.id])}>
                                <ArrowRightLeft className="h-3.5 w-3.5" />
                                To Funding
                              </button>
                            )}
                            {row.transferred && (
                              <span className="self-center text-xs font-semibold text-violet-700">Transferred</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!loading && !opening?.movements?.length && (
                  <p className="py-14 text-center text-sm text-gray-500">No opening cash movements match these filters.</p>
                )}
              </div>
            </section>
          </>
        )}
      </main>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={submit} className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <h2 className="font-bold text-gray-900">{form.id ? 'Correct investment date' : 'Add owner investment'}</h2>
                <p className="text-xs text-gray-500">
                  {form.id
                    ? 'Use the date the funds actually became available to the business.'
                    : 'Increases capital and available Business Funding.'}
                </p>
              </div>
              <button type="button" onClick={() => setModal(false)} className={ICON}><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-4 p-5">
              <Field label="Investment date">
                <DateInput value={form.date} onChange={(date) => setForm((value) => ({ ...value, date }))} className={INPUT} />
              </Field>
              <Field label="Amount">
                <input
                  required
                  min="0.01"
                  step="0.01"
                  type="number"
                  value={form.amount}
                  disabled={Boolean(form.id)}
                  onChange={(event) => setForm((value) => ({ ...value, amount: event.target.value }))}
                  className={`${INPUT} disabled:bg-gray-100 disabled:text-gray-500`}
                />
              </Field>
              <Field label="Note / source">
                <textarea
                  rows={3}
                  value={form.note}
                  onChange={(event) => setForm((value) => ({ ...value, note: event.target.value }))}
                  className="w-full rounded-xl border border-gray-300 p-3 text-sm"
                  placeholder="e.g. Initial owner capital"
                />
              </Field>
              {form.id && (
                <p className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-800">
                  This corrects when the existing funds became available; it does not add more money.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
              <button type="button" onClick={() => setModal(false)} className={BUTTON}>Cancel</button>
              <button disabled={saving} className={PRIMARY}>{saving ? 'Saving…' : form.id ? 'Save Correction' : 'Add Investment'}</button>
            </div>
          </form>
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <h2 className="font-bold text-gray-900">Opening cash movement #{detail.id}</h2>
                <p className="text-xs text-gray-500">{detail.reason_label} · {formatCalendarDate(detail.entry_date)}</p>
              </div>
              <button type="button" onClick={() => setDetail(null)} className={ICON}><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3 p-5 text-sm">
              <DetailRow label="Direction" value={detail.direction === 'out' ? 'Removed from drawer' : 'Added to drawer'} />
              <DetailRow label="Amount" value={money(detail.amount)} />
              <DetailRow label="Prior counted → opening" value={`${money(detail.prior_cash)} → ${money(detail.opening_cash)}`} />
              <DetailRow label="Destination" value={`${detail.destination_name || '—'} (${detail.destination_code || '—'})`} />
              <DetailRow label="Staff" value={detail.created_by_name} />
              <DetailRow label="Memo" value={detail.memo || '—'} />
              <DetailRow label="Reference" value={detail.external_ref || '—'} />
              <div>
                <p className="mb-2 text-xs font-semibold uppercase text-gray-500">Journal lines</p>
                <div className="overflow-hidden rounded-xl border border-gray-200">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-gray-50 text-gray-500">
                      <tr>
                        <th className="px-3 py-2">Account</th>
                        <th className="px-3 py-2 text-right">Debit</th>
                        <th className="px-3 py-2 text-right">Credit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {(detail.lines || []).map((line, index) => (
                        <tr key={`${line.code}-${index}`}>
                          <td className="px-3 py-2">{line.code} · {line.name}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{Number(line.debit) ? money(line.debit) : '—'}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{Number(line.credit) ? money(line.credit) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
              {detail.transferable && (
                <button type="button" disabled={saving} className={PRIMARY} onClick={() => transferIds([detail.id])}>
                  Transfer to Funding
                </button>
              )}
              <button type="button" className={BUTTON} onClick={() => setDetail(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl px-4 py-2 text-sm font-semibold ${active ? 'bg-gray-950 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
    >
      {children}
    </button>
  );
}

function Metric({ label, value, tone = 'text-gray-900' }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${tone}`}>{value}</p>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block text-sm font-medium text-gray-700">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-gray-100 pb-2">
      <span className="text-gray-500">{label}</span>
      <span className="max-w-[65%] text-right font-medium text-gray-900">{value}</span>
    </div>
  );
}

const INPUT = 'h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm text-gray-900';
const BUTTON = 'inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50';
const PRIMARY = 'inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-gray-950 px-4 text-sm font-semibold text-white hover:bg-black disabled:opacity-50';
const ICON = 'inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100';
