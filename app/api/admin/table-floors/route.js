import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureTableTaxonomySchema, listFloors, createFloor, updateFloor, deleteFloor } from '@/lib/table-management.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'tables.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureTableTaxonomySchema(db);
    return NextResponse.json({ floors: await listFloors(db) });
  } catch (error) {
    return handleRouteError(error, 'Failed to load floors');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'tables.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureTableTaxonomySchema(db);
    const floor = await createFloor(db, await request.json());
    return NextResponse.json({ message: 'Floor saved.', floor }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to create floor');
  }
}

export async function PUT(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'tables.manage' });
    if (auth.error) return auth.error;
    const data = await request.json();
    if (!data.id) return NextResponse.json({ error: 'Which floor should be updated?' }, { status: 400 });
    const db = Database.getInstance();
    await ensureTableTaxonomySchema(db);
    const floor = await updateFloor(db, data.id, data);
    return NextResponse.json({ message: 'Floor updated.', floor });
  } catch (error) {
    return handleRouteError(error, 'Failed to update floor');
  }
}

export async function DELETE(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'tables.manage' });
    if (auth.error) return auth.error;
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Which floor should be removed?' }, { status: 400 });
    const db = Database.getInstance();
    await ensureTableTaxonomySchema(db);
    await deleteFloor(db, id);
    return NextResponse.json({ message: 'Floor deleted.' });
  } catch (error) {
    return handleRouteError(error, 'Failed to delete floor');
  }
}
