'use client';

import { useState } from 'react';
import { BedDouble, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { money, ROOM_STATES, roomState } from '@/lib/hotel/view';
import { Badge, Modal, useHotel } from './workspace';
import s from './hotel.module.css';

function CategoryForm({ category, onClose }) {
  const { act, busy } = useHotel();
  const [error, setError] = useState('');
  return <Modal title={category ? `Edit ${category.name}` : 'New room category'} onClose={onClose}><form className={s.form} onSubmit={async (event) => {
    event.preventDefault();
    const f = Object.fromEntries(new FormData(event.currentTarget));
    const result = await act({ type: 'category', id: category?.id, ...f, applyToRooms: f.applyToRooms === 'on' });
    if (result.ok) onClose(); else setError(result.error);
  }}>
    <label>Category name<input name="name" required maxLength={60} defaultValue={category?.name} placeholder="e.g. Deluxe King, Family Suite" /></label>
    <div className={s.formRow}>
      <label>Nightly price before tax (NPR)<input name="rate" type="number" min="0" max="1000000" step="0.01" required defaultValue={category?.rate} /></label>
      <label>Max guests<input name="capacity" type="number" min="1" max="20" required defaultValue={category?.capacity ?? 2} /></label>
    </div>
    <label>Beds<input name="beds" maxLength={60} defaultValue={category?.beds} placeholder="e.g. 1 king bed, 2 twin beds" /></label>
    <label>Amenities<input name="amenities" maxLength={300} defaultValue={category?.amenities} placeholder="e.g. AC, balcony, mountain view, bathtub" /></label>
    <label>Description<textarea name="description" rows={2} maxLength={300} defaultValue={category?.description} /></label>
    {category?.rooms > 0 && <label className={s.checkLabel}><input type="checkbox" name="applyToRooms" />Apply this price to its {category.rooms} room(s) (existing bookings keep their price)</label>}
    {error && <p className={s.error} role="alert">{error}</p>}
    <div className={s.actions}><button type="button" className={s.secondary} disabled={busy} onClick={onClose}>Cancel</button><button className={s.primary} disabled={busy}>{busy ? 'Saving…' : category ? 'Save category' : 'Add category'}</button></div>
  </form></Modal>;
}

function BulkRoomsForm({ onClose }) {
  const { state, act, busy } = useHotel();
  const [error, setError] = useState('');
  const categories = state.categories || [];
  return <Modal title="Add a range of rooms" onClose={onClose}><form className={s.form} onSubmit={async (event) => {
    event.preventDefault();
    const result = await act({ type: 'rooms_bulk', ...Object.fromEntries(new FormData(event.currentTarget)) });
    if (result.ok) onClose(); else setError(result.error);
  }}>
    <div className={s.formRow}>
      <label>Category<select name="categoryId" required>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>Floor<input name="floor" type="number" min="0" max="99" required defaultValue="1" /></label>
    </div>
    <div className={s.formRow}>
      <label>From number<input name="from" type="number" min="0" required placeholder="101" /></label>
      <label>To number<input name="to" type="number" min="0" required placeholder="110" /></label>
    </div>
    <label>Prefix (optional)<input name="prefix" maxLength={4} pattern="[A-Za-z0-9-]{0,4}" placeholder="e.g. A for A101" /></label>
    <p className={s.formNote}>Existing room numbers are skipped.</p>
    {error && <p className={s.error} role="alert">{error}</p>}
    <div className={s.actions}><button type="button" className={s.secondary} disabled={busy} onClick={onClose}>Cancel</button><button className={s.primary} disabled={busy}>{busy ? 'Saving…' : 'Add rooms'}</button></div>
  </form></Modal>;
}

function RoomForm({ room, onClose }) {
  const { state, act, busy } = useHotel();
  const [error, setError] = useState('');
  const categories = state.categories || [];
  const [categoryId, setCategoryId] = useState(categories.find((c) => c.name === room?.type)?.id || categories[0]?.id || '');
  const cat = categories.find((c) => c.id === categoryId);
  return <Modal title={room ? `Edit room ${room.id}` : 'Add a room'} onClose={onClose}><form className={s.form} onSubmit={async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const result = await act({ ...values, categoryId, type: room ? 'room_edit' : 'room', version: room?.version });
    if (result.ok) onClose(); else setError(result.error);
  }}>
    <div className={s.formRow}>
      <label>Room number<input name="roomId" required pattern="[A-Za-z0-9-]{1,12}" maxLength={12} placeholder="e.g. 101" defaultValue={room?.id} readOnly={Boolean(room)} /></label>
      <label>Floor<input name="floor" type="number" min="0" max="99" required defaultValue={room?.floor ?? 1} /></label>
    </div>
    <label>Category<select required value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>{categories.map((c) => <option key={c.id} value={c.id}>{c.name} · {money(c.rate)} · up to {c.capacity}</option>)}</select></label>
    <div className={s.formRow}>
      <label>Max guests<input name="capacity" type="number" min="1" max="20" key={`cap-${categoryId}`} defaultValue={room ? room.capacity : ''} placeholder={cat ? `${cat.capacity} (category)` : ''} /></label>
      <label>Nightly price (NPR)<input name="rate" type="number" min="0" max="1000000" step="0.01" key={`rate-${categoryId}`} defaultValue={room ? room.rate : ''} placeholder={cat ? `${cat.rate} (category)` : ''} /></label>
    </div>
    <p className={s.formNote}>Leave price or max guests empty to use the category’s. Prices are captured when a booking is made, so changing them never changes existing bookings.</p>
    {error && <p className={s.error} role="alert">{error}</p>}
    <div className={s.actions}><button type="button" className={s.secondary} disabled={busy} onClick={onClose}>Cancel</button><button className={s.primary} disabled={busy || !categoryId}>{busy ? 'Saving…' : room ? 'Save room' : 'Add room'}</button></div>
  </form></Modal>;
}

