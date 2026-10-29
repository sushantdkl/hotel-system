import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureTableTaxonomySchema, listTypes, createType, updateType, deleteType } from '@/lib/table-management.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'tables.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureTableTaxonomySchema(db);
    return NextResponse.json({ types: await listTypes(db) });
  } catch (error) {
    return handleRouteError(error, 'Failed to load table types');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'tables.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureTableTaxonomySchema(db);
    const type = await createType(db, await request.json());
    return NextResponse.json({ message: 'Type saved.', type }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to create table type');
  }
}

export async function PUT(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'tables.manage' });
    if (auth.error) return auth.error;
    const data = await request.json();
    if (!data.id) return NextResponse.json({ error: 'Which type should be updated?' }, { status: 400 });
    const db = Database.getInstance();
    await ensureTableTaxonomySchema(db);
    const type = await updateType(db, data.id, data);
    return NextResponse.json({ message: 'Type updated.', type });
  } catch (error) {
    return handleRouteError(error, 'Failed to update table type');
  }
}

export async function DELETE(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'tables.manage' });
    if (auth.error) return auth.error;
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Which type should be removed?' }, { status: 400 });
    const db = Database.getInstance();
    await ensureTableTaxonomySchema(db);
    await deleteType(db, id);
    return NextResponse.json({ message: 'Type deleted.' });
  } catch (error) {
    return handleRouteError(error, 'Failed to delete table type');
  }
}
