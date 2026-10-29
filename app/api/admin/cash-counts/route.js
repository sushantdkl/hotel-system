import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import {
  listScheduledCashCounts,
  scheduledCashCountStatus,
  submitScheduledCashCount,
} from '@/lib/scheduled-cash-counts.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    if (auth.user.role === 'cashier') {
      return NextResponse.json({ status: await scheduledCashCountStatus(db, auth.user) });
    }
    const query = new URL(request.url).searchParams;
    return NextResponse.json(await listScheduledCashCounts(db, {
      page: query.get('page'),
      pageSize: query.get('pageSize'),
      date: query.get('date') || '',
    }));
  } catch (error) {
    return handleRouteError(error, 'Could not load scheduled cash counts.');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['cashier'] });
    if (auth.error) return auth.error;
    const result = await submitScheduledCashCount(Database.getInstance(), auth.user, await request.json());
    return NextResponse.json({ message: 'Cash count submitted.', result }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Could not submit the cash count.');
  }
}
