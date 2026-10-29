'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BellRing, Cctv, RefreshCw, Send } from 'lucide-react';
import AdminLayout from '@/components/admin/admin-layout';
import { apiJson } from '@/lib/authed-fetch';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useConfirm } from '@/components/ui/confirm';
import { useCapabilities } from '@/lib/use-capabilities';
import { formatNepalTime } from '@/lib/time-utils';

const SEVERITY = {
  low: 'bg-gray-100 text-gray-700', medium: 'bg-sky-50 text-sky-700',
  urgent: 'bg-amber-100 text-amber-800', critical: 'bg-red-600 text-white',
};
// An alert can point at a camera: link_label "cctv:<id>:<name>".
const cameraLink = (cam) => `cctv:${cam.id}:${cam.name}`.slice(0, 80);
const parseCamera = (label) => { const m = /^cctv:([^:]+):(.*)$/.exec(label || ''); return m ? { id: m[1], name: m[2] } : null; };
const CATEGORIES = ['VIP issue', 'Security', 'Equipment failure', 'Cash dispute', 'Guest complaint', 'Other'];

export default function OwnerAlertsPage() {
  const { role } = useCapabilities();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [composing, setComposing] = useState(false);
  const { confirm } = useConfirm();
  const [cameras, setCameras] = useState([]);
  useEffect(() => { apiJson('/api/cctv').then((d) => setCameras(d.cameras || [])).catch(() => setCameras([])); }, []);

  const load = useCallback(async () => {
    try {
      setData(await apiJson('/api/alerts'));
      setError('');
    } catch (err) {
      setError(err.error || 'Could not load alerts.');
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
    const timer = setInterval(load, 20_000);
    return () => clearInterval(timer);
  }, [load]);

  const send = async (method, body, after) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await apiJson('/api/alerts', { method, body: JSON.stringify(body) });
      setNotice(result.message);
      after?.();
      await load();
    } catch (err) {
      setError(err.error || 'Could not save this update.');
    } finally {
      setBusy(false);
    }
  };

  const isOwner = role === 'admin';
  return (
    <AdminLayout>
      <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 lg:p-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">{isOwner ? 'Owner alerts' : 'Alert the owner'}</h1>
            <p className="mt-1 text-sm text-gray-500">{isOwner ? 'Escalations from your manager. Urgent and critical alerts play a sound while this app is open.' : 'Send an incident straight to the owner. It appears in their alert inbox immediately.'}</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={load} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"><RefreshCw className="h-4 w-4" /> Refresh</button>
            {role === 'manager' && <button type="button" onClick={() => { setError(''); setComposing(true); }} className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700"><Send className="h-4 w-4" /> Alert owner</button>}
          </div>
        </header>
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}

        <Dialog open={composing} onOpenChange={setComposing}><DialogContent onClose={() => setComposing(false)}>
          <DialogHeader><DialogTitle>Alert the owner</DialogTitle><DialogDescription>Appears in the owner’s inbox immediately. Urgent and critical alerts play a sound.</DialogDescription></DialogHeader>
          <form
            className="mt-6 grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              const fields = Object.fromEntries(new FormData(e.currentTarget));
              const cam = cameras.find((c) => c.id === fields.camera);
              send('POST', { ...fields, link: cam ? cameraLink(cam) : fields.link }, () => setComposing(false));
            }}
          >
            <label className="text-sm font-medium text-gray-700">Severity
              <select name="severity" required defaultValue="urgent" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2">
                <option value="low">Low</option><option value="medium">Medium</option><option value="urgent">Urgent</option><option value="critical">Critical</option>
              </select>
            </label>
            <label className="text-sm font-medium text-gray-700">Category
              <select name="category" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2">{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
            </label>
            <label className="text-sm font-medium text-gray-700 sm:col-span-2">Title<input name="title" required maxLength={120} placeholder="e.g. Cash drawer short at closing" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
            <label className="text-sm font-medium text-gray-700 sm:col-span-2">What happened<textarea name="message" required maxLength={2000} rows={3} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
            <label className="text-sm font-medium text-gray-700">Related room or table (optional)<input name="link" maxLength={80} placeholder="e.g. Room 204, Table 7" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
            <label className="text-sm font-medium text-gray-700">Camera (optional)<select name="camera" defaultValue="" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"><option value="">None</option>{cameras.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.zone}</option>)}</select></label>
            {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">{error}</p>}
            <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 font-bold text-white hover:bg-red-700 disabled:opacity-50 sm:col-span-2"><Send className="h-4 w-4" /> Send to owner</button>
          </form>
        </DialogContent></Dialog>

        <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
          <h2 className="border-b border-gray-200 p-5 font-bold text-gray-950">{isOwner ? `Inbox · ${data?.open ?? 0} open` : 'Alerts you sent'}</h2>
          <div className="divide-y divide-gray-100">
            {data?.alerts?.map((a) => (
              <article key={a.id} className={`flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between ${a.status === 'open' && ['urgent', 'critical'].includes(a.severity) ? 'bg-red-50/40' : ''}`}>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase ${SEVERITY[a.severity]}`}>{a.severity}</span>
                    <span className="text-xs font-semibold text-gray-500">{a.category}</span>
                    <span className="text-xs text-gray-400">{formatNepalTime(a.created_at)}</span>
                  </p>
                  <h3 className="mt-1 font-bold text-gray-950">{a.title}</h3>
                  <p className="whitespace-pre-line text-sm text-gray-700">{a.message}</p>
                  <p className="mt-1 text-xs text-gray-500">From {a.created_by_name}{a.link_label && !parseCamera(a.link_label) ? ` · ${a.link_label}` : ''}{a.handled_by_name ? ` · ${a.status} by ${a.handled_by_name}` : ''}</p>
                  {parseCamera(a.link_label) && <Link href={`/admin/cctv?camera=${encodeURIComponent(parseCamera(a.link_label).id)}`} className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-gray-900 underline"><Cctv className="h-4 w-4" /> View camera {parseCamera(a.link_label).name}</Link>}
                </div>
                {isOwner && a.status !== 'resolved' ? (
                  <div className="flex shrink-0 gap-2">
                    {a.status === 'open' && <button type="button" disabled={busy} onClick={() => send('PATCH', { id: a.id, status: 'acknowledged' })} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">Acknowledge</button>}
                    <button type="button" disabled={busy} onClick={async () => { if (await confirm({ title: `Resolve “${a.title}”?`, message: 'It moves out of the open inbox. Resolved alerts cannot be reopened.', confirmLabel: 'Resolve', tone: 'default' })) await send('PATCH', { id: a.id, status: 'resolved' }); }} className="rounded-lg bg-gray-950 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50">Resolve</button>
                  </div>
                ) : (
                  <span className="self-start rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold capitalize text-gray-600">{a.status}</span>
                )}
              </article>
            ))}
            {data && !data.alerts.length && <p className="flex items-center justify-center gap-2 p-10 text-sm text-gray-500"><BellRing className="h-4 w-4" /> No alerts.</p>}
          </div>
        </section>
      </div>
    </AdminLayout>
  );
}
