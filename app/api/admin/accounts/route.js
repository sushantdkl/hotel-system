import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureAccountingSchema, listAccountsWithBalances, createAccount, updateAccount, deleteAccount } from '@/lib/accounting.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'chart_of_accounts.access' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureAccountingSchema(db);
    return NextResponse.json({ accounts: await listAccountsWithBalances(db) });
  } catch (error) {
    return handleRouteError(error, 'Failed to load chart of accounts');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'chart_of_accounts.access' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureAccountingSchema(db);
    const account = await createAccount(db, await request.json());
    return NextResponse.json({ message: 'Account created.', account }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to create account');
  }
}

export async function PUT(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'chart_of_accounts.access' });
    if (auth.error) return auth.error;
    const data = await request.json();
    if (!data.id) return NextResponse.json({ error: 'Which account?' }, { status: 400 });
    const db = Database.getInstance();
    await ensureAccountingSchema(db);
    const account = await updateAccount(db, data.id, data);
    return NextResponse.json({ message: 'Account updated.', account });
  } catch (error) {
    return handleRouteError(error, 'Failed to update account');
  }
}

export async function DELETE(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'chart_of_accounts.access' });
    if (auth.error) return auth.error;
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Which account?' }, { status: 400 });
    const db = Database.getInstance();
    await ensureAccountingSchema(db);
    await deleteAccount(db, id);
    return NextResponse.json({ message: 'Account deleted.' });
  } catch (error) {
    return handleRouteError(error, 'Failed to delete account');
  }
}
