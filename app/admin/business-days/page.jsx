'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AlertTriangle, CalendarClock, CircleCheck, LockKeyhole, Printer, RefreshCw, UnlockKeyhole } from 'lucide-react';
import AdminLayout from '@/components/admin/admin-layout';
import ClosingSummary from '@/components/business-days/closing-summary';
import DayNotesPanel from '@/components/business-days/day-notes-panel.jsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { apiJson } from '@/lib/authed-fetch';
import { printReport } from '@/lib/print-report.js';
import { friendlyFromError, friendlyMessage } from '@/lib/friendly-message';
import { useToast } from '@/components/ui/toast';
import DateInput from '@/components/ui/date-input.jsx';
import { formatCalendarDate, formatCalendarDateTime } from '@/lib/calendar-system.js';

const money = (value) => `Rs ${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const nepalToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu' }).format(new Date());
const dateOnly = (value) => {
  if (!value) return '';
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu' }).format(parsed);
  }
  const match = text.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : text.slice(0, 10);
};
const nextDate = (value) => {
  if (!value) return nepalToday();
  const date = new Date(`${dateOnly(value)}T12:00:00+05:45`);
  date.setUTCDate(date.getUTCDate() + 1);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu' }).format(date);
};
const formatDate = (value) => formatCalendarDate(dateOnly(value), { empty: '-' });
const formatTime = (value) => formatCalendarDateTime(value, { empty: '-' });

export default function BusinessDaysPage() {
  const isCashier = usePathname()?.startsWith('/cashier');
  const { addToast } = useToast();
  const [context, setContext] = useState(null);
  const [summary, setSummary] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState({ business_date: nepalToday(), opening_cash: '', opening_note: '', opening_cash_reason: '', opening_cash_note: '' });
  const [countedCash, setCountedCash] = useState('');
  const [cashDenominations, setCashDenominations] = useState({});
  const [closingNote, setClosingNote] = useState('');
  const [forceMode, setForceMode] = useState(false);
  const [forceReason, setForceReason] = useState('');
  const [selected, setSelected] = useState(null);
  const [confirmNextDay, setConfirmNextDay] = useState(false);
  const [staleReason, setStaleReason] = useState('');
  const [historicalSession, setHistoricalSession] = useState(null);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const [dayData, historyData] = await Promise.all([
        apiJson('/api/admin/business-days?view=closing'),
        apiJson('/api/admin/business-days?view=history&pageSize=25'),
      ]);
      setContext(dayData);
      setSummary(dayData.summary || null);
      setHistory(historyData.rows || []);
      if (!dayData.activeSession) {
        const suggestedDate = dayData.current?.business_date
          ? (dateOnly(dayData.current.business_date) === nepalToday() ? dateOnly(dayData.current.business_date) : nepalToday())
          : nepalToday();
        setOpening((value) => (value.business_date === suggestedDate ? value : { ...value, business_date: suggestedDate }));
      }
    } catch (error) {
      addToast(friendlyFromError(error, 'load_failed'));
    } finally { setLoading(false); }
  }, [addToast]);

  useEffect(() => { load(); }, [load]);

  const openDay = async (event, action = '') => {
    event?.preventDefault?.();
    setBusy(true);
    try {
      await apiJson('/api/admin/business-days', { method: 'POST', body: JSON.stringify({
        ...opening,
        action,
        confirm_next_day: action === 'start_next' ? confirmNextDay : undefined,
        opening_cash: Number(opening.opening_cash || 0),
        business_date: action === 'reopen_same_day' && context?.current?.business_date
          ? dateOnly(context.current.business_date)
          : action === 'start_next' && context?.current?.business_date
            ? nepalToday()
            : opening.business_date,
      }) });
      addToast(friendlyMessage('save_success', { description: action === 'reopen_same_day' ? 'Store reopened.' : 'Business day opened.' }));
      setOpening((value) => ({ ...value, opening_cash: '', opening_note: '', opening_cash_reason: '', opening_cash_note: '' }));
      setConfirmNextDay(false);
      await load({ quiet: true });
    } catch (error) { addToast(friendlyFromError(error, 'save_failed')); }
    finally { setBusy(false); }
  };

  const closeDay = async (force = false) => {
    if (countedCash === '') {
      addToast(friendlyMessage('validation', { description: 'Enter the physical cash counted in the drawer.' }));
      return;
    }
    if (force && !forceReason.trim()) {
      addToast(friendlyMessage('validation', { description: 'Enter a force-close reason.' }));
      return;
    }
    setBusy(true);
    try {
      await apiJson('/api/admin/business-days', { method: 'PUT', body: JSON.stringify({
        counted_cash: Number(countedCash), closing_note: closingNote.trim() || null,
        cash_denominations: cashDenominations,
        force, force_close_reason: force ? forceReason.trim() : null,
      }) });
      addToast(friendlyMessage('save_success', { description: force ? 'Store session force closed.' : 'Store session closed. The business day remains current until the next business day starts.' }));
      setCountedCash(''); setCashDenominations({}); setClosingNote(''); setForceMode(false); setForceReason('');
      await load({ quiet: true });
    } catch (error) {
      const blockerText = error?.blockers?.items?.map((item) => `${item.count} ${item.label}`).join(', ');
      addToast(friendlyFromError(blockerText ? { ...error, error: blockerText } : error, 'save_failed'));
    } finally { setBusy(false); }
  };

  const continueStale = async () => {
    if (!staleReason.trim()) {
      addToast(friendlyMessage('validation', { description: 'Enter a reason to continue this stale business day.' }));
      return;
    }
    setBusy(true);
    try {
      await apiJson('/api/admin/business-days', { method: 'POST', body: JSON.stringify({
        action: 'continue_stale',
        business_date: dateOnly(context?.current?.business_date),
        confirm_continue_stale: true,
        reason: staleReason.trim(),
      }) });
      addToast(friendlyMessage('save_success', { description: 'Business day continued.' }));
      setStaleReason('');
      await load({ quiet: true });
    } catch (error) { addToast(friendlyFromError(error, 'save_failed')); }
    finally { setBusy(false); }
  };

  const inspectDay = async (id) => {
    try { setSelected(await apiJson(`/api/admin/business-days/${id}`)); }
    catch (error) { addToast(friendlyFromError(error, 'load_failed')); }
  };

  const difference = useMemo(() => countedCash === '' || !summary || summary.cash?.hidden ? null : Number(countedCash) - Number(summary.cash?.expected_cash || 0), [countedCash, summary]);

  return <AdminLayout>
    <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold text-gray-950 sm:text-3xl">Opening &amp; Closing</h1><p className="mt-1 text-sm text-gray-500">Restaurant business-day lifecycle and cash reconciliation.</p></div>
        <button type="button" onClick={() => load()} disabled={loading} title="Refresh" className="inline-flex h-10 w-10 items-center justify-center border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
      </div>
    </header>

    <main className="bg-gray-50 px-4 py-6 sm:px-6 lg:px-8">
      {!loading && context?.current?.isStale && !context.current.staleAcknowledged && (
        <StaleBanner businessDate={context.current.business_date} laterBusinessDay={context.laterBusinessDay} reason={staleReason} setReason={setStaleReason} busy={busy} onContinue={continueStale} />
      )}
      {loading ? <div className="h-64 animate-pulse border border-gray-200 bg-white" /> : !context?.activeSession ? <OpeningForm context={context} opening={opening} setOpening={setOpening} busy={busy} onSubmit={openDay} confirmNextDay={confirmNextDay} setConfirmNextDay={setConfirmNextDay} /> : <>
        <div className="mb-6 border border-emerald-200 bg-emerald-50 px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3"><div className="mt-0.5 flex h-9 w-9 items-center justify-center bg-emerald-700 text-white"><UnlockKeyhole className="h-4 w-4" /></div><div><p className="text-xs font-semibold uppercase text-emerald-700">Business Day Open</p><p className="text-lg font-bold text-gray-950">{formatDate(context.current.business_date)}</p></div></div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3"><Status label="Opened" value={formatTime(context.activeSession?.opened_at || context.current.opened_at)} /><Status label="Opened By" value={context.activeSession?.opened_by_name || context.current.opened_by_name || 'Administrator'} /><Status label="Opening Cash" value={money(context.activeSession?.opening_cash ?? context.current.opening_cash)} /></div>
          </div>
        </div>

        <div className="border border-gray-200 bg-white px-4 py-6 sm:px-6 lg:px-8">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-5"><div><h2 className="text-xl font-bold text-gray-950">Business day closing</h2><p className="mt-1 text-sm text-gray-500">Review the entire day before closing. Figures refresh from operational and accounting records.</p></div><button type="button" onClick={() => load({ quiet: true })} className="inline-flex h-9 items-center gap-2 border border-gray-300 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"><RefreshCw className="h-4 w-4" />Refresh figures</button></div>
          <DayNotesPanel day={context.current} audit={context.audit || []} className="mb-6" />
          {context?.cashPolicy?.expectedCashVisible === false && <p role="status" className="mb-5 border border-amber-300 bg-amber-50 p-4 text-sm">Cash reconciliation and normal closing become available at {context.cashPolicy.cutoff || "the configured cutoff"} Nepal time. Refresh figures after the cutoff.</p>}
          {summary && <ClosingSummary summary={summary} countedCash={countedCash} onCountedCashChange={setCountedCash} denominationCounts={cashDenominations} onDenominationCountsChange={setCashDenominations} interactive onHistoricalSessionChange={setHistoricalSession} />}
          <div className="border-t border-gray-200 pt-6">
            <label className="block"><span className="mb-2 block text-sm font-semibold text-gray-900">Closing Note <span className="font-normal text-gray-500">optional</span></span><textarea value={closingNote} onChange={(event) => setClosingNote(event.target.value)} rows={3} maxLength={1000} className="w-full border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900" placeholder="Handover details or notes for management" /></label>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
              <div className="text-sm text-gray-600">{historicalSession ? <span className="font-semibold text-amber-700">Viewing closed session {historicalSession.session_number} — switch back to the open session to close the drawer.</span> : difference == null ? 'Enter counted cash to complete reconciliation.' : <span className="font-semibold">Difference: {Math.abs(difference) < 0.005 ? 'MATCHED' : difference < 0 ? `SHORT ${money(Math.abs(difference))}` : `OVER ${money(difference)}`}</span>}</div>
              <div className="flex flex-wrap gap-2">{!isCashier && <button type="button" onClick={() => setForceMode((value) => !value)} className="h-11 border border-gray-300 px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50">{forceMode ? 'Cancel force close' : 'Force close'}</button>}<button type="button" disabled={busy || historicalSession || context?.cashPolicy?.normalCloseAllowed === false || countedCash === '' || !summary?.blockers?.canCloseNormally} onClick={() => closeDay(false)} className="inline-flex h-11 items-center gap-2 bg-gray-950 px-5 text-sm font-semibold text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-40"><LockKeyhole className="h-4 w-4" />Close Store Session</button></div>
            </div>
            {!isCashier && forceMode && <div className="mt-4 border border-amber-300 bg-amber-50 p-4"><div className="flex gap-2 text-sm text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><p>Force close preserves unresolved orders, KOTs and bills. They will be explicitly carried into the next opened business day.</p></div><label className="mt-3 block"><span className="mb-1 block text-sm font-semibold text-amber-950">Required reason</span><textarea value={forceReason} onChange={(event) => setForceReason(event.target.value)} rows={2} maxLength={1000} className="w-full border border-amber-400 bg-white px-3 py-2 text-sm outline-none focus:border-amber-700" /></label><button type="button" disabled={busy || countedCash === '' || !forceReason.trim()} onClick={() => closeDay(true)} className="mt-3 inline-flex h-11 items-center gap-2 bg-amber-700 px-5 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-40"><AlertTriangle className="h-4 w-4" />Force Close Business Day</button></div>}
          </div>
        </div>
      </>}

      <History rows={history} onSelect={inspectDay} />
    </main>

    <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}><DialogContent className="sm:max-w-6xl" data-print-root onClose={() => setSelected(null)}><DialogHeader><DialogTitle>Closing Report · {formatDate(selected?.day?.business_date)}</DialogTitle></DialogHeader>{selected?.day?.closed_at && <p className="mt-1 text-sm text-gray-500">Closed at <span className="font-semibold text-gray-800">{formatTime(selected.day.closed_at)}</span>{selected.day.closed_by_name ? ` by ${selected.day.closed_by_name}` : ''}</p>}<DayNotesPanel day={selected?.day} audit={selected?.audit || []} className="mt-4" />{selected?.summary && <div className="mt-6"><ClosingSummary summary={selected.summary} countedCash={selected.day?.counted_cash ?? ''} /></div>}<div className="mt-6 flex justify-end"><button type="button" onClick={(e) => printReport(e.currentTarget.closest('[data-print-root]'))} className="inline-flex h-10 items-center gap-2 border border-gray-300 px-4 text-sm font-semibold"><Printer className="h-4 w-4" />Print</button></div></DialogContent></Dialog>
  </AdminLayout>;
}

function OpeningForm({ context, opening, setOpening, busy, onSubmit, confirmNextDay, setConfirmNextDay }) {
  const storeClosed = !!context?.storeClosed;
  const currentDate = context?.current?.business_date ? dateOnly(context.current.business_date) : null;
  // Once the session is closed, the calendar decides the primary action.
  // A stale acknowledgement only permits finishing yesterday's open work; it
  // must never turn yesterday into the reopen choice on a new Nepal date.
  const isNewDay = storeClosed && Boolean(currentDate) && currentDate !== nepalToday();
  const canContinueStale = !!context?.current?.isStale && !context?.current?.staleAcknowledged;
  const suggestedNextDate = isNewDay ? nepalToday() : (currentDate ? nextDate(currentDate) : opening.business_date);
  const displayDate = isNewDay ? suggestedNextDate : (storeClosed ? currentDate : opening.business_date);
  const previousClosingCash = storeClosed ? context?.latestSession?.counted_cash : context?.previous?.counted_cash;
  const openingAmount = opening.opening_cash === '' ? null : Number(opening.opening_cash || 0);
  const cashDelta = previousClosingCash == null || openingAmount == null ? 0 : openingAmount - Number(previousClosingCash || 0);
  const movementRequired = Math.abs(cashDelta) >= 0.01;
  const movementMissing = movementRequired && (!opening.opening_cash_reason || (opening.opening_cash_reason === 'other' && !String(opening.opening_cash_note || '').trim()));
  const movementOptions = cashDelta < 0
    ? [['cash_reserve', 'Cash Reserve / Safe'], ['bank_deposit', 'Bank Deposit'], ['owner_withdrawal', 'Owner Withdrawal'], ['other', 'Other']]
    : [['cash_reserve', 'Cash Reserve / Safe'], ['bank_withdrawal', 'Bank Withdrawal'], ['owner_contribution', 'Owner Contribution'], ['other', 'Other']];
  const primaryAction = isNewDay ? 'start_next' : (storeClosed ? 'reopen_same_day' : '');
  const primaryDisabled = busy || opening.opening_cash === '' || movementMissing || (isNewDay && !confirmNextDay);
  const primaryLabel = isNewDay ? `Open New Business Day · ${formatDate(suggestedNextDate)}` : storeClosed ? 'Reopen Store' : 'Open Business Day';

  return <div className="mx-auto max-w-3xl border border-gray-200 bg-white">
    <div className="border-b border-gray-200 px-5 py-5 sm:px-7"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center bg-gray-950 text-white"><CalendarClock className="h-5 w-5" /></div><div><p className="text-xs font-semibold uppercase text-gray-500">Business Day Opening</p><h2 className="text-xl font-bold text-gray-950">{isNewDay ? 'Start a new business day' : storeClosed ? 'Store session closed' : 'Begin restaurant operations'}</h2></div></div></div>
    <form onSubmit={(event) => onSubmit(event, primaryAction)} className="space-y-5 px-5 py-6 sm:px-7">
      {storeClosed && !isNewDay && <div className="border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><strong className="font-semibold">Business Day {formatDate(currentDate)} is still current.</strong> Reopen the store to continue this day.</div>}
      {isNewDay && <div className="border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><strong className="font-semibold">It&apos;s now {formatDate(suggestedNextDate)} in Nepal.</strong> Business Day {formatDate(currentDate)} is from an earlier date. Open today&apos;s business day below.{canContinueStale ? ` Use the stale-day notice above only if the previous night shift is genuinely still being finished.` : ''}</div>}
      <div className="grid gap-4 sm:grid-cols-2"><label><span className="mb-1.5 block text-sm font-semibold text-gray-800">Business Date</span><DateInput required value={displayDate || ''} disabled={storeClosed} onChange={(v) => setOpening((value) => ({ ...value, business_date: v }))} className="h-12 w-full border border-gray-300 px-3 text-base outline-none focus:border-gray-950 disabled:bg-gray-100" /></label><div><span className="mb-1.5 block text-sm font-semibold text-gray-800">{storeClosed ? 'Current Business Day' : 'Previous Business Day'}</span><div className="flex h-12 items-center border border-gray-200 bg-gray-50 px-3 text-sm text-gray-700">{storeClosed && context?.current ? <><CircleCheck className="mr-2 h-4 w-4 text-emerald-600" />{formatDate(context.current.business_date)} · Closed {formatTime(context.latestSession?.closed_at || context.current.closed_at)}</> : context?.previous ? <><CircleCheck className="mr-2 h-4 w-4 text-emerald-600" />{formatDate(context.previous.business_date)} · Closed {formatTime(context.previous.closed_at)}</> : 'No previous business day'}</div></div></div>
      {previousClosingCash != null && <div className="border-l-4 border-gray-300 bg-gray-50 px-4 py-3"><p className="text-xs font-medium text-gray-500">Previous Closing Cash</p><p className="mt-0.5 text-lg font-semibold tabular-nums text-gray-950">{money(previousClosingCash)}</p><p className="mt-1 text-xs text-gray-500">Reference only. Enter the cash physically present now.</p></div>}
      <label><span className="mb-1.5 block text-sm font-semibold text-gray-800">Opening Cash</span><div className="flex h-14 items-center border-2 border-gray-950 px-4"><span className="mr-2 text-lg font-semibold">Rs</span><input type="number" min="0" step="0.01" inputMode="decimal" required value={opening.opening_cash} onChange={(event) => setOpening((value) => ({ ...value, opening_cash: event.target.value }))} className="min-w-0 flex-1 text-2xl font-bold tabular-nums outline-none" placeholder="0.00" /></div><p className="mt-1.5 text-xs text-gray-500">Physical cash available in the drawer. This is not revenue.</p></label>
      {movementRequired && <div className="border border-gray-200 bg-gray-50 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold text-gray-950">{cashDelta < 0 ? 'Cash removed before opening' : 'Cash added before opening'}</p><p className="mt-1 text-xs text-gray-500">{cashDelta < 0 ? `${money(Math.abs(cashDelta))} less than previous closing cash.` : `${money(cashDelta)} more than previous closing cash.`}</p></div><span className="text-sm font-bold tabular-nums text-gray-950">{cashDelta < 0 ? '-' : '+'} {money(Math.abs(cashDelta))}</span></div><div className="mt-3 grid gap-2 sm:grid-cols-2">{movementOptions.map(([value, label]) => <label key={value} className={`flex min-h-11 cursor-pointer items-center gap-2 border px-3 py-2 text-sm font-medium ${opening.opening_cash_reason === value ? 'border-gray-950 bg-white text-gray-950' : 'border-gray-200 bg-white text-gray-700'}`}><input type="radio" name="opening_cash_reason" value={value} checked={opening.opening_cash_reason === value} onChange={(event) => setOpening((state) => ({ ...state, opening_cash_reason: event.target.value }))} />{label}</label>)}</div>{opening.opening_cash_reason === 'other' && <label className="mt-3 block"><span className="mb-1 block text-sm font-semibold text-gray-800">Movement Note</span><textarea rows={2} maxLength={500} value={opening.opening_cash_note} onChange={(event) => setOpening((state) => ({ ...state, opening_cash_note: event.target.value }))} className="w-full border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-gray-950" placeholder="Explain where the cash came from or went" /></label>}</div>}
      <label><span className="mb-1.5 block text-sm font-semibold text-gray-800">Opening Note <span className="font-normal text-gray-500">optional</span></span><textarea rows={3} maxLength={1000} value={opening.opening_note} onChange={(event) => setOpening((value) => ({ ...value, opening_note: event.target.value }))} className="w-full border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-950" /></label>
      {isNewDay && <label className="flex items-start gap-2 text-sm text-gray-700"><input type="checkbox" checked={confirmNextDay} onChange={(event) => setConfirmNextDay(event.target.checked)} className="mt-1" />I confirm this starts {formatDate(suggestedNextDate)} as a new business day, not another session for {formatDate(currentDate)}.</label>}
      <button type="submit" disabled={primaryDisabled} className="inline-flex h-12 w-full items-center justify-center gap-2 bg-gray-950 px-5 text-sm font-semibold text-white hover:bg-black disabled:opacity-40">{isNewDay ? <CalendarClock className="h-4 w-4" /> : <UnlockKeyhole className="h-4 w-4" />}{primaryLabel}</button>
      {isNewDay && canContinueStale && <p className="text-center text-xs text-gray-500">Need to finish the previous night shift instead? Use the stale-day notice above.</p>}
    </form>
  </div>;
}
function History({ rows, onSelect }) {
  return <section className="mt-6 border border-gray-200 bg-white"><div className="border-b border-gray-200 px-5 py-4"><h2 className="text-sm font-semibold text-gray-950">Business Day History</h2></div><div className="overflow-x-auto"><table className="w-full min-w-[980px] text-sm"><thead className="bg-gray-50 text-left text-xs uppercase text-gray-500"><tr>{['Business Date','Opened','Closed','Opened By','Closed By','Opening Cash','Expected','Counted','Difference','Sales','Notes','Status'].map((label) => <th key={label} className="px-4 py-3 font-semibold">{label}</th>)}</tr></thead><tbody className="divide-y divide-gray-100">{rows.map((day) => { let snap={};try{snap=JSON.parse(day.closing_snapshot||'{}')}catch{} return <tr key={day.id} onClick={() => onSelect(day.id)} className="cursor-pointer hover:bg-gray-50"><td className="px-4 py-3 font-semibold text-gray-950">{formatDate(day.business_date)}</td><td className="px-4 py-3 text-gray-600">{formatTime(day.opened_at)}</td><td className="px-4 py-3 text-gray-600">{formatTime(day.closed_at)}</td><td className="px-4 py-3 text-gray-600">{day.opened_by_name || '-'}</td><td className="px-4 py-3 text-gray-600">{day.closed_by_name || '-'}</td><td className="px-4 py-3 text-right tabular-nums">{money(day.opening_cash)}</td><td className="px-4 py-3 text-right tabular-nums">{day.expected_cash == null ? '-' : money(day.expected_cash)}</td><td className="px-4 py-3 text-right tabular-nums">{day.counted_cash == null ? '-' : money(day.counted_cash)}</td><td className={`px-4 py-3 text-right font-semibold tabular-nums ${Number(day.cash_difference)<0?'text-rose-700':Number(day.cash_difference)>0?'text-amber-700':'text-emerald-700'}`}>{day.cash_difference==null?'-':money(day.cash_difference)}</td><td className="px-4 py-3 text-right tabular-nums">{money(snap?.sales?.billed_total)}</td><td className="px-4 py-3"><DayNotesCell day={day} /></td><td className="px-4 py-3"><span className={`inline-flex items-center gap-1 text-xs font-semibold ${day.status==='open'?'text-emerald-700':'text-gray-600'}`}>{day.status==='open'?<UnlockKeyhole className="h-3.5 w-3.5"/>:<LockKeyhole className="h-3.5 w-3.5"/>}{day.force_closed?'Force closed':day.status}</span></td></tr>;})}{rows.length===0&&<tr><td colSpan={12} className="px-4 py-10 text-center text-gray-500">No business day history yet.</td></tr>}</tbody></table></div></section>;
}

function StaleBanner({ businessDate, laterBusinessDay, reason, setReason, busy, onContinue }) {
  return <div className="mb-6 border border-rose-300 bg-rose-50 px-4 py-4 sm:px-5">
    <div className="flex gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-700" />
      <div className="flex-1">
        <p className="text-sm font-semibold text-rose-900">Business Day {formatDate(businessDate)} is still open from a previous Nepal date.</p>
        {laterBusinessDay ? (
          <p className="mt-2 border border-rose-300 bg-white px-3 py-2 text-sm font-medium text-rose-900">
            It cannot be continued because the later Business Day {formatDate(laterBusinessDay.business_date)} already exists. Close this old store session, then start the current business day. This prevents new expenses and purchases from being posted into the old drawer.
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-rose-800">New orders, expenses, payroll, and other new activity are blocked until this day is continued or the next business day is started. Existing orders and KOTs can still be completed, paid, voided, or cancelled.</p>
            <label className="mt-3 block"><span className="mb-1 block text-sm font-semibold text-rose-950">Reason to continue this day</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} maxLength={500} className="w-full border border-rose-300 bg-white px-3 py-2 text-sm outline-none focus:border-rose-700" placeholder="e.g. Night shift is still settling bills" /></label>
            <button type="button" disabled={busy || !reason.trim()} onClick={onContinue} className="mt-3 inline-flex h-10 items-center gap-2 bg-rose-700 px-4 text-sm font-semibold text-white hover:bg-rose-800 disabled:opacity-40"><UnlockKeyhole className="h-4 w-4" />Continue This Existing Business Day</button>
          </>
        )}
      </div>
    </div>
  </div>;
}

function Status({ label, value }) { return <div><p className="text-xs font-medium text-emerald-700">{label}</p><p className="mt-0.5 max-w-48 truncate font-semibold text-gray-950">{value}</p></div>; }


/**
 * Compact notes cell for the history table. Shows the first note that exists
 * (force-close reason wins, it is the one worth seeing at a glance), truncated,
 * with the full text on hover. The row already opens the closing report, which
 * shows all of them in full.
 */
function DayNotesCell({ day }) {
  const note =
    (day.force_closed && day.force_close_reason) ||
    day.closing_note ||
    day.opening_note ||
    '';
  if (!note) return <span className="text-gray-300">-</span>;
  const warn = Boolean(day.force_closed && day.force_close_reason);
  return (
    <span
      title={note}
      className={`block max-w-[200px] truncate text-xs ${warn ? 'font-medium text-amber-800' : 'text-gray-600'}`}
    >
      {note}
    </span>
  );
}
