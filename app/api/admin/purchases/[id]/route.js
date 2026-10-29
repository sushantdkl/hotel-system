import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureRecipeTables } from '@/lib/recipes.js';
import { getPurchase, updatePurchase, voidPurchase, deletePurchase } from '@/lib/purchases.js';
import { isPermissionAllowedSync } from '@/lib/permissions.js';
import { correctExpensePaymentMethod } from '@/lib/expense-links.js';
import { permissionRole } from '@/lib/roles.js';

export async function GET(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'purchases.view' });
    if (auth.error) return auth.error;

    const { id } = await params;
    const db = Database.getInstance();
    await ensureRecipeTables(db);
    const purchase = await getPurchase(db, id);
    if (!purchase) return NextResponse.json({ error: 'Purchase not found.' }, { status: 404 });
    return NextResponse.json({ purchase });
  } catch (error) {
    return handleRouteError(error, 'Failed to load purchase');
  }
}

export async function PUT(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'purchases.edit' });
    if (auth.error) return auth.error;

    const { id } = await params;
    const data = await request.json();
    const db = Database.getInstance();
    await ensureRecipeTables(db);
    const existingPurchase = await getPurchase(db, id);
    if (!existingPurchase) return NextResponse.json({ error: 'Purchase not found.' }, { status: 404 });
    if (existingPurchase.expense?.business_day_status === 'closed' && String(data.change_reason || '').trim().length < 3) {
      return NextResponse.json({ error: 'Enter a clear reason for correcting this closed purchase.' }, { status: 400 });
    }
    const supplierName = data.supplier || data.supplier_name;
    if (auth.user?.role === 'cashier' && String(supplierName || '').trim()) {
      const existingSupplier = await db.get(
        `SELECT id FROM suppliers WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1`,
        [String(supplierName).trim()]
      );
      if (!existingSupplier && !isPermissionAllowedSync(permissionRole(auth.user), 'suppliers.manage')) {
        return NextResponse.json(
          { error: 'Ask an admin to add this supplier or grant supplier-management permission.' },
          { status: 403 }
        );
      }
    }

    const purchase = await updatePurchase(db, id, {
      ...data,
      performed_by: auth.user?.id || null,
      // Cashiers cannot re-attribute a historical delivery to another user.
      received_by: auth.user?.role === 'cashier' ? undefined : data.received_by ?? auth.user?.id ?? null,
    });
    return NextResponse.json({ message: 'Purchase updated and stock re-applied.', purchase });
  } catch (error) {
    return handleRouteError(error, 'Failed to update purchase');
  }
}

/** Correct payment only. This remains available for an older invoice because
 * it does not reverse/reapply stock or rewrite the delivery itself. */
export async function PATCH(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'purchases.payment_method_correct' });
    if (auth.error) return auth.error;

    const { id } = await params;
    const data = await request.json();
    const db = Database.getInstance();
    await ensureRecipeTables(db);
    const purchase = await getPurchase(db, id);
    if (!purchase) return NextResponse.json({ error: 'Purchase not found.' }, { status: 404 });
    if (!purchase.expense?.id) {
      return NextResponse.json({ error: 'This purchase has no active linked expense to correct.' }, { status: 409 });
    }

    const correction = await correctExpensePaymentMethod(db, {
      expenseId: purchase.expense.id,
      paymentMethod: data.payment_method,
      reason: data.reason,
      performedBy: auth.user?.id || null,
      requestKey: data.request_key,
    });
    return NextResponse.json({
      message: 'Purchase payment method corrected.',
      correction,
      purchase: await getPurchase(db, id),
    });
  } catch (error) {
    return handleRouteError(error, 'Failed to correct purchase payment method');
  }
}

/**
 * DELETE voids by default — the stock is reversed, the linked expense is
 * removed and the record is kept for audit. ?hard=1 only succeeds on a draft
 * or already-voided purchase.
 */
export async function DELETE(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'purchases.void' });
    if (auth.error) return auth.error;

    const { id } = await params;
    const q = new URL(request.url).searchParams;
    const db = Database.getInstance();
    await ensureRecipeTables(db);

    if (q.get('hard') === '1') {
      if (auth.user.role !== 'admin') {
        return NextResponse.json({ error: 'Only an admin can permanently delete a purchase record.' }, { status: 403 });
      }
      return NextResponse.json(await deletePurchase(db, id, { performedBy: auth.user?.id || null }));
    }

    const purchase = await voidPurchase(db, id, {
      reason: q.get('reason'),
      performedBy: auth.user?.id || null,
      allowPreviousDay: isPermissionAllowedSync(permissionRole(auth.user), 'purchases.void_previous_day'),
    });
    return NextResponse.json({ message: 'Purchase voided and stock reversed.', purchase });
  } catch (error) {
    return handleRouteError(error, 'Failed to void purchase');
  }
}
