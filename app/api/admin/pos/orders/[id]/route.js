import { NextResponse } from 'next/server';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import Database from '@/lib/db/index.js';
import { getOrderWorkspace, logPosEvent, ensureKotProSchema } from '@/lib/kot-service.js';
import { OrderRepository } from '@/lib/db/repositories/orders.js';
import { ensureColumn } from '@/lib/db/schema-helpers.js';
import { assignOrderExecutive, ensureDeliverySchema } from '@/lib/delivery.js';

/** Full workspace for one order: items (sent/unsent), KOT history, bill state. */
export async function GET(request, context) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'waiter', 'cashier'], permission: 'orders.view' });
    if (auth.error) return auth.error;
    const { id } = await context.params;
    const orderId = parseInt(id, 10);
    if (!Number.isFinite(orderId)) return NextResponse.json({ error: 'Invalid order.' }, { status: 400 });

    const db = Database.getInstance();
    const workspace = await getOrderWorkspace(db, orderId);
    if (!workspace) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    return NextResponse.json({ success: true, workspace });
  } catch (error) {
    return handleRouteError(error, 'Could not load the order.');
  }
}

/**
 * Change table for an active order (or update party_label).
 * Body: { table_id } and/or { party_label }
 */
export async function PATCH(request, context) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'waiter', 'cashier'], permission: 'orders.update' });
    if (auth.error) return auth.error;
    const { id } = await context.params;
    const orderId = parseInt(id, 10);
    if (!Number.isFinite(orderId)) return NextResponse.json({ error: 'Invalid order.' }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const db = Database.getInstance();
    await ensureKotProSchema(db);
    await ensureColumn(db, 'orders', 'party_label', 'TEXT').catch(() => {});

    // Delivery assignment is allowed regardless of order status (e.g. correcting
    // who delivered it after completion), so it's handled before the active-only lookup below.
    if (body.delivery_executive_id !== undefined) {
      await ensureDeliverySchema(db);
      const exists = await db.get('SELECT id, delivery_executive_id FROM orders WHERE id = ?', [orderId]);
      if (!exists) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
      const executiveId = body.delivery_executive_id ? parseInt(body.delivery_executive_id, 10) : null;
      await assignOrderExecutive(db, orderId, executiveId);
      if (Number(exists.delivery_executive_id || 0) !== Number(executiveId || 0)) {
        await logPosEvent(db, {
          action: 'delivery_executive_changed', actor_id: auth.user.id, actor_name: auth.user.full_name,
          order_id: orderId, previous_value: exists.delivery_executive_id, new_value: executiveId,
        });
      }
      const workspace = await getOrderWorkspace(db, orderId);
      return NextResponse.json({ success: true, workspace });
    }

    return db.transaction(async (tx) => {
    const order = await tx.get(
      `SELECT * FROM orders WHERE id = ? AND status NOT IN ('completed','cancelled')${tx.driver === 'postgres' ? ' FOR UPDATE' : ''}`,
      [orderId]
    );
    if (!order) return NextResponse.json({ error: 'Active order not found.' }, { status: 404 });

    const orderRepo = new OrderRepository();
    orderRepo.db = tx;
    const oldTableId = order.table_id || null;
    let newTableId = oldTableId;
    let tableNumber = order.table_number;

    if (body.table_id != null) {
      newTableId = parseInt(body.table_id, 10);
      if (!Number.isFinite(newTableId)) {
        return NextResponse.json({ error: 'Invalid table.' }, { status: 400 });
      }
      const table = await tx.get(`SELECT * FROM tables WHERE id = ?${tx.driver === 'postgres' ? ' FOR UPDATE' : ''}`, [newTableId]);
      if (!table) return NextResponse.json({ error: 'Table not found.' }, { status: 404 });
      tableNumber = table.table_number;

      await tx.run(
        `UPDATE orders SET table_id = ?, table_number = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [newTableId, tableNumber, orderId]
      );

      // Point the new table at this order and mark occupied.
      await tx.run(
        `UPDATE tables SET status = 'occupied', current_order_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [orderId, newTableId]
      );

      // Free old table only if no other parties remain.
      if (oldTableId && oldTableId !== newTableId) {
        await orderRepo.releaseTableIfEmpty(oldTableId, orderId);
      }

      await logPosEvent(tx, {
        action: 'order_changed_table',
        actor_id: auth.user.id,
        actor_name: auth.user.full_name,
        order_id: orderId,
        table_id: newTableId,
        previous_value: oldTableId,
        new_value: newTableId,
      });
    }

    if (body.party_label != null) {
      const nextPartyLabel = String(body.party_label).trim() || null;
      await tx.run(
        `UPDATE orders SET party_label = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [nextPartyLabel, orderId]
      );
      if (String(order.party_label || '') !== String(nextPartyLabel || '')) {
        await logPosEvent(tx, {
          action: 'party_label_changed', actor_id: auth.user.id, actor_name: auth.user.full_name,
          order_id: orderId, previous_value: order.party_label || null, new_value: nextPartyLabel,
        });
      }
    }

    const workspace = await getOrderWorkspace(tx, orderId);
    return NextResponse.json({ success: true, workspace });
    });
  } catch (error) {
    return handleRouteError(error, 'Could not update the order.');
  }
}
