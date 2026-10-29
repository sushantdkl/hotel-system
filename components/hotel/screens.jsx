'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowDownLeft, ArrowRight, ArrowUpRight, BedDouble, BellOff, CheckCircle2, ChevronLeft, ChevronRight, Clock3, GlassWater, Layers, Moon, Printer, Search, Shirt, Sparkles, Users, Wallet, Wrench } from 'lucide-react';
import { authedRequest } from '@/lib/authed-fetch';
import { activeStay, balance, BOOKING_TYPE_LABEL, HK_LABEL, money, occupancyState, ROOM_STATES, roomState, shortDate } from '@/lib/hotel/view';
import { printHtml, registrationCardHtml, reservationConfirmationHtml } from '@/lib/hotel/statement';
import { Badge, Modal, useHotel } from './workspace';
import s from './hotel.module.css';
import LiveFolios, { FolioForm, StayChangeForm } from './live-folios';

function Person({ booking }) {
  return <div className={s.person}><span className={s.avatar}>{booking.initials}</span><div><div className={s.name}>{booking.guest}</div><div className={s.small}>{booking.id} · {booking.adults ?? booking.guests} adult(s){booking.children ? ` + ${booking.children} child(ren)` : ''}</div></div></div>;
}
function Status({ status, type }) {
  const values = { confirmed: [BOOKING_TYPE_LABEL[type] || 'Confirmed', type === 'tentative' || type === 'waitlist' ? 'amber' : 'green'], in_house: ['In house', 'blue'], checked_out: ['Checked out', 'gray'], cancelled: ['Cancelled', 'rose'] };
  const [label, tone] = values[status] || [status, 'gray'];
  return <Badge tone={tone}>{label}</Badge>;
}
function RoomBadge({ status }) { return <Badge tone={ROOM_STATES[status].tone}>{ROOM_STATES[status].label}</Badge>; }
function Panel({ title, count, action, children }) {
  return <section className={s.panel}><div className={s.panelHeader}><h2 className={s.panelTitle}>{title}{count !== undefined && <span className={s.count}>{count}</span>}</h2>{action}</div>{children}</section>;
}
function Empty({ children }) { return <p className={s.empty}>{children}</p>; }
function Kpis({ items }) {
  return <div className={s.kpis}>{items.map(({ label, value, hint, icon: Icon }) => <div className={s.kpi} key={label}><div className={s.kpiLabel}><span>{label}</span><Icon size={16} strokeWidth={1.6} /></div><div className={s.kpiValue}>{value}</div><div className={s.kpiHint}>{hint}</div></div>)}</div>;
}
const Fact = ({ label, children }) => <div><span>{label}</span><strong>{children}</strong></div>;
// Query-string value for a lazy state initializer. Hotel screens render only on
// the client (after the snapshot loads), so no Suspense boundary is needed.
const queryParam = (name) => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(name));
const nowClock = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());

/** Today's remaining meal allowance for a stay, from the plan components and usage in the snapshot. */
export function allowanceToday(state, booking) {
  const plan = (state.plans || []).find((p) => p.name === booking.meal);
  if (!plan?.components?.length) return null;
  const date = state.businessDate;
  const pax = (c) => c.adult * (booking.adults ?? booking.guests) + c.child * (booking.children || 0);
  const rows = plan.components.map((c) => {
    const entitled = c.timing === 'night_of' ? booking.start <= date && date < booking.end : booking.start < date && date <= booking.end;
    const used = (booking.packageUsage || []).filter((u) => u.date === date && u.label === c.label).reduce((sum, u) => sum + u.amount, 0);
    return { label: c.label, remaining: entitled ? Math.max(0, pax(c) - used) : 0, entitled };
  });
  return rows;
}

function QuickRows({ rows, empty, onSelect, cols }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return <div className={s.tableScroll}><table className={s.table}><tbody>{rows.map((r) => <tr key={r.key}>{cols.map((c, i) => <td key={i}>{c(r)}</td>)}<td><button className={s.textButton} onClick={() => onSelect(r)}>{r.action || 'Open'}<ArrowRight size={13} /></button></td></tr>)}</tbody></table></div>;
}

function LaundryForm({ booking, onClose }) {
  const { act, busy } = useHotel();
  const [error, setError] = useState('');
  return <Modal title={`Laundry · room ${booking.roomId}`} onClose={onClose}><form className={s.form} onSubmit={async (event) => {
    event.preventDefault();
    const result = await act({ type: 'laundry', roomId: booking.roomId, ...Object.fromEntries(new FormData(event.currentTarget)) });
    if (result.ok) onClose(); else setError(result.error);
  }}>
    <label>Items<input name="items" required maxLength={300} placeholder="e.g. 2 shirts, 1 trouser (wash & iron)" /></label>
    <div className={s.formRow}><label>Pieces<input name="pieces" type="number" min="1" max="500" defaultValue="1" required /></label><label>Price before tax (NPR)<input name="amount" type="number" min="0" step="0.01" required /></label></div>
    <label className={s.checkLabel}><input type="checkbox" name="express" />Express</label>
    <label>Notes<input name="notes" maxLength={300} /></label>
    <p className={s.formNote}>Tracked Collected → Washing → Ironing → Ready → Delivered. The folio is charged once, on delivery.</p>
    {error && <p className={s.error} role="alert">{error}</p>}
    <div className={s.actions}><button type="button" className={s.secondary} onClick={onClose}>Cancel</button><button className={s.primary} disabled={busy}>Record laundry</button></div>
  </form></Modal>;
}

export function MinibarForm({ roomId = '', onClose }) {
  const { state, act, busy } = useHotel();
  const [error, setError] = useState('');
  const [itemId, setItemId] = useState('');
  const occupied = state.bookings.filter((b) => b.status === 'in_house');
  const items = state.minibarItems || [];
  return <Modal title="Minibar consumption" onClose={onClose}><form className={s.form} onSubmit={async (event) => {
    event.preventDefault();
    const result = await act({ type: 'minibar', ...Object.fromEntries(new FormData(event.currentTarget)) });
    if (result.ok) onClose(); else setError(result.error);
  }}>
    <label>Room<select name="roomId" required defaultValue={roomId}><option value="" disabled>Choose an occupied room</option>{occupied.map((b) => <option key={b.id} value={b.roomId}>{b.roomId} · {b.guest}</option>)}</select></label>
    {items.length > 0 && <label>Item<select name="itemId" value={itemId} onChange={(e) => setItemId(e.target.value)}><option value="">Other (type below)</option>{items.map((i) => <option key={i.id} value={i.id}>{i.name} · {money(i.price)}{i.stock != null ? ` · stock ${i.stock}` : ''}</option>)}</select></label>}
    {!itemId && <div className={s.formRow}><label>Item<input name="item" required maxLength={60} placeholder="e.g. Coke 250 ml" /></label><label>Unit price before tax (NPR)<input name="unitPrice" type="number" min="0.01" step="0.01" required /></label></div>}
    <label>Quantity<input name="quantity" type="number" min="1" max="50" required defaultValue="1" /></label>
    <p className={s.formNote}>Posted to the in-house guest’s folio (Minibar revenue). Catalog items linked to inventory also reduce stock in the same step.</p>
    {error && <p className={s.error} role="alert">{error}</p>}
    <div className={s.actions}><button type="button" className={s.secondary} disabled={busy} onClick={onClose}>Cancel</button><button className={s.primary} disabled={busy || !occupied.length}>{busy ? 'Saving…' : 'Post minibar charge'}</button></div>
  </form></Modal>;
}

