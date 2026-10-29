import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { folioLinkForBill, linkOrderToStay, linkTableReservationToStay, listRoomServiceOrders, stayBadges, updateRoomService } from '@/lib/hotel/links.js';
import { listChargeableStays } from '@/lib/hotel/room-charges.js';

export const dynamic = 'force-dynamic';
const RESTAURANT_OR_HOTEL = ['pos.access', 'pos.charge_to_room', 'reservations.access', 'order_desk.access', 'hotel.front_desk', 'hotel.folios'];

/**
 * GET ?bill=<id>                 folio link for a restaurant bill
 * GET ?orders=1,2&reservations=3 in-house badges
 * GET ?roomService=1             room-service delivery board
 * GET ?stays=1&q=203             in-house guests (link picker)
 */
export async function GET(request) {
  try {
    const auth = await requireAuth(request, { anyPermissions: RESTAURANT_OR_HOTEL });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const url = new URL(request.url);
    const list = (key) => (url.searchParams.get(key) || '').split(',').filter(Boolean);
    let body;
    if (url.searchParams.get('bill')) body = { link: await folioLinkForBill(db, Number(url.searchParams.get('bill'))) };
    else if (url.searchParams.get('roomService')) body = { orders: await listRoomServiceOrders(db) };
    else if (url.searchParams.get('stays')) body = { stays: await listChargeableStays(db, { query: url.searchParams.get('q') || '', outlet: url.searchParams.get('outlet') === 'room_service' ? 'room_service' : 'restaurant' }) };
    else body = await stayBadges(db, { orderIds: list('orders'), reservationIds: list('reservations') });
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return handleRouteError(error, 'Could not load hotel links.'); }
}

/** POST { type: 'order' | 'reservation' | 'room_service', ... } */
export async function POST(request) {
  try {
    const auth = await requireAuth(request, { anyPermissions: RESTAURANT_OR_HOTEL });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const data = await request.json();
    if (data?.type === 'order') return NextResponse.json(await linkOrderToStay(db, auth.user, { orderId: data.orderId, stayId: data.stayId || null }));
    if (data?.type === 'reservation') return NextResponse.json(await linkTableReservationToStay(db, auth.user, { reservationId: data.reservationId, stayId: data.stayId || null }));
    if (data?.type === 'room_service') return NextResponse.json(await updateRoomService(db, auth.user, { orderId: data.orderId, status: data.status || null, requestedTime: data.requestedTime }));
    return NextResponse.json({ error: 'Unknown link type.' }, { status: 400 });
  } catch (error) { return handleRouteError(error, 'Could not save the hotel link.'); }
}
