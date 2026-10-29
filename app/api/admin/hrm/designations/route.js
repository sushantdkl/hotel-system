import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureHrmSchema, listDesignations, createDesignation, updateDesignation, deleteDesignation } from '@/lib/hrm.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], anyPermissions: ['hrm.designations.manage', 'employees.manage', 'payroll.view'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureHrmSchema(db);
    return NextResponse.json({ designations: await listDesignations(db) });
  } catch (error) {
    return handleRouteError(error, 'Failed to load designations');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'hrm.designations.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureHrmSchema(db);
    const designation = await createDesignation(db, await request.json());
    return NextResponse.json({ message: 'Designation created.', designation }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to create designation');
  }
}

export async function PUT(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'hrm.designations.manage' });
    if (auth.error) return auth.error;
    const data = await request.json();
    if (!data.id) return NextResponse.json({ error: 'Which designation?' }, { status: 400 });
    const db = Database.getInstance();
    await ensureHrmSchema(db);
    const designation = await updateDesignation(db, data.id, data);
    return NextResponse.json({ message: 'Designation updated.', designation });
  } catch (error) {
    return handleRouteError(error, 'Failed to update designation');
  }
}

export async function DELETE(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'hrm.designations.manage' });
    if (auth.error) return auth.error;
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Which designation?' }, { status: 400 });
    const db = Database.getInstance();
    await ensureHrmSchema(db);
    await deleteDesignation(db, id);
    return NextResponse.json({ message: 'Designation deleted.' });
  } catch (error) {
    return handleRouteError(error, 'Failed to delete designation');
  }
}