function StatusForm({ room, onClose }) {
  const { act, busy } = useHotel();
  const [error, setError] = useState('');
  const next = { ready: ['ready', 'dirty'], dirty: ['dirty', 'cleaning'], cleaning: ['cleaning', 'inspection'], inspection: ['inspection', 'ready', 'dirty'] }[room.cleaning];
  return <Modal title={`Room ${room.id} status`} onClose={onClose}><form className={s.form} onSubmit={async (event) => {
    event.preventDefault();
    const f = Object.fromEntries(new FormData(event.currentTarget));
    const result = await act({ type: 'room_status', roomId: room.id, version: room.version, cleaning: f.cleaning, blocked: f.block === 'none' ? 0 : 1, blockKind: f.block === 'none' ? 'out_of_order' : f.block, reason: f.reason });
    if (result.ok) onClose(); else setError(result.error);
  }}>
    <label>Housekeeping<select name="cleaning" defaultValue={room.cleaning}>{next.map((c) => <option key={c} value={c}>{HK_LABEL[c]}</option>)}</select></label>
    <label>Availability<select name="block" defaultValue={room.blocked ? room.blockKind : 'none'}><option value="none">In service</option><option value="out_of_order">Out of order (repair)</option><option value="out_of_service">Out of service (short-term)</option></select></label>
    <label>Reason (audited)<input name="reason" maxLength={200} /></label>
    {error && <p className={s.error} role="alert">{error}</p>}
    <div className={s.actions}><button type="button" className={s.secondary} onClick={onClose}>Cancel</button><button className={s.primary} disabled={busy}>Save status</button></div>
  </form></Modal>;
}

/** Everything about one room on one screen, with the common actions. */
function RoomDetails({ roomId, onClose }) {
  const { state, act, openBooking, busy, can } = useHotel();
  const date = state.businessDate;
  const [error, setError] = useState('');
  const [sub, setSub] = useState(null);
  const room = state.rooms.find((r) => r.id === roomId);
  const stay = activeStay(state, room.id);
  const arrival = state.bookings.find((b) => b.roomId === roomId && b.status === 'confirmed' && b.start === date);
  const booking = stay || arrival;
  const status = roomState(state, room);
  const ticket = (state.tickets || []).find((t) => t.roomId === room.id && !['resolved', 'closed'].includes(t.status));
  const allowance = booking ? allowanceToday(state, booking) : null;
  const run = async (action, close = true) => { setError(''); const result = await act(action); if (!result.ok) setError(result.error); else if (close) onClose(); };
  return <Modal title={`Room ${room.id}`} onClose={onClose} wide><div className={s.form}>
    <div className={s.actions}><RoomBadge status={status} /><Badge tone="gray">{room.type} · floor {room.floor}</Badge>{room.hkFlag === 'dnd' && <Badge tone="violet">Do not disturb</Badge>}{room.hkFlag === 'pickup' && <Badge tone="amber">Pickup requested</Badge>}</div>
    <div className={s.facts}>
      <Fact label="Occupancy">{occupancyState(state, room)}</Fact>
      <Fact label="Housekeeping">{HK_LABEL[room.cleaning]}</Fact>
      <Fact label="Maintenance">{ticket ? `${ticket.status.replace('_', ' ')} · ${ticket.title}` : 'OK'}</Fact>
      {booking ? <>
        <Fact label="Guest">{booking.guest}</Fact>
        <Fact label="Arrival">{shortDate(booking.start)}</Fact>
        <Fact label="Departure">{shortDate(booking.end)} · 12:00</Fact>
        <Fact label="Rate plan">{booking.meal}</Fact>
        <Fact label="Rate">{money(booking.rate)} / night</Fact>
        <Fact label="Folio balance">{money(balance(booking))}</Fact>
        <Fact label="Deposit held">{money(booking.depositHeld || 0)}</Fact>
        <Fact label="Source">{booking.source}{booking.company ? ` · ${booking.company}` : ''}</Fact>
        {allowance && <Fact label="Meal allowance today">{allowance.filter((a) => a.entitled).map((a) => `${a.label} ${money(a.remaining)}`).join(' · ') || 'None today'}</Fact>}
      </> : <Fact label="Tariff">{money(room.rate)} / night</Fact>}
    </div>
    {booking?.specialRequests && <p className={s.formNote}>Requests: {booking.specialRequests}</p>}
    {booking?.unpostedNights?.length > 0 && <p className={s.formNote}>{booking.unpostedNights.length} room night(s) still to post ({money(booking.unpostedAmount)}).</p>}
    {error && <p className={s.error} role="alert">{error}</p>}
    <div className={s.quick}>
      {arrival && !stay && can('hotel.front_desk') && <button className={s.primary} disabled={busy} onClick={() => run({ type: 'checkin', id: arrival.id })}>Check in guest</button>}
      {booking?.guestId && <Link className={s.secondary} href={`/admin/hotel/guests?guest=${booking.guestId}`} onClick={onClose}>View guest</Link>}
      {booking && <Link className={s.secondary} href={`/admin/hotel/reservations?stay=${booking.id}`} onClick={onClose}>View reservation</Link>}
      {booking && <Link className={s.secondary} href={`/admin/hotel/folios?guest=${booking.id}`} onClick={onClose}>View folio</Link>}
      {stay && <button className={s.secondary} onClick={() => { onClose(); openBooking(stay); }}>Add room</button>}
      {booking && <button className={s.secondary} onClick={() => setSub('move')}>Move room</button>}
      {booking && <button className={s.secondary} onClick={() => setSub('dates')}>{stay ? 'Extend / early checkout' : 'Change dates'}</button>}
      {stay && <Link className={s.secondary} href="/admin/pos" onClick={onClose}>Order room service</Link>}
      {stay && can('hotel.laundry') && <button className={s.secondary} onClick={() => setSub('laundry')}><Shirt size={14} />Post laundry</button>}
      {stay && <button className={s.secondary} onClick={() => setSub('minibar')}><GlassWater size={14} />Post minibar</button>}
      {stay && <button className={s.secondary} disabled={busy} onClick={() => run({ type: 'stayover', roomId: room.id, note: 'Guest request' }, false)}><Sparkles size={14} />Guest request / service</button>}
      {stay && <button className={s.secondary} disabled={busy} onClick={() => run({ type: 'room_flag', roomId: room.id, flag: room.hkFlag === 'dnd' ? '' : 'dnd' }, false)}><BellOff size={14} />{room.hkFlag === 'dnd' ? 'Clear DND' : 'Do not disturb'}</button>}
      <button className={s.secondary} onClick={() => setSub('issue')}><Wrench size={14} />Maintenance request</button>
      {!stay && can('hotel.setup') && <button className={s.secondary} onClick={() => setSub('status')}>Change status</button>}
      {['dirty', 'cleaning', 'inspection'].includes(status) && <Link className={s.secondary} href="/admin/hotel/housekeeping" onClick={onClose}>Housekeeping</Link>}
      {booking && <button className={s.secondary} onClick={async () => {
        const guest = booking.guestId ? await authedRequest(`/api/hotel/guests/${booking.guestId}`).then((r) => r.json()).then((d) => d.guest).catch(() => null) : null;
        try { printHtml(registrationCardHtml({ property: state.property, booking, guest })); } catch (e) { setError(e.message); }
      }}><Printer size={14} />Registration card</button>}
      {!booking && status === 'available' && <button className={s.primary} onClick={() => { onClose(); openBooking(); }}>New reservation</button>}
    </div>
    {sub === 'move' && <StayChangeForm booking={booking} mode="move" onClose={() => setSub(null)} />}
    {sub === 'dates' && <StayChangeForm booking={booking} mode="dates" onClose={() => setSub(null)} />}
    {sub === 'laundry' && <LaundryForm booking={stay} onClose={() => setSub(null)} />}
    {sub === 'minibar' && <MinibarForm roomId={room.id} onClose={() => setSub(null)} />}
    {sub === 'issue' && <IssueForm roomId={room.id} onClose={() => setSub(null)} />}
    {sub === 'status' && <StatusForm room={room} onClose={() => setSub(null)} />}
  </div></Modal>;
}

