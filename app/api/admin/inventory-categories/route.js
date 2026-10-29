import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import {
  ensureInventoryCategorySchema,
  listInventoryCategories,
  createInventoryCategory,
  updateInventoryCategory,
  deleteInventoryCategory,
} from '@/lib/inventory-categories.js';

export async function GET(request) {
  try {
    // Kitchen reads inventory too, so it may need the category list for pickers.
    const auth = await requireAuth(request, { roles: ['admin', 'kitchen', 'cashier'], permission: 'inventory.setup.view' });
    if (auth.error) return auth.error;

    const db = Database.getInstance();
    await ensureInventoryCategorySchema(db);
    return NextResponse.json({ categories: await listInventoryCategories(db) });
  } catch (error) {
    return handleRouteError(error, 'Failed to load inventory categories');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'inventory.setup.manage' });
    if (auth.error) return auth.error;

    const data = await request.json();
    const db = Database.getInstance();
    await ensureInventoryCategorySchema(db);
    const category = await createInventoryCategory(db, data.name);
    return NextResponse.json({ message: 'Category saved.', category }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to create inventory category');
  }
}

export async function PUT(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'inventory.setup.manage' });
    if (auth.error) return auth.error;

    const data = await request.json();
    if (!data.id) return NextResponse.json({ error: 'Which category should be updated?' }, { status: 400 });

    const db = Database.getInstance();
    await ensureInventoryCategorySchema(db);
    const category = await updateInventoryCategory(db, data.id, data.name);
    return NextResponse.json({ message: 'Category updated.', category });
  } catch (error) {
    return handleRouteError(error, 'Failed to update inventory category');
  }
}

export async function DELETE(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'inventory.setup.manage' });
    if (auth.error) return auth.error;

    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Which category should be removed?' }, { status: 400 });

    const db = Database.getInstance();
    await ensureInventoryCategorySchema(db);
    await deleteInventoryCategory(db, id);
    return NextResponse.json({ message: 'Category deleted — its items are now uncategorised.' });
  } catch (error) {
    return handleRouteError(error, 'Failed to delete inventory category');
  }
}
