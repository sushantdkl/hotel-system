import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import {
  ensureUnitConversionSchema,
  listUnitConversions,
  createUnitConversion,
  updateUnitConversion,
  deleteUnitConversion,
} from '@/lib/unit-conversions.js';

export async function GET(request) {
  try {
    // Kitchen/waiter/cashier read these indirectly through inventory; admin manages.
    const auth = await requireAuth(request, { roles: ['admin', 'kitchen', 'cashier'], permission: 'inventory.setup.view' });
    if (auth.error) return auth.error;

    const db = Database.getInstance();
    await ensureUnitConversionSchema(db);
    return NextResponse.json({ conversions: await listUnitConversions(db) });
  } catch (error) {
    return handleRouteError(error, 'Failed to load unit conversions');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'inventory.setup.manage' });
    if (auth.error) return auth.error;

    const db = Database.getInstance();
    await ensureUnitConversionSchema(db);
    const conversion = await createUnitConversion(db, await request.json());
    return NextResponse.json({ message: 'Conversion saved.', conversion }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to create unit conversion');
  }
}

export async function PUT(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'inventory.setup.manage' });
    if (auth.error) return auth.error;

    const data = await request.json();
    if (!data.id) return NextResponse.json({ error: 'Which conversion should be updated?' }, { status: 400 });

    const db = Database.getInstance();
    await ensureUnitConversionSchema(db);
    const conversion = await updateUnitConversion(db, data.id, data);
    return NextResponse.json({ message: 'Conversion updated.', conversion });
  } catch (error) {
    return handleRouteError(error, 'Failed to update unit conversion');
  }
}

export async function DELETE(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'inventory.setup.manage' });
    if (auth.error) return auth.error;

    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Which conversion should be removed?' }, { status: 400 });

    const db = Database.getInstance();
    await ensureUnitConversionSchema(db);
    await deleteUnitConversion(db, id);
    return NextResponse.json({ message: 'Conversion deleted.' });
  } catch (error) {
    return handleRouteError(error, 'Failed to delete unit conversion');
  }
}
