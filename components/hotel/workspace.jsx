'use client';

import { createContext, useContext, useCallback, useEffect, useId, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { CalendarDays, Check, Hotel, Plus, X } from 'lucide-react';
import { hotelPageFor } from './pages';
import { money, nightsBetween, roomAvailable, shortDate } from '@/lib/hotel/view';
import { useCapabilities } from '@/lib/use-capabilities';
import s from './hotel.module.css';

const HotelContext = createContext(null);
export const useHotel = () => useContext(HotelContext);

export function Badge({ children, tone = 'gray' }) {
  return <span className={`${s.badge} ${s[tone]}`}>{children}</span>;
}

export function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const trigger = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);
  return <dialog ref={ref} className={`${s.dialog} ${wide ? s.wideDialog : ''}`} aria-labelledby={titleId} onCancel={onClose} onClick={(event) => { if (event.target === ref.current) onClose(); }}>
    <div className={s.dialogHead}><h2 id={titleId}>{title}</h2><button className={s.iconButton} onClick={onClose} aria-label="Close dialog"><X size={18} /></button></div>
    {children}
  </dialog>;
}

// Rendered as a native dialog so it stacks above any open hotel Modal.
function ConfirmModal({ title, message, confirmLabel = 'Confirm', danger = false, onResult }) {
  return <Modal title={title} onClose={() => onResult(false)}><div className={s.form}>
    {message && <p className={s.formNote}>{message}</p>}
    <div className={s.actions}><button type="button" className={s.secondary} onClick={() => onResult(false)}>Cancel</button><button type="button" autoFocus className={danger ? s.danger : s.primary} onClick={() => onResult(true)}>{confirmLabel}</button></div>
  </div></Modal>;
}

/**
 * New reservation, or (addTo = an open stay) "Add room" for the same guest:
 * the new room joins the master reservation and the payer decides routing.
 */
