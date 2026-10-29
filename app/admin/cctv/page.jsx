'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Maximize2, RefreshCw, Settings, Upload, ZoomIn, ZoomOut } from 'lucide-react';
import AdminLayout from '@/components/admin/admin-layout';
import { apiJson } from '@/lib/authed-fetch';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useConfirm } from '@/components/ui/confirm';
import { useCapabilities } from '@/lib/use-capabilities';
import { isAdminLike } from '@/lib/roles';

const LAYOUTS = [[1, '1×1'], [2, '2×2'], [3, '3×3'], [4, '4×4']];
const GRID = { 1: 'grid-cols-1', 2: 'grid-cols-1 sm:grid-cols-2', 3: 'grid-cols-2 lg:grid-cols-3', 4: 'grid-cols-2 lg:grid-cols-4' };
const STATUS_DOT = { online: 'bg-emerald-500', offline: 'bg-red-500', unknown: 'bg-gray-400' };
const input = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm';

function PtzPad({ camera, onError }) {
  const [busy, setBusy] = useState(false);
  const move = async (direction) => {
    setBusy(true);
    try { await apiJson(`/api/cctv/${camera.id}/ptz`, { method: 'POST', body: JSON.stringify({ direction }) }); }
    catch (err) { onError(err.error || 'PTZ command failed.'); }
    finally { setBusy(false); }
  };
  const btn = 'flex h-8 w-8 items-center justify-center rounded-md bg-gray-900/80 text-white hover:bg-gray-900 disabled:opacity-40';
  return <div className="grid grid-cols-3 gap-1" role="group" aria-label={`PTZ ${camera.name}`}>
    <span /><button type="button" className={btn} disabled={busy} onClick={() => move('up')} aria-label="Tilt up"><ArrowUp className="h-4 w-4" /></button><button type="button" className={btn} disabled={busy} onClick={() => move('zoom_in')} aria-label="Zoom in"><ZoomIn className="h-4 w-4" /></button>
    <button type="button" className={btn} disabled={busy} onClick={() => move('left')} aria-label="Pan left"><ArrowLeft className="h-4 w-4" /></button><span /><button type="button" className={btn} disabled={busy} onClick={() => move('right')} aria-label="Pan right"><ArrowRight className="h-4 w-4" /></button>
    <span /><button type="button" className={btn} disabled={busy} onClick={() => move('down')} aria-label="Tilt down"><ArrowDown className="h-4 w-4" /></button><button type="button" className={btn} disabled={busy} onClick={() => move('zoom_out')} aria-label="Zoom out"><ZoomOut className="h-4 w-4" /></button>
  </div>;
}

