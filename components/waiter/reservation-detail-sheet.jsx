'use client';

import { useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Phone, Users, Clock, MapPin, Star, History,
} from 'lucide-react';
import ReservationTimeline from '@/components/waiter/reservation-timeline';
import {
  formatTimeRemaining,
  specialRequestLabels,
  buildSuggestions,
} from '@/lib/waiter-reservations';
import { formatCalendarDate } from '@/lib/calendar-system.js';

/** Client-ness never changes after hydration, so there is nothing to subscribe to. */
const subscribeNoop = () => () => {};

export default function ReservationDetailSheet({
  open,
  reservation: r,
  tables = [],
  customerHistory = null,
  graceMinutes = 20,
  busy = false,
  onClose,
  onAssign,
  onSeat,
  onCheckIn,
  onCall,
  onCancel,
  onNoShow,
  onEdit,
  onOpenOrder,
  onLoadHistory,
}) {
  // createPortal needs `document`; useSyncExternalStore answers "am I on the
  // client yet" without a setState-in-effect round trip.
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);

  const [editOpen, setEditOpen] = useState(false);
  // `null` means "not edited yet", so the value shown falls back to the booking.
  // Copying props into state in an effect meant the form rendered once with the
  // *previous* booking's values before the effect corrected it — visible as a
  // flash of the last-opened reservation when switching between two.
  const [draft, setDraft] = useState(null);

  // Reset the draft when the sheet opens for a different booking. Adjusting
  // state during render is React's documented pattern for this.
  const openFor = r ? String(r.id ?? '') : null;
  const [lastOpenFor, setLastOpenFor] = useState(openFor);
  if (openFor !== lastOpenFor) {
    setLastOpenFor(openFor);
    setDraft(null);
    setEditOpen(false);
  }

  const partySize = draft?.partySize ?? (r?.party_size || 2);
  const notes = draft?.notes ?? (r?.admin_notes || '');
  const message = draft?.message ?? (r?.message || '');
  const patchDraft = (patch) => setDraft((d) => ({ partySize, notes, message, ...d, ...patch }));
  const setPartySize = (v) => patchDraft({ partySize: typeof v === 'function' ? v(partySize) : v });
  const setNotes = (v) => patchDraft({ notes: typeof v === 'function' ? v(notes) : v });
  const setMessage = (v) => patchDraft({ message: typeof v === 'function' ? v(message) : v });

  if (!open || !mounted || !r) return null;

  const timing = formatTimeRemaining(r, new Date(), graceMinutes);
  const requests = specialRequestLabels(r);
  const tips = buildSuggestions(r, tables);

  return createPortal(
    <div className="fixed inset-0 z-[180]">
      <button type="button" className="absolute inset-0 bg-slate-900/45" aria-label="Close" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-100 px-4 py-3 flex items-start justify-between gap-2 z-10">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Reservation #{r.id}</p>
            <h2 className="text-xl font-semibold text-slate-900 flex items-center gap-1.5">
              {!!r.is_vip && <Star className="w-4 h-4 text-amber-500" />}
              {r.name}
            </h2>
            <p className={`text-xs font-semibold mt-0.5 ${timing.late ? 'text-orange-700' : 'text-slate-500'}`}>
              {timing.label} · {r.status}
            </p>
          </div>
          <button type="button" onClick={onClose} className="h-9 w-9 rounded-xl flex items-center justify-center hover:bg-slate-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-slate-400">Phone</dt>
              <dd className="font-medium">{r.phone}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Guests</dt>
              <dd className="font-medium flex items-center gap-1">
                <Users className="w-3.5 h-3.5" /> {r.party_size || r.guests}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">When</dt>
              <dd className="font-medium flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" /> {formatCalendarDate(r.date)} {r.time || ''}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Table</dt>
              <dd className="font-medium flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" />
                {r.table_number ? `T${r.table_number}` : 'Not assigned'}
              </dd>
            </div>
          </dl>

          {requests.length > 0 && (
            <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 text-sm text-slate-700">
              {requests.join(' · ')}
            </div>
          )}

          {tips.length > 0 && (
            <ul className="text-xs text-amber-900 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 space-y-1">
              {tips.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}

          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Journey</p>
            <ReservationTimeline reservation={r} />
          </div>

          {editOpen && (
            <div className="rounded-xl border border-slate-200 p-3 space-y-2">
              <label className="block text-xs text-slate-500">
                Party size
                <input
                  type="number"
                  min={1}
                  value={partySize}
                  onChange={(e) => setPartySize(Number(e.target.value) || 1)}
                  className="mt-1 w-full h-10 rounded-lg border border-slate-200 px-2"
                />
              </label>
              <label className="block text-xs text-slate-500">
                Guest requests
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5"
                />
              </label>
              <label className="block text-xs text-slate-500">
                Staff notes
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5"
                />
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  onEdit?.(r, {
                    party_size: partySize,
                    message,
                    admin_notes: notes,
                  })
                }
                className="w-full h-10 rounded-xl bg-slate-900 text-white text-sm font-semibold"
              >
                Save changes
              </button>
            </div>
          )}

          {customerHistory && (
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs text-slate-600">
              <p className="font-semibold text-slate-800 flex items-center gap-1 mb-1">
                <History className="w-3.5 h-3.5" /> Customer history
              </p>
              <p>
                {customerHistory.total_visits || 0} visits · spent Rs{' '}
                {Number(customerHistory.total_spent || 0).toFixed(0)}
              </p>
              {customerHistory.notes && <p className="mt-1">{customerHistory.notes}</p>}
              {customerHistory.is_vip ? <p className="text-amber-800 font-medium mt-1">VIP on file</p> : null}
            </div>
          )}

          <div className="flex flex-col gap-2 pb-2">
            {r.status === 'confirmed' && (
              <SheetBtn onClick={() => onCheckIn?.(r)} className="bg-amber-600 text-white" disabled={busy}>
                Customer arrived
              </SheetBtn>
            )}
            {['new', 'confirmed', 'arrived'].includes(r.status) && (
              <SheetBtn onClick={() => onAssign?.(r)} className="bg-slate-900 text-white" disabled={busy}>
                {r.table_id ? 'Change table' : 'Assign table'}
              </SheetBtn>
            )}
            {['confirmed', 'arrived'].includes(r.status) && (
              <SheetBtn
                onClick={() => onSeat?.(r)}
                className="bg-violet-600 text-white"
                disabled={busy || !r.table_id}
              >
                Seat guest
              </SheetBtn>
            )}
            {r.status === 'seated' && r.order_id && (
              <SheetBtn onClick={() => onOpenOrder?.(r)} className="bg-violet-600 text-white">
                Open active order
              </SheetBtn>
            )}
            {r.status === 'seated' && (
              <SheetBtn onClick={() => onCancel?.(r)} className="bg-red-50 text-red-700">
                Cancel seating / release table
              </SheetBtn>
            )}
            <div className="grid grid-cols-2 gap-2">
              <SheetBtn onClick={() => onCall?.(r)} className="bg-slate-100 text-slate-800">
                <Phone className="w-3.5 h-3.5 inline mr-1" />
                Call
              </SheetBtn>
              <SheetBtn onClick={() => setEditOpen((v) => !v)} className="bg-slate-100 text-slate-800">
                Edit
              </SheetBtn>
              <SheetBtn onClick={() => onLoadHistory?.(r)} className="bg-slate-100 text-slate-800">
                History
              </SheetBtn>
              {['confirmed', 'arrived'].includes(r.status) && (
                <SheetBtn onClick={() => onNoShow?.(r)} className="bg-orange-50 text-orange-900">
                  No-show
                </SheetBtn>
              )}
            </div>
            {['new', 'confirmed', 'arrived'].includes(r.status) && (
              <SheetBtn onClick={() => onCancel?.(r)} className="bg-red-50 text-red-700">
                Cancel reservation
              </SheetBtn>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function SheetBtn({ children, className = '', onClick, disabled }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`w-full h-11 rounded-xl text-sm font-semibold disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}
