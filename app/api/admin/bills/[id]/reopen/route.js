import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { reopenBill, finalizeRevision, applyRevisionSettlement, cancelRevision } from '@/lib/bills-admin.js';

/**
 * POST   /api/admin/bills/[id]/reopen         → reopen into a live POS order + checkout
 * PUT    /api/admin/bills/[id]/reopen         → finalize a legacy revision (compute treatment)
 * DELETE /api/admin/bills/[id]/reopen?revisionId= → discard an open revision
 *
 * Reopen never mutates the original finalized invoice. It opens (or resumes) an
 * active POS order for the same table/customer and returns a path to checkout.
 */

function statusFrom(error) {
  return typeof error?.status === 'number' ? error.status : 500;
}

export async function POST(request, context) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier', 'waiter'], permission: 'bills.reopen' });
    if (auth.error) return auth.error;

    const id = Number((await context.params).id);
    const body = await request.json().catch(() => ({}));
    const db = Database.getInstance();
    const result = await reopenBill(db, { billId: id, reason: body?.reason, actorId: auth.user?.id || null });
    return NextResponse.json({ message: 'Bill reopened.', ...result }, { status: 201 });
  } catch (error) {
    if (error?.status) return NextResponse.json({ error: error.message }, { status: statusFrom(error) });
    return handleRouteError(error, 'Failed to reopen bill.');
  }
}

export async function PUT(request, context) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier', 'waiter'], permission: 'bills.reopen' });
    if (auth.error) return auth.error;

    const id = Number((await context.params).id);
    const body = await request.json().catch(() => ({}));
    if (!body?.revisionId) return NextResponse.json({ error: 'Missing revisionId.' }, { status: 400 });

    const db = Database.getInstance();
    const result = await finalizeRevision(db, {
      billId: id,
      revisionId: Number(body.revisionId),
      items: Array.isArray(body.items) ? body.items : null,
      reason: body.reason || null,
      actorId: auth.user?.id || null,
    });
    return NextResponse.json({ message: 'Revision finalized.', ...result });
  } catch (error) {
    if (error?.status) return NextResponse.json({ error: error.message }, { status: statusFrom(error) });
    return handleRouteError(error, 'Failed to finalize revision.');
  }
}

/** PATCH /api/admin/bills/[id]/reopen — settle a finalized revision's difference
 *  (collect the supplemental payment or issue the refund via existing services). */
export async function PATCH(request, context) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier', 'waiter'], permission: 'bills.reopen' });
    if (auth.error) return auth.error;

    const id = Number((await context.params).id);
    const body = await request.json().catch(() => ({}));
    if (!body?.revisionId) return NextResponse.json({ error: 'Missing revisionId.' }, { status: 400 });

    const db = Database.getInstance();
    const result = await applyRevisionSettlement(db, {
      billId: id,
      revisionId: Number(body.revisionId),
      method: body.method || 'cash',
      reference: body.reference || null,
      allocations: body.allocations,
      requestKey: body.idempotency_key,
      reason: body.reason || null,
      actorId: auth.user?.id || null,
      actorRole: auth.user?.role,
    });
    return NextResponse.json({ message: 'Settled.', ...result });
  } catch (error) {
    if (error?.status) return NextResponse.json({ error: error.message }, { status: statusFrom(error) });
    return handleRouteError(error, 'Failed to settle revision.');
  }
}

export async function DELETE(request, context) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier', 'waiter'], permission: 'bills.reopen' });
    if (auth.error) return auth.error;

    const id = Number((await context.params).id);
    const { searchParams } = new URL(request.url);
    const revisionId = Number(searchParams.get('revisionId'));
    if (!revisionId) return NextResponse.json({ error: 'Missing revisionId.' }, { status: 400 });

    const db = Database.getInstance();
    const result = await cancelRevision(db, { billId: id, revisionId, actorId: auth.user?.id || null });
    return NextResponse.json({ message: 'Revision discarded.', ...result });
  } catch (error) {
    if (error?.status) return NextResponse.json({ error: error.message }, { status: statusFrom(error) });
    return handleRouteError(error, 'Failed to discard revision.');
  }
}
