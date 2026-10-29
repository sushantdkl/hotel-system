import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { createOwnerAlert, ensureStaffHrSchema, listOwnerAlerts, updateOwnerAlert } from '@/lib/staff-hr.js';

export const dynamic = 'force-dynamic';

// Manager -> owner escalations. Owner sees all; a manager sees their own.
async function guard(request) {
  const auth = await requireAuth(request, { roles: ['admin'] });
  if (auth.error) return { error: auth.error };
  const db = Database.getInstance();
  await ensureStaffHrSchema(db);
  return { db, user: auth.user };
}

export async function GET(request) {
  try {
    const { db, user, error } = await guard(request);
    if (error) return error;
    return NextResponse.json(await listOwnerAlerts(db, user), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleRouteError(error, 'Could not load alerts.');
  }
}

export async function POST(request) {
  try {
    const { db, user, error } = await guard(request);
    if (error) return error;
    return NextResponse.json(await createOwnerAlert(db, user, await request.json()), { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Could not send this alert.');
  }
}

export async function PATCH(request) {
  try {
    const { db, user, error } = await guard(request);
    if (error) return error;
    const body = await request.json();
    return NextResponse.json(await updateOwnerAlert(db, user, body.id, body.status));
  } catch (error) {
    return handleRouteError(error, 'Could not update this alert.');
  }
}
