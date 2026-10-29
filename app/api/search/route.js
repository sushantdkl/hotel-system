import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensurePermissionCache } from '@/lib/permissions.js';
import { globalSearch } from '@/lib/global-search.js';

export const dynamic = 'force-dynamic';

/** GET ?q= — permission-filtered search across guests, stays, rooms, invoices, bills, orders, tables, customers, suppliers, staff. */
export async function GET(request) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensurePermissionCache(db);
    return NextResponse.json(await globalSearch(db, auth.user, new URL(request.url).searchParams.get('q')), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return handleRouteError(error, 'Search failed.'); }
}
