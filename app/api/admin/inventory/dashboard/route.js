import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { resolvePeriodRange } from '@/lib/report-dates.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { composeInventoryDashboard } from '@/lib/inventory-dashboard.js';

/**
 * GET /api/admin/inventory/dashboard
 * Read-only inventory overview. Reuses inventory_items, thresholds and the
 * stock-movement ledger. Query: period, startDate, endDate, category, status, search.
 */
export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'inventory.dashboard.view' });
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const range = resolvePeriodRange(
      searchParams.get('period') || 'week',
      searchParams.get('startDate'),
      searchParams.get('endDate'),
      { calendarSystem: searchParams.get('calendarSystem') }
    );

    const db = Database.getInstance();
    const data = await composeInventoryDashboard(db, {
      range,
      category: searchParams.get('category') || null,
      status: searchParams.get('status') || null,
      search: (searchParams.get('search') || '').trim() || null,
    });
    return NextResponse.json(data);
  } catch (error) {
    return handleRouteError(error, 'Failed to build the inventory dashboard.');
  }
}
