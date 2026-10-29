import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { getBillDetail, voidBillAdmin, refundBillAdmin, completeBillPayment, logReceiptReprint, reviseBillSettlement } from '@/lib/bills-admin.js';
import { ensurePermissionCache, isPermissionAllowedSync } from '@/lib/permissions.js';
import { permissionRole } from '@/lib/roles.js';

/** GET /api/admin/bills/[id] — full bill detail (read-only). */
export async function GET(request, context) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'waiter', 'cashier'], permission: 'bills.view' });
    if (auth.error) return auth.error;

    const id = Number((await context.params).id);
    if (!id) return NextResponse.json({ error: 'Invalid bill id.' }, { status: 400 });

    const db = Database.getInstance();
    const detail = await getBillDetail(db, id);
    if (!detail) return NextResponse.json({ error: 'Bill not found.' }, { status: 404 });
    return NextResponse.json({ bill: detail });
  } catch (error) {
    return handleRouteError(error, 'Failed to load bill.');
  }
}

/**
 * POST /api/admin/bills/[id] — bill actions.
 * body: { action: 'void' | 'refund' | 'complete_payment' | 'reprint' | 'revise_settlement', ... }
 * Each reuses an existing, verified service and writes an audit entry.
 */
export async function POST(request, context) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier', 'waiter'], permission: 'bills.view' });
    if (auth.error) return auth.error;

    const id = Number((await context.params).id);
    if (!id) return NextResponse.json({ error: 'Invalid bill id.' }, { status: 400 });
    const body = await request.json().catch(() => ({}));

    const actorId = auth.user?.id || null;
    const db = Database.getInstance();

    const actionPermission = {
      void: 'bills.void',
      refund: 'bills.refund',
      complete_payment: 'bills.pay',
      revise_settlement: 'bills.revise_settlement',
      reprint: 'bills.reprint',
    }[body?.action];
    if (auth.user.role !== 'admin' && actionPermission) {
      await ensurePermissionCache(db);
      if (!isPermissionAllowedSync(permissionRole(auth.user), actionPermission)) {
        return NextResponse.json({ error: 'You do not have access to this action.' }, { status: 403 });
      }
    }

    let result;
    switch (body?.action) {
      case 'void':
        result = await voidBillAdmin(db, { billId: id, reason: body.reason, restock: body.restock !== false, actorId });
        break;
      case 'refund':
        result = await refundBillAdmin(db, { billId: id, amount: body.amount, full: !!body.full, method: body.method || 'cash', reason: body.reason, actorId });
        break;
      case 'complete_payment':
        result = await completeBillPayment(db, {
          billId: id,
          amount: body.amount,
          method: body.method || 'cash',
          reference: body.reference || null,
          provider: body.provider || null,
          verified: body.verified === true,
          allocations: body.allocations,
          requestKey: body.idempotency_key,
          actorId,
          actorRole: auth.user?.role,
        });
        break;
      case 'revise_settlement':
        result = await reviseBillSettlement(db, {
          billId: id,
          reason: body.reason,
          allocations: body.allocations,
          customerId: body.customer_id ?? null,
          customerName: body.customer_name ?? null,
          customerPhone: body.customer_phone ?? null,
          actorId,
          actorRole: auth.user?.role,
        });
        break;
      case 'reprint':
        result = await logReceiptReprint(db, { billId: id, kind: body.kind || 'final', actorId });
        break;
      case 'delete':
        return NextResponse.json({
          error: 'Bills are financial records and cannot be deleted from production history. Void or refund the bill with a reason instead.',
        }, { status: 409 });
      default:
        return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
    return NextResponse.json({ message: 'Done.', action: body.action, ...result });
  } catch (error) {
    if (error?.status) return NextResponse.json({ error: error.message }, { status: error.status });
    return handleRouteError(error, 'Bill action failed.');
  }
}
