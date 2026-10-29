import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureAccountingSchema } from '@/lib/accounting.js';
import { listBankAccounts, listBankMovements, recordBankMovement } from '@/lib/accounting-cash.js';
import { currentBusinessDayId } from '@/lib/business-days.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'bank.access' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureAccountingSchema(db);
    const q = new URL(request.url).searchParams;
    const [banks, movementResult] = await Promise.all([
      listBankAccounts(db),
      listBankMovements(db, {
        paged: true,
        page: q.get('page'), pageSize: q.get('page_size'), search: q.get('search'),
        from: q.get('from'), to: q.get('to'), direction: q.get('direction'), bankId: q.get('bank_id'),
      }),
    ]);
    return NextResponse.json({ banks, movements: movementResult.rows, pagination: movementResult.pagination });
  } catch (error) {
    return handleRouteError(error, 'Failed to load bank accounts');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'bank.access' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureAccountingSchema(db);
    const data = await request.json();
    if (data.action === 'add_account' || data.action === 'transfer') {
      return NextResponse.json({ error: 'Online uses one Primary Bank balance.' }, { status: 409 });
    }
    const businessDayId = await currentBusinessDayId(db, { required: true });
    const result = await recordBankMovement(db, { ...data, kind: data.action, created_by: auth.user?.id || null, business_day_id: businessDayId });
    return NextResponse.json({ message: 'Recorded.', ...result }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to record bank movement');
  }
}