function EditReservation({ booking, onClose }) {
  const { state, act, busy, can } = useHotel();
  const [error, setError] = useState('');
  return <Modal title={`Edit ${booking.id}`} onClose={onClose}><form className={s.form} onSubmit={async (event) => {
    event.preventDefault();
    const f = Object.fromEntries(new FormData(event.currentTarget));
    const result = await act({ type: 'update_reservation', id: booking.id, ...f, noPost: f.noPost === 'on' });
    if (result.ok) onClose(); else setError(result.error);
  }}>
    <div className={s.formRow}><label>Adults<input name="adults" type="number" min="1" max="20" defaultValue={booking.adults} /></label><label>Children<input name="children" type="number" min="0" max="19" defaultValue={booking.children} /></label></div>
    <div className={s.formRow}><label>Status<select name="bookingType" defaultValue={booking.bookingType} disabled={booking.status !== 'confirmed'}>{(state.bookingTypes || []).map((t) => <option key={t} value={t}>{BOOKING_TYPE_LABEL[t]}</option>)}</select></label><label>Segment<select name="segment" defaultValue={booking.segment}>{(state.segments || ['']).map((x) => <option key={x} value={x}>{x || 'Not set'}</option>)}</select></label></div>
    <div className={s.formRow}><label>Company<input name="company" maxLength={100} defaultValue={booking.company} /></label><label>Travel agent<input name="agent" maxLength={100} defaultValue={booking.agent} /></label></div>
    <label>Payment guarantee<input name="guarantee" maxLength={100} defaultValue={booking.guarantee} /></label>
    <label>Special requests<textarea name="specialRequests" rows={2} maxLength={500} defaultValue={booking.specialRequests} /></label>
    <label>Internal notes<textarea name="notes" rows={2} maxLength={1000} defaultValue={booking.notes} /></label>
    <div className={s.formRow}>
      <label>Folio credit limit (NPR){!can('hotel.folio_adjust') && <span className={s.small}>Manager permission</span>}<input name="creditLimit" type="number" min="0" step="0.01" defaultValue={booking.creditLimit ?? ''} disabled={!can('hotel.folio_adjust')} placeholder="No limit" /></label>
      <label className={s.checkLabel}><input type="checkbox" name="noPost" defaultChecked={booking.noPost} />No-post (block restaurant room charges)</label>
    </div>
    {!can('hotel.folio_adjust') && <input type="hidden" name="creditLimit" value={booking.creditLimit ?? ''} />}
    {error && <p className={s.error} role="alert">{error}</p>}
    <div className={s.actions}><button type="button" className={s.secondary} onClick={onClose}>Cancel</button><button className={s.primary} disabled={busy}>Save</button></div>
  </form></Modal>;
}

function ReasonForm({ title, label, onSubmit, onClose, danger = false }) {
  const { busy } = useHotel();
  const [error, setError] = useState('');
  return <Modal title={title} onClose={onClose}><form className={s.form} onSubmit={async (event) => {
    event.preventDefault();
    const result = await onSubmit(new FormData(event.currentTarget).get('reason'));
    if (result.ok) onClose(); else setError(result.error);
  }}>
    <label>{label}<input name="reason" required maxLength={200} autoFocus /></label>
    {error && <p className={s.error} role="alert">{error}</p>}
    <div className={s.actions}><button type="button" className={s.secondary} onClick={onClose}>Back</button><button className={danger ? s.danger : s.primary} disabled={busy}>{title}</button></div>
  </form></Modal>;
}

