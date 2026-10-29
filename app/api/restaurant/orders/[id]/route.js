import { OrderRepository } from '@/lib/db/repositories/orders.js';
import { KotRepository } from '@/lib/db/repositories/kots.js';
import { requireAuth } from '@/lib/api-guard.js';

async function verifyAuth(request, permission) {
  const auth = await requireAuth(request, { permission });
  if (auth.error) throw Object.assign(new Error('You do not have access to this action.'), { status: 403 });
  return auth.user;
}

function activeItemCount(items = []) {
  return (items || []).filter((i) => !['voided', 'cancelled'].includes(i.status)).length;
}

async function assertCancelAllowed(user, orderRepo, orderId, reason) {
  if (!String(reason || '').trim()) {
    const err = new Error('A cancel reason is required.');
    err.status = 400;
    throw err;
  }
  const items = await orderRepo.getOrderItems(orderId);
  const count = activeItemCount(items);
  // Waiters may cancel empty orders only; admin/cashier can cancel non-empty
  if (count > 0 && user.role === 'waiter') {
    const err = new Error('Only a cashier or admin can cancel an order that already has items.');
    err.status = 403;
    throw err;
  }
  if (!['admin', 'cashier', 'waiter'].includes(user.role)) {
    const err = new Error('You do not have permission to cancel orders.');
    err.status = 403;
    throw err;
  }
}

// GET - Get single order with items and KOTs
export async function GET(request, context) {
  try {
    const user = await verifyAuth(request, 'orders.view');
    const { params } = context;
    const { id: orderId } = await params;
    
    const orderRepo = new OrderRepository();
    const kotRepo = new KotRepository();
    
    const order = await orderRepo.getById(orderId);
    
    if (!order) {
      return Response.json(
        { error: 'This order could not be found.' },
        { status: 404 }
      );
    }
    
    const items = await orderRepo.getOrderItems(orderId);
    let kots = [];
    try {
      kots = await kotRepo.getByOrder(orderId) || [];
    } catch {
      kots = [];
    }

    let reservation = null;
    try {
      const Database = (await import('@/lib/db/index.js')).default;
      const { ensureLeadsTables } = await import('@/lib/leads.js');
      const db = Database.getInstance();
      await ensureLeadsTables(db);
      reservation = await db.get(
        `SELECT r.*, t.table_number
         FROM reservations r
         LEFT JOIN tables t ON t.id = r.table_id
         WHERE r.order_id = ?`,
        [orderId]
      );
    } catch {
      reservation = null;
    }

    return Response.json({ order, items, kots, reservation });
    
  } catch (error) {
    console.error('Get order details error:', error);
    const authFail = /authorization|session|token/i.test(error.message || '');
    return Response.json(
      { error: authFail ? 'Please sign in again to continue.' : 'Could not load this order.' },
      { status: authFail ? 401 : 500 }
    );
  }
}

// PUT - Update order
export async function PUT(request, context) {
  try {
    const user = await verifyAuth(request, 'orders.update');
    const { params } = context;
    const { id: orderId } = await params;
    const updateData = await request.json();
    
    const orderRepo = new OrderRepository();
    const order = await orderRepo.getById(orderId);
    if (!order) {
      return Response.json({ error: 'This order could not be found.' }, { status: 404 });
    }
    
    if (updateData.status) {
      if (updateData.status === 'cancelled') {
        await assertCancelAllowed(user, orderRepo, orderId, updateData.cancel_reason);
        await orderRepo.cancelOrder(orderId, String(updateData.cancel_reason).trim(), { actorId: user.id });
      } else if (
        updateData.status === 'dining' &&
        order.status === 'awaiting_payment' &&
        updateData.unlock_bill
      ) {
        // Explicit unlock from awaiting_payment → dining
        if (!['admin', 'cashier', 'waiter'].includes(user.role)) {
          return Response.json({ error: 'You cannot unlock this bill.' }, { status: 403 });
        }
        await orderRepo.updateStatus(orderId, 'dining');
        try {
          await orderRepo.db.run(
            `UPDATE orders
             SET notes = COALESCE(notes, '') || ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [`\nBill request cancelled by ${user.full_name || user.role}`, orderId]
          );
        } catch {
          /* ignore note failure */
        }
      } else {
        await orderRepo.updateStatus(orderId, updateData.status);
      }

      // Stamp kitchen timing + who prepared it, for timers/analytics/chef stats.
      // Additive only — the status transition itself stays in updateStatus.
      try {
        if (updateData.status === 'preparing') {
          await orderRepo.db.run(
            `UPDATE orders SET prep_started_at = COALESCE(prep_started_at, CURRENT_TIMESTAMP),
                    prepared_by = COALESCE(prepared_by, ?) WHERE id = ?`,
            [user.id, orderId]
          );
        } else if (updateData.status === 'ready') {
          await orderRepo.db.run(
            `UPDATE orders SET ready_at = CURRENT_TIMESTAMP, prepared_by = COALESCE(prepared_by, ?) WHERE id = ?`,
            [user.id, orderId]
          );
        }
      } catch {
        /* timing capture is best-effort */
      }
    }

    const updated = await orderRepo.getById(orderId);
    
    return Response.json({ success: true, order: updated });
    
  } catch (error) {
    console.error('Update order error:', error);
    const status = error.status || 500;
    return Response.json(
      { error: error.message || 'Could not update the order. Please try again.' },
      { status: [400, 403, 404, 409].includes(status) ? status : 500 }
    );
  }
}

// DELETE - Cancel order
export async function DELETE(request, context) {
  try {
    const user = await verifyAuth(request, 'orders.cancel');
    const { params } = context;
    const { id: orderId } = await params;
    let cancel_reason = '';
    try {
      const body = await request.json();
      cancel_reason = body.cancel_reason || body.reason || '';
    } catch {
      /* no body */
    }
    
    const orderRepo = new OrderRepository();
    await assertCancelAllowed(user, orderRepo, orderId, cancel_reason);
    await orderRepo.cancelOrder(orderId, cancel_reason.trim(), { actorId: user.id });
    
    return Response.json({ success: true });
    
  } catch (error) {
    console.error('Cancel order error:', error);
    const status = error.status || 500;
    return Response.json(
      { error: error.message || 'Could not cancel the order. Please try again.' },
      { status: [400, 403, 404, 409].includes(status) ? status : 500 }
    );
  }
}
