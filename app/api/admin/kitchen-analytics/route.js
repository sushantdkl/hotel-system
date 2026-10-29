import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { kitchenAnalytics } from '@/lib/kitchen-analytics.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier', 'kitchen'], permission: 'kitchen_analytics.view' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    return NextResponse.json(await kitchenAnalytics(db));
  } catch (error) {
    return handleRouteError(error, 'Failed to load kitchen analytics');
  }
}
