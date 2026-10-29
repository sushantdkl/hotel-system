'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Clock, LogIn, LogOut, Plus, RefreshCw } from 'lucide-react';
import { apiJson } from '@/lib/authed-fetch';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useConfirm } from '@/components/ui/confirm';
import { HOTEL_ROLE_HOME, ROLE_LABELS, isAdminLike } from '@/lib/roles';

const HOME = { cashier: '/cashier', waiter: '/waiter', kitchen: '/kitchen' };
const homeFor = (role) => HOME[role] || HOTEL_ROLE_HOME[role] || (isAdminLike(role) ? '/admin/dashboard' : '/login');
const STATUS_TONE = {
  present: 'bg-emerald-50 text-emerald-700', half_day: 'bg-amber-50 text-amber-700', leave: 'bg-sky-50 text-sky-700', absent: 'bg-rose-50 text-rose-700',
  pending: 'bg-amber-50 text-amber-700', approved: 'bg-emerald-50 text-emerald-700', rejected: 'bg-rose-50 text-rose-700', cancelled: 'bg-gray-100 text-gray-500',
};
const label = (s) => String(s || '').replace('_', ' ').replace(/^\w/, (c) => c.toUpperCase());
const time = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kathmandu' }) : '');
const Pill = ({ status }) => <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[status] || 'bg-gray-100 text-gray-600'}`}>{label(status)}</span>;

export default function StaffSelfServicePage() {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [month, setMonth] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(null); // 'clock_out' | 'leave'
  const { confirm } = useConfirm();
  const [inbox, setInbox] = useState({ items: [], unread: 0 });
  const loadInbox = useCallback(async () => {
    try { setInbox(await apiJson('/api/notifications')); } catch { /* inbox is optional */ }
  }, []);
  useEffect(() => { void Promise.resolve().then(loadInbox); }, [loadInbox]);
  const readAll = async () => { try { await apiJson('/api/notifications', { method: 'POST', body: '{}' }); await loadInbox(); } catch { /* ignore */ } };

  const load = useCallback(async (m = month) => {
    try {
      const result = await apiJson(`/api/staff/me${m ? `?month=${m}` : ''}`);
      setData(result);
      setMonth(result.month);
      setError('');
    } catch (err) {
      if (err.status === 401) router.push('/login');
      else setError(err.error || 'Could not load your attendance.');
    }
  }, [month, router]);

  useEffect(() => { void Promise.resolve().then(() => load('')); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (body, after) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await apiJson('/api/staff/me', { method: 'POST', body: JSON.stringify(body) });
      setNotice(result.message);
      after?.();
      await load();
    } catch (err) {
      setError(err.error || 'Could not save this update.');
    } finally {
      setBusy(false);
    }
  };

  const role = data?.user?.role;
  const t = data?.totals;
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-4xl space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href={homeFor(role)} className="rounded-lg border border-gray-300 bg-white p-2 text-gray-700 hover:bg-gray-50" aria-label="Back"><ArrowLeft className="h-5 w-5" /></Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-950">My attendance & leave</h1>
              <p className="text-sm text-gray-500">{data ? `${data.user.full_name} · ${ROLE_LABELS[role] || role}` : 'Loading…'}</p>
            </div>
          </div>
          <button type="button" onClick={() => load()} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"><RefreshCw className="h-4 w-4" /> Refresh</button>
        </header>

        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}

        {inbox.items.length > 0 && <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3"><h2 className="font-bold text-gray-950">Notifications{inbox.unread ? ` (${inbox.unread} new)` : ''}</h2>{inbox.unread > 0 && <button type="button" onClick={readAll} className="text-sm font-semibold text-gray-600 underline">Mark all read</button>}</div>
          <div className="divide-y divide-gray-100">{inbox.items.slice(0, 10).map((n) => <div key={n.id} className={`py-2.5 text-sm ${n.read_at ? 'text-gray-500' : ''}`}>
            <p className={n.read_at ? '' : 'font-semibold text-gray-950'}>{n.title}</p><p>{n.body}</p>{n.link && <Link href={n.link} className="text-xs font-semibold text-sky-700 underline">Open</Link>}
          </div>)}</div>
        </section>}

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Clock className={`h-9 w-9 ${data?.clockedInSince ? 'text-emerald-600' : 'text-gray-400'}`} />
              <div>
                <p className="font-bold text-gray-950">{data?.clockedInSince ? `Clocked in since ${time(data.clockedInSince)}` : 'Not clocked in'}</p>
                <p className="text-sm text-gray-500">{data?.clockedInSince ? 'Clock out when your shift ends. Add a handover note if needed.' : 'Clock in when you start your shift.'}</p>
              </div>
            </div>
            {data && !data.clockedInSince && (
              <button type="button" disabled={busy} onClick={() => act({ action: 'clock_in' })} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 font-bold text-white hover:bg-emerald-700 disabled:opacity-50"><LogIn className="h-5 w-5" /> Clock in</button>
            )}
            {data?.clockedInSince && (
              <button type="button" disabled={busy} onClick={() => { setError(''); setModal('clock_out'); }} className="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-950 px-5 py-3 font-bold text-white hover:bg-gray-800 disabled:opacity-50"><LogOut className="h-5 w-5" /> Clock out</button>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-bold text-gray-950">Monthly attendance</h2>
            <input type="month" value={month} onChange={(e) => { setMonth(e.target.value); void load(e.target.value); }} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" aria-label="Month" />
          </div>
          {t && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {[['Present', t.present], ['Half day', t.halfDay], ['Leave', t.leave], ['Absent', t.absent], ['Hours', t.hours], ['Overtime h', t.overtime]].map(([k, v]) => (
                <div key={k} className="rounded-xl bg-gray-50 p-3 text-center"><p className="text-xl font-bold tabular-nums text-gray-950">{v}</p><p className="text-xs text-gray-500">{k}</p></div>
              ))}
            </div>
          )}
          <div className="mt-4 divide-y divide-gray-100">
            {data?.days?.map((d) => (
              <div key={d.date} className="flex items-center justify-between py-2 text-sm"><span className="text-gray-700">{d.date}</span><span className="flex items-center gap-3"><span className="tabular-nums text-gray-500">{d.hours ? `${d.hours} h` : ''}</span><Pill status={d.status} /></span></div>
            ))}
            {data && !data.days.length && <p className="py-6 text-center text-sm text-gray-500">No attendance recorded this month.</p>}
          </div>
        </section>

        {role !== 'admin' && (
          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h2 className="font-bold text-gray-950">My leave</h2><p className="text-sm text-gray-500">{role === 'manager' ? 'Your requests go to the owner.' : 'Your requests go to your manager.'}</p></div>
              <button type="button" onClick={() => { setError(''); setModal('leave'); }} className="inline-flex items-center gap-2 rounded-xl bg-gray-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-gray-800"><Plus className="h-4 w-4" /> Apply for leave</button>
            </div>
            <Dialog open={modal === 'leave'} onOpenChange={(open) => { if (!open) setModal(null); }}><DialogContent onClose={() => setModal(null)} className="sm:max-w-lg">
            <DialogHeader><DialogTitle>Apply for leave</DialogTitle><DialogDescription>{role === 'manager' ? 'The owner approves or rejects it.' : 'Your manager approves or rejects it.'}</DialogDescription></DialogHeader>
            <form
              className="mt-6 grid gap-3 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                act({ action: 'apply_leave', ...Object.fromEntries(new FormData(e.currentTarget)) }, () => setModal(null));
              }}
            >
              <label className="text-sm font-medium text-gray-700">Type
                <select name="type" required className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"><option value="casual">Casual</option><option value="sick">Sick</option><option value="emergency">Emergency</option></select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-sm font-medium text-gray-700">From<input type="date" name="start" required className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-2" /></label>
                <label className="text-sm font-medium text-gray-700">To<input type="date" name="end" required className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-2" /></label>
              </div>
              <label className="text-sm font-medium text-gray-700 sm:col-span-2">Reason<input name="reason" required maxLength={500} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
              {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">{error}</p>}
              <button disabled={busy} className="rounded-xl bg-gray-950 px-4 py-2.5 font-bold text-white hover:bg-gray-800 disabled:opacity-50 sm:col-span-2">{busy ? 'Sending…' : 'Send request'}</button>
            </form>
            </DialogContent></Dialog>
            <div className="mt-5 divide-y divide-gray-100">
              {data?.leaves?.map((l) => (
                <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <div>
                    <p className="font-semibold text-gray-900">{label(l.leave_type)} · {l.start_date}{l.end_date !== l.start_date ? ` → ${l.end_date}` : ''}</p>
                    <p className="text-gray-500">{l.reason}{l.decision_note ? ` · ${l.decided_by_name || 'Approver'}: ${l.decision_note}` : ''}</p>
                  </div>
                  <span className="flex items-center gap-2">
                    <Pill status={l.status} />
                    {l.status === 'pending' && <button type="button" disabled={busy} onClick={async () => { if (await confirm({ title: 'Cancel this leave request?', message: `${label(l.leave_type)} leave · ${l.start_date}${l.end_date !== l.start_date ? ` → ${l.end_date}` : ''}`, confirmLabel: 'Cancel request', cancelLabel: 'Keep it', tone: 'danger' })) await act({ action: 'cancel_leave', id: l.id }); }} className="text-xs font-semibold text-gray-500 underline">Cancel</button>}
                  </span>
                </div>
              ))}
              {data && !data.leaves.length && <p className="py-4 text-center text-sm text-gray-500">No leave requests yet.</p>}
            </div>
          </section>
        )}
        <Dialog open={modal === 'clock_out'} onOpenChange={(open) => { if (!open) setModal(null); }}><DialogContent onClose={() => setModal(null)} className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Clock out?</DialogTitle><DialogDescription>{data?.clockedInSince ? `On shift since ${time(data.clockedInSince)}.` : ''} Hand over anything still open.</DialogDescription></DialogHeader>
          <form className="mt-6 space-y-4" onSubmit={(e) => { e.preventDefault(); act({ action: 'clock_out', note: new FormData(e.currentTarget).get('note') }, () => setModal(null)); }}>
            <label className="block text-sm font-medium text-gray-700">Handover note (optional)<textarea name="note" rows={3} maxLength={500} autoFocus placeholder="e.g. Open tables 4 and 7 passed to Ram" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></label>
            {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setModal(null)} className="rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700">Stay clocked in</button>
              <button disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-gray-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-gray-800 disabled:opacity-50"><LogOut className="h-4 w-4" /> {busy ? 'Saving…' : 'Clock out'}</button>
            </div>
          </form>
        </DialogContent></Dialog>
      </div>
    </main>
  );
}