function ReservationDetails({ bookingId, onClose }) {
  const { state, act, busy, openBooking } = useHotel();
  const [error, setError] = useState('');
  const [form, setForm] = useState(null);
  const [copied, setCopied] = useState(false);
  const booking = state.bookings.find((b) => b.id === bookingId);
  const date = state.businessDate;
  if (!booking) return null;
  const group = booking.groupId ? state.bookings.filter((b) => b.groupId === booking.groupId) : [];
  const run = async (action, keepOpen = true) => {
    setError('');
    const result = await act({ id: booking.id, ...action });
    if (!result.ok) setError(result.error); else if (!keepOpen) onClose();
    return result;
  };
  return <Modal title={`Reservation ${booking.id}`} onClose={onClose} wide><div className={s.form}>
    <div className={s.actions}><Person booking={booking} /><Status status={booking.status} type={booking.bookingType} />{booking.noShow && <Badge tone="rose">No-show</Badge>}{booking.noPost && <Badge tone="rose">No-post</Badge>}</div>
    <div className={s.facts}>
      <Fact label="Room">{booking.roomId} · {booking.roomType}</Fact>
      <Fact label="Stay">{shortDate(booking.start)} → {shortDate(booking.end)}</Fact>
      <Fact label="Rate plan">{booking.meal}</Fact>
      <Fact label="Agreed rate">{money(booking.rate)} / night{booking.ratesVary ? ' (varies)' : ''}</Fact>
      <Fact label="Stay value">{money(booking.stayValue)}</Fact>
      <Fact label="Folio balance">{money(balance(booking))}</Fact>
      <Fact label="Deposit held">{money(booking.depositHeld || 0)}</Fact>
      <Fact label="Source / segment">{booking.source}{booking.segment ? ` · ${booking.segment}` : ''}</Fact>
      {booking.company && <Fact label="Company">{booking.company}</Fact>}
      {booking.agent && <Fact label="Travel agent">{booking.agent}</Fact>}
      {booking.guarantee && <Fact label="Guarantee">{booking.guarantee}</Fact>}
      <Fact label="Phone">{booking.phone || '—'}</Fact>
    </div>
    {(booking.specialRequests || booking.notes) && <p className={s.formNote}>{booking.specialRequests && <>Requests: {booking.specialRequests}<br /></>}{booking.notes && <>Notes: {booking.notes}</>}</p>}
    {group.length > 1 && <div className={s.formNote}><strong>Master reservation {booking.groupId}</strong> ({(state.groups || []).find((g) => g.id === booking.groupId)?.payerMode || 'individual'} billing)<br />{group.map((g) => `Room ${g.roomId} · ${g.guest} · ${g.status.replace('_', ' ')}${g.routing ? ` → billed to ${g.routing.targetRoom}` : ''}`).join(' | ')}</div>}
    {booking.moves?.length > 0 && <p className={s.formNote}>Room moves: {booking.moves.map((m) => `${shortDate(m.date)} ${m.from} → ${m.to} (${m.reason}${m.by ? `, ${m.by}` : ''})`).join('; ')}</p>}
    <div className={s.actions}>
      {booking.guestId && <Link className={s.textButton} href={`/admin/hotel/guests?guest=${booking.guestId}`} onClick={onClose}>Guest profile & ID documents<ArrowRight size={13} /></Link>}
      <Link className={s.textButton} href={`/admin/hotel/folios?guest=${booking.id}`} onClick={onClose}>Folio<ArrowRight size={13} /></Link>
      <button className={s.textButton} onClick={() => { try { printHtml(reservationConfirmationHtml({ property: state.property, booking })); } catch (e) { setError(e.message); } }}><Printer size={13} />Confirmation</button>
    </div>
    {booking.precheckinAt && <Badge tone="green">Checked in online{booking.eta ? ` · arriving ${booking.eta}` : ''}</Badge>}
    {booking.status === 'confirmed' && <div className={s.actions}>
      {booking.precheckinToken
        ? <button className={s.textButton} onClick={() => { void navigator.clipboard?.writeText(`${window.location.origin}/checkin/${booking.precheckinToken}`); setError(''); setCopied(true); }}>{copied ? 'Link copied' : 'Copy online check-in link'}</button>
        : <button className={s.textButton} disabled={busy} onClick={() => run({ type: 'precheckin_link' })}>Create online check-in link</button>}
    </div>}
    {error && <p role="alert" className={s.error}>{error}</p>}
    {['confirmed', 'in_house'].includes(booking.status) && <div className={s.quick}>
      {booking.status === 'confirmed' && booking.start <= date && booking.end > date && booking.bookingType !== 'waitlist' && <button className={s.primary} disabled={busy} onClick={() => run({ type: 'checkin' }, false)}>Check in guest</button>}
      <button className={s.secondary} onClick={() => setForm('edit')}>Edit details</button>
      <label className={s.small}>Rate plan<select value={booking.meal} disabled={busy} onChange={(e) => run({ type: 'change_plan', meal: e.target.value })}>{(state.plans || []).map((p) => <option key={p.name}>{p.name}</option>)}</select></label>
      {booking.status === 'confirmed' && <label className={s.small}>Status<select value={booking.bookingType} disabled={busy} onChange={(e) => run({ type: 'booking_type', bookingType: e.target.value })}>{(state.bookingTypes || []).map((t) => <option key={t} value={t}>{BOOKING_TYPE_LABEL[t]}</option>)}</select></label>}
      <button className={s.secondary} disabled={busy} onClick={() => setForm('payment')}>{booking.status === 'confirmed' ? 'Record deposit' : 'Record payment'}</button>
      {balance(booking) < 0 && <button className={s.secondary} disabled={busy} onClick={() => setForm('refund')}>Refund</button>}
      <button className={s.secondary} disabled={busy} onClick={() => setForm('charge')}>{booking.status === 'confirmed' ? 'Cancellation / no-show fee' : 'Add charge'}</button>
      <button className={s.secondary} disabled={busy} onClick={() => setForm('dates')}>Change dates</button>
      <button className={s.secondary} disabled={busy} onClick={() => setForm('move')}>Change room</button>
      <button className={s.secondary} onClick={() => { onClose(); openBooking(booking); }}>Add room</button>
      {booking.status === 'confirmed' && booking.start <= date && <button className={s.secondary} disabled={busy} onClick={() => setForm('noshow')}>Mark no-show</button>}
      {booking.status === 'confirmed' && <button className={s.danger} disabled={busy} onClick={() => setForm('cancel')}>Cancel reservation</button>}
    </div>}
    {form === 'edit' && <EditReservation booking={booking} onClose={() => setForm(null)} />}
    {form === 'cancel' && <ReasonForm title="Cancel reservation" label="Cancellation reason" danger onClose={() => setForm(null)} onSubmit={(reason) => run({ type: 'cancel', reason }, false)} />}
    {form === 'noshow' && <ReasonForm title="Mark no-show" label="Note (e.g. guest unreachable)" danger onClose={() => setForm(null)} onSubmit={(reason) => run({ type: 'no_show', reason }, false)} />}
    {['move', 'dates'].includes(form) && <StayChangeForm booking={booking} mode={form} onClose={() => setForm(null)} />}
    {['payment', 'refund', 'charge'].includes(form) && <FolioForm booking={booking} mode={form} onClose={() => setForm(null)} />}
  </div></Modal>;
}

/** Night audit summary on the front desk (full page at /admin/hotel/night-audit). */
function NightAuditSummary() {
  const { state } = useHotel();
  const today = state.audits?.find((a) => a.date === state.businessDate);
  const last = today || state.audits?.[0];
  return <Panel title="Night audit" action={<Link className={s.textButton} href="/admin/hotel/night-audit">{today ? 'Open' : 'Run night audit'}<ArrowRight size={13} /></Link>}>
    <div className={s.panelBody}>{last ? <p className={s.small}><strong>{today ? 'Today' : `Last run ${shortDate(last.date)}`}</strong>: occupancy {last.occupancyPercent}% · ADR {money(last.adr || 0)} · {last.roomNightsPosted} night(s) posted{last.needsReview?.length ? ` · ${last.needsReview.length} to review` : ''}</p> : <p className={s.small}>Not run yet.</p>}</div>
  </Panel>;
}