function CameraSetup({ zones, onChanged }) {
  const [cameras, setCameras] = useState([]);
  const [editing, setEditing] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const { confirm } = useConfirm();
  const edit = (id) => { setMessage(''); setEditing(id); };
  const load = useCallback(async () => { try { setCameras((await apiJson('/api/cctv?setup=1')).cameras); } catch (err) { setMessage(err.error || 'Could not load camera settings.'); } }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  const send = async (body, after) => {
    setBusy(true); setMessage('');
    try { setMessage((await apiJson('/api/cctv', { method: 'POST', body: JSON.stringify(body) })).message); after?.(); await load(); onChanged(); }
    catch (err) { setMessage(err.error || 'Could not save.'); }
    finally { setBusy(false); }
  };
  const cam = editing === 'new' ? {} : cameras.find((c) => c.id === editing);
  return <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-bold text-gray-950">Camera setup</h2>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => send({ action: 'push' })} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"><Upload className="h-4 w-4" /> Push to MediaMTX</button>
        <button type="button" disabled={busy} onClick={() => send({ action: 'status' })} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"><RefreshCw className="h-4 w-4" /> Check status</button>
        <button type="button" onClick={() => edit('new')} className="rounded-lg bg-gray-950 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800">Add camera</button>
      </div>
    </div>
    {message && !cam && <p role="status" className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">{message}</p>}
    <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-3 py-2">Camera</th><th className="px-3 py-2">Area</th><th className="px-3 py-2">Source</th><th className="px-3 py-2">PTZ</th><th className="px-3 py-2" /></tr></thead>
      <tbody className="divide-y divide-gray-100">{cameras.map((c) => <tr key={c.id}><td className="px-3 py-2 font-medium">{c.name}<p className="text-xs text-gray-500">MediaMTX path: {c.streamPath}</p></td><td className="px-3 py-2">{c.zone}</td><td className="max-w-[260px] truncate px-3 py-2 text-gray-500">{c.sourceUrl}</td><td className="px-3 py-2">{c.ptzSupported ? 'ONVIF' : '—'}</td>
        <td className="px-3 py-2 text-right"><button type="button" className="text-sm font-semibold underline" onClick={() => edit(c.id)}>Edit</button> <button type="button" className="ml-2 text-sm font-semibold text-red-700 underline" disabled={busy} onClick={async () => { if (await confirm({ title: `Remove ${c.name}?`, message: 'It disappears from the camera grid and setup. This cannot be undone.', confirmLabel: 'Remove', tone: 'delete' })) await send({ action: 'delete', id: c.id }); }}>Remove</button></td></tr>)}</tbody></table>
      {!cameras.length && <p className="p-6 text-center text-sm text-gray-500">No cameras yet.</p>}</div>
    <Dialog open={Boolean(cam)} onOpenChange={(open) => { if (!open) setEditing(null); }}><DialogContent onClose={() => setEditing(null)}>
    <DialogHeader><DialogTitle>{cam?.id ? `Edit ${cam.name}` : 'Add camera'}</DialogTitle><DialogDescription>RTSP source for live view; ONVIF details only for PTZ cameras.</DialogDescription></DialogHeader>
    {cam && <form key={editing} className="mt-6 grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)); send({ action: 'save', id: cam.id, ...f, ptzSupported: f.ptzSupported === 'on' }, () => setEditing(null)); }}>
      <label className="text-sm font-medium text-gray-700">Name<input name="name" required maxLength={60} defaultValue={cam.name} className={input} /></label>
      <label className="text-sm font-medium text-gray-700">Area<select name="zone" defaultValue={cam.zone || 'Lobby'} className={input}>{zones.map((z) => <option key={z}>{z}</option>)}</select></label>
      <label className="text-sm font-medium text-gray-700 sm:col-span-2">Stream source (RTSP)<input name="sourceUrl" required={!cam.id} placeholder={cam.id ? 'Leave blank to keep the current source' : 'rtsp://user:pass@192.168.1.20:554/stream1'} className={input} /></label>
      <label className="flex items-center gap-2 text-sm font-medium text-gray-700"><input type="checkbox" name="ptzSupported" defaultChecked={cam.ptzSupported} /> PTZ camera (ONVIF)</label>
      <label className="text-sm font-medium text-gray-700">Display order<input name="sortOrder" type="number" defaultValue={cam.sortOrder ?? 0} className={input} /></label>
      <label className="text-sm font-medium text-gray-700 sm:col-span-2">ONVIF PTZ service URL<input name="onvifUrl" defaultValue={cam.onvifUrl} placeholder="http://192.168.1.20/onvif/ptz_service" className={input} /></label>
      <label className="text-sm font-medium text-gray-700">ONVIF user<input name="onvifUser" defaultValue={cam.onvifUser} autoComplete="off" className={input} /></label>
      <label className="text-sm font-medium text-gray-700">ONVIF password<input name="onvifPassword" type="password" autoComplete="new-password" placeholder={cam.hasOnvifPassword ? 'Saved; leave blank to keep' : ''} className={input} /></label>
      <label className="text-sm font-medium text-gray-700">ONVIF profile token<input name="onvifProfile" defaultValue={cam.onvifProfile || 'Profile_1'} className={input} /></label>
      {message && <p role="alert" className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700 sm:col-span-2">{message}</p>}
      <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold">Cancel</button><button disabled={busy} className="rounded-lg bg-gray-950 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50">{busy ? 'Saving…' : cam.id ? 'Save camera' : 'Add camera'}</button></div>
    </form>}
    </DialogContent></Dialog>
    <p className="text-xs text-gray-500">Source URLs and passwords are visible only here. Viewers get the MediaMTX stream page, so keep MediaMTX on your private network or VPN, or enable its read authentication.</p>
  </section>;
}

export default function CctvPage() { return <Suspense fallback={<p className="p-6">Loading cameras…</p>}><CctvRoute /></Suspense>; }

function CctvRoute() {
  const params = useSearchParams();
  const focusId = params.get('camera');
  const { role, can } = useCapabilities();
  const [data, setData] = useState(null);
  const [layout, setLayout] = useState(focusId ? 1 : 2);
  const [zone, setZone] = useState('All');
  const [selected, setSelected] = useState(focusId);
  const [error, setError] = useState('');
  const [showSetup, setShowSetup] = useState(false);
  const tiles = useRef({});

  const load = useCallback(async () => {
    try { setData(await apiJson('/api/cctv')); setError(''); }
    catch (err) { setError(err.error || 'Could not load cameras.'); }
  }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const cams = (data?.cameras || []).filter((c) => zone === 'All' || c.zone === zone);
  const ordered = selected ? [...cams.filter((c) => c.id === selected), ...cams.filter((c) => c.id !== selected)] : cams;
  const shown = ordered.slice(0, layout * layout);
  const zones = ['All', ...new Set((data?.cameras || []).map((c) => c.zone))];

  return (
    <AdminLayout>
      <div className="mx-auto max-w-[1600px] space-y-4 p-4 sm:p-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div><h1 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">CCTV</h1><p className="mt-1 text-sm text-gray-500">{data ? `${data.cameras.length} camera(s) · ${data.cameras.filter((c) => c.status === 'online').length} online` : 'Live cameras'}</p></div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={zone} onChange={(e) => setZone(e.target.value)} aria-label="Area" className="rounded-lg border border-gray-300 px-3 py-2 text-sm">{zones.map((z) => <option key={z}>{z}</option>)}</select>
            <div role="group" aria-label="Grid layout" className="grid grid-cols-4 gap-1 rounded-xl bg-gray-100 p-1">{LAYOUTS.map(([n, label]) => <button key={n} type="button" aria-pressed={layout === n} onClick={() => setLayout(n)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${layout === n ? 'bg-white text-gray-950 shadow-sm' : 'text-gray-600'}`}>{label}</button>)}</div>
            {isAdminLike(role) && <button type="button" onClick={() => setShowSetup(!showSetup)} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"><Settings className="h-4 w-4" /> Setup</button>}
          </div>
        </header>
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {data && !data.streamConfigured && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Live video needs MediaMTX. Set <code>CCTV_STREAM_BASE_URL</code> (MediaMTX WebRTC address, e.g. https://cctv.example.com) and <code>MEDIAMTX_API_URL</code>, restart the app, then use Setup → Push to MediaMTX.</div>}
        {showSetup && isAdminLike(role) && <CameraSetup zones={data?.zones || []} onChanged={load} />}

        <div className={`grid gap-2 ${GRID[layout]}`}>
          {shown.map((cam) => (
            <figure key={cam.id} ref={(el) => { tiles.current[cam.id] = el; }} className={`relative overflow-hidden rounded-xl bg-black ${selected === cam.id ? 'ring-2 ring-emerald-500' : ''}`}>
              <div className="aspect-video w-full">
                {cam.streamUrl ? <iframe src={cam.streamUrl} title={`Camera ${cam.name}`} className="h-full w-full border-0" allow="autoplay; fullscreen" loading="lazy" />
                  : <div className="flex h-full items-center justify-center text-sm text-gray-400">Stream not configured</div>}
              </div>
              <figcaption className="pointer-events-none absolute left-0 right-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-3 py-2 text-xs font-semibold text-white">
                <span className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${STATUS_DOT[cam.status]}`} />{cam.name} · {cam.zone}</span>
              </figcaption>
              {/* Clicks inside the video frame never reach the page, so selection is an explicit button. */}
              <div className="absolute right-2 top-2 flex gap-1">
                {cam.ptz && can('cctv.ptz_control') && <button type="button" aria-pressed={selected === cam.id} onClick={() => setSelected(selected === cam.id ? null : cam.id)} className={`rounded-lg px-2 py-1 text-xs font-bold text-white ${selected === cam.id ? 'bg-emerald-600' : 'bg-black/50 hover:bg-black/70'}`}>PTZ</button>}
                <button type="button" aria-label={`Fullscreen ${cam.name}`} onClick={() => tiles.current[cam.id]?.requestFullscreen?.()} className="rounded-lg bg-black/50 p-1.5 text-white hover:bg-black/70"><Maximize2 className="h-4 w-4" /></button>
              </div>
              {cam.ptz && can('cctv.ptz_control') && selected === cam.id && <div className="absolute bottom-2 right-2"><PtzPad camera={cam} onError={setError} /></div>}
            </figure>
          ))}
        </div>
        {data && !cams.length && <p className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">No cameras{zone !== 'All' ? ` in ${zone}` : ''}.{isAdminLike(role) ? ' Add one under Setup.' : ''}</p>}
        {cams.length > shown.length && <p className="text-xs text-gray-500">Showing {shown.length} of {cams.length}. Choose a larger grid or an area to see the rest.</p>}
      </div>
    </AdminLayout>
  );
}
