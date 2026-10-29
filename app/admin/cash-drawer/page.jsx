'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import { ArrowDownLeft, ArrowUpRight, Lock, Unlock, X } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import { apiJson } from '@/lib/authed-fetch';
import { money } from '@/components/accounting/ledger-table';
import { formatNepalTime } from '@/lib/time-utils';
import HistoryFilters from '@/components/accounting/history-filters.jsx';
import PaginationControls from '@/components/ui/pagination-controls.jsx';

const emptyMove = { amount: '', movement_type: '', reason: '', bank_account_id: '' };

export default function CashDrawerPage() {
  const { addToast } = useToast();
  const [data, setData] = useState({
    drawers: [],
    sessions: [],
    open: null,
    expected_cash: null,
    movements: [],
    banks: [],
    cash_in_types: [],
    cash_out_types: [],
  });
  const [loading, setLoading] = useState(true);
  const [openForm, setOpenForm] = useState({ drawer_id: '', opening_amount: '' });
  const [counted, setCounted] = useState('');
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(null); // 'in' | 'out' | null
  const [move, setMove] = useState(emptyMove);
  const [selectedMovement, setSelectedMovement] = useState(null);
  const [movementFilters, setMovementFilters] = useState({ search: '', from: '', to: '', selectValue: '' });
  const [movementPage, setMovementPage] = useState(1);
  const [movementPageSize, setMovementPageSize] = useState(25);
  const [sessionFilters, setSessionFilters] = useState({ search: '', from: '', to: '', selectValue: '' });
  const [sessionPage, setSessionPage] = useState(1);
  const [sessionPageSize, setSessionPageSize] = useState(25);
  const keyRef = useRef(`cm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({
        movement_page: String(movementPage), movement_page_size: String(movementPageSize),
        session_page: String(sessionPage), session_page_size: String(sessionPageSize),
      });
      if (movementFilters.search) q.set('movement_search', movementFilters.search);
      if (movementFilters.from) q.set('movement_from', movementFilters.from);
      if (movementFilters.to) q.set('movement_to', movementFilters.to);
      if (movementFilters.selectValue) q.set('movement_direction', movementFilters.selectValue);
      if (sessionFilters.search) q.set('session_search', sessionFilters.search);
      if (sessionFilters.from) q.set('session_from', sessionFilters.from);
      if (sessionFilters.to) q.set('session_to', sessionFilters.to);
      if (sessionFilters.selectValue) q.set('session_status', sessionFilters.selectValue);
      const d = await apiJson(`/api/admin/cash-drawer?${q}`);
      setData(d);
      setOpenForm((f) => ({ ...f, drawer_id: f.drawer_id || String(d.drawers?.[0]?.id || '') }));
    } catch (error) {
      addToast(friendlyFromError(error, 'load_failed'));
    } finally {
      setLoading(false);
    }
  }, [addToast, movementFilters, movementPage, movementPageSize, sessionFilters, sessionPage, sessionPageSize]);
  useEffect(() => { load(); }, [load]);

  const typeOptions = useMemo(
    () => (modal === 'in' ? data.cash_in_types : data.cash_out_types) || [],
    [modal, data.cash_in_types, data.cash_out_types]
  );
  const selectedType = typeOptions.find((t) => t.value === move.movement_type);
  const needsBank = Boolean(selectedType?.needs_bank);

  const openDrawer = async () => {
    setBusy(true);
    try {
      await apiJson('/api/admin/cash-drawer', {
        method: 'POST',
        body: JSON.stringify({
          drawer_id: openForm.drawer_id || null,
          opening_amount: Number(openForm.opening_amount) || 0,
        }),
      });
      addToast(friendlyMessage('save_success', { description: 'Drawer opened.' }));
      setOpenForm((f) => ({ ...f, opening_amount: '' }));
      load();
    } catch (error) {
      addToast(friendlyFromError(error, 'save_failed'));
    } finally {
      setBusy(false);
    }
  };

  const closeDrawer = async () => {
    if (counted === '') {
      addToast(friendlyMessage('validation', { description: 'Enter the counted cash.' }));
      return;
    }
    setBusy(true);
    try {
      await apiJson('/api/admin/cash-drawer', {
        method: 'PUT',
        body: JSON.stringify({ session_id: data.open.id, counted_amount: Number(counted) }),
      });
      addToast(friendlyMessage('save_success', { description: 'Drawer closed and reconciled.' }));
      setCounted('');
      load();
    } catch (error) {
      addToast(friendlyFromError(error, 'save_failed'));
    } finally {
      setBusy(false);
    }
  };

  const openMove = (direction) => {
    const types = direction === 'in' ? data.cash_in_types : data.cash_out_types;
    setMove({
      ...emptyMove,
      movement_type: types?.[0]?.value || '',
      bank_account_id: String(data.banks?.[0]?.id || ''),
    });
    keyRef.current = `cm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setModal(direction);
  };

  const submitMove = async (event) => {
    event.preventDefault();
    if (!(Number(move.amount) > 0)) {
      addToast(friendlyMessage('validation', { description: 'Enter an amount.' }));
      return;
    }
    if (!move.movement_type) {
      addToast(friendlyMessage('validation', { description: 'Select a type.' }));
      return;
    }
    if (String(move.reason || '').trim().length < 3) {
      addToast(friendlyMessage('validation', { description: 'Enter a reason (at least 3 characters).' }));
      return;
    }
    if (needsBank && !move.bank_account_id) {
      addToast(friendlyMessage('validation', { description: 'Select a bank account.' }));
      return;
    }
    setBusy(true);
    try {
      await apiJson('/api/admin/cash-drawer', {
        method: 'POST',
        body: JSON.stringify({
          action: modal === 'in' ? 'cash_in' : 'cash_out',
          movement_type: move.movement_type,
          amount: Number(move.amount),
          reason: move.reason.trim(),
          bank_account_id: needsBank ? Number(move.bank_account_id) : null,
          drawer_id: data.open?.drawer_id || openForm.drawer_id || null,
          external_ref: keyRef.current,
        }),
      });
      addToast(friendlyMessage('save_success', {
        description: modal === 'in' ? 'Cash in recorded.' : 'Cash out recorded.',
      }));
      setModal(null);
      setMove(emptyMove);
      keyRef.current = `cm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      load();
    } catch (error) {
      addToast(friendlyFromError(error, 'save_failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Cash Drawer</h1>
        <p className="mt-1 text-sm text-gray-500">
          Open with a float, record Cash In / Cash Out (not sales), then close by counting. Difference posts to Cash Over / Short.
        </p>
      </header>

      <div className="space-y-6 bg-gray-50 p-4 sm:p-6 lg:p-8">
        {data.open ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-emerald-800">
                <Unlock className="h-5 w-5" />
                <h2 className="text-lg font-semibold">{data.open.drawer_name} is open</h2>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => openMove('in')}
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  <ArrowDownLeft className="h-4 w-4" /> Cash In
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => openMove('out')}
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-rose-700 px-4 text-sm font-medium text-white hover:bg-rose-800 disabled:opacity-50"
                >
                  <ArrowUpRight className="h-4 w-4" /> Cash Out
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Opened by" value={data.open.opened_by_name || '—'} />
              <Stat label="Opening float" value={money(data.open.opening_amount)} />
              <Stat label="Expected cash" value={data.cashPolicy?.expectedCashVisible === false ? `Available at ${data.cashPolicy.cutoff} NPT` : money(data.expected_cash)} />
              <Stat label="Opened at" value={formatNepalTime(data.open.opened_at)} />
            </div>
            <div className="mt-5 flex flex-wrap items-end gap-3 border-t border-emerald-200 pt-4">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Counted cash</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={counted}
                  onChange={(e) => setCounted(e.target.value)}
                  className="h-11 w-48 rounded-lg border border-gray-300 px-3 text-sm"
                  placeholder="0.00"
                />
              </label>
              <button
                disabled={busy || data.cashPolicy?.normalCloseAllowed === false}
                onClick={closeDrawer}
                className="inline-flex h-11 items-center gap-2 rounded-lg bg-gray-900 px-5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
              >
                <Lock className="h-4 w-4" /> Close &amp; reconcile
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-gray-900">Open a drawer</h2>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy || !data.drawers.length}
                  onClick={() => openMove('in')}
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  <ArrowDownLeft className="h-4 w-4" /> Cash In
                </button>
                <button
                  type="button"
                  disabled={busy || !data.drawers.length}
                  onClick={() => openMove('out')}
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-rose-700 px-4 text-sm font-medium text-white hover:bg-rose-800 disabled:opacity-50"
                >
                  <ArrowUpRight className="h-4 w-4" /> Cash Out
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Drawer</span>
                <select
                  value={openForm.drawer_id}
                  onChange={(e) => setOpenForm((f) => ({ ...f, drawer_id: e.target.value }))}
                  className="h-11 rounded-lg border border-gray-300 px-3 text-sm"
                >
                  {data.drawers.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Opening float</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={openForm.opening_amount}
                  onChange={(e) => setOpenForm((f) => ({ ...f, opening_amount: e.target.value }))}
                  className="h-11 w-48 rounded-lg border border-gray-300 px-3 text-sm"
                  placeholder="0.00"
                />
              </label>
              <button
                disabled={busy || !data.drawers.length}
                onClick={openDrawer}
                className="inline-flex h-11 items-center gap-2 rounded-lg bg-gray-900 px-5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
              >
                <Unlock className="h-4 w-4" /> Open drawer
              </button>
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-5 py-4">
            <h2 className="text-sm font-semibold text-gray-900">Cash In / Out history</h2>
            <p className="mt-0.5 text-xs text-gray-500">These change expected drawer cash but are not sales.</p>
          </div>
          <HistoryFilters
            {...movementFilters}
            selectLabel="Direction"
            selectOptions={[{ value: '', label: 'Cash in & out' }, { value: 'in', label: 'Cash in' }, { value: 'out', label: 'Cash out' }]}
            searchPlaceholder="Reason, journal, reference, or employee…"
            onChange={(patch) => { setMovementFilters((value) => ({ ...value, ...patch })); setMovementPage(1); }}
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">When</th>
                  <th className="px-4 py-3 font-semibold">Type / reason</th>
                  <th className="px-4 py-3 font-semibold">By</th>
                  <th className="px-4 py-3 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(data.movements || []).map((row) => {
                  const delta = Number(row.cash_delta || 0);
                  const isIn = delta >= 0;
                  return (
                    <tr key={row.id} tabIndex={0} role="button" onClick={() => setSelectedMovement(row)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setSelectedMovement(row); }} className="cursor-pointer hover:bg-gray-50 focus:bg-gray-50 focus:outline-none">
                      <td className="px-4 py-2.5 text-gray-600">{formatNepalTime(row.created_at)}</td>
                      <td className="px-4 py-2.5 text-gray-900">
                        <span className={`mr-2 inline-flex rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${isIn ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                          {row.is_reversal ? 'Reversal' : isIn ? 'In' : 'Out'}
                        </span>
                        <span className={row.reversal_id ? 'line-through text-gray-500' : ''}>{row.memo}</span>
                        {row.reversal_id ? <span className="ml-2 text-xs font-medium text-amber-700">Reversed by #{row.reversal_id}</span> : null}
                        {row.is_reversal ? <span className="mt-1 block text-xs text-gray-500">Undoing #{row.reversed_journal_id}: {row.original_memo}</span> : null}
                      </td>
                      <td className="px-4 py-2.5 text-gray-600">{row.by_name || '—'}</td>
                      <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${isIn ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {isIn ? '+' : '−'}{money(Math.abs(delta))}
                      </td>
                    </tr>
                  );
                })}
                {!loading && !(data.movements || []).length && (
                  <tr><td colSpan={4} className="px-4 py-10 text-center text-gray-500">No cash in / out yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="px-4 pb-4"><PaginationControls pagination={data.movement_pagination} loading={loading} onPageChange={setMovementPage} onPageSizeChange={(value) => { setMovementPageSize(value); setMovementPage(1); }} /></div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-5 py-4">
            <h2 className="text-sm font-semibold text-gray-900">Session history</h2>
          </div>
          <HistoryFilters
            {...sessionFilters}
            selectLabel="Status"
            selectOptions={[{ value: '', label: 'Open & closed' }, { value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }]}
            searchPlaceholder="Drawer, note, or employee…"
            onChange={(patch) => { setSessionFilters((value) => ({ ...value, ...patch })); setSessionPage(1); }}
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Drawer</th>
                  <th className="px-4 py-3 font-semibold">Opened</th>
                  <th className="px-4 py-3 font-semibold">Closed</th>
                  <th className="px-4 py-3 text-right font-semibold">Opening</th>
                  <th className="px-4 py-3 text-right font-semibold">Expected</th>
                  <th className="px-4 py-3 text-right font-semibold">Counted</th>
                  <th className="px-4 py-3 text-right font-semibold">Difference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.sessions.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-900">{s.drawer_name}</td>
                    <td className="px-4 py-2.5 text-gray-600">{formatNepalTime(s.opened_at)}</td>
                    <td className="px-4 py-2.5 text-gray-600">
                      {s.closed_at ? formatNepalTime(s.closed_at) : <span className="text-emerald-700">Open</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{money(s.opening_amount)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{s.expected_amount != null ? money(s.expected_amount) : '—'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{s.counted_amount != null ? money(s.counted_amount) : '—'}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${Number(s.difference) < 0 ? 'text-rose-700' : Number(s.difference) > 0 ? 'text-amber-700' : 'text-gray-500'}`}>
                      {s.difference != null ? money(s.difference) : '—'}
                    </td>
                  </tr>
                ))}
                {!loading && data.sessions.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-500">No sessions yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="px-4 pb-4"><PaginationControls pagination={data.session_pagination} loading={loading} onPageChange={setSessionPage} onPageSizeChange={(value) => { setSessionPageSize(value); setSessionPage(1); }} /></div>
        </div>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={submitMove} className="w-full max-w-md rounded-2xl border border-gray-200 bg-white shadow-xl">
            <div className="border-b border-gray-200 px-5 py-4">
              <h2 className="text-lg font-bold text-gray-900">{modal === 'in' ? 'Cash In' : 'Cash Out'}</h2>
              <p className="mt-1 text-xs text-gray-500">
                {modal === 'in'
                  ? 'Adds to expected drawer cash. Does not count as sales.'
                  : 'Removes from expected drawer cash. Journaled by type — not always an expense.'}
              </p>
            </div>
            <div className="space-y-4 p-5">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Type</span>
                <select
                  required
                  value={move.movement_type}
                  onChange={(e) => setMove((m) => ({ ...m, movement_type: e.target.value }))}
                  className="h-11 w-full rounded-lg border border-gray-300 px-3 text-sm"
                >
                  {typeOptions.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Amount</span>
                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={move.amount}
                  onChange={(e) => setMove((m) => ({ ...m, amount: e.target.value }))}
                  className="h-11 w-full rounded-lg border border-gray-300 px-3 text-sm"
                  placeholder="0.00"
                />
              </label>
              {needsBank && (
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-gray-700">
                    {modal === 'in' ? 'Bank account (source)' : 'Bank account (destination)'}
                  </span>
                  <select
                    required
                    value={move.bank_account_id}
                    onChange={(e) => setMove((m) => ({ ...m, bank_account_id: e.target.value }))}
                    className="h-11 w-full rounded-lg border border-gray-300 px-3 text-sm"
                  >
                    {(data.banks || []).map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </label>
              )}
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Reason / note</span>
                <textarea
                  required
                  minLength={3}
                  value={move.reason}
                  onChange={(e) => setMove((m) => ({ ...m, reason: e.target.value }))}
                  className="min-h-24 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  placeholder="Required — why this movement happened"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
              <button
                type="button"
                onClick={() => setModal(null)}
                className="inline-flex h-10 items-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className={`inline-flex h-10 items-center rounded-lg px-4 text-sm font-medium text-white disabled:opacity-50 ${
                  modal === 'in' ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-rose-700 hover:bg-rose-800'
                }`}
              >
                {busy ? 'Saving…' : modal === 'in' ? 'Record Cash In' : 'Record Cash Out'}
              </button>
            </div>
          </form>
        </div>
      )}
      {selectedMovement && <MovementDetail row={selectedMovement} onClose={() => setSelectedMovement(null)} />}
    </AdminLayout>
  );
}

function MovementDetail({ row, onClose }) {
  const delta = Number(row.cash_delta || 0);
  const title = row.is_reversal ? 'Cash movement reversal' : delta >= 0 ? 'Cash In details' : 'Cash Out details';
  return <div className="fixed inset-0 z-[110] flex items-center justify-center bg-gray-950/50 p-4" role="dialog" aria-modal="true" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white shadow-2xl">
      <div className="flex items-start justify-between border-b border-gray-200 px-5 py-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Journal #{row.id}</p><h3 className="mt-1 text-lg font-bold text-gray-950">{title}</h3></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"><X className="h-4 w-4"/></button></div>
      <div className="space-y-4 p-5">
        <p className="rounded-xl bg-gray-50 p-4 text-sm leading-6 text-gray-800">{row.memo}</p>
        <div className="grid gap-4 sm:grid-cols-2"><MovementField label="When" value={formatNepalTime(row.created_at)}/><MovementField label="Recorded by" value={row.by_name || 'Not recorded'}/><MovementField label="Direction" value={row.is_reversal ? 'Reversal / correction' : delta >= 0 ? 'Cash added' : 'Cash removed'}/><MovementField label="Amount" value={`${delta >= 0 ? '+' : '−'}${money(Math.abs(delta))}`} tone={delta >= 0 ? 'green' : 'red'}/></div>
        {row.is_reversal ? <div className="border-l-4 border-rose-500 bg-rose-50 p-3 text-sm text-rose-900"><strong>Undoing journal #{row.reversed_journal_id}</strong><p className="mt-1">{row.original_memo}</p></div> : null}
        {row.reversal_id ? <div className="border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-900">This entry was reversed by journal <strong>#{row.reversal_id}</strong>. It no longer contributes to net Cash In / Cash Out totals.</div> : null}
      </div>
    </div>
  </div>;
}

function MovementField({ label, value, tone = '' }) {
  return <div><p className="text-xs font-medium text-gray-500">{label}</p><p className={`mt-1 text-sm font-semibold ${tone === 'green' ? 'text-emerald-700' : tone === 'red' ? 'text-rose-700' : 'text-gray-900'}`}>{value}</p></div>;
}

function Stat({ label, value }) {
  return (
    <div>
      <p className="text-xs font-medium text-emerald-700/70">{label}</p>
      <p className="mt-0.5 truncate text-sm font-semibold text-gray-900">{value}</p>
    </div>
  );
}