export function FrontDesk() {
  const { state, can } = useHotel();
  const date = state.businessDate;
  const [selected, setSelected] = useState(null);
  const [reservation, setReservation] = useState(null);
  const clock = nowClock();
  const inHouse = state.bookings.filter((b) => b.status === 'in_house');
  const arrivals = state.bookings.filter((b) => b.start === date && b.status === 'confirmed' && b.bookingType !== 'waitlist');
  const late = arrivals.filter((b) => b.eta && b.eta < clock);
  const noShows = state.bookings.filter((b) => b.status === 'confirmed' && b.start < date && b.bookingType !== 'waitlist');
  const departures = inHouse.filter((b) => b.end <= date);
  const walkIns = inHouse.filter((b) => b.source === 'Walk-In' && b.start === date);
  const outstanding = inHouse.filter((b) => balance(b) > 0 || b.unpostedNights.length).sort((a, b) => balance(b) - balance(a));
  const overLimit = inHouse.filter((b) => b.creditLimit != null && balance(b) > b.creditLimit);
  const dirty = state.rooms.filter((r) => !r.blocked && ['dirty', 'cleaning'].includes(r.cleaning));
  const inspect = state.rooms.filter((r) => !r.blocked && r.cleaning === 'inspection');
  const ooo = state.rooms.filter((r) => r.blocked);
  const moves = state.bookings.flatMap((b) => (b.moves || []).filter((m) => m.date === date).map((m) => ({ ...m, guest: b.guest, id: b.id })));
  const requests = state.tasks.filter((t) => t.taskType === 'stayover' && t.status !== 'ready');
  const sellable = state.rooms.filter((r) => !r.blocked).length;
  const roomRow = (r) => ({ key: r.id, room: r, action: 'Room' });
  return <>
    <Kpis items={[
      { label: 'Occupancy', value: `${sellable ? Math.round(inHouse.length / sellable * 100) : 0}%`, hint: `${inHouse.length} occupied / ${sellable} sellable`, icon: BedDouble },
      { label: 'Arrivals', value: String(arrivals.length).padStart(2, '0'), hint: `${late.length} late · ${walkIns.length} walk-in`, icon: ArrowDownLeft },
      { label: 'Departures', value: String(departures.length).padStart(2, '0'), hint: 'Due out by 12:00', icon: ArrowUpRight },
      { label: 'Open balances', value: money(outstanding.reduce((sum, b) => sum + Math.max(0, balance(b)), 0)), hint: `${outstanding.length} folio(s)${overLimit.length ? ` · ${overLimit.length} over limit` : ''}`, icon: Wallet },
    ]} />
    {(noShows.length > 0 || overLimit.length > 0 || late.length > 0) && <section className={`${s.panel} mb-5`}>{[
      ...noShows.map((b) => ({ key: `ns${b.id}`, sev: 'high', text: `No-show pending: ${b.guest} (room ${b.roomId}) was due ${shortDate(b.start)}`, open: () => setReservation(b.id) })),
      ...late.map((b) => ({ key: `l${b.id}`, sev: 'medium', text: `Late arrival: ${b.guest} expected ${b.eta}`, open: () => setReservation(b.id) })),
      ...overLimit.map((b) => ({ key: `o${b.id}`, sev: 'high', text: `Over credit limit: room ${b.roomId} ${b.guest} ${money(balance(b))} / ${money(b.creditLimit)}`, open: () => setSelected(b.roomId) })),
    ].map((a) => <div key={a.key} className={`${s.alertRow} ${s[`sev_${a.sev}`]}`}><span><AlertTriangle size={14} className="mr-2 inline" />{a.text}</span><button className={s.textButton} onClick={a.open}>Review<ArrowRight size={13} /></button></div>)}</section>}
    <div className={s.columns}><div className={s.stack}>
      <Panel title="Arrivals today" count={arrivals.length} action={<Link className={s.textButton} href="/admin/hotel/reservations">All reservations<ArrowRight size={13} /></Link>}>
        <QuickRows rows={arrivals.map((b) => ({ key: b.id, b, action: 'Arrival' }))} empty="All arrivals are taken care of." onSelect={(r) => setReservation(r.b.id)} cols={[(r) => <Person booking={r.b} />, (r) => { const room = state.rooms.find((x) => x.id === r.b.roomId); return <><strong>{r.b.roomId}</strong><div className={s.small}>{room ? HK_LABEL[room.cleaning] : ''}{room?.blocked ? ' · out of order' : ''}</div></>; }, (r) => <><span>{r.b.eta || '14:00'}</span><div className={s.small}>{r.b.source}{r.b.precheckinAt ? ' · online check-in' : ''}</div></>, (r) => <Status status={r.b.status} type={r.b.bookingType} />]} />
      </Panel>
      <Panel title="Departures" count={departures.length}>
        <QuickRows rows={departures.map((b) => ({ key: b.id, b, action: 'Folio' }))} empty="No departures pending." onSelect={(r) => { window.location.href = `/admin/hotel/folios?guest=${r.b.id}`; }} cols={[(r) => <Person booking={r.b} />, (r) => <strong>{r.b.roomId}</strong>, (r) => <span>{money(balance(r.b))}{r.b.unpostedNights.length ? ' · nights to post' : ''}</span>]} />
      </Panel>
      <Panel title="In house" count={inHouse.length}>
        <QuickRows rows={inHouse.map((b) => ({ key: b.id, b, action: 'Room' }))} empty="No guests in house." onSelect={(r) => setSelected(r.b.roomId)} cols={[(r) => <Person booking={r.b} />, (r) => <strong>{r.b.roomId}</strong>, (r) => <span>to {shortDate(r.b.end)} · {r.b.meal}</span>, (r) => <span>{money(balance(r.b))}</span>]} />
      </Panel>
      {(noShows.length > 0) && <Panel title="No-shows pending" count={noShows.length}><QuickRows rows={noShows.map((b) => ({ key: b.id, b, action: 'Review' }))} empty="" onSelect={(r) => setReservation(r.b.id)} cols={[(r) => <Person booking={r.b} />, (r) => <span>due {shortDate(r.b.start)} · {BOOKING_TYPE_LABEL[r.b.bookingType]}</span>]} /></Panel>}
      <NightAuditSummary />
      {!state.rooms.length && <Panel title="Welcome to your hotel"><div className={s.panelBody}><p className={s.subtitle}>Add your property name and rooms to start taking reservations.</p><Link className={s.textButton} href="/admin/hotel/room-setup">Set up hotel rooms<ArrowRight size={14} /></Link></div></Panel>}
    </div><div className={s.stack}>
      <Panel title="Rooms at a glance" action={<Link className={s.textButton} href="/admin/hotel/rooms">Room rack<ArrowRight size={13} /></Link>}><div className={s.panelBody}><div className={s.overviewRooms}>{state.rooms.map((room) => { const status = roomState(state, room); return <button key={room.id} className={s.miniRoom} data-status={status === 'service' ? 'blocked' : status} onClick={() => setSelected(room.id)} aria-label={`Room ${room.id}, ${ROOM_STATES[status].label}`}><strong>{room.id}</strong><span>{ROOM_STATES[status].label}</span></button>; })}</div></div></Panel>
      <Panel title="Dirty / cleaning" count={dirty.length}><QuickRows rows={dirty.map(roomRow)} empty="No rooms waiting." onSelect={(r) => setSelected(r.room.id)} cols={[(r) => <strong>{r.room.id}</strong>, (r) => <span>{HK_LABEL[r.room.cleaning]}{arrivals.some((a) => a.roomId === r.room.id) ? ' · arrival today' : ''}</span>]} /></Panel>
      <Panel title="Awaiting inspection" count={inspect.length}><QuickRows rows={inspect.map(roomRow)} empty="Nothing to inspect." onSelect={(r) => setSelected(r.room.id)} cols={[(r) => <strong>{r.room.id}</strong>, (r) => <span>{r.room.type}</span>]} /></Panel>
      <Panel title="Out of order / service" count={ooo.length}><QuickRows rows={ooo.map(roomRow)} empty="All rooms in service." onSelect={(r) => setSelected(r.room.id)} cols={[(r) => <strong>{r.room.id}</strong>, (r) => <span>{r.room.blockKind === 'out_of_service' ? 'Out of service' : 'Out of order'}</span>]} /></Panel>
      <Panel title="Outstanding folios" count={outstanding.length}><QuickRows rows={outstanding.map((b) => ({ key: b.id, b, action: 'Folio' }))} empty="All folios settled." onSelect={(r) => { window.location.href = `/admin/hotel/folios?guest=${r.b.id}`; }} cols={[(r) => <span><strong>{r.b.roomId}</strong> · {r.b.guest}</span>, (r) => <span>{money(balance(r.b))}</span>]} /></Panel>
      <Panel title="Guest requests" count={requests.length}><QuickRows rows={requests.map((t) => ({ key: t.id, t, action: 'Room' }))} empty="No open requests." onSelect={(r) => setSelected(r.t.roomId)} cols={[(r) => <strong>{r.t.roomId}</strong>, (r) => <span>{r.t.note} · {r.t.assignee}</span>]} /></Panel>
      {moves.length > 0 && <Panel title="Room moves today" count={moves.length}><div className={s.panelBody}><ul className={s.activity}>{moves.map((m, i) => <li key={i}><CheckCircle2 size={13} /><span>{m.guest}: {m.from} → {m.to} ({m.reason})</span></li>)}</ul></div></Panel>}
      <Panel title="Activity & handover"><div className={s.panelBody}><ul className={s.activity}>{state.activity.slice(0, 6).map((event, i) => <li key={`${event}-${i}`}><CheckCircle2 size={13} /><span>{event}</span></li>)}</ul>{can('hotel.reports') && <Link className={s.textButton} href="/admin/hotel/reports">Hotel reports<ArrowRight size={13} /></Link>}</div></Panel>
    </div></div>
    {selected && <RoomDetails roomId={selected} onClose={() => setSelected(null)} />}
    {reservation && <ReservationDetails bookingId={reservation} onClose={() => setReservation(null)} />}
  </>;
}