export function BookingForm({ onClose, addTo = null }) {
  const { state, act, busy, can } = useHotel();
  const date = state.businessDate;
  const [start, setStart] = useState(addTo ? (addTo.start > date ? addTo.start : date) : date);
  const [end, setEnd] = useState(addTo ? addTo.end : new Date(Date.parse(date) + 86400000).toISOString().slice(0, 10));
  const [bookingType, setBookingType] = useState('confirmed');
  const [error, setError] = useState('');
  const available = state.rooms.filter((room) => bookingType === 'waitlist' ? !room.blocked : roomAvailable(state, room.id, start, end));
  return <Modal title={addTo ? `Add a room for ${addTo.guest}` : 'New reservation'} onClose={onClose} wide>
    <form className={s.form} onSubmit={async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const data = Object.fromEntries(form);
      data.roomIds = form.getAll('roomIds');
      if (!data.roomIds.length) { setError('Choose at least one room.'); return; }
      if (addTo) data.groupId = addTo.groupId || addTo.id;
      const result = await act({ type: 'book', ...data });
      if (result.ok) onClose(); else setError(result.error);
    }}>
      {addTo
        ? <div className={s.formNote}>Linked to {addTo.groupId ? `master reservation ${addTo.groupId}` : `${addTo.id} (becomes a master reservation)`}. The guest’s existing stay, folio and room are not changed.</div>
        : <div className={s.formNote}>Each night is priced with the room tariff, seasons and the rate plan when you save.</div>}
      {!addTo && <div className={s.formRow}><label>Guest name<input name="guest" required maxLength={100} placeholder="e.g. Anjali Gurung" autoComplete="name" /></label><label>Guest phone<input name="phone" type="tel" maxLength={30} /></label></div>}
      {addTo && <label>Guest name for this room (optional)<input name="guest" maxLength={100} placeholder={`${addTo.guest} (same guest profile)`} /></label>}
      <div className={s.formRow}>
        <label>Arrival<input type="date" name="start" required min={date} value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label>Departure<input type="date" name="end" required min={start} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
      </div>
      <fieldset key={`${start}-${end}-${bookingType}`} className={s.roomPicker}><legend>{bookingType === 'waitlist' ? 'Rooms (waitlist holds no inventory)' : 'Available rooms · select one or more'}</legend>{available.map((room) => <label key={room.id} className={s.checkLabel}><input type="checkbox" name="roomIds" value={room.id} />{room.id} · {room.type} · up to {room.capacity} · {money(room.rate)} / night</label>)}</fieldset>
      {!available.length && <p className={s.error}>No rooms available for these dates.</p>}
      <div className={s.formRow}>
        <label>Adults per room<select name="adults" defaultValue="2">{Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        <label>Children per room<select name="children" defaultValue="0">{Array.from({ length: 7 }, (_, i) => i).map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
      </div>
      <div className={s.formRow}>
        <label>Rate plan<select name="meal">{(state.plans || []).map((plan) => <option key={plan.name} value={plan.name}>{plan.name}{plan.supplementCents ? ` (+${money(plan.supplementCents / 100)} / night)` : ''}{plan.components?.length ? ` · ${plan.components.map((c) => c.label).join(' + ')}` : ''}</option>)}</select></label>
        <label>Status<select name="bookingType" value={bookingType} onChange={(e) => setBookingType(e.target.value)}>{(state.bookingTypes || ['tentative', 'confirmed', 'guaranteed', 'waitlist']).map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}</select></label>
      </div>
      {addTo && <label>Who pays for this room<select name="payer" defaultValue="master"><option value="master">Same master payer (all charges to {addTo.guest}’s folio)</option><option value="master_rooms">Master pays room charges; guest pays extras</option><option value="own">Separate payer (own folio)</option></select></label>}
      <div className={s.formRow}>
        <label>Source<select name="source" defaultValue={addTo?.source || 'Direct'}>{(state.sources || ['Direct', 'Walk-In', 'Phone', 'Booking.com', 'Agoda', 'Airbnb']).map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>Market segment<select name="segment" defaultValue={addTo?.segment || ''}>{(state.segments || ['']).map((x) => <option key={x} value={x}>{x || 'Not set'}</option>)}</select></label>
      </div>
      <div className={s.formRow}>
        <label>Company<input name="company" maxLength={100} defaultValue={addTo?.company || ''} /></label>
        <label>Travel agent<input name="agent" maxLength={100} defaultValue={addTo?.agent || ''} /></label>
      </div>
      <label>Payment guarantee<input name="guarantee" maxLength={100} placeholder="e.g. Advance deposit, company letter, card on file" /></label>
      <label>Special requests<textarea name="specialRequests" rows={2} maxLength={500} placeholder="e.g. High floor, extra pillows, airport pickup" /></label>
      <label>Internal notes<textarea name="notes" rows={2} maxLength={1000} /></label>
      {can('hotel.rate_override') && <label>Nightly rate override (NPR, optional)<input name="rate" type="number" min="0" step="0.01" placeholder="Leave empty for the room tariff" /><span className={s.small}>Overrides are audited and the owner is alerted.</span></label>}
      <p className={s.small}>{addTo ? 'Uses the same guest profile.' : 'A guest profile is matched by name and phone, or created. Add ID documents under Guests.'} {Math.max(0, nightsBetween(start, end)) || 0} night(s).</p>
      {error && <p role="alert" className={s.error}>{error}</p>}
      <div className={s.actions}><button type="button" className={s.secondary} onClick={onClose} disabled={busy}>Cancel</button><button className={s.primary} disabled={!available.length || busy}>{busy ? 'Saving…' : addTo ? 'Add room' : 'Save reservation'}</button></div>
    </form>
  </Modal>;
}

// Loads saved hotel records and exposes them (plus act/refresh) to hotel screens. Also used by the Settings page.
export function HotelProvider({ children, extra }) {
  const [state, setState] = useState(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(true);
  const busyRef = useRef(true);
  const [loadError, setLoadError] = useState('');
  const pending = useRef(null);
  const [confirmBox, setConfirmBox] = useState(null);
  const { can } = useCapabilities();
  // await confirm({ title, message, confirmLabel, danger }) -> true | false
  const confirm = useCallback((options) => new Promise((resolve) => setConfirmBox({ ...options, resolve })), []);
  const getState = useCallback(async () => {
    const response = await fetch('/api/hotel', { headers: { Authorization: `Bearer ${localStorage.getItem('pos_token') || ''}` }, cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load hotel records.');
    setState(data.state);
  }, []);
  const refresh = useCallback(async () => {
    setBusy(true); busyRef.current = true; setLoadError('');
    try { await getState(); } catch (error) { setLoadError(error.message); }
    finally { setBusy(false); busyRef.current = false; }
  }, [getState]);
  useEffect(() => { void Promise.resolve().then(refresh); }, [refresh]);
  const act = async (action) => {
    if (busyRef.current) return { ok: false, error: 'An update is already in progress.' };
    busyRef.current = true; setBusy(true);
    try {
      const payload = JSON.stringify(action);
      if (pending.current?.payload !== payload) pending.current = { payload, key: crypto.randomUUID() };
      const response = await fetch('/api/hotel', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('pos_token') || ''}`, 'Idempotency-Key': pending.current.key }, body: payload });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save this update.');
      pending.current = null;
      setNotice(data.message);
      try { await getState(); } catch (error) { setLoadError(`Update saved. ${error.message}`); }
      return { ok: true, data };
    } catch (error) { return { ok: false, error: error.message }; }
    finally { busyRef.current = false; setBusy(false); }
  };
  const value = { state, act, busy, refresh, can, confirm, ...extra };
  return <HotelContext.Provider value={value}>
    {loadError ? <div role="alert" className={s.error}>{loadError}<button className={s.textButton} onClick={refresh}>Retry loading hotel records</button></div> : !state ? <div role="status" className={s.empty}>Loading hotel records…</div> : children}
    {confirmBox && <ConfirmModal {...confirmBox} onResult={(ok) => { confirmBox.resolve(ok); setConfirmBox(null); }} />}
    {notice && <div className={s.notice} role="status"><Check size={17} /><span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={15} /></button></div>}
  </HotelContext.Provider>;
}

function WorkspaceHeader({ current, onBook }) {
  const { state, busy, refresh, can } = useHotel();
  return <header className={s.header}>
    <div><p className={s.eyebrow}>{state.property?.name || 'Your hotel'}</p><h1 className={s.title}>{current.title}</h1><p className={s.subtitle}>{current.description}</p></div>
    <div className={s.actions}><span className={s.date}><CalendarDays size={15} />{shortDate(state.businessDate)} {state.businessDate.slice(0, 4)}</span><button className={s.secondary} disabled={busy} onClick={refresh}>Refresh</button>{current.booking && can('hotel.front_desk') && <button className={s.primary} disabled={busy} onClick={(event) => { event.currentTarget.focus(); onBook(); }}><Plus size={16} /> New reservation</button>}</div>
  </header>;
}

export default function HotelWorkspace({ children }) {
  const [bookingOpen, setBookingOpen] = useState(false);
  const current = hotelPageFor(usePathname());
  return <section className={s.workspace} aria-label="Hotel management workspace">
    <HotelProvider extra={{ openBooking: (addTo = null) => setBookingOpen(addTo && addTo.id ? addTo : true) }}>
      <WorkspaceHeader current={current} onBook={() => setBookingOpen(true)} />
      {children}
      <p className={`${s.small} mt-6 flex items-center gap-2`}><Hotel size={13} />Saved hotel records · Asia/Kathmandu · All amounts in NPR</p>
      {bookingOpen && <BookingForm addTo={bookingOpen === true ? null : bookingOpen} onClose={() => setBookingOpen(false)} />}
    </HotelProvider>
  </section>;
}
