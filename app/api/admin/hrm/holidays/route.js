import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureHrmSchema, listHolidays, createHoliday, deleteHoliday } from '@/lib/hrm.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'hrm.holidays.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureHrmSchema(db);
    const year = new URL(request.url).searchParams.get('year');
    return NextResponse.json({ holidays: await listHolidays(db, { year }) });
  } catch (error) {
    return handleRouteError(error, 'Failed to load holidays');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'hrm.holidays.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureHrmSchema(db);
    const holiday = await createHoliday(db, await request.json(), auth.user);
    return NextResponse.json({ message: 'Holiday added.', holiday }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to add holiday');
  }
}

export async function DELETE(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'hrm.holidays.manage' });
    if (auth.error) return auth.error;
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Which holiday?' }, { status: 400 });
    const db = Database.getInstance();
    await ensureHrmSchema(db);
    await deleteHoliday(db, id);
    return NextResponse.json({ message: 'Holiday removed.' });
  } catch (error) {
    return handleRouteError(error, 'Failed to remove holiday');
  }
}
