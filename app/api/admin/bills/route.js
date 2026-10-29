import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { listBills } from '@/lib/bills-admin.js';

/** GET /api/admin/bills — central bill list with tabs, search and filters. */
export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'waiter', 'cashier'], permission: 'bills.access' });
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const db = Database.getInstance();
    const data = await listBills(db, {
      tab: searchParams.get('tab') || 'all',
      search: (searchParams.get('search') || '').trim() || null,
      channel: searchParams.get('channel') || null,
      paymentMethod: searchParams.get('paymentMethod') || null,
      paymentStatus: searchParams.get('paymentStatus') || null,
      orderStatus: searchParams.get('orderStatus') || null,
      from: searchParams.get('from') || null,
      to: searchParams.get('to') || null,
      reopened: searchParams.get('reopened') === '1' ? true : null,
      page: Number(searchParams.get('page')) || 1,
      pageSize: Number(searchParams.get('pageSize')) || 25,
    });
    return NextResponse.json(data);
  } catch (error) {
    return handleRouteError(error, 'Failed to load bills.');
  }
}
