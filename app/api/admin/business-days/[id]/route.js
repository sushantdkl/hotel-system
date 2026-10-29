import { cashSafePayload, assertCashClosingAllowed } from '@/lib/cash-closing-policy.js';
import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { businessDayDetail } from '@/lib/business-days.js';

export async function GET(request, { params }) {
  try {
    const auth = await requireAuth(request, { permission: 'business_days.view' });
    if (auth.error) return auth.error;
    const respond = (value, options) => NextResponse.json(cashSafePayload(value, auth.user), options);
    const { id } = await params;
    return respond(await businessDayDetail(Database.getInstance(), Number(id)));
  } catch (error) {
    return handleRouteError(error, 'Could not load this business day.');
  }
}
