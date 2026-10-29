import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import {
  ensureExpenseCategorySchema,
  listExpenseCategories,
  createExpenseCategory,
  updateExpenseCategory,
  deleteExpenseCategory,
} from '@/lib/expense-categories.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], anyPermissions: ['expenses.manage', 'expense_categories.manage'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureExpenseCategorySchema(db);
    return NextResponse.json({ categories: await listExpenseCategories(db) });
  } catch (error) {
    return handleRouteError(error, 'Failed to load expense categories');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'expense_categories.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureExpenseCategorySchema(db);
    const category = await createExpenseCategory(db, (await request.json()).name);
    return NextResponse.json({ message: 'Category saved.', category }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to create expense category');
  }
}

export async function PUT(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'expense_categories.manage' });
    if (auth.error) return auth.error;
    const data = await request.json();
    if (!data.id) return NextResponse.json({ error: 'Which category?' }, { status: 400 });
    const db = Database.getInstance();
    await ensureExpenseCategorySchema(db);
    const category = await updateExpenseCategory(db, data.id, data.name, data.business_unit ?? null);
    return NextResponse.json({ message: 'Category updated.', category });
  } catch (error) {
    return handleRouteError(error, 'Failed to update expense category');
  }
}

export async function DELETE(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'expense_categories.manage' });
    if (auth.error) return auth.error;
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Which category?' }, { status: 400 });
    const db = Database.getInstance();
    await ensureExpenseCategorySchema(db);
    await deleteExpenseCategory(db, id);
    return NextResponse.json({ message: 'Category deleted.' });
  } catch (error) {
    return handleRouteError(error, 'Failed to delete expense category');
  }
}
