import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError, jsonError } from '@/lib/api-guard.js';
import { addSecurityEntry, checkOutEntry, ensureSecuritySchema, securityDay } from '@/lib/security.js';
import { createOwnerAlert, ensureStaffHrSchema } from '@/lib/staff-hr.js';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { permission: 'hotel.security' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureSecuritySchema(db);
    return NextResponse.json(await securityDay(db, new URL(request.url).searchParams.get('date')), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleRouteError(error, 'Could not load the security log.');
  }
}

/** action: log | checkout | emergency (owner alert). */
export async function POST(request) {
  try {
    const auth = await requireAuth(request, { permission: 'hotel.security' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureSecuritySchema(db);
    const body = await request.json();
    if (body.action === 'log') return NextResponse.json(await addSecurityEntry(db, auth.user, body));
    if (body.action === 'checkout') return NextResponse.json(await checkOutEntry(db, body.id));
    if (body.action === 'emergency') {
      await ensureStaffHrSchema(db);
      // Alert first (it validates and only managers / the watchman may send), then log the incident.
      const result = await createOwnerAlert(db, auth.user, { severity: body.severity || 'critical', category: 'Security', title: body.title, message: body.message, link: body.link });
      await addSecurityEntry(db, auth.user, { kind: 'incident', name: body.title, notes: body.message, reference: body.link });
      return NextResponse.json(result);
    }
    return jsonError('Unknown action.');
  } catch (error) {
    return handleRouteError(error, 'Could not save this entry.');
  }
}
