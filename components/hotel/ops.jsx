'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, Download, Moon, Printer, RefreshCw, Shirt, Soup } from 'lucide-react';
import { apiJson, authedRequest } from '@/lib/authed-fetch';
import { money, shortDate } from '@/lib/hotel/view';
import { printHtml } from '@/lib/hotel/statement';
import { Badge, Modal, useHotel } from './workspace';
import s from './hotel.module.css';

function Panel({ title, count, action, children }) {
  return <section className={s.panel}><div className={s.panelHeader}><h2 className={s.panelTitle}>{title}{count !== undefined && <span className={s.count}>{count}</span>}</h2>{action}</div>{children}</section>;
}
const Empty = ({ children }) => <p className={s.empty}>{children}</p>;

const LAUNDRY_NEXT = { collected: ['washing', 'ready', 'cancelled'], washing: ['ironing', 'ready'], ironing: ['ready'], ready: ['delivered'], delivered: [], cancelled: [] };
const LAUNDRY_TONE = { collected: 'amber', washing: 'blue', ironing: 'violet', ready: 'green', delivered: 'gray', cancelled: 'rose' };

export function Laundry() {
  const { state, act, busy } = useHotel();
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const occupied = state.bookings.filter((b) => b.status === 'in_house');
  const orders = state.laundry || [];
  const run = async (action) => { setError(''); const r = await act(action); if (!r.ok) setError(r.error); };
  return <>
    <div className={s.toolbar}><span className={s.small}><Shirt size={14} className="inline mr-2" />Collected → Washing → Ironing → Ready → Delivered. The folio is charged once, on delivery.</span><button className={s.primary} onClick={() => setAdding(true)} disabled={!occupied.length}>New laundry order</button></div>
    {error && <p className={s.error} role="alert">{error}</p>}
    <Panel title="Laundry orders" count={orders.length}>
      {!orders.length ? <Empty>No laundry in progress.</Empty> : <div className={s.tableScroll}><table className={s.table}><thead><tr><th>Order</th><th>Room / guest</th><th>Items</th><th>Price</th><th>Status</th><th>Next</th></tr></thead><tbody>{orders.map((o) => <tr key={o.id}>
        <td><strong>{o.id}</strong><p className={s.small}>{String(o.createdAt).slice(0, 16)}{o.express ? ' · express' : ''}</p></td>
        <td>{o.roomId}<p className={s.small}>{o.guest}</p></td>
        <td>{o.items}<p className={s.small}>{o.pieces} piece(s)</p></td>
        <td>{money(o.amount)}{o.folioEntryId && <p className={s.small}>Folio #{o.folioEntryId}</p>}</td>
        <td><Badge tone={LAUNDRY_TONE[o.status]}>{o.status}</Badge></td>
        <td><div className={s.actions}>{LAUNDRY_NEXT[o.status].map((next) => <button key={next} className={next === 'delivered' ? s.primary : s.secondary} disabled={busy} onClick={() => run({ type: 'laundry_update', id: o.id, status: next })}>{next === 'delivered' ? 'Deliver & charge' : next[0].toUpperCase() + next.slice(1)}</button>)}</div></td>
      </tr>)}</tbody></table></div>}
    </Panel>
    {adding && <Modal title="New laundry order" onClose={() => setAdding(false)}><form className={s.form} onSubmit={async (event) => { event.preventDefault(); const r = await act({ type: 'laundry', ...Object.fromEntries(new FormData(event.currentTarget)) }); if (r.ok) setAdding(false); else setError(r.error); }}>
      <label>Room<select name="roomId" required defaultValue="">{[<option key="" value="" disabled>Choose an occupied room</option>, ...occupied.map((b) => <option key={b.id} value={b.roomId}>{b.roomId} · {b.guest}</option>)]}</select></label>
      <label>Items<input name="items" required maxLength={300} placeholder="e.g. 2 shirts, 1 dress (dry clean)" /></label>
      <div className={s.formRow}><label>Pieces<input name="pieces" type="number" min="1" max="500" defaultValue="1" required /></label><label>Price before tax (NPR)<input name="amount" type="number" min="0" step="0.01" required /></label></div>
      <label className={s.checkLabel}><input type="checkbox" name="express" />Express</label>
      <label>Notes<input name="notes" maxLength={300} /></label>
      <div className={s.actions}><button type="button" className={s.secondary} onClick={() => setAdding(false)}>Cancel</button><button className={s.primary} disabled={busy}>Record</button></div>
    </form></Modal>}
  </>;
}

const RS_NEXT = { ordered: ['preparing', 'ready', 'cancelled'], preparing: ['ready'], ready: ['out_for_delivery'], out_for_delivery: ['delivered'], delivered: ['tray_cleared'], tray_cleared: [], cancelled: [] };
const RS_LABEL = { ordered: 'Ordered', preparing: 'Preparing', ready: 'Ready', out_for_delivery: 'Out for delivery', delivered: 'Delivered', tray_cleared: 'Tray cleared', cancelled: 'Cancelled' };

/** Room-service delivery board: orders come from the restaurant POS / QR (same kitchen, KOT and bill). */
export function RoomService() {
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setOrders((await apiJson('/api/hotel/links?roomService=1')).orders); } catch (e) { setError(e.message); } }, []);
  useEffect(() => { void Promise.resolve().then(load); const t = setInterval(load, 20000); return () => clearInterval(t); }, [load]);
  const move = async (orderId, status) => {
    setBusy(true); setError('');
    try {
      const res = await authedRequest('/api/hotel/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'room_service', orderId, status }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error); await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <>
    <div className={s.toolbar}><span className={s.small}><Soup size={14} className="inline mr-2" />Room service uses the restaurant menu, KOT and kitchen. Take the order in the POS on the room’s room-service table (or guest QR); settle with Charge to Room.</span><div className={s.actions}><Link className={s.secondary} href="/admin/pos">Open POS</Link><button className={s.secondary} onClick={load}><RefreshCw size={14} />Refresh</button></div></div>
    {error && <p className={s.error} role="alert">{error}</p>}
    <Panel title="Room-service orders (last 24 h and open)" count={orders?.length}>
      {!orders ? <Empty>Loading…</Empty> : !orders.length ? <Empty>No room-service orders.</Empty> : <div className={s.tableScroll}><table className={s.table}><thead><tr><th>Order</th><th>Room / guest</th><th>Kitchen</th><th>Delivery</th><th>Next</th></tr></thead><tbody>{orders.map((o) => <tr key={o.id}>
        <td><strong>{o.number}</strong><p className={s.small}>{String(o.createdAt).slice(0, 16)}{o.requestedTime ? ` · for ${o.requestedTime}` : ''}</p>{o.notes && <p className={s.small}>{o.notes}</p>}</td>
        <td>{o.room ? `Room ${o.room}` : '—'}<p className={s.small}>{o.guest || 'No in-house link'}</p></td>
        <td><Badge tone="gray">{o.orderStatus}</Badge></td>
        <td><Badge tone={o.status === 'delivered' || o.status === 'tray_cleared' ? 'green' : 'amber'}>{RS_LABEL[o.status]}</Badge>{o.deliveredBy && <p className={s.small}>{o.deliveredBy} · {String(o.deliveredAt).slice(11, 16)}</p>}</td>
        <td><div className={s.actions}>{RS_NEXT[o.status].map((next) => <button key={next} className={s.secondary} disabled={busy} onClick={() => move(o.id, next)}>{RS_LABEL[next]}</button>)}</div></td>
      </tr>)}</tbody></table></div>}
    </Panel>
  </>;
}

export function NightAudit() {
  const { state, act, busy, can, confirm } = useHotel();
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const today = state.audits?.find((a) => a.date === state.businessDate);
  const inHouse = state.bookings.filter((b) => b.status === 'in_house');
  const pendingArrivals = state.bookings.filter((b) => b.status === 'confirmed' && b.start <= state.businessDate && b.bookingType !== 'waitlist');
  const dueOuts = inHouse.filter((b) => b.end <= state.businessDate);
  const unposted = inHouse.filter((b) => b.unpostedNights.length);
  const run = async (force) => {
    if (!(await confirm({ title: `${force ? 'Re-run' : 'Run'} night audit for ${shortDate(state.businessDate)}?`, message: 'Posts every due room night (never twice), defers meal-plan allowances, handles no-shows and records occupancy, ADR and RevPAR.', confirmLabel: force ? 'Re-run audit' : 'Run night audit' }))) return;
    setError(''); const r = await act({ type: 'night_audit', force, reason }); if (!r.ok) setError(r.error);
  };
  return <>
    <div className={s.split}>
      <Panel title={`Pre-audit checklist · ${shortDate(state.businessDate)}`}>
        <div className={s.panelBody}><ul className={s.activity}>
          <li><CheckCircle2 size={13} /><span>{pendingArrivals.length} arrival(s) not checked in{pendingArrivals.length ? `: ${pendingArrivals.map((b) => `${b.roomId} ${b.guest}`).join(', ')}` : ''}</span></li>
          <li><CheckCircle2 size={13} /><span>{dueOuts.length} due-out(s) still in house{dueOuts.length ? `: ${dueOuts.map((b) => `${b.roomId} ${b.guest}`).join(', ')}` : ''}</span></li>
          <li><CheckCircle2 size={13} /><span>{unposted.length} stay(s) with room nights to post (the audit posts them)</span></li>
          <li><CheckCircle2 size={13} /><span>Guaranteed no-shows are listed for a fee; others with an empty folio become no-shows.</span></li>
          <li><CheckCircle2 size={13} /><span>Open restaurant orders, unverified payments and OTA conflicts are recorded in the audit summary.</span></li>
        </ul>
        {error && <p className={s.error} role="alert">{error}</p>}
        {can('hotel.folios') && <div className={`${s.actions} mt-4`}>
          {!today ? <button className={s.primary} disabled={busy} onClick={() => run(false)}><Moon size={14} />Run night audit</button>
            : <><input className={s.search} placeholder="Reason for re-run" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /><button className={s.secondary} disabled={busy || !reason} onClick={() => run(true)}>Re-run (no duplicate charges)</button></>}
          <Link className={s.textButton} href="/admin/business-days">Opening & Closing<ArrowRight size={13} /></Link>
        </div>}</div>
      </Panel>
      <Panel title="Recent audits" count={state.audits?.length || 0}>
        {!state.audits?.length ? <Empty>No audits yet.</Empty> : <div className={s.tableScroll}><table className={s.table}><thead><tr><th>Date</th><th>Occ.</th><th>ADR</th><th>RevPAR</th><th>Posted</th><th>Review</th></tr></thead><tbody>{state.audits.map((a) => <tr key={a.date}><td>{shortDate(a.date)}{a.rerun ? <span className={s.small}> · re-run</span> : ''}</td><td>{a.occupancyPercent}%</td><td>{money(a.adr || 0)}</td><td>{money(a.revpar || 0)}</td><td>{a.roomNightsPosted}</td><td className={s.small}>{[...(a.noShows || []).map((n) => `No-show ${n}`), ...(a.needsReview || [])].join('; ') || '—'}{a.checklist ? ` · ${a.checklist.openRestaurantOrders} open orders, ${a.checklist.unverifiedPayments} unverified payments, ${a.checklist.otaConflicts} OTA conflicts` : ''}</td></tr>)}</tbody></table></div>}
      </Panel>
    </div>
  </>;
}

const presetRange = (date, key) => {
  const d = (n) => new Date(Date.parse(date) + n * 86400000).toISOString().slice(0, 10);
  if (key === 'yesterday') return [d(-1), d(-1)];
  if (key === 'week') return [d(-6), date];
  if (key === 'month') return [`${date.slice(0, 8)}01`, date];
  if (key === 'next7') return [date, d(6)];
  return [date, date];
};

export function HotelReports() {
  const { state } = useHotel();
  const [list, setList] = useState([]);
  const [id, setId] = useState('arrivals');
  const [[from, to], setRange] = useState([state.businessDate, state.businessDate]);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => { apiJson('/api/hotel/reports').then((d) => setList(d.reports)).catch((e) => setError(e.message)); }, []);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setReport(await apiJson(`/api/hotel/reports?id=${id}&from=${from}&to=${to}`)); } catch (e) { setError(e.message); setReport(null); } finally { setLoading(false); }
  }, [id, from, to]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  const csv = async () => {
    const res = await authedRequest(`/api/hotel/reports?id=${id}&from=${from}&to=${to}&format=csv`);
    if (!res.ok) { setError('Export failed.'); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a'); a.href = url; a.download = `hotel-${id}-${from}-to-${to}.csv`; a.click(); URL.revokeObjectURL(url);
  };
  const fmt = (c, v) => (c.type === 'money' ? money(Number(v) || 0) : v ?? '');
  const groups = [...new Set(list.map((r) => r.group))];
  const print = () => {
    if (!report) return;
    const head = report.columns.map((c) => `<th>${c.label}</th>`).join('');
    const body = report.rows.map((r) => `<tr>${report.columns.map((c) => `<td>${String(fmt(c, r[c.key])).replace(/</g, '&lt;')}</td>`).join('')}</tr>`).join('');
    printHtml(`<!doctype html><html><head><meta charset="utf-8"><title>${report.title}</title><style>body{font:12px Arial;margin:24px}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #ddd;padding:5px;text-align:left}</style></head><body><h2>${state.property.name} · ${report.title}</h2><p>${report.from} to ${report.to}</p><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`);
  };
  return <>
    <div className={s.toolbar}><div className={s.actions}>
      <label className={s.small}>Report<select value={id} onChange={(e) => setId(e.target.value)}>{groups.map((g) => <optgroup key={g} label={g}>{list.filter((r) => r.group === g).map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}</optgroup>)}</select></label>
      <div className={s.filters}>{[['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'Last 7 days'], ['month', 'This month'], ['next7', 'Next 7 days']].map(([k, label]) => <button key={k} className={s.filter} onClick={() => setRange(presetRange(state.businessDate, k))}>{label}</button>)}</div>
      <label className={s.small}>From<input type="date" value={from} onChange={(e) => setRange([e.target.value, to])} /></label>
      <label className={s.small}>To<input type="date" value={to} onChange={(e) => setRange([from, e.target.value])} /></label>
    </div><div className={s.actions}><button className={s.secondary} onClick={csv}><Download size={14} />CSV</button><button className={s.secondary} onClick={print}><Printer size={14} />Print / PDF</button></div></div>
    {error && <p className={s.error} role="alert">{error}</p>}
    <Panel title={report?.title || 'Report'} count={report?.rows.length} action={loading && <span className={s.small}>Loading…</span>}>
      {report?.summary && <div className={`${s.facts} m-4`}>{Object.entries(report.summary).map(([k, v]) => <div key={k}><span>{k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}</span><strong>{typeof v === 'number' && /revenue|adr|revpar|balance|total|amount|ledger|receivable|liability|overage|room/i.test(k) ? money(v) : String(v)}</strong></div>)}</div>}
      {report && (!report.rows.length ? <Empty>No records for this range.</Empty> : <div className={s.tableScroll}><table className={`${s.table} ${s.reportTable}`}><thead><tr>{report.columns.map((c) => <th key={c.key} className={c.type === 'money' || c.type === 'number' ? s.right : ''}>{c.label}</th>)}</tr></thead><tbody>{report.rows.map((r, i) => <tr key={i}>{report.columns.map((c) => <td key={c.key} className={c.type === 'money' || c.type === 'number' ? s.right : ''}>{fmt(c, r[c.key])}</td>)}</tr>)}</tbody></table></div>)}
      <p className={s.note}>Computed from stored folio, reservation, journal and bill records. Occupancy, ADR and RevPAR use room nights by service date; ledger revenue uses posting date. Restaurant revenue charged to rooms is counted once, in Food & beverage.</p>
    </Panel>
  </>;
}

/** Meal plans (rate plans with daily allowances) and the minibar catalog. */
export function MealPlans() {
  const { state, act, busy } = useHotel();
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const run = async (action) => { setError(''); const r = await act(action); if (!r.ok) setError(r.error); return r; };
  return <>
    {error && <p className={s.error} role="alert">{error}</p>}
    <div className={s.split}>
      <Panel title="Rate plans & meal packages" count={state.plans.length} action={<button className={s.secondary} onClick={() => setEditing({ id: null, name: '', supplementCents: 0, components: [] })}>New plan</button>}>
        {!state.plans.length ? <Empty>No plans.</Empty> : <div className={s.tableScroll}><table className={s.table}><thead><tr><th>Plan</th><th>Per night</th><th>Daily allowance</th><th /></tr></thead><tbody>{state.plans.map((p) => <tr key={p.name}><td><strong>{p.name}</strong><p className={s.small}>{p.planCode || ''}</p></td><td>+{money((p.supplementCents || 0) / 100)}</td><td>{p.components?.length ? p.components.map((c) => `${c.label} ${money(c.adult)}/adult${c.child ? `, ${money(c.child)}/child` : ''} (${c.timing === 'night_of' ? 'evening' : 'morning after'}, ${c.start}–${c.end}, ${c.outlets.join(' + ').replace('_', ' ')})`).join('; ') : <span className={s.small}>Room only (no allowance)</span>}</td><td>{p.id && <button className={s.textButton} onClick={() => setEditing(p)}>Edit</button>}</td></tr>)}</tbody></table></div>}
        <p className={s.note}>Each posted night defers the plan’s allowance (components × adults/children) from room revenue to the package liability. Restaurant and room-service bills charged to the room use it first; any overage goes to the folio; unused allowance closes at checkout.</p>
      </Panel>
      <Panel title="Minibar catalog" count={(state.minibarItems || []).length}>
        <div className={s.tableScroll}><table className={s.table}><thead><tr><th>Item</th><th>Price</th><th>Inventory link</th><th>Stock</th></tr></thead><tbody>{(state.minibarItems || []).map((m) => <tr key={m.id}><td>{m.name}</td><td>{money(m.price)}</td><td>{m.inventoryName || <span className={s.small}>Not linked</span>}</td><td>{m.stock ?? '—'}</td></tr>)}</tbody></table></div>
        <form className={s.form} onSubmit={async (e) => { e.preventDefault(); const r = await run({ type: 'minibar_item', ...Object.fromEntries(new FormData(e.currentTarget)) }); if (r.ok) e.currentTarget?.reset?.(); }}>
          <div className={s.formRow}><label>Item<input name="name" required maxLength={60} /></label><label>Price before tax<input name="price" type="number" min="0" step="0.01" required /></label></div>
          <div className={s.formRow}><label>Inventory item id (optional)<input name="inventoryItemId" type="number" min="1" placeholder="From Inventory" /></label><label>Par level per room<input name="parLevel" type="number" min="0" max="50" defaultValue="2" /></label></div>
          <button className={s.primary} disabled={busy}>Save minibar item</button>
        </form>
      </Panel>
    </div>
    {editing && <PlanEditor plan={editing} onClose={() => setEditing(null)} onError={setError} />}
  </>;
}

function PlanEditor({ plan, onClose, onError }) {
  const { state, act, busy } = useHotel();
  const [rows, setRows] = useState(plan.components?.length ? plan.components : [{ label: 'Breakfast', adult: 0, child: 0, timing: 'after_night', start: '06:30', end: '10:30', outlets: ['restaurant', 'room_service'] }]);
  const [error, setError] = useState('');
  const set = (i, key, value) => setRows(rows.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
  return <Modal title={plan.id ? `Edit ${plan.name}` : 'New rate plan'} onClose={onClose} wide><form className={s.form} onSubmit={async (event) => {
    event.preventDefault();
    const f = Object.fromEntries(new FormData(event.currentTarget));
    let planId = plan.id;
    const saved = await act({ type: 'plan', name: f.name, supplement: f.supplement });
    if (!saved.ok) { setError(saved.error); return; }
    planId = planId || saved.data.id;
    const r = await act({ type: 'plan_package', planId, planCode: f.planCode, description: f.description, components: rows });
    if (r.ok) onClose(); else { setError(r.error); onError?.(r.error); }
  }}>
    <div className={s.formRow}><label>Name<input name="name" required maxLength={60} defaultValue={plan.name} readOnly={Boolean(plan.id)} /></label><label>Type<select name="planCode" defaultValue={plan.planCode || 'CUSTOM'}>{(state.planCodes || []).map((c) => <option key={c} value={c}>{c.replaceAll('_', ' ')}</option>)}</select></label></div>
    <div className={s.formRow}><label>Supplement per night (NPR)<input name="supplement" type="number" min="0" step="0.01" defaultValue={(plan.supplementCents || 0) / 100} /></label><label>Description<input name="description" maxLength={200} defaultValue={plan.description || ''} /></label></div>
    {rows.map((r, i) => <fieldset key={i} className={s.roomPicker}><legend>Component {i + 1}</legend>
      <div className={s.formRow}><label>Meal<input value={r.label} onChange={(e) => set(i, 'label', e.target.value)} required maxLength={40} /></label><label>Served<select value={r.timing} onChange={(e) => set(i, 'timing', e.target.value)}><option value="after_night">Morning after each night (breakfast)</option><option value="night_of">Each stay night (lunch/dinner)</option></select></label></div>
      <div className={s.formRow}><label>Allowance per adult (NPR)<input type="number" min="0" step="0.01" value={r.adult} onChange={(e) => set(i, 'adult', e.target.value)} /></label><label>Per child (NPR)<input type="number" min="0" step="0.01" value={r.child} onChange={(e) => set(i, 'child', e.target.value)} /></label></div>
      <div className={s.formRow}><label>From<input type="time" value={r.start} onChange={(e) => set(i, 'start', e.target.value)} /></label><label>To<input type="time" value={r.end} onChange={(e) => set(i, 'end', e.target.value)} /></label></div>
      <div className={s.actions}>{['restaurant', 'room_service'].map((o) => <label key={o} className={s.checkLabel}><input type="checkbox" checked={r.outlets.includes(o)} onChange={(e) => set(i, 'outlets', e.target.checked ? [...r.outlets, o] : r.outlets.filter((x) => x !== o))} />{o === 'restaurant' ? 'Restaurant' : 'Room service'}</label>)}<button type="button" className={s.textButton} onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button></div>
    </fieldset>)}
    <button type="button" className={s.secondary} onClick={() => setRows([...rows, { label: 'Dinner', adult: 0, child: 0, timing: 'night_of', start: '18:30', end: '22:30', outlets: ['restaurant'] }])}>Add component</button>
    {error && <p className={s.error} role="alert">{error}</p>}
    <div className={s.actions}><button type="button" className={s.secondary} onClick={onClose}>Cancel</button><button className={s.primary} disabled={busy}>Save plan</button></div>
  </form></Modal>;
}
