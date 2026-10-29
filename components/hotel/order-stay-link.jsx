'use client';

import { useCallback, useEffect, useState } from 'react';
import { BedDouble } from 'lucide-react';
import { apiJson, authedRequest } from '@/lib/authed-fetch';

/**
 * "In-house guest · Room 203" badge for a restaurant order, with a picker to
 * link or unlink the hotel stay. Linking never forces room billing; the guest
 * can still pay cash, QR or card. Hidden when the hotel is not available.
 */
export function StayLink({ kind = 'order', id: orderId, compact = false }) {
  const listKey = kind === 'order' ? 'orders' : 'reservations';
  const [badge, setBadge] = useState(null);
  const [stays, setStays] = useState(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!orderId) { setBadge(null); return; }
    try { const data = await apiJson(`/api/hotel/links?${listKey}=${orderId}`); setBadge(data[listKey]?.[orderId] || null); } catch { setBadge(null); }
  }, [orderId, listKey]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  const pick = async (stayId) => {
    setError('');
    const res = await authedRequest('/api/hotel/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(kind === 'order' ? { type: 'order', orderId, stayId: stayId || null } : { type: 'reservation', reservationId: orderId, stayId: stayId || null }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error || 'Could not link the guest.'); return; }
    setOpen(false); await load();
  };
  if (!orderId) return null;
  return <span className="relative inline-flex items-center gap-1">
    {badge ? <button type="button" onClick={() => setOpen(!open)} className="inline-flex items-center gap-1 rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-bold text-teal-800"><BedDouble className="h-3 w-3" />IN-HOUSE · Room {badge.room} · {badge.guest}</button>
      : <button type="button" onClick={async () => { setOpen(!open); if (!stays) { try { setStays((await apiJson('/api/hotel/links?stays=1')).stays); } catch (e) { setError(e.message); } } }} className="inline-flex items-center gap-1 rounded-full border border-teal-200 px-2 py-0.5 text-[10px] font-semibold text-teal-700"><BedDouble className="h-3 w-3" />{compact ? 'Hotel guest?' : 'Link hotel guest'}</button>}
    {open && <span className="absolute left-0 top-6 z-50 w-64 rounded-xl border border-gray-200 bg-white p-2 text-xs shadow-lg">
      {badge && <button type="button" className="mb-1 w-full rounded px-2 py-1 text-left text-red-700 hover:bg-red-50" onClick={() => pick(null)}>Remove hotel guest link</button>}
      {!badge && (stays === null ? <span className="block px-2 py-1 text-gray-500">Loading…</span> : !stays.length ? <span className="block px-2 py-1 text-gray-500">No in-house guests.</span>
        : stays.map((s) => <button key={s.id} type="button" className="block w-full rounded px-2 py-1 text-left hover:bg-teal-50" onClick={() => pick(s.id)}>Room {s.room} · {s.guest}<span className="block text-[10px] text-gray-500">{s.meal}</span></button>))}
      {error && <span className="block px-2 py-1 text-red-600">{error}</span>}
    </span>}
  </span>;
}

export default function OrderStayLink({ orderId, compact = false }) {
  return <StayLink kind="order" id={orderId} compact={compact} />;
}
