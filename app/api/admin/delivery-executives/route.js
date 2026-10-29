import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { listDeliveryExecutives, createDeliveryExecutive } from '@/lib/delivery.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'delivery.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const search = new URL(request.url).searchParams.get('search') || '';
    const executives = await listDeliveryExecutives(db, { search });
    return NextResponse.json({ executives });
  } catch (error) {
    return handleRouteError(error, 'Could not load delivery executives.');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'delivery.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const body = await request.json();
    const executive = await createDeliveryExecutive(db, body);
    return NextResponse.json({ message: 'Delivery executive added.', executive }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Could not add delivery executive.');
  }
}