export function RoomRack() {
  const { state } = useHotel();
  const date = state.businessDate;
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(() => queryParam('room'));
  const rooms = state.rooms.filter((room) => (filter === 'all' || roomState(state, room) === filter) && `${room.id} ${room.type} ${activeStay(state, room.id)?.guest || ''}`.toLowerCase().includes(search.toLowerCase()));
  return <><div className={s.toolbar}><label className={s.search}><Search size={16} /><input aria-label="Search rooms or guests" placeholder="Search room, type or guest…" value={search} onChange={(e) => setSearch(e.target.value)} /></label><div className={s.filters}>{[['all', 'All rooms'], ['available', 'Ready'], ['occupied', 'Occupied'], ['departure', 'Due out'], ['dirty', 'Needs cleaning'], ['inspection', 'Inspect'], ['blocked', 'Out of order'], ['service', 'Out of service']].map(([key, label]) => <button key={key} className={`${s.filter} ${filter === key ? s.selectedFilter : ''}`} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}<span className={s.count}>{key === 'all' ? state.rooms.length : state.rooms.filter((r) => roomState(state, r) === key).length}</span></button>)}</div></div>
    {!rooms.length && <Empty>No rooms match. Try another status or search.</Empty>}
    {[...new Set(rooms.map((room) => room.floor))].sort((a, b) => a - b).map((floor) => rooms.some((r) => r.floor === floor) && <section key={floor} className={s.floor}><h2 className={s.floorTitle}><Layers size={15} />Floor {floor}<span className={s.small}>/ {rooms.filter((r) => r.floor === floor).length} rooms shown</span></h2><div className={s.roomGrid}>{rooms.filter((r) => r.floor === floor).map((room) => {
      const status = roomState(state, room); const stay = activeStay(state, room.id);
      const arrival = state.bookings.find((b) => b.roomId === room.id && b.status === 'confirmed' && b.start === date);
      return <button className={s.room} data-status={status === 'service' ? 'blocked' : status} key={room.id} onClick={() => setSelected(room.id)}><div className={s.roomTop}><strong className={s.roomNumber}>{room.id}</strong><RoomBadge status={status} /></div><div className={s.small}>{room.type} · {HK_LABEL[room.cleaning]}{room.hkFlag === 'dnd' ? ' · DND' : ''}</div><div className={s.roomGuest}>{stay?.guest || (arrival ? `Arriving · ${arrival.guest}` : status === 'available' ? 'Ready for a new guest' : room.blocked ? 'Not for sale' : 'Room turnover')}</div><div className={s.roomBottom}><span>{stay ? `${shortDate(stay.start)} → ${shortDate(stay.end)} · ${money(balance(stay))}` : `${money(room.rate)} / night`}</span><span>{stay ? `${stay.source}` : arrival ? arrival.eta || '' : 'View room'}<ArrowRight size={11} className="inline ml-1" /></span></div></button>;
    })}</div></section>)}
    {selected && state.rooms.some((r) => r.id === selected) && <RoomDetails roomId={selected} onClose={() => setSelected(null)} />}
  </>;
}

export function Reservations() {
  const { state } = useHotel();
  const date = state.businessDate;
  const [view, setView] = useState('calendar');
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(() => queryParam('stay'));
  const dates = Array.from({ length: 7 }, (_, i) => new Date(Date.parse(`${date}T00:00:00Z`) + (i + offset) * 86400000).toISOString().slice(0, 10));
  const bookings = state.bookings.filter((b) => `${b.guest} ${b.id} ${b.roomId} ${b.company} ${b.groupId || ''} ${b.phone}`.toLowerCase().includes(search.toLowerCase()));
  return <><div className={s.toolbar}><div className={s.actions}><div className={s.filters}>{['calendar', 'list'].map((key) => <button className={`${s.filter} ${view === key ? s.selectedFilter : ''}`} aria-pressed={view === key} onClick={() => setView(key)} key={key}>{key === 'calendar' ? 'Calendar view' : 'Reservation list'}</button>)}</div><label className={s.search}><Search size={15} /><input aria-label="Search reservations" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search guest, room, company, group…" /></label></div>{view === 'calendar' && <div className={s.actions}><button className={s.secondary} aria-label="Previous week" onClick={() => setOffset(offset - 7)}><ChevronLeft size={15} /></button><button className={s.secondary} onClick={() => setOffset(0)}>Today</button><button className={s.secondary} aria-label="Next week" onClick={() => setOffset(offset + 7)}><ChevronRight size={15} /></button></div>}</div>
    <Panel title={view === 'calendar' ? `${shortDate(dates[0])} – ${shortDate(dates[6])}, ${dates[6].slice(0, 4)}` : 'Reservations'} count={view === 'list' ? bookings.length : undefined} action={<div className={s.actions}><Badge tone="blue">In house</Badge><Badge tone="green">Confirmed</Badge><Badge tone="amber">Tentative</Badge></div>}>
      {view === 'calendar' ? <><div className={s.tableScroll}><table className={s.calendar}><thead><tr><th>Room / Type</th>{dates.map((day) => <th className={day === date ? s.today : ''} key={day}>{shortDate(day)}<div className={s.small}>{new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'Asia/Kathmandu' })}</div></th>)}</tr></thead><tbody>{state.rooms.map((room) => {
        const cells = []; let index = 0;
        while (index < dates.length) {
          const day = dates[index];
          const b = bookings.find((item) => item.roomId === room.id && item.start <= day && item.end > day && ['confirmed', 'in_house'].includes(item.status) && item.bookingType !== 'waitlist');
          if (b) { let span = 1; while (index + span < dates.length && dates[index + span] < b.end) span++; cells.push(<td key={day} colSpan={span}><button className={`${s.calendarEvent} ${b.status === 'confirmed' ? s.confirmedEvent : ''}`} onClick={() => setSelected(b.id)} title={`${b.guest} · ${shortDate(b.start)} to ${shortDate(b.end)}`}>{b.bookingType === 'tentative' ? '? ' : ''}{b.guest} · {shortDate(b.end)}</button></td>); index += span; }
          else { cells.push(<td className={day === date ? s.today : ''} key={day}>{room.blocked && <span className={s.small}>Blocked</span>}</td>); index++; }
        }
        return <tr key={room.id}><td><strong>{room.id}</strong><div className={s.small}>{room.type}</div></td>{cells}</tr>;
      })}</tbody></table></div><p className={s.calendarHint}>Reservations occupy nights from arrival up to departure. Waitlisted bookings are in the list view. Select a booking to see its details.</p></> : <div className={s.tableScroll}><table className={s.table}><thead><tr><th>Guest</th><th>Room</th><th>Stay dates</th><th>Source</th><th>Status</th><th>Balance</th><th>Action</th></tr></thead><tbody>{bookings.map((b) => <tr key={b.id}><td><Person booking={b} />{b.groupId && <span className={s.small}>{b.groupId}</span>}</td><td>{b.roomId}</td><td>{shortDate(b.start)} → {shortDate(b.end)}</td><td>{b.source}{b.company ? <div className={s.small}>{b.company}</div> : null}</td><td><Status status={b.status} type={b.bookingType} /></td><td>{money(balance(b))}</td><td><button className={s.textButton} onClick={() => setSelected(b.id)}>Open<ArrowRight size={13} /></button></td></tr>)}</tbody></table>{!bookings.length && <Empty>No reservations match your search.</Empty>}<p className={s.calendarHint}>Shows open bookings and the last {state.historyDays} days. Older stays are in Guests and Hotel reports.</p></div>}
    </Panel>{selected && <ReservationDetails bookingId={selected} onClose={() => setSelected(null)} />}
  </>;
}

export function Folios({ initialId }) {
  return <LiveFolios initialId={initialId} />;
}

