'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, Plus, Printer, ReceiptText, Undo2, ArrowLeftRight, BedDouble, Utensils } from 'lucide-react';
import { authedRequest } from '@/lib/authed-fetch';
import { balance, money, shortDate, SOURCE_LABEL } from '@/lib/hotel/view';
import { folioHtml, printHtml, printStatement } from '@/lib/hotel/statement';
import { Badge, Modal, useHotel } from './workspace';
import s from './hotel.module.css';

const TONE = { charge: 'gray', credit: 'violet', payment: 'green', refund: 'amber' };
const KIND = { charge: 'Charge', credit: 'Credit', payment: 'Payment', refund: 'Refund' };
const SIGN = { charge: '', refund: '', credit: '−', payment: '−' };

// Room move (reason + rate decision) or new dates for a confirmed / in-house stay.
export function StayChangeForm({ booking, mode, onClose }) {
  const { act, busy, state, can } = useHotel();
  const [error, setError] = useState('');
  const [target, setTarget] = useState('');
  const inHouse = booking.status === 'in_house';
  const rooms = state.rooms.filter((room) => room.id !== booking.roomId && !room.blocked && room.capacity >= booking.guests && (!inHouse || room.cleaning === 'ready'));
  const current = state.rooms.find((r) => r.id === booking.roomId);
  const chosen = state.rooms.find((r) => r.id === target);
  const typeChanges = chosen && current && chosen.type !== current.type;
  const upgrade = chosen && current && chosen.rate > current.rate;
  return <Modal title={mode === 'move' ? `Move ${booking.guest}` : 'Extend or shorten stay'} onClose={onClose}>
    <form className={s.form} onSubmit={async (event) => {
      event.preventDefault();
      const result = await act({ type: mode === 'move' ? 'move' : 'change_dates', id: booking.id, ...Object.fromEntries(new FormData(event.currentTarget)) });
      if (result.ok) onClose(); else setError(result.error);
    }}>
      <div><strong>{booking.guest}</strong><p className={s.small}>Room {booking.roomId} · {booking.roomType} · {shortDate(booking.start)} → {shortDate(booking.end)} · {money(booking.rate)} / night</p></div>
      {mode === 'move' ? <>
        <label>New room<select name="roomId" required value={target} onChange={(e) => setTarget(e.target.value)}><option value="" disabled>Choose a room</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.id} · {room.type} · {money(room.rate)} / night</option>)}</select></label>
        <label>Reason<select name="reason" required defaultValue=""><option value="" disabled>Choose the reason</option>{(state.moveReasons || []).map((r) => <option key={r}>{r}</option>)}</select></label>
        <fieldset className={s.roomPicker}><legend>Rate for the remaining nights</legend>
          <label className={s.checkLabel}><input type="radio" name="rateDecision" value="keep" defaultChecked />Keep the original rate ({money(booking.rate)}){typeChanges && upgrade && !can('hotel.comp_upgrade') ? ' · needs complimentary-upgrade permission' : ''}</label>
          <label className={s.checkLabel}><input type="radio" name="rateDecision" value="new" />Use the new room’s rate{chosen ? ` (${money(chosen.rate)} tariff + plan)` : ''}</label>
        </fieldset>
        <label>Notes<textarea name="notes" rows={2} maxLength={500} placeholder="e.g. AC not cooling; guest informed" /></label>
        <p className={s.formNote}>{inHouse ? 'Only inspected, ready rooms are listed. The vacated room goes to housekeeping.' : 'Availability for the whole stay is checked on save.'} The guest, folio, payments, restaurant charges and meal plan stay with this stay. The move is kept in the room-move history.</p>
      </> : <div className={s.formRow}>
        <label>Arrival<input type="date" name="start" defaultValue={booking.start} disabled={inHouse} min={inHouse ? undefined : state.businessDate} /></label>
        <label>Departure<input type="date" name="end" required defaultValue={booking.end} min={state.businessDate} /></label>
      </div>}
      {mode !== 'move' && <p className={s.formNote}>Added nights are priced with today’s tariff, seasons and the rate plan. Early departure: set departure to today, then check out.</p>}
      {error && <p role="alert" className={s.error}>{error}</p>}
      <div className={s.actions}><button className={s.secondary} type="button" disabled={busy} onClick={onClose}>Cancel</button><button className={s.primary} disabled={busy || (mode === 'move' && !rooms.length)}>{busy ? 'Saving…' : mode === 'move' ? 'Move guest' : 'Save dates'}</button></div>
    </form>
  </Modal>;
}