export default function RoomSetup() {
  const { state, act, busy, confirm } = useHotel();
  const [categoryForm, setCategoryForm] = useState(null);
  const [bulkForm, setBulkForm] = useState(false);
  const [roomForm, setRoomForm] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const categories = state.categories || [];
  const run = async (action, after) => { setError(''); const result = await act(action); if (result.ok) after?.(); else setError(result.error); return result.ok; };
  const ask = async (options, action) => { if (await confirm(options)) await run(action); };
  const updateStatus = (room, cleaning, blocked) => run({ type: 'room_status', roomId: room.id, version: room.version, cleaning, blocked: blocked ? 1 : 0 });
  const rooms = state.rooms.filter((r) => filter === 'all' || r.type === filter);

  return <div className={s.stack}>
    {error && <p className={s.error} role="alert">{error}</p>}

    <section className={s.panel}>
      <div className={s.panelHeader}><h2 className={s.panelTitle}>1 · Room categories<span className={s.count}>{categories.length}</span></h2><button className={s.primary} disabled={busy} onClick={() => setCategoryForm('new')}><Plus size={15} />New category</button></div>
      {!categories.length ? <div className={s.empty}>Start by creating a category, e.g. “Deluxe King” at NPR 4,500 for 2 guests. Then add its rooms.</div>
        : <div className={s.categoryGrid}>{categories.map((c) => <article key={c.id} className={s.categoryCard}>
          <div className={s.roomTop}><strong className={s.name}>{c.name}</strong><Badge tone={c.rooms ? 'green' : 'gray'}>{c.rooms} room{c.rooms === 1 ? '' : 's'}</Badge></div>
          <p className={s.kpiValue}>{money(c.rate)}<span className={s.small}> / night</span></p>
          <p className={s.small}><Users size={12} className="inline mr-1" />Up to {c.capacity} guests{c.beds ? ` · ${c.beds}` : ''}</p>
          {c.amenities && <p className={s.small}>{c.amenities}</p>}
          {c.description && <p className={s.small}>{c.description}</p>}
          <div className={`${s.actions} mt-3`}>
            <button className={s.secondary} disabled={busy} onClick={() => setCategoryForm(c)}><Pencil size={13} />Edit</button>
            {c.rooms === 0 && <button className={s.iconButton} aria-label={`Delete ${c.name}`} disabled={busy} onClick={() => ask({ title: `Delete ${c.name}?`, message: 'This room category is removed. It has no rooms, so no booking is affected.', confirmLabel: 'Delete', danger: true }, { type: 'category_delete', id: c.id })}><Trash2 size={15} /></button>}
          </div>
        </article>)}</div>}
    </section>

    {categories.length > 0 && <section className={s.panel}>
      <div className={s.panelHeader}><h2 className={s.panelTitle}>2 · Add rooms</h2><div className={s.actions}><button className={s.secondary} disabled={busy} onClick={() => setRoomForm('new')}><Plus size={14} />Add one room</button><button className={s.primary} disabled={busy} onClick={() => setBulkForm(true)}><Plus size={14} />Add range</button></div></div>
      <div className={s.panelBody}><p className={s.small}>Add one room, or a run of rooms at once, e.g. 101 to 110 on floor 1.</p></div>
    </section>}

    <section className={s.panel}>
      <div className={s.panelHeader}><h2 className={s.panelTitle}><BedDouble size={16} className="inline mr-2" />3 · All rooms<span className={s.count}>{state.rooms.length}</span></h2>
        <select aria-label="Filter by category" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All categories</option>{categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}</select></div>
      {!rooms.length ? <div className={s.empty}>No rooms yet.</div> : <div className={s.tableScroll}><table className={s.table}><thead><tr><th>Room</th><th>Category</th><th>Price</th><th>Status</th><th>Readiness</th><th>Availability</th><th>Details</th></tr></thead><tbody>{rooms.map((room) => {
        const status = roomState(state, room);
        const occupied = ['occupied', 'departure'].includes(status);
        const next = { ready: 'dirty', dirty: 'cleaning', cleaning: 'inspection', inspection: 'ready' }[room.cleaning];
        const label = { ready: 'Mark dirty', dirty: 'Start cleaning', cleaning: 'Send to inspection', inspection: 'Inspect & mark ready' }[room.cleaning];
        return <tr key={room.id}><td><strong>{room.id}</strong><p className={s.small}>Floor {room.floor}</p></td><td>{room.type}<p className={s.small}>Up to {room.capacity} guests</p></td><td>{money(room.rate)}</td><td><Badge tone={ROOM_STATES[status].tone}>{ROOM_STATES[status].label}</Badge></td><td><button className={s.textButton} disabled={busy || occupied || room.blocked} onClick={() => updateStatus(room, next, room.blocked)}>{label}</button></td><td><button className={s.textButton} disabled={busy || occupied} onClick={async () => { if (room.blocked || await confirm({ title: `Take room ${room.id} out of order?`, message: 'It cannot be booked or checked into until you put it back in service.', confirmLabel: 'Take out of order', danger: true })) await updateStatus(room, room.cleaning, !room.blocked); }}>{room.blocked ? 'Put back in service' : 'Take out of order'}</button></td><td><button className={s.textButton} disabled={busy} onClick={() => setRoomForm(room)}>Edit</button></td></tr>;
      })}</tbody></table></div>}
      <p className={s.note}>A room with reservations cannot be taken out of order. Occupied rooms cannot be turned over. Cleaning and inspection must finish before check-in.</p>
    </section>

    {categoryForm && <CategoryForm category={categoryForm === 'new' ? null : categoryForm} onClose={() => setCategoryForm(null)} />}
    {bulkForm && <BulkRoomsForm onClose={() => setBulkForm(false)} />}
    {roomForm && <RoomForm room={roomForm === 'new' ? null : roomForm} onClose={() => setRoomForm(null)} />}
  </div>;
}
