'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Plus } from 'lucide-react';
import { money } from '@/lib/hotel/view';
import { Badge, Modal, useHotel } from './workspace';
import s from './hotel.module.css';

function RoomServiceSetup() {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const enable = async () => {
    setBusy(true);
    try {
      const response = await fetch('/api/hotel/room-service', { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('pos_token') || ''}` } });
      const data = await response.json();
      setMessage(response.ok ? data.message : data.error || 'Could not set up room service.');
    } finally { setBusy(false); }
  };
  return <section className={s.panel}>
    <div className={s.panelHeader}><h2 className={s.panelTitle}>Room service QR</h2><button className={s.secondary} disabled={busy} onClick={enable}>Create QR codes for all rooms</button></div>
    <div className={s.panelBody}>
      <p className={s.formNote}>Each room gets a “Room 101”-style table in the restaurant (section Room service) with its own QR code. Guests scan it in the room and order from the menu; orders go to the kitchen like any QR order, and are accepted only while a guest is checked in. Settle the bill in POS with <strong>Charge to room</strong>.</p>
      {message && <p role="status" className={`${s.small} mt-3`}>{message} <Link className={s.textButton} href="/admin/table-management">Open Table Management<ArrowRight size={13} /></Link></p>}
    </div>
  </section>;
}

function RatesSetup() {
  const { state, act, busy, confirm } = useHotel();
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // 'season' | 'plan' | plan object
  const types = [...new Set(state.rooms.map((room) => room.type))];
  const editPlan = typeof modal === 'object' ? modal : null;
  const open = (value) => { setError(''); setModal(value); };
  const submit = (type) => async (event) => {
    event.preventDefault(); setError('');
    const result = await act({ type, ...Object.fromEntries(new FormData(event.currentTarget)) });
    if (result.ok) setModal(null); else setError(result.error);
  };
  const remove = async (type, id, name) => {
    if (!(await confirm({ title: `Remove ${name}?`, message: 'New bookings stop using it. Existing bookings keep their prices.', confirmLabel: 'Remove', danger: true }))) return;
    setError(''); const result = await act({ type, id }); if (!result.ok) setError(result.error);
  };
  const actions = (label) => <div className={s.actions}><button type="button" className={s.secondary} disabled={busy} onClick={() => setModal(null)}>Cancel</button><button className={s.primary} disabled={busy}>{busy ? 'Saving…' : label}</button></div>;
  return <section className={s.panel}>
    <div className={s.panelHeader}><h2 className={s.panelTitle}>Seasons & rate plans</h2></div>
    <div className={s.panelBody}>
      <p className={s.formNote}>Each night is priced when the booking is made: room tariff ± the matching season, plus the rate plan’s nightly supplement. A room-type season beats an all-rooms season. Existing bookings keep their prices.</p>
      {error && !modal && <p className={s.error} role="alert">{error}</p>}
      <div className={`${s.actions} justify-between mt-4`}><h3 className={s.name}>Seasons</h3><button className={s.secondary} disabled={busy} onClick={() => open('season')}><Plus size={14} />Add season</button></div>
      <div className={s.tableScroll}><table className={s.table}><thead><tr><th>Season</th><th>Dates</th><th>Rooms</th><th>Adjustment</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
        {state.seasons.map((season) => <tr key={season.id}><td>{season.name}</td><td>{season.start} → {season.end}</td><td>{season.roomType || 'All rooms'}</td><td>{season.adjustBps > 0 ? '+' : ''}{season.adjustBps / 100}%</td><td><button className={s.textButton} disabled={busy} onClick={() => remove('season_delete', season.id, season.name)}>Remove</button></td></tr>)}
      </tbody></table>{!state.seasons.length && <p className={s.empty}>No seasons. Tariffs apply all year.</p>}</div>
      <div className={`${s.actions} justify-between mt-6`}><h3 className={s.name}>Rate plans (meal plans)</h3><button className={s.secondary} disabled={busy} onClick={() => open('plan')}><Plus size={14} />Add plan</button></div>
      <div className={s.tableScroll}><table className={s.table}><thead><tr><th>Plan</th><th>Supplement per room-night</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
        {state.plans.map((plan) => <tr key={plan.name}><td>{plan.name}</td><td>{money(plan.supplementCents / 100)}</td><td>{plan.id && <div className={s.actions}><button className={s.textButton} disabled={busy} onClick={() => open(plan)}>Edit</button><button className={s.textButton} disabled={busy} onClick={() => remove('plan_delete', plan.id, plan.name)}>Remove</button></div>}</td></tr>)}
      </tbody></table></div>
      <p className={s.small}>Until you add a plan, bookings offer Room only and Breakfast included at no supplement.</p>
    </div>
    {modal === 'season' && <Modal title="Add season" onClose={() => setModal(null)}><form className={s.form} onSubmit={submit('season')}>
      <div className={s.formRow}><label>Name<input name="name" required maxLength={60} placeholder="e.g. Dashain peak" /></label><label>Adjustment (%)<input name="percent" type="number" min="-90" max="500" step="0.01" required placeholder="e.g. 25 or -15" /></label></div>
      <div className={s.formRow}><label>From<input name="start" type="date" required /></label><label>To<input name="end" type="date" required /></label></div>
      <label>Room type<select name="roomType" defaultValue=""><option value="">All rooms</option>{types.map((type) => <option key={type}>{type}</option>)}</select></label>
      {error && <p className={s.error} role="alert">{error}</p>}
      {actions('Add season')}
    </form></Modal>}
    {(modal === 'plan' || editPlan) && <Modal title={editPlan ? `Edit ${editPlan.name}` : 'Add rate plan'} onClose={() => setModal(null)}><form className={s.form} onSubmit={submit('plan')}>
      <div className={s.formRow}><label>Plan name<input name="name" required maxLength={60} placeholder="e.g. Half board" defaultValue={editPlan?.name} readOnly={Boolean(editPlan)} /></label><label>Supplement per night (NPR)<input name="supplement" type="number" min="0" step="0.01" required defaultValue={editPlan ? editPlan.supplementCents / 100 : 0} /></label></div>
      {editPlan && <p className={s.formNote}>Only new bookings use the new supplement.</p>}
      {error && <p className={s.error} role="alert">{error}</p>}
      {actions(editPlan ? 'Save plan' : 'Add plan')}
    </form></Modal>}
  </section>;
}

export default function HotelSetup() {
  const { state, act, busy } = useHotel();
  const [error, setError] = useState('');
  return <div className={s.stack}>
    <section className={s.panel}><div className={s.panelHeader}><h2 className={s.panelTitle}>Property details</h2><Badge tone="green">Saved records</Badge></div><form className={s.form} onSubmit={async (event) => {
      event.preventDefault(); setError('');
      const fields = new FormData(event.currentTarget);
      const result = await act({ type: 'property', name: fields.get('name'), taxPercent: fields.get('taxPercent') });
      if (!result.ok) setError(result.error);
    }}><label>Hotel name<input name="name" key={state.property.name} required maxLength={100} defaultValue={state.property.name} /></label><label>Room & extra service tax (%)<input name="taxPercent" key={state.property.roomTaxPercent} type="number" min="0" max="100" step="0.01" required defaultValue={state.property.roomTaxPercent} /></label><p className={s.formNote}>The configured tax rate applies to new reservations. Existing stays keep their saved tax rate. Rates entered for rooms and extra services are before tax.</p><div className={s.actions}><span className={s.small}>Currency: NPR · Timezone: Asia/Kathmandu</span><button className={s.secondary} disabled={busy}>Save property</button></div></form></section>
    {error && <p className={s.error} role="alert">{error}</p>}
    <section className={s.panel}><div className={s.panelBody}><p className={s.subtitle}>Rooms and room categories have their own page.</p><Link className={s.textButton} href="/admin/hotel/room-setup">Open Rooms & categories<ArrowRight size={14} /></Link></div></section>
    <RatesSetup />
    <RoomServiceSetup />
  </div>;
}
