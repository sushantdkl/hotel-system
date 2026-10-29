'use client';

import { Phone, Users, Clock, MapPin, Star } from 'lucide-react';
import { StayLink } from '@/components/hotel/order-stay-link';
import {
  formatTimeRemaining,
  specialRequestLabels,
  buildSuggestions,
} from '@/lib/waiter-reservations';

const STATUS_BADGE = {
  new: 'bg-sky-100 text-sky-800',
  confirmed: 'bg-emerald-100 text-emerald-800',
  arrived: 'bg-amber-100 text-amber-900',
  seated: 'bg-violet-100 text-violet-800',
  completed: 'bg-slate-100 text-slate-600',
  cancelled: 'bg-red-100 text-red-700',
  no_show: 'bg-orange-100 text-orange-800',
};

/**
 * Compact reservation card for waiter board.
 */
export default function ReservationCard({
  reservation: r,
  tables = [],
  graceMinutes = 20,
  // No `Date.now()` default: reading the clock during render makes the render
  // impure (two renders with identical props produce different output, and SSR
  // cannot match hydration). Both call sites already pass a ticking `now` from
  // parent state, so the default was dead weight hiding a real hazard.
  now,
  onOpen,
  onAssign,
  onSeat,
  onCheckIn,
  onCall,
  onCancel,
  onNoShow,
  onEdit,
  onOpenOrder,
}) {
  const timing = formatTimeRemaining(r, new Date(now), graceMinutes);
  const requests = specialRequestLabels(r);
  const tips = buildSuggestions(r, tables, new Date(now));
  const badge = STATUS_BADGE[r.status] || STATUS_BADGE.confirmed;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-3.5 shadow-sm space-y-2.5">
      <button type="button" onClick={() => onOpen?.(r)} className="w-full text-left">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-slate-900 truncate">
              {r.is_vip ? <Star className="w-3.5 h-3.5 inline text-amber-500 mr-0.5" /> : null}
              {r.name}
            </p>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3 h-3" /> {r.time || '—'}
              </span>
              <span className="inline-flex items-center gap-1">
                <Users className="w-3 h-3" /> {r.party_size || r.guests}
              </span>
              <span className="inline-flex items-center gap-1">
                <Phone className="w-3 h-3" /> {r.phone}
              </span>
              <span
                className={`inline-flex items-center gap-1 font-medium ${
                  r.table_number ? 'text-emerald-700' : 'text-amber-700'
                }`}
              >
                <MapPin className="w-3 h-3" />
                {r.table_number ? `T${r.table_number}` : 'Not assigned'}
              </span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold capitalize ${badge}`}>
              {r.status}
            </span>
            <span
              className={`text-[11px] font-semibold ${
                timing.late ? 'text-orange-700' : 'text-slate-500'
              }`}
            >
              {timing.label}
            </span>
          </div>
        </div>
        {requests.length > 0 && (
          <p className="text-[11px] text-slate-400 mt-1.5 line-clamp-2">{requests.join(' · ')}</p>
        )}
        {tips.length > 0 && (
          <p className="text-[11px] text-amber-800 mt-1 bg-amber-50 rounded-lg px-2 py-1">
            {tips[0]}
          </p>
        )}
      </button>
      <StayLink kind="reservation" id={r.id} compact />

      <div className="flex flex-wrap gap-1.5 pt-0.5">
        {['new', 'confirmed'].includes(r.status) && (
          <Action onClick={() => onCheckIn?.(r)} className="bg-amber-600 text-white">
            Arrived
          </Action>
        )}
        {['new', 'confirmed', 'arrived'].includes(r.status) && !r.table_id && (
          <Action onClick={() => onAssign?.(r)} className="bg-slate-900 text-white">
            Assign table
          </Action>
        )}
        {['new', 'confirmed', 'arrived'].includes(r.status) && r.table_id && (
          <>
            <Action onClick={() => onSeat?.(r)} className="bg-violet-600 text-white">
              Seat guest
            </Action>
            <Action onClick={() => onAssign?.(r)} className="bg-slate-100 text-slate-800">
              Change table
            </Action>
          </>
        )}
        {r.status === 'seated' && r.order_id && (
          <Action onClick={() => onOpenOrder?.(r)} className="bg-violet-600 text-white">
            Open table
          </Action>
        )}
        {r.status === 'seated' && (
          <Action onClick={() => onCancel?.(r)} className="bg-red-50 text-red-700">
            Cancel seating
          </Action>
        )}
        {['new', 'confirmed', 'arrived'].includes(r.status) && (
          <>
            <Action onClick={() => onCall?.(r)} className="bg-slate-100 text-slate-800">
              Call
            </Action>
            <Action onClick={() => onEdit?.(r)} className="bg-slate-100 text-slate-800">
              Edit
            </Action>
            <Action onClick={() => onCancel?.(r)} className="bg-red-50 text-red-700">
              Cancel
            </Action>
          </>
        )}
        {['new', 'confirmed', 'arrived'].includes(r.status) && (
          <Action onClick={() => onNoShow?.(r)} className="bg-orange-50 text-orange-900">
            No-show
          </Action>
        )}
      </div>
    </div>
  );
}

function Action({ children, onClick, className = '' }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold ${className}`}
    >
      {children}
    </button>
  );
}