const titles = { payment: 'Record guest payment', deposit: 'Record advance deposit', refund: 'Refund guest credit', charge: 'Add charge', adjust: 'Post allowance', checkout: 'Review & check out', reverse: 'Reverse charge', transfer: 'Transfer charge', window: 'Folio window payer', route: 'Billing routing' };

export function FolioForm({ booking, mode, entry = null, onClose }) {
  const { act, busy, state } = useHotel();
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [method, setMethod] = useState('Cash');
  const isDeposit = mode === 'payment' && booking.status === 'confirmed';
  const credit = Math.max(0, -balance(booking));
  const windows = [1, 2, 3, 4];
  const openStays = state.bookings.filter((b) => b.id !== booking.id && ['in_house', 'confirmed'].includes(b.status));
  const payerOf = (w) => booking.windows?.find((x) => x.window === w);
  const due = (w) => booking.windowBalances?.[w] || 0;
  return <Modal title={isDeposit ? titles.deposit : titles[mode]} onClose={onClose}>
    <form className={s.form} onSubmit={async (event) => {
      event.preventDefault();
      const fields = Object.fromEntries(new FormData(event.currentTarget));
      if (mode === 'route') fields.sourceTypes = new FormData(event.currentTarget).getAll('sourceTypes');
      const result = await act({ ...fields, type: mode, id: booking.id, revision: booking.folioRevision, entryId: entry?.id });
      if (result.ok) onClose(); else setError(result.error);
    }}>
      <div><strong>{booking.guest}</strong><p className={s.small}>Room {booking.roomId} · {booking.id}</p></div>
      {mode === 'checkout' && <>
        <div className={s.formNote}>Departure today: {shortDate(state.businessDate)} · reserved until {shortDate(booking.end)}.<br />Before checkout: all due nights posted, every window settled. On checkout the advance deposit is applied, unused meal allowance is closed, the invoice is finalized, the room goes to Dirty and a cleaning task is created.</div>
        <div className={s.total}><span>Balance</span><span>{money(balance(booking))}</span></div>
        {booking.depositHeld > 0 && <p className={s.small}>Deposit held {money(booking.depositHeld)} is applied to the bill.</p>}
        <label className={s.checkLabel}><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} required />Confirm this guest is departing today.</label>
      </>}
      {(mode === 'payment' || mode === 'refund') && <>
        <div className={s.formNote}>{mode === 'refund' ? `Record money already returned. Credit available: ${money(credit)}. A held deposit is refunded from the deposit liability.` : isDeposit ? 'Record an advance deposit already received. It is held as a guest deposit (liability) and applied to the bill at checkout.' : 'Record money already received. Card, Bank and Online post to the primary bank. City Ledger bills the window to a company or travel agent account (receivable).'}</div>
        <div className={s.formRow}>
          <label>Method<select name="method" value={method} onChange={(e) => setMethod(e.target.value)}>{(mode === 'refund' || isDeposit ? ['Cash', 'Online', 'Card', 'Bank'] : state.paymentMethods || ['Cash', 'Online']).map((m) => <option key={m}>{m}</option>)}</select></label>
          {mode === 'payment' && !isDeposit && <label>Window<select name="window" defaultValue="1">{windows.filter((w) => w === 1 || due(w)).map((w) => <option key={w} value={w}>Window {w}{payerOf(w) ? ` · ${payerOf(w).payerName || payerOf(w).payerType}` : ''} · {money(due(w))}</option>)}</select></label>}
        </div>
        {method === 'City Ledger' && <label>Company / agent account<input name="account" required maxLength={100} defaultValue={payerOf(2)?.payerName || booking.company || ''} /></label>}
        <label>Amount (NPR)<input name="amount" type="number" min="0.01" step="0.01" required defaultValue={mode === 'refund' ? credit : isDeposit ? undefined : Math.max(0, due(1))} /></label>
        {mode === 'refund' && <label>Reason<input name="reason" required maxLength={200} placeholder="e.g. Deposit returned on cancellation" /></label>}
      </>}
      {mode === 'charge' && <>
        <div className={s.formRow}>
          <label>Charge type<select name="sourceType" defaultValue="OTHER">{(state.chargeSources || []).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
          <label>Quantity<input name="quantity" type="number" min="1" max="100" defaultValue="1" /></label>
        </div>
        <label>Description<input name="description" required maxLength={120} placeholder={booking.status === 'confirmed' ? 'e.g. Cancellation fee' : 'e.g. Airport transfer'} /></label>
        <label>Unit price before tax (NPR)<input name="amount" type="number" min="0.01" step="0.01" required /></label>
        <p className={s.formNote}>Tax {booking.taxPercent}% is added. Billing routing (if set) decides which folio receives it. Restaurant and room-service bills come from the POS with Charge to Room.</p>
      </>}
      {mode === 'adjust' && <>
        <p className={s.formNote}>An allowance is a credit (with tax reversed) against a department, e.g. a service-recovery discount. It needs a reason, is audited and alerts the owner.</p>
        <div className={s.formRow}>
          <label>Applies to<select name="sourceType" defaultValue="ROOM">{[{ key: 'ROOM', label: 'Room' }, ...(state.chargeSources || [])].map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
          <label>Amount incl. tax (NPR)<input name="amount" type="number" min="0.01" step="0.01" max={Math.max(0.01, balance(booking))} required /></label>
        </div>
        <label>Reason<input name="reason" required maxLength={200} /></label>
      </>}
      {mode === 'reverse' && entry && <>
        <div className={s.formNote}>Reverses #{entry.id} {entry.label} ({money(entry.amount)}) with a credit row and a mirror journal. The original stays on the folio. Post the corrected charge afterwards if needed.</div>
        <label>Reason<input name="reason" required maxLength={200} autoFocus /></label>
      </>}
      {mode === 'transfer' && entry && <>
        <div className={s.formNote}>Moves #{entry.id} {entry.label} ({money(entry.amount)}) to another window or room. It is not new revenue; only the guest receivable moves. Both sides stay visible and audited.</div>
        <div className={s.formRow}>
          <label>To stay<select name="targetId" defaultValue={booking.id}><option value={booking.id}>This folio (another window)</option>{openStays.map((b) => <option key={b.id} value={b.id}>Room {b.roomId} · {b.guest}</option>)}</select></label>
          <label>Window<select name="window" defaultValue={entry.window === 1 ? 2 : 1}>{windows.map((w) => <option key={w} value={w}>Window {w}</option>)}</select></label>
        </div>
        <label>Reason<input name="reason" required maxLength={200} /></label>
      </>}
      {mode === 'window' && <>
        <div className={s.formRow}>
          <label>Window<select name="window" defaultValue="2">{windows.map((w) => <option key={w} value={w}>Window {w}</option>)}</select></label>
          <label>Paid by<select name="payerType" defaultValue="company"><option value="guest">Guest</option><option value="company">Company</option><option value="agent">Travel agent</option><option value="master">Master / organizer</option></select></label>
        </div>
        <label>Payer name<input name="payerName" maxLength={100} defaultValue={booking.company || ''} /></label>
      </>}
      {mode === 'route' && <>
        <p className={s.formNote}>New charges of the chosen types post to the target folio and window automatically (e.g. a family room billed to the master, or room charges to the company window). Existing charges stay where they are; use Transfer for those.</p>
        <div className={s.formRow}>
          <label>Send to<select name="targetId" defaultValue={booking.routing?.targetId || booking.id}><option value={booking.id}>This folio</option>{openStays.map((b) => <option key={b.id} value={b.id}>Room {b.roomId} · {b.guest}</option>)}</select></label>
          <label>Window<select name="window" defaultValue={booking.routing?.window || 2}>{windows.map((w) => <option key={w} value={w}>Window {w}</option>)}</select></label>
        </div>
        <fieldset className={s.roomPicker}><legend>Charge types (none = all)</legend>{[{ key: 'ROOM', label: 'Room nights' }, ...(state.chargeSources || []), { key: 'RESTAURANT', label: 'Restaurant' }, { key: 'ROOM_SERVICE', label: 'Room service' }].map((c) => <label key={c.key} className={s.checkLabel}><input type="checkbox" name="sourceTypes" value={c.key} defaultChecked={booking.routing?.types?.includes(c.key)} />{c.label}</label>)}</fieldset>
        {booking.routing && <label className={s.checkLabel}><input type="checkbox" name="clear" value="1" />Remove routing (charges post to this room again)</label>}
      </>}
      {error && <div role="alert" className={s.error}>{error}{/business|session/i.test(error) && <Link className={s.textButton} href="/admin/business-days">Open Opening & Closing<ArrowRight size={13} /></Link>}</div>}
      <div className={s.actions}><button className={s.secondary} type="button" disabled={busy} onClick={onClose}>Cancel</button><button className={mode === 'reverse' ? s.danger : s.primary} disabled={busy || (mode === 'checkout' && !confirmed)}>{busy ? 'Saving…' : mode === 'checkout' ? 'Finalize checkout' : titles[mode] || 'Save'}</button></div>
    </form>
  </Modal>;
}

async function printInvoice(stayId, setError) {
  const response = await authedRequest('/api/hotel/invoice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stayId }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { setError(data.error || 'Could not print the invoice.'); return; }
  try { printStatement(data.statement, { copy: data.copy }); } catch (printError) { setError(printError.message); }
}

export default function LiveFolios({ initialId }) {
  const { state, act, busy, can, openBooking } = useHotel();
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [win, setWin] = useState('all');
  const bookings = state.bookings.filter((b) => ['in_house', 'checked_out'].includes(b.status) || (b.status === 'confirmed' && (b.payments.length || b.entries.length)));
  const booking = bookings.find((item) => item.id === (selected || initialId)) || bookings[0];
  if (!booking) return <div className={s.panel}><div className={s.empty}><ReceiptText size={28} className="mx-auto mb-4" /><h2 className={s.panelTitle}>No guest folios yet</h2><p className={s.subtitle}>Check a guest in, or take a deposit, to start a folio.</p><Link href="/admin/hotel/reservations" className={s.textButton}>Open reservations<ArrowRight size={14} /></Link></div></div>;
  const active = booking.status === 'in_house';
  const open = active || booking.status === 'confirmed';
  const pending = booking.unpostedNights.length;
  const rows = [...booking.entries, ...booking.payments].sort((a, b) => a.id - b.id).filter((r) => win === 'all' || String(r.window) === win);
  const usedWindows = [...new Set([1, ...booking.entries.map((e) => e.window), ...booking.payments.map((e) => e.window), ...(booking.windows || []).map((w) => w.window)])].sort();
  const payer = (w) => booking.windows?.find((x) => x.window === w);
  const charges = booking.entries.reduce((sum, e) => sum + (e.kind === 'credit' ? -1 : 1) * e.amount, 0);
  const tax = booking.entries.reduce((sum, e) => sum + (e.kind === 'credit' ? -1 : 1) * e.tax, 0);
  const paid = booking.payments.reduce((sum, e) => sum + (e.kind === 'refund' ? -1 : 1) * e.amount, 0);
  const run = async (action) => { setError(''); const result = await act(action); if (!result.ok) setError(result.error); };
  const link = (entry) => (entry.sourceType === 'RESTAURANT' || entry.sourceType === 'ROOM_SERVICE') && entry.sourceId ? <Link className={s.textButton} href={`/admin/bills?bill=${entry.sourceId}`}><Utensils size={12} />Open restaurant bill</Link> : null;
  return <div className={s.folioLayout}>
    <div className={`${s.panel} ${s.folioList}`}>{bookings.map((item) => <button className={s.folioChoice} key={item.id} aria-pressed={item.id === booking.id} onClick={() => { setSelected(item.id); setError(''); setWin('all'); }}><div className={s.person}><span className={s.avatar}>{item.initials}</span><div><strong className={s.name}>{item.guest}</strong><p className={s.small}>Room {item.roomId} · {shortDate(item.start)}</p></div></div><div className={`${s.actions} mt-3`}><Badge tone={item.status === 'checked_out' ? 'gray' : item.status === 'confirmed' ? 'violet' : item.unpostedNights.length ? 'amber' : balance(item) ? 'amber' : 'green'}>{item.status === 'checked_out' ? 'Checked out' : item.status === 'confirmed' ? `Arriving · ${money(balance(item))}` : item.unpostedNights.length ? 'Room nights to post' : balance(item) ? money(balance(item)) : 'Settled'}</Badge>{item.routing && <Badge tone="blue">Routed to {item.routing.targetRoom}</Badge>}</div></button>)}</div>
    <section className={s.panel}>
      <div className={s.panelHeader}><h2 className={s.panelTitle}>Guest folio / {booking.id}</h2><div className={s.actions}>{booking.groupId && <Badge tone="blue">{booking.groupId}</Badge>}<Badge tone={active ? 'blue' : booking.status === 'confirmed' ? 'violet' : 'gray'}>{active ? 'In house' : booking.status === 'confirmed' ? 'Not arrived' : 'Checked out'}</Badge></div></div>
      <div className={s.folioSummary}>
        <div><span className={s.small}>Guest</span><strong>{booking.guestId ? <Link href={`/admin/hotel/guests?guest=${booking.guestId}`}>{booking.guest}</Link> : booking.guest}</strong></div>
        <div><span className={s.small}>Room</span><strong>{booking.roomId} · {booking.roomType}</strong></div>
        <div><span className={s.small}>Stay</span><strong>{shortDate(booking.start)} → {shortDate(booking.end)}</strong></div>
        <div><span className={s.small}>Rate / plan</span><strong>{money(booking.rate)} + {booking.taxPercent}% · {booking.meal}</strong></div>
        <div><span className={s.small}>Deposit held</span><strong>{money(booking.depositHeld || 0)}</strong></div>
        {booking.creditLimit != null && <div><span className={s.small}>Credit limit</span><strong>{money(booking.creditLimit)}</strong></div>}
        {booking.company && <div><span className={s.small}>Company</span><strong>{booking.company}</strong></div>}
      </div>
      {booking.routing && <div className={s.pendingCharges}><div><strong>Charges route to room {booking.routing.targetRoom}</strong><p className={s.small}>{booking.routing.types.includes('*') ? 'All charges' : booking.routing.types.map((t) => SOURCE_LABEL[t] || t).join(', ')} · window {booking.routing.window}</p></div></div>}
      {pending > 0 && <div className={s.pendingCharges}><div><strong>{pending} room night(s) ready to post</strong><p className={s.small}>{money(booking.unpostedAmount)} including tax · first-night minimum, then elapsed nights. Night audit posts them automatically.</p></div><button disabled={busy} className={s.secondary} onClick={() => run({ type: 'post_nights', id: booking.id })}>Post room nights</button></div>}
      <div className={`${s.toolbar} ${s.panelBody}`}><div className={s.filters}>
        <button className={`${s.filter} ${win === 'all' ? s.selectedFilter : ''}`} aria-pressed={win === 'all'} onClick={() => setWin('all')}>All windows<span className={s.count}>{money(balance(booking))}</span></button>
        {usedWindows.map((w) => <button key={w} className={`${s.filter} ${win === String(w) ? s.selectedFilter : ''}`} aria-pressed={win === String(w)} onClick={() => setWin(String(w))}>Window {w}{payer(w) ? ` · ${payer(w).payerName || payer(w).payerType}` : w === 1 ? ' · guest' : ''}<span className={s.count}>{money(booking.windowBalances?.[w] || 0)}</span></button>)}
      </div></div>
      <div className={s.tableScroll}><table className={s.table}><thead><tr><th>Date / description</th><th>Source</th><th>Type</th><th className={s.right}>Amount (NPR)</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{rows.map((entry) => <tr key={entry.id}>
        <td>{entry.label}<p className={s.small}>{shortDate(entry.date)} · #{entry.id}{entry.room && entry.room !== booking.roomId ? ` · room ${entry.room}` : ''}{entry.window > 1 ? ` · window ${entry.window}` : ''}{entry.tax ? ` · tax ${money(entry.tax)}` : ''}{entry.packageAmount ? ` · meal plan ${money(entry.packageAmount)}` : ''}{entry.reason ? ` · ${entry.reason}` : ''}</p>{link(entry)}</td>
        <td><Badge tone="gray">{SOURCE_LABEL[entry.sourceType] || entry.sourceType}</Badge></td>
        <td><Badge tone={TONE[entry.kind]}>{entry.reversed ? 'Reversed / moved' : KIND[entry.kind]}</Badge></td>
        <td className={s.right}>{SIGN[entry.kind]}{money(entry.amount)}</td>
        <td>{open && entry.kind === 'charge' && !entry.reversed && <div className={s.actions}>
          {can('hotel.folio_adjust') && !['RESTAURANT', 'ROOM_SERVICE'].includes(entry.sourceType) && !entry.transferRef && <button className={s.textButton} title="Reverse" onClick={() => setForm({ mode: 'reverse', entry })}><Undo2 size={13} />Reverse</button>}
          {can('hotel.folio_transfer') && <button className={s.textButton} title="Transfer" onClick={() => setForm({ mode: 'transfer', entry })}><ArrowLeftRight size={13} />Transfer</button>}
        </div>}</td>
      </tr>)}</tbody></table>{!rows.length && <div className={s.empty}>No transactions{win !== 'all' ? ' in this window' : ''}.</div>}</div>
      {booking.packageUsage?.length > 0 && <div className={s.panelBody}><strong className={s.small}>Meal plan used (covered by the room rate, not charged again)</strong><ul className={s.activity}>{booking.packageUsage.map((u, i) => <li key={i}><CheckCircle2 size={13} /><span>{shortDate(u.date)} · {u.label} · {u.outlet.replace('_', ' ')}{u.bill ? ` · bill ${u.bill}` : ''} · {money(u.amount)}</span></li>)}</ul></div>}
      <div className={s.panelBody}><div className={`${s.actions} justify-between`}><span className={s.small}>Charges less credits</span><strong>{money(charges)}</strong></div><div className={`${s.actions} justify-between mt-3`}><span className={s.small}>of which tax</span><strong>{money(tax)}</strong></div><div className={`${s.actions} justify-between mt-3`}><span className={s.small}>Payments, deposits and city ledger (net of refunds)</span><strong>{money(paid)}</strong></div></div>
      <div className={s.total}><span>Balance due</span><span>{money(balance(booking))}</span></div>
      {error && <div className={`${s.error} m-5`} role="alert">{error}{/business|session/i.test(error) && <Link href="/admin/business-days" className={s.textButton}>Open Opening & Closing<ArrowRight size={13} /></Link>}</div>}
      {open ? <><div className={`${s.quick} ${s.panelBody}`}>
        <button className={s.primary} disabled={busy} onClick={() => setForm({ mode: 'payment' })}>{active ? 'Record payment' : 'Record deposit'}</button>
        <button className={s.secondary} disabled={busy} onClick={() => setForm({ mode: 'charge' })}><Plus size={14} />Add charge</button>
        {balance(booking) < 0 && <button className={s.secondary} disabled={busy} onClick={() => setForm({ mode: 'refund' })}>Refund credit</button>}
        {booking.depositHeld > 0 && active && <button className={s.secondary} disabled={busy} onClick={() => run({ type: 'apply_deposit', id: booking.id })}>Apply deposit now</button>}
        {can('hotel.folio_adjust') && <button className={s.secondary} disabled={busy} onClick={() => setForm({ mode: 'adjust' })}>Allowance</button>}
        <button className={s.secondary} disabled={busy} onClick={() => setForm({ mode: 'window' })}>Window payer</button>
        {can('hotel.folio_transfer') && <button className={s.secondary} disabled={busy} onClick={() => setForm({ mode: 'route' })}>Billing routing</button>}
        {active && <button className={s.secondary} disabled={busy} onClick={() => setForm({ mode: 'move' })}><BedDouble size={14} />Move room</button>}
        <button className={s.secondary} disabled={busy} onClick={() => setForm({ mode: 'dates' })}>Extend / shorten</button>
        <button className={s.secondary} disabled={busy} onClick={() => openBooking(booking)}>Add room</button>
        <button className={s.secondary} onClick={() => { try { printHtml(folioHtml({ property: state.property, booking })); } catch (e) { setError(e.message); } }}><Printer size={14} />Print folio</button>
        {active && <button className={s.primary} disabled={busy || pending > 0 || balance(booking) !== 0} onClick={() => setForm({ mode: 'checkout' })}>Check out guest<ArrowRight size={14} /></button>}
        {active && booking.groupId && <button className={s.secondary} disabled={busy} onClick={async () => { await run({ type: 'group_checkout', groupId: booking.groupId }); }}>Check out whole group</button>}
      </div><p className={s.note}>Every posting goes to the shared ledger and is audited. Posted rows are never edited: use Reverse, then post the corrected charge. <Link href="/admin/business-days" className="underline">Opening & Closing</Link> must have today’s business session open for financial postings.</p></>
        : <div className={s.panelBody}><div className={s.actions}><CheckCircle2 size={17} /><strong className={s.name}>Finalized · {booking.statement?.number}</strong><button className={s.secondary} disabled={!booking.statement} onClick={() => printInvoice(booking.id, setError)}><Printer size={14} />Print invoice</button></div><p className={s.small}>The first print is marked ORIGINAL, reprints DUPLICATE. The finalized invoice keeps its original details.</p></div>}
    </section>
    {form && (['move', 'dates'].includes(form.mode) ? <StayChangeForm booking={booking} mode={form.mode} onClose={() => setForm(null)} /> : <FolioForm booking={booking} mode={form.mode} entry={form.entry} onClose={() => setForm(null)} />)}
  </div>;
}
