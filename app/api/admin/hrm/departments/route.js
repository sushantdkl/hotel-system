import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureHrmSchema, listDepartments, createDepartment, updateDepartment, deleteDepartment } from '@/lib/hrm.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], anyPermissions: ['hrm.departments.manage', 'employees.manage', 'payroll.view'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureHrmSchema(db);
    return NextResponse.json({ departments: await listDepartments(db) });
  } catch (error) {
    return handleRouteError(error, 'Failed to load departments');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'hrm.departments.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureHrmSchema(db);
    const department = await createDepartment(db, await request.json());
    return NextResponse.json({ message: 'Department created.', department }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to create department');
  }
}

export async function PUT(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'hrm.departments.manage' });
    if (auth.error) return auth.error;
    const data = await request.json();
    if (!data.id) return NextResponse.json({ error: 'Which department?' }, { status: 400 });
    const db = Database.getInstance();
    await ensureHrmSchema(db);
    const department = await updateDepartment(db, data.id, data);
    return NextResponse.json({ message: 'Department updated.', department });
  } catch (error) {
    return handleRouteError(error, 'Failed to update department');
  }
}

export async function DELETE(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'hrm.departments.manage' });
    if (auth.error) return auth.error;
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Which department?' }, { status: 400 });
    const db = Database.getInstance();
    await ensureHrmSchema(db);
    await deleteDepartment(db, id);
    return NextResponse.json({ message: 'Department deleted.' });
  } catch (error) {
    return handleRouteError(error, 'Failed to delete department');
  }
}