export function IssueForm({ roomId, onClose }) {
  const { state, act, busy } = useHotel();
  const [error, setError] = useState('');
  return <Modal title="Report damage or maintenance issue" onClose={onClose}><form className={s.form} onSubmit={async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const photo = form.get('photo');
    form.delete('photo');
    const result = await act({ type: 'report_issue', ...Object.fromEntries(form), blockRoom: form.get('blockRoom') === 'on' });
    if (!result.ok) { setError(result.error); return; }
    if (photo && photo.size) {
      const upload = new FormData(); upload.append('file', photo);
      const response = await authedRequest(`/api/hotel/tickets/${result.data.id}/photo`, { method: 'POST', body: upload });
      if (!response.ok) { setError(`Ticket saved, but the photo failed: ${(await response.json().catch(() => ({}))).error || 'upload error'}`); return; }
    }
    onClose();
  }}>
    <label>Room<select name="roomId" required defaultValue={roomId || ''}><option value="" disabled>Choose a room</option>{state.rooms.map((room) => <option key={room.id} value={room.id}>{room.id} · {room.type}</option>)}</select></label>
    <label>What is wrong<input name="title" required maxLength={120} placeholder="e.g. Broken lamp, leaking tap" /></label>
    <label>Details<textarea name="description" rows={2} maxLength={1000} /></label>
    <label>Priority<select name="priority" defaultValue="normal"><option value="low">Low</option><option value="normal">Normal</option><option value="urgent">Urgent</option></select></label>
    <label className={s.checkLabel}><input type="checkbox" name="blockRoom" />Take the room off sale until fixed</label>
    <label>If off sale<select name="blockKind" defaultValue="out_of_order"><option value="out_of_order">Out of order (repair)</option><option value="out_of_service">Out of service (short-term)</option></select></label>
    <label>Photo (optional, up to 2 MB)<input name="photo" type="file" accept="image/jpeg,image/png,image/webp" /></label>
    {error && <p className={s.error} role="alert">{error}</p>}
    <div className={s.actions}><button type="button" className={s.secondary} disabled={busy} onClick={onClose}>Cancel</button><button className={s.primary} disabled={busy}>{busy ? 'Saving…' : 'Send to maintenance'}</button></div>
  </form></Modal>;
}

const TICKET_TONE = { open: 'rose', assigned: 'amber', in_progress: 'amber', waiting_part: 'violet', resolved: 'green', closed: 'gray' };
const TICKET_NEXT = { open: ['assigned', 'in_progress', 'resolved'], assigned: ['in_progress', 'waiting_part', 'resolved'], in_progress: ['waiting_part', 'resolved'], waiting_part: ['in_progress', 'resolved'], resolved: ['closed', 'in_progress'], closed: [] };
const TICKET_ACTION = { assigned: 'Assign', in_progress: 'Start work', waiting_part: 'Waiting for part', resolved: 'Resolve', closed: 'Close' };

function TicketForm({ ticket, status, onClose }) {
  const { state, act, busy } = useHotel();
  const [error, setError] = useState('');
  return <Modal title={`${TICKET_ACTION[status]} · ${ticket.roomId} ${ticket.title}`} onClose={onClose}><form className={s.form} onSubmit={async (event) => {
    event.preventDefault();
    const result = await act({ type: 'ticket_update', id: ticket.id, status, ...Object.fromEntries(new FormData(event.currentTarget)) });
    if (result.ok) onClose(); else setError(result.error);
  }}>
    {status === 'assigned' && <label>Technician<select name="userId" required defaultValue="">{[<option key="" value="" disabled>Choose</option>, ...(state.technicians || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)]}</select></label>}
    <label>{status === 'resolved' ? 'What was done' : 'Note'}<textarea name="note" rows={3} maxLength={500} required={status === 'resolved'} /></label>
    {status === 'resolved' && ticket.blockedRoom && <p className={s.formNote}>The room comes off the block and goes to housekeeping inspection before it can be sold again (unless another open ticket keeps it blocked).</p>}
    {error && <p className={s.error} role="alert">{error}</p>}
    <div className={s.actions}><button type="button" className={s.secondary} disabled={busy} onClick={onClose}>Cancel</button><button className={s.primary} disabled={busy}>{TICKET_ACTION[status]}</button></div>
  </form></Modal>;
}

