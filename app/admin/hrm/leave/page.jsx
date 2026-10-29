'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, RefreshCw, X } from 'lucide-react';
import AdminLayout from '@/components/admin/admin-layout';
import { apiJson } from '@/lib/authed-fetch';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ROLE_LABELS } from '@/lib/roles';

const time = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kathmandu' });
const TONE = { pending: 'bg-amber-50 text-amber-700', approved: 'bg-emerald-50 text-emerald-700', rejected: 'bg-rose-50 text-rose-700', cancelled: 'bg-gray-100 text-gray-500' };

export default function LeaveApprovalsPage() {
  const [status, setStatus] = useState('pending');
  const [data, setData] = useState(null);
  const [deciding, setDeciding] = useState(null); // { request, decision }
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await apiJson(`/api/admin/hrm/leave?status=${status}`));
      setError('');
    } catch (err) {
      setError(err.error || 'Could not load leave requests.');
    }
  }, [status]);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const decide = async (id, decision, note) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await apiJson('/api/admin/hrm/leave', { method: 'POST', body: JSON.stringify({ id, decision, note }) });
      setNotice(result.message);
      setDeciding(null);
      await load();
    } catch (err) {
      setError(err.error || 'Could not save this decision.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminLayout>
      <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">Leave & clock-ins</h1>
            <p className="mt-1 text-sm text-gray-500">Approve staff leave and see who is on duty. A manager’s own leave is decided by the owner.</p>
          </div>
          <button type="button" onClick={load} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"><RefreshCw className="h-4 w-4" /> Refresh</button>
        </header>
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="font-bold text-gray-950">On duty now ({data?.clockedIn?.length ?? 0})</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {data?.clockedIn?.map((c) => (
              <span key={c.user_id} className="rounded-full bg-emerald-50 px-3 py-1 text-sm text-emerald-800">{c.full_name} · {ROLE_LABELS[c.role] || c.role} · since {time(c.clock_in_at)}</span>
            ))}
            {data && !data.clockedIn.length && <p className="text-sm text-gray-500">Nobody is clocked in.</p>}
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 p-5">
            <h2 className="font-bold text-gray-950">Leave requests</h2>
            <div role="group" aria-label="Filter" className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1">
              {['pending', 'all'].map((s) => (
                <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)} className={`rounded-lg px-4 py-1.5 text-sm font-semibold ${status === s ? 'bg-white text-gray-950 shadow-sm' : 'text-gray-600'}`}>{s === 'pending' ? 'Pending' : 'All'}</button>
              ))}
            </div>
          </div>
          <div className="divide-y divide-gray-100">
            {data?.requests?.map((r) => (
              <div key={r.id} className="flex flex-col gap-3 p-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-950">{r.full_name} <span className="font-normal text-gray-500">· {ROLE_LABELS[r.role] || r.role}</span></p>
                  <p className="text-sm text-gray-700">{r.leave_type} leave · {r.start_date}{r.end_date !== r.start_date ? ` → ${r.end_date}` : ''} · {r.days} day{r.days > 1 ? 's' : ''}</p>
                  <p className="text-sm text-gray-500">{r.reason}</p>
                  {r.status === 'pending' && r.overlapping > 0 && (
                    <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-amber-700"><AlertTriangle className="h-4 w-4" /> Coverage: {r.overlapping} other {ROLE_LABELS[r.role] || r.role} staff already off or requesting these days ({r.roleHeadcount} in total).</p>
                  )}
                  {r.status !== 'pending' && <p className="mt-1 text-xs text-gray-500">{r.decided_by_name ? `Decided by ${r.decided_by_name}` : ''}{r.decision_note ? ` · ${r.decision_note}` : ''}</p>}
                </div>
                {r.canDecide ? (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <button type="button" disabled={busy} onClick={() => { setError(''); setDeciding({ request: r, decision: 'approved' }); }} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"><Check className="h-4 w-4" /> Approve</button>
                    <button type="button" disabled={busy} onClick={() => { setError(''); setDeciding({ request: r, decision: 'rejected' }); }} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"><X className="h-4 w-4" /> Reject</button>
                  </div>
                ) : (
                  <span className={`self-start rounded-full px-2.5 py-1 text-xs font-semibold ${TONE[r.status] || ''}`}>{r.status === 'pending' ? 'Owner decides' : r.status}</span>
                )}
              </div>
            ))}
            {data && !data.requests.length && <p className="p-10 text-center text-sm text-gray-500">No {status === 'pending' ? 'pending ' : ''}leave requests.</p>}
          </div>
        </section>
        <Dialog open={Boolean(deciding)} onOpenChange={(open) => { if (!open) setDeciding(null); }}><DialogContent onClose={() => setDeciding(null)} className="sm:max-w-lg">
          {deciding && <>
            <DialogHeader><DialogTitle>{deciding.decision === 'approved' ? 'Approve' : 'Reject'} {deciding.request.full_name}’s leave?</DialogTitle><DialogDescription>{deciding.request.leave_type} leave · {deciding.request.start_date}{deciding.request.end_date !== deciding.request.start_date ? ` → ${deciding.request.end_date}` : ''} · {deciding.request.days} day{deciding.request.days > 1 ? 's' : ''}</DialogDescription></DialogHeader>
            <form className="mt-6 space-y-4" onSubmit={(e) => { e.preventDefault(); void decide(deciding.request.id, deciding.decision, new FormData(e.currentTarget).get('note')); }}>
              {deciding.request.reason && <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">{deciding.request.reason}</p>}
              {deciding.decision === 'approved' && deciding.request.overlapping > 0 && <p className="flex items-center gap-1.5 text-sm font-medium text-amber-700"><AlertTriangle className="h-4 w-4" /> {deciding.request.overlapping} other {ROLE_LABELS[deciding.request.role] || deciding.request.role} staff already off or requesting these days.</p>}
              <label className="block text-sm font-medium text-gray-700">Note to {deciding.request.full_name} {deciding.decision === 'rejected' ? '*' : '(optional)'}<textarea name="note" rows={2} maxLength={500} required={deciding.decision === 'rejected'} autoFocus placeholder={deciding.decision === 'rejected' ? 'e.g. Short-staffed that weekend' : ''} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></label>
              {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setDeciding(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700">Cancel</button>
                <button disabled={busy} className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${deciding.decision === 'approved' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'}`}>{busy ? 'Saving…' : deciding.decision === 'approved' ? 'Approve leave' : 'Reject leave'}</button>
              </div>
            </form>
          </>}
        </DialogContent></Dialog>
      </div>
    </AdminLayout>
  );
}
