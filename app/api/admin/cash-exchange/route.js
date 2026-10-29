import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureAccountingSchema } from '@/lib/accounting.js';
import { listCashExchanges, recordCashExchange } from '@/lib/accounting-cash.js';
import { currentBusinessDayId } from '@/lib/business-days.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'cash_exchange.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureAccountingSchema(db);
    const rows = await listCashExchanges(db, { limit: 50 });
    return NextResponse.json({ exchanges: rows });
  } catch (error) {
    return handleRouteError(error, 'Failed to load exchanges');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'cash_exchange.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureAccountingSchema(db);
    const businessDayId = await currentBusinessDayId(db, { required: true });
    const result = await recordCashExchange(db, {
      ...(await request.json()), created_by: auth.user?.id || null, business_day_id: businessDayId,
    });
    return NextResponse.json({ message: 'Exchange recorded.', ...result }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to record exchange');
  }
}
