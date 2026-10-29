'use client';

import { useCallback, useEffect, useState } from 'react';
import { LogOut, Plus, RefreshCw, Siren } from 'lucide-react';
import AdminLayout from '@/components/admin/admin-layout';
import { apiJson } from '@/lib/authed-fetch';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useCapabilities } from '@/lib/use-capabilities';
import { nepalDateString } from '@/lib/report-dates';

const KINDS = [['visitor', 'Visitor'], ['vendor', 'Vendor / delivery'], ['vehicle', 'Guest vehicle'], ['patrol', 'Patrol round'], ['incident', 'Incident']];
const time = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kathmandu' }) : '—');
const input = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm';

export default function SecurityDeskPage() {
  const { role } = useCapabilities();
  const [date, setDate] = useState(nepalDateString(new Date()));
  const [kind, setKind] = useState('visitor');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(null); // 'entry' | 'emergency'
  const [cameras, setCameras] = useState([]);
  useEffect(() => { apiJson('/api/cctv').then((d) => setCameras(d.cameras || [])).catch(() => setCameras([])); }, []);

  const load = useCallback(async () => {
    try { setData(await apiJson(`/api/security?date=${date}`)); setError(''); }
    catch (err) { setError(err.error || 'Could not load the security log.'); }
  }, [date]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const send = async (body, after) => {
    setBusy(true); setError(''); setNotice('');
    try { setNotice((await apiJson('/api/security', { method: 'POST', body: JSON.stringify(body) })).message); after?.(); await load(); }
    catch (err) { setError(err.error || 'Could not save this entry.'); }
    finally { setBusy(false); }
  };

  return (
    <AdminLayout>
      <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">Security desk</h1>
            <p className="mt-1 text-sm text-gray-500">Gate entries, guest vehicles, patrol rounds and incidents.</p>
          </div>
          <div className="flex gap-2"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Log date" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" /><button type="button" onClick={load} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"><RefreshCw className="h-4 w-4" /> Refresh</button>
            <button type="button" onClick={() => { setError(''); setModal('entry'); }} className="inline-flex items-center gap-2 rounded-lg bg-gray-950 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800"><Plus className="h-4 w-4" /> New entry</button>
            {['watchman', 'manager'].includes(role) && <button type="button" onClick={() => { setError(''); setModal('emergency'); }} className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700"><Siren className="h-4 w-4" /> Emergency</button>}</div>
        </header>
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}

        <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <h2 className="border-b border-gray-200 px-5 py-4 font-bold text-gray-950">Inside now ({data?.inside.length ?? 0})</h2>
          <div className="divide-y divide-gray-100">{data?.inside.map((e) => <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
            <span><strong>{e.name}</strong> · {e.kind}{e.vehicle_no ? ` · ${e.vehicle_no}` : ''}{e.purpose ? ` · ${e.purpose}` : ''}<span className="text-gray-500"> · in {time(e.in_at)}</span></span>
            <button type="button" disabled={busy} onClick={() => send({ action: 'checkout', id: e.id })} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 font-semibold text-gray-700 hover:bg-gray-50"><LogOut className="h-4 w-4" /> Check out</button>
          </div>)}{data && !data.inside.length && <p className="p-6 text-center text-sm text-gray-500">Nobody checked in at the gate.</p>}</div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <h2 className="border-b border-gray-200 px-5 py-4 font-bold text-gray-950">Log for {data?.date || date}</h2>
          <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500"><tr>{['In', 'Out', 'Type', 'Name', 'Details', 'By'].map((h) => <th key={h} className="px-4 py-3">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-100">{data?.entries.map((e) => <tr key={e.id} className={e.kind === 'incident' ? 'bg-red-50/50' : ''}>
              <td className="px-4 py-2.5">{time(e.in_at)}</td><td className="px-4 py-2.5">{e.kind === 'patrol' || e.kind === 'incident' ? '' : time(e.out_at)}</td>
              <td className="px-4 py-2.5 capitalize">{e.kind}</td><td className="px-4 py-2.5 font-medium">{e.name}</td>
              <td className="px-4 py-2.5 text-gray-600">{[e.vehicle_no, e.purpose, e.reference, e.notes].filter(Boolean).join(' · ')}</td><td className="px-4 py-2.5 text-gray-500">{e.logged_by_name}</td>
            </tr>)}</tbody>
          </table>{data && !data.entries.length && <p className="p-6 text-center text-sm text-gray-500">No entries.</p>}</div>
        </section>
        <Dialog open={modal === 'entry'} onOpenChange={(open) => { if (!open) setModal(null); }}><DialogContent onClose={() => setModal(null)} className="sm:max-w-lg">
          <DialogHeader><DialogTitle>New gate entry</DialogTitle><DialogDescription>Visitors, vendors and vehicles stay under Inside now until checked out.</DialogDescription></DialogHeader>
          <form className="mt-6 space-y-3" onSubmit={(e) => { e.preventDefault(); send({ action: 'log', kind, ...Object.fromEntries(new FormData(e.currentTarget)) }, () => setModal(null)); }}>
            <div role="group" aria-label="Entry type" className="flex flex-wrap gap-1">{KINDS.map(([id, label]) => <button key={id} type="button" aria-pressed={kind === id} onClick={() => setKind(id)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${kind === id ? 'bg-gray-950 text-white' : 'bg-gray-100 text-gray-700'}`}>{label}</button>)}</div>
            <label className="block text-sm font-medium text-gray-700">{kind === 'patrol' ? 'Checkpoint / route' : kind === 'incident' ? 'What happened (short)' : 'Name'}<input name="name" required maxLength={100} className={input} /></label>
            {['visitor', 'vendor'].includes(kind) && <label className="block text-sm font-medium text-gray-700">Purpose<input name="purpose" maxLength={200} placeholder={kind === 'vendor' ? 'e.g. Vegetable delivery' : 'e.g. Meeting guest'} className={input} /></label>}
            {['visitor', 'vendor', 'vehicle'].includes(kind) && <label className="block text-sm font-medium text-gray-700">Vehicle number{kind === 'vehicle' ? ' *' : ''}<input name="vehicleNo" required={kind === 'vehicle'} maxLength={30} className={input} /></label>}
            <label className="block text-sm font-medium text-gray-700">Room / reference<input name="reference" maxLength={60} placeholder="e.g. Room 204, Kitchen" className={input} /></label>
            <label className="block text-sm font-medium text-gray-700">Notes<textarea name="notes" rows={2} maxLength={1000} className={input} /></label>
            {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <button disabled={busy} className="w-full rounded-xl bg-gray-950 px-4 py-2.5 font-bold text-white hover:bg-gray-800 disabled:opacity-50">{['patrol', 'incident'].includes(kind) ? 'Log' : 'Check in'}</button>
          </form>
        </DialogContent></Dialog>
        <Dialog open={modal === 'emergency'} onOpenChange={(open) => { if (!open) setModal(null); }}><DialogContent onClose={() => setModal(null)} className="sm:max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2 text-red-700"><Siren className="h-6 w-6" /> Emergency alert to owner</DialogTitle><DialogDescription>The owner gets it immediately, with sound.</DialogDescription></DialogHeader>
          <form className="mt-6 space-y-3" onSubmit={(e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)); const cam = cameras.find((c) => c.id === f.camera); send({ action: 'emergency', ...f, link: cam ? `cctv:${cam.id}:${cam.name}`.slice(0, 80) : f.link }, () => setModal(null)); }}>
            <label className="block text-sm font-medium text-gray-700">Severity<select name="severity" defaultValue="critical" className={input}><option value="urgent">Urgent</option><option value="critical">Critical</option></select></label>
            <label className="block text-sm font-medium text-gray-700">Title<input name="title" required maxLength={120} placeholder="e.g. Fire alarm, intruder at rear gate" className={input} /></label>
            <label className="block text-sm font-medium text-gray-700">Details<textarea name="message" required rows={3} maxLength={2000} className={input} /></label>
            <label className="block text-sm font-medium text-gray-700">Location<input name="link" maxLength={80} className={input} /></label>
            {cameras.length > 0 && <label className="block text-sm font-medium text-gray-700">Camera<select name="camera" defaultValue="" className={input}><option value="">None</option>{cameras.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.zone}</option>)}</select></label>}
            {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <button disabled={busy} className="w-full rounded-xl bg-red-600 px-4 py-2.5 font-bold text-white hover:bg-red-700 disabled:opacity-50">Send emergency alert</button>
          </form>
        </DialogContent></Dialog>
      </div>
    </AdminLayout>
  );
}
