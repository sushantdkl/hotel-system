import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureRecipeTables } from '@/lib/recipes.js';
import { createPurchase, listPurchases } from '@/lib/purchases.js';
import { readListParams } from '@/lib/paginate.js';
import { isPermissionAllowedSync } from '@/lib/permissions.js';
import { permissionRole } from '@/lib/roles.js';

async function cashierMayUseSupplier(db, user, supplierName) {
  if (user?.role !== 'cashier' || !String(supplierName || '').trim()) return true;
  const existing = await db.get(
    `SELECT id FROM suppliers WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1`,
    [String(supplierName).trim()]
  );
  return !!existing || isPermissionAllowedSync(permissionRole(user), 'suppliers.manage');
}

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'purchases.view' });
    if (auth.error) return auth.error;

    const db = Database.getInstance();
    await ensureRecipeTables(db);

    const q = new URL(request.url).searchParams;
    const filters = {
      supplierId: q.get('supplier_id'),
      status: q.get('status'),
      from: q.get('from'),
      to: q.get('to'),
      paymentMethod: q.get('payment_method'),
    };

    const { rows, pagination, summary } = await listPurchases(db, { ...readListParams(q), ...filters });
    return NextResponse.json({ purchases: rows, pagination, summary });
  } catch (error) {
    return handleRouteError(error, 'Failed to load purchases');
  }
}

/**
 * One transactional receipt: header + lines + stock + movements + expense.
 * Quantities and unit costs are in PURCHASE units.
 */
export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'purchases.create' });
    if (auth.error) return auth.error;

    const data = await request.json();
    const db = Database.getInstance();
    await ensureRecipeTables(db);
    if (!await cashierMayUseSupplier(db, auth.user, data.supplier || data.supplier_name)) {
      return NextResponse.json(
        { error: 'Ask an admin to add this supplier or grant supplier-management permission.' },
        { status: 403 }
      );
    }

    const purchase = await createPurchase(db, {
      ...data,
      performed_by: auth.user?.id || null,
      received_by: auth.user?.role === 'cashier'
        ? auth.user.id
        : data.received_by ?? auth.user?.id ?? null,
    });
    return NextResponse.json({ message: 'Delivery received and stock updated.', purchase }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to record purchase');
  }
}
