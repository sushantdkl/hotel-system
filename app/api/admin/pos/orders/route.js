import { NextResponse } from 'next/server';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import Database from '@/lib/db/index.js';
import { OrderRepository } from '@/lib/db/repositories/orders.js';
import { getOrderWorkspace, logPosEvent, ensureKotProSchema } from '@/lib/kot-service.js';
import { ensureColumn } from '@/lib/db/schema-helpers.js';

const orderRepo = new OrderRepository();

/** List active POS orders (dine-in + takeaway) that still need attention. */
export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'waiter', 'cashier'], permission: 'orders.view' });
    if (auth.error) return auth.error;
    const orders = await orderRepo.getActiveOrders();
    return NextResponse.json({ success: true, orders });
  } catch (error) {
    return handleRouteError(error, 'Could not load active orders.');
  }
}

/**
 * Open (or resume) a single active order for a table, or start a takeaway order.
 * Pass `new_party: true` to create an additional independent order/tab on an
 * already-occupied table (multi-person dining).
 */
export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'waiter', 'cashier'], permission: 'orders.create' });
    if (auth.error) return auth.error;
    const body = await request.json();
    const tableId = body.table_id ? parseInt(body.table_id, 10) : null;
    const orderType = tableId ? 'dine_in' : (body.order_type || 'takeaway');
    const newParty = Boolean(body.new_party);

    const db = Database.getInstance();
    await ensureKotProSchema(db);
    await ensureColumn(db, 'orders', 'party_label', 'TEXT').catch(() => {});

    if (tableId && !newParty) {
      // Resume the table's current active order if one already exists.
      const table = await db.get('SELECT * FROM tables WHERE id = ?', [tableId]);
      if (!table) return NextResponse.json({ error: 'Table not found.' }, { status: 404 });
      if (table.current_order_id) {
        const current = await db.get(
          `SELECT * FROM orders WHERE id = ? AND status NOT IN ('completed','cancelled')`,
          [table.current_order_id]
        );
        if (current) {
          const workspace = await getOrderWorkspace(db, current.id);
          return NextResponse.json({ success: true, resumed: true, order_id: current.id, workspace });
        }
      }
      // Guard against a stray active order that isn't yet linked to the table.
      const stray = await db.get(
        `SELECT * FROM orders WHERE table_id = ? AND status NOT IN ('completed','cancelled') ORDER BY id DESC LIMIT 1`,
        [tableId]
      );
      if (stray) {
        await db.run('UPDATE tables SET current_order_id = ? WHERE id = ?', [stray.id, tableId]);
        const workspace = await getOrderWorkspace(db, stray.id);
        return NextResponse.json({ success: true, resumed: true, order_id: stray.id, workspace });
      }
    }

    if (tableId && newParty) {
      const table = await db.get('SELECT * FROM tables WHERE id = ?', [tableId]);
      if (!table) return NextResponse.json({ error: 'Table not found.' }, { status: 404 });
    }

    let partyLabel = body.party_label || null;
    if (tableId && !partyLabel) {
      const countRow = await db.get(
        `SELECT COUNT(*) AS c FROM orders WHERE table_id = ? AND status NOT IN ('completed','cancelled')`,
        [tableId]
      );
      const n = Number(countRow?.c || 0) + 1;
      partyLabel = n <= 1 ? 'Party 1' : `Party ${n}`;
    }

    const created = await orderRepo.create({
      table_id: tableId,
      order_type: orderType,
      customer_name: body.customer_name || null,
      customer_phone: body.customer_phone || null,
      notes: body.notes || null,
      items: [],
      new_party: newParty || Boolean(tableId && body.keep_existing),
      party_label: partyLabel,
    });

    await logPosEvent(db, {
      action: newParty ? 'party_created' : 'order_created',
      actor_id: auth.user.id,
      actor_name: auth.user.full_name,
      order_id: created.order_id,
      table_id: tableId,
      new_value: created.order_number,
      detail: { order_type: orderType, party_label: partyLabel },
    });

    const workspace = await getOrderWorkspace(db, created.order_id);
    return NextResponse.json({
      success: true,
      order_id: created.order_id,
      workspace,
      party_label: partyLabel,
    }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Could not open the order.');
  }
}
