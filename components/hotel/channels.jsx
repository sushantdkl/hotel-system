'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Copy, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { apiJson } from '@/lib/authed-fetch';
import { money } from '@/lib/hotel/view';
import { Badge, Modal, useHotel } from './workspace';
import s from './hotel.module.css';

const OUTCOME_TONE = { ok: 'green', conflict: 'amber', error: 'rose', ignored: 'gray' };

export default function Channels() {
  const { state, can, confirm } = useHotel();
  const [modal, setModal] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState('');
  const setup = can('hotel.setup');

  const load = useCallback(async () => {
    try { setData(await apiJson('/api/hotel/ota')); setError(''); }
    catch (err) { setError(err.error || 'Could not load channel sync.'); }
  }, []);
  useEffect(() => { void Promise.resolve().then(() => { setOrigin(window.location.origin); return load(); }); }, [load]);

  const send = async (body, after) => {
    setBusy(true); setError(''); setNotice('');
    try { setNotice((await apiJson('/api/hotel/ota', { method: 'POST', body: JSON.stringify(body) })).message); after?.(); await load(); }
    catch (err) { setError(err.error || 'Could not save this update.'); }
    finally { setBusy(false); }
  };
  const submit = (action, extra) => (e) => { e.preventDefault(); send({ action, ...extra, ...Object.fromEntries(new FormData(e.currentTarget)) }, () => setModal(null)); };
  const editing = modal?.channel;
  const ask = async (options, body) => { if (await confirm(options)) await send(body); };
  const copy = (text) => { void navigator.clipboard?.writeText(text); setNotice('Copied.'); };

  if (!data) return error ? <p role="alert" className={s.error}>{error}</p> : <p className={s.empty}>Loading channel sync…</p>;
  return <div className={s.stack}>
    {error && <p role="alert" className={s.error}>{error}</p>}
    {notice && <p role="status" className={s.formNote}>{notice}</p>}

    <section className={s.panel}>
      <div className={s.panelHeader}><h2 className={s.panelTitle}><AlertTriangle size={16} className="inline mr-2" />Needs a decision<span className={s.count}>{data.conflicts.length}</span></h2><button className={s.secondary} disabled={busy} onClick={() => send({ action: 'sync' })}><RefreshCw size={14} />Sync calendars now</button></div>
      {!data.conflicts.length ? <p className={s.empty}>No conflicts. Every channel booking has a room.</p> : <div className={s.tableScroll}><table className={s.table}><thead><tr><th>Channel / booking</th><th>Stay</th><th>Problem</th><th>Action</th></tr></thead><tbody>{data.conflicts.map((k) => <tr key={k.id}>
        <td><strong>{k.channel}</strong><p className={s.small}>{k.externalId}</p></td>
        <td>{k.event.guest || '—'}<p className={s.small}>{k.event.arrival ? `${k.event.arrival} → ${k.event.departure}` : k.event.event} {k.event.room ? `· room ${k.event.room}` : k.event.roomType ? `· ${k.event.roomType}` : ''}</p></td>
        <td>{k.reason}</td>
        <td><div className={s.actions}>
          <button className={s.primary} disabled={busy} onClick={() => send({ action: 'conflict', id: k.id, resolution: 'retry' })}>Retry</button>
          <button className={s.secondary} disabled={busy} onClick={() => ask({ title: 'Dismiss this conflict?', message: `${k.channel} booking ${k.externalId} will leave the queue without a room. Only dismiss after handling it with the guest or the channel.`, confirmLabel: 'Dismiss', danger: true }, { action: 'conflict', id: k.id, resolution: 'dismiss', note: 'Handled manually' })}>Dismiss</button></div></td>
      </tr>)}</tbody></table></div>}
      <p className={s.note}>Retry after freeing a room (move or cancel another stay) or adding the room. Dismiss once you have handled it with the guest or the channel. Nothing here was booked, so there is no double-booking.</p>
    </section>

    <section className={s.panel}>
      <div className={s.panelHeader}><h2 className={s.panelTitle}>Channels<span className={s.count}>{data.channels.length}</span></h2>{setup && <button className={s.secondary} disabled={busy} onClick={() => { setError(''); setModal('channel'); }}><Plus size={14} />Add channel</button>}</div>
      <div className={s.tableScroll}><table className={s.table}><thead><tr><th>Channel</th><th>Commission</th><th>Webhook (channel manager)</th><th>Status</th></tr></thead><tbody>{data.channels.map((c) => {
        const url = `${origin}/api/webhooks/ota/${c.id}`;
        return <tr key={c.id}><td><strong>{c.name}</strong>{setup && <p><button className={s.textButton} disabled={busy} onClick={() => { setError(''); setModal({ channel: c }); }}>Edit</button></p>}</td><td>{c.commissionPercent}%</td>
          <td>{setup ? <><button className={s.textButton} onClick={() => copy(url)}><Copy size={13} />{url}</button><p className={s.small}>Header <code>x-ota-token</code>: <button className={s.textButton} onClick={() => copy(c.token)}><Copy size={12} />copy token</button> · <button className={s.textButton} disabled={busy} onClick={() => ask({ title: `Replace ${c.name} token?`, message: 'The old token stops working at once. Paste the new one into the channel manager or its bookings will be rejected.', confirmLabel: 'Replace token', danger: true }, { action: 'rotate', id: c.id })}>Replace token</button></p></> : <span className={s.small}>Configured by hotel setup</span>}</td>
          <td><Badge tone={c.active ? 'green' : 'gray'}>{c.active ? 'Active' : 'Paused'}</Badge>{setup && <button className={`${s.textButton} ml-2`} disabled={busy} onClick={() => { const body = { action: 'channel', id: c.id, name: c.name, commissionPercent: c.commissionPercent, active: !c.active }; if (c.active) void ask({ title: `Pause ${c.name}?`, message: 'New bookings from this channel are not imported while paused.', confirmLabel: 'Pause channel', danger: true }, body); else void send(body); }}>{c.active ? 'Pause' : 'Resume'}</button>}</td></tr>;
      })}</tbody></table>{!data.channels.length && <p className={s.empty}>No channels yet.</p>}</div>
    </section>

    <section className={s.panel}>
      <div className={s.panelHeader}><h2 className={s.panelTitle}>Room calendars (iCal)<span className={s.count}>{data.feeds.length}</span></h2>{setup && data.channels.length > 0 && <button className={s.secondary} disabled={busy} onClick={() => { setError(''); setModal('feed'); }}><Plus size={14} />Link room calendar</button>}</div>
      <div className={s.tableScroll}><table className={s.table}><thead><tr><th>Channel / room</th><th>Import from channel</th><th>Export to channel</th><th>Last sync</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{data.feeds.map((f) => {
        const exportUrl = `${origin}/api/ical/${f.exportToken}.ics`;
        return <tr key={f.id}><td><strong>{f.channel}</strong><p className={s.small}>Room {f.room}</p></td>
          <td><span className={s.small}>{f.importUrl || 'Not set'}</span></td>
          <td><button className={s.textButton} onClick={() => copy(exportUrl)}><Copy size={13} />Copy export link</button></td>
          <td><span className={s.small}>{f.lastSyncAt ? String(f.lastSyncAt).slice(0, 16) : 'Never'}</span>{f.lastError && <p className={s.error}>{f.lastError}</p>}</td>
          <td>{setup && <button className={s.iconButton} aria-label={`Remove calendar for room ${f.room}`} disabled={busy} onClick={() => ask({ title: `Remove calendar for room ${f.room}?`, message: `Nights booked on ${f.channel} stop syncing for this room, and its export link stops working.`, confirmLabel: 'Remove', danger: true }, { action: 'feed_delete', id: f.id })}><Trash2 size={15} /></button>}</td></tr>;
      })}</tbody></table>{!data.feeds.length && <p className={s.empty}>No room calendars linked.</p>}</div>
    </section>

    <section className={s.panel}>
      <div className={s.panelHeader}><h2 className={s.panelTitle}>Channel bookings<span className={s.count}>{data.bookings.length}</span></h2></div>
      <div className={s.tableScroll}><table className={s.table}><thead><tr><th>Channel</th><th>Booking</th><th>Reservation</th><th>Status</th><th className={s.right}>Total</th><th className={s.right}>Commission</th><th>Payment</th></tr></thead><tbody>{data.bookings.map((b) => <tr key={`${b.channel}-${b.externalId}`}><td>{b.channel}</td><td><span className={s.small}>{b.externalId}</span></td><td>{b.reservationId || '—'}</td><td><Badge tone={b.status === 'cancelled' ? 'rose' : 'green'}>{b.status}</Badge></td><td className={s.right}>{b.total ? money(b.total) : '—'}</td><td className={s.right}>{b.commission ? money(b.commission) : '—'}</td><td>{b.prepaid ? <Badge tone="blue">Prepaid to channel</Badge> : <span className={s.small}>Pay at hotel</span>}</td></tr>)}</tbody></table>{!data.bookings.length && <p className={s.empty}>No channel bookings yet.</p>}</div>
    </section>

    <section className={s.panel}>
      <div className={s.panelHeader}><h2 className={s.panelTitle}>Sync log</h2></div>
      <div className={s.tableScroll}><table className={s.table}><thead><tr><th>When</th><th>Channel</th><th>Source</th><th>Result</th><th>Message</th></tr></thead><tbody>{data.log.map((l) => <tr key={l.id}><td><span className={s.small}>{String(l.created_at).slice(0, 16)}</span></td><td>{l.channel_name || '—'}</td><td>{l.source}</td><td><Badge tone={OUTCOME_TONE[l.outcome]}>{l.outcome}</Badge></td><td>{l.message}</td></tr>)}</tbody></table>{!data.log.length && <p className={s.empty}>No sync activity yet.</p>}</div>
    </section>

    {(modal === 'channel' || editing) && <Modal title={editing ? `Edit ${editing.name}` : 'Add channel'} onClose={() => setModal(null)}><form className={s.form} onSubmit={submit('channel', editing && { id: editing.id, active: editing.active })}>
      <div className={s.formRow}><label>Channel name<input name="name" required maxLength={60} defaultValue={editing?.name} placeholder="e.g. Booking.com, Airbnb, Agoda" /></label><label>Commission (%)<input name="commissionPercent" type="number" min="0" max="50" step="0.01" required defaultValue={editing?.commissionPercent ?? 15} /></label></div>
      {editing && <p className={s.formNote}>The new commission applies to bookings imported from now on.</p>}
      {error && <p role="alert" className={s.error}>{error}</p>}
      <div className={s.actions}><button type="button" className={s.secondary} disabled={busy} onClick={() => setModal(null)}>Cancel</button><button className={s.primary} disabled={busy}>{busy ? 'Saving…' : editing ? 'Save channel' : 'Add channel'}</button></div>
    </form></Modal>}
    {modal === 'feed' && <Modal title="Link room calendar" onClose={() => setModal(null)}><form className={s.form} onSubmit={submit('feed')}>
      <div className={s.formRow}><label>Channel<select name="channelId" required>{data.channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Room<select name="roomNumber" required>{state.rooms.map((r) => <option key={r.id} value={r.id}>{r.id} · {r.type}</option>)}</select></label></div>
      <label>iCal import URL from the channel (optional)<input name="importUrl" type="url" placeholder="https://www.airbnb.com/calendar/ical/....ics" /></label>
      <p className={s.small}>Paste the channel’s export link here, and give the channel this room’s <strong>export link</strong> so it blocks nights booked here. Calendars sync when you press Sync now (or from a scheduled job; see docs).</p>
      {error && <p role="alert" className={s.error}>{error}</p>}
      <div className={s.actions}><button type="button" className={s.secondary} disabled={busy} onClick={() => setModal(null)}>Cancel</button><button className={s.primary} disabled={busy}>{busy ? 'Saving…' : 'Save room calendar'}</button></div>
    </form></Modal>}
  </div>;
}
