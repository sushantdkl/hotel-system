import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import {
  listWaiterRequests,
  updateWaiterRequest,
  waiterRequestTypeLabel,
} from '@/lib/waiter-requests.js';

const ROLES = ['admin', 'cashier', 'waiter'];

function shape(row) {
  return {
    ...row,
    request_label: waiterRequestTypeLabel(row.request_type),
  };
}

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ROLES, permission: 'waiter_calls.access' });
    if (auth.error) return auth.error;
    const { searchParams } = new URL(request.url);
    const result = await listWaiterRequests(Database.getInstance(), {
      status: searchParams.get('status') || 'active',
      limit: searchParams.get('limit') || 100,
    });
    return NextResponse.json({ requests: result.rows.map(shape), counts: result.counts });
  } catch (error) {
    return handleRouteError(error, 'Could not load waiter calls.');
  }
}

export async function PATCH(request) {
  try {
    const auth = await requireAuth(request, { roles: ROLES, permission: 'waiter_calls.access' });
    if (auth.error) return auth.error;
    const body = await request.json();
    const updated = await updateWaiterRequest(Database.getInstance(), {
      id: body.id,
      action: body.action,
      actor: auth.user,
    });
    return NextResponse.json({ request: shape(updated) });
  } catch (error) {
    return handleRouteError(error, 'Could not update the waiter call.');
  }
}