export function Maintenance() {
  const { state, busy, can } = useHotel();
  const [reporting, setReporting] = useState(false);
  const [updating, setUpdating] = useState(null);
  const [error, setError] = useState('');
  const [showClosed, setShowClosed] = useState(false);
  const [room, setRoom] = useState('');
  const all = state.tickets || [];
  const tickets = all.filter((t) => (showClosed || !['resolved', 'closed'].includes(t.status)) && (!room || t.roomId === room));
  const viewPhoto = async (id) => {
    const response = await authedRequest(`/api/hotel/tickets/${id}/photo`);
    if (!response.ok) { setError('Could not open the photo.'); return; }
    const url = URL.createObjectURL(await response.blob());
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  return <>
    <Kpis items={[
      { label: 'Open', value: String(all.filter((t) => ['open', 'assigned'].includes(t.status)).length), hint: 'Waiting for work', icon: Wrench },
      { label: 'In progress', value: String(all.filter((t) => ['in_progress', 'waiting_part'].includes(t.status)).length), hint: `${all.filter((t) => t.status === 'waiting_part').length} waiting for parts`, icon: Clock3 },
      { label: 'Off sale', value: String(state.rooms.filter((r) => r.blocked).length), hint: 'Out of order / service', icon: BedDouble },
      { label: 'Resolved', value: String(all.filter((t) => ['resolved', 'closed'].includes(t.status)).length), hint: 'Last 200 tickets', icon: CheckCircle2 },
    ]} />
    <div className={s.toolbar}><div className={s.actions}><label className={s.checkLabel}><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />Show resolved & closed</label><label className={s.small}>Room history<select value={room} onChange={(e) => setRoom(e.target.value)}><option value="">All rooms</option>{state.rooms.map((r) => <option key={r.id} value={r.id}>{r.id}</option>)}</select></label></div><button className={s.primary} onClick={() => setReporting(true)}><Wrench size={15} />Report issue</button></div>
    {error && <p role="alert" className={s.error}>{error}</p>}
    <Panel title="Maintenance tickets" count={tickets.length}>
      {!tickets.length ? <Empty>No tickets.</Empty> : <div className={s.tableScroll}><table className={s.table}><thead><tr><th>Room / issue</th><th>Priority</th><th>Status</th><th>Reported</th><th>Action</th></tr></thead><tbody>{tickets.map((t) => <tr key={t.id}>
        <td><strong>{t.roomId}</strong> · {t.title}<p className={s.small}>{t.id} · {t.description}{t.blockedRoom ? ' · room off sale' : ''}{t.resolution ? ` · Fix: ${t.resolution}` : ''}</p>{t.hasPhoto && <button className={s.textButton} onClick={() => viewPhoto(t.id)}>View photo</button>}</td>
        <td><Badge tone={t.priority === 'urgent' ? 'rose' : t.priority === 'normal' ? 'amber' : 'gray'}>{t.priority}</Badge></td>
        <td><Badge tone={TICKET_TONE[t.status]}>{t.status.replace('_', ' ')}</Badge>{t.assignedTo && <p className={s.small}>{t.assignedTo}</p>}</td>
        <td><span className={s.small}>{t.reportedBy || '—'}<br />{String(t.createdAt).slice(0, 16)}</span></td>
        <td>{can('hotel.maintenance') && TICKET_NEXT[t.status]?.length ? <div className={s.actions}>{TICKET_NEXT[t.status].map((next) => <button key={next} className={next === 'resolved' ? s.primary : s.secondary} disabled={busy} onClick={() => setUpdating({ ticket: t, status: next })}>{TICKET_ACTION[next]}</button>)}</div> : <span className={s.small}>{t.resolvedAt ? String(t.resolvedAt).slice(0, 16) : 'Maintenance staff'}</span>}</td>
      </tr>)}</tbody></table></div>}
    </Panel>
    {reporting && <IssueForm onClose={() => setReporting(false)} />}
    {updating && <TicketForm ticket={updating.ticket} status={updating.status} onClose={() => setUpdating(null)} />}
  </>;
}

const minutesBetween = (a, b) => (a && b ? Math.round((Date.parse(String(b).replace(' ', 'T') + 'Z') - Date.parse(String(a).replace(' ', 'T') + 'Z')) / 60000) : null);

export function Housekeeping() {
  const { state, act, busy, can } = useHotel();
  const [floor, setFloor] = useState('all');
  const [error, setError] = useState('');
  const [mine, setMine] = useState(false);
  const [modal, setModal] = useState(null);
  let me = null;
  if (typeof window !== 'undefined') { try { me = JSON.parse(localStorage.getItem('pos_user') || '{}').id; } catch { me = null; } }
  const stages = [['dirty', 'To clean', 'Start cleaning'], ['cleaning', 'In progress', 'Send for inspection'], ['inspection', 'To inspect', 'Inspect & mark ready'], ['ready', 'Completed', null]];
  const tasks = state.tasks.filter((task) => (floor === 'all' || state.rooms.find((r) => r.id === task.roomId)?.floor === Number(floor)) && (!mine || task.assignedTo === me));
  const done = state.tasks.filter((t) => t.status === 'ready' && t.completedAt && t.taskType !== 'stayover');
  const avg = done.length ? Math.round(done.reduce((sum, t) => sum + (minutesBetween(t.createdAt, t.completedAt) || 0), 0) / done.length) : null;
  const occupied = state.bookings.filter((b) => b.status === 'in_house');
  const run = async (action) => { setError(''); const result = await act(action); if (!result.ok) setError(result.error); };
  return <>
    <Kpis items={[{ label: 'Needs cleaning', value: String(state.tasks.filter((t) => t.status === 'dirty').length), hint: `${state.tasks.filter((t) => t.taskType === 'stayover' && t.status !== 'ready').length} stayover / requests`, icon: BedDouble }, { label: 'In progress', value: String(state.tasks.filter((t) => t.status === 'cleaning').length), hint: 'Cleaning underway', icon: Clock3 }, { label: 'Awaiting inspection', value: String(state.tasks.filter((t) => t.status === 'inspection').length), hint: 'Supervisor review needed', icon: Search }, { label: 'Avg turnaround', value: avg == null ? '—' : `${avg} min`, hint: `${done.length} turnover(s) completed`, icon: CheckCircle2 }]} />
    <div className={s.toolbar}><div className={s.filters}>{[['all', 'All floors'], ...[...new Set(state.rooms.map((room) => room.floor))].sort((a, b) => a - b).map((value) => [String(value), `Floor ${value}`])].map(([key, label]) => <button className={`${s.filter} ${floor === key ? s.selectedFilter : ''}`} key={key} aria-pressed={floor === key} onClick={() => setFloor(key)}>{label}</button>)}</div><span className={s.small}><Users size={14} className="inline mr-2" />Turnovers, stayovers and guest requests</span><div className={s.actions}><label className={s.checkLabel}><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />My tasks</label>{can('hotel.housekeeping') && <button className={s.secondary} onClick={() => setModal('minibar')}><GlassWater size={14} />Minibar</button>}<button className={s.secondary} onClick={() => setModal('stayover')}><Sparkles size={14} />Stayover</button><button className={s.secondary} onClick={() => setModal('issue')}><Wrench size={14} />Report issue</button></div></div>
    {error && <p role="alert" className={s.error}>{error}</p>}
    {occupied.some((b) => state.rooms.find((r) => r.id === b.roomId)?.hkFlag) && <p className={s.formNote}><Moon size={13} className="inline mr-1" />{occupied.filter((b) => state.rooms.find((r) => r.id === b.roomId)?.hkFlag).map((b) => { const r = state.rooms.find((x) => x.id === b.roomId); return `${r.id}: ${r.hkFlag === 'dnd' ? 'Do not disturb' : 'Pickup requested'}`; }).join(' · ')}</p>}
    <div className={s.board}>{stages.map(([status, label, action]) => <section className={s.lane} key={status}><h2 className={s.laneTitle}>{label}<span className={s.count}>{tasks.filter((t) => t.status === status).length}</span></h2>{tasks.filter((t) => t.status === status).map((task) => { const room = state.rooms.find((r) => r.id === task.roomId); const stayover = task.taskType === 'stayover'; return <article className={s.task} key={task.id}><div className={s.roomTop}><strong className={s.roomNumber}>{task.roomId}</strong><Badge tone={task.priority === 'High' ? 'rose' : stayover ? 'blue' : 'gray'}>{stayover ? 'Stayover' : task.priority}</Badge></div><div className={s.small}>{room?.type}{room?.hkFlag === 'dnd' ? ' · DND' : ''} · {task.taskType}</div><p>{task.note}</p>{can('hotel.front_desk') && task.status !== 'ready' ? <label className={s.small}>Assigned to<select aria-label={`Assign room ${task.roomId}`} value={task.assignedTo || ''} disabled={busy} onChange={(e) => run({ type: 'assign_task', id: task.id, userId: e.target.value || null })}><option value="">Unassigned</option>{(state.housekeepers || []).map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></label> : <div className={s.person}><span className={s.avatar}>{task.assignee.slice(0, 1)}</span><span className={s.name}>{task.assignee}</span></div>}{action ? <button className={s.secondary} disabled={busy} onClick={() => run({ type: 'clean', id: task.id, version: task.version })}>{stayover ? (status === 'dirty' ? 'Start service' : 'Service done') : action}<ArrowRight size={13} /></button> : <div className="mt-4"><Badge tone="green">{stayover ? 'Serviced' : `Ready${minutesBetween(task.createdAt, task.completedAt) != null ? ` · ${minutesBetween(task.createdAt, task.completedAt)} min` : ''}`}</Badge></div>}</article>; })}{!tasks.some((t) => t.status === status) && <p className={s.small}>No rooms in this stage.</p>}</section>)}</div>
    {modal === 'minibar' && <MinibarForm onClose={() => setModal(null)} />}
    {modal === 'issue' && <IssueForm onClose={() => setModal(null)} />}
    {modal === 'stayover' && <Modal title="Stayover service / guest request" onClose={() => setModal(null)}><form className={s.form} onSubmit={async (event) => { event.preventDefault(); const f = Object.fromEntries(new FormData(event.currentTarget)); const result = await act({ type: f.flag ? 'room_flag' : 'stayover', roomId: f.roomId, note: f.note, flag: f.flag }); if (result.ok) setModal(null); else setError(result.error); }}>
      <label>Room<select name="roomId" required defaultValue="">{[<option key="" value="" disabled>Choose an occupied room</option>, ...occupied.map((b) => <option key={b.id} value={b.roomId}>{b.roomId} · {b.guest}</option>)]}</select></label>
      <label>Request<input name="note" maxLength={200} placeholder="e.g. Extra towels, turndown" /></label>
      <label>Or set a flag<select name="flag" defaultValue=""><option value="">No flag (service request)</option><option value="dnd">Do not disturb</option><option value="pickup">Pickup requested</option></select></label>
      <div className={s.actions}><button type="button" className={s.secondary} onClick={() => setModal(null)}>Cancel</button><button className={s.primary} disabled={busy}>Save</button></div>
    </form></Modal>}
  </>;
}
