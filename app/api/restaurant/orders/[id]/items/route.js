import { OrderRepository } from '@/lib/db/repositories/orders.js';
import { requireAuth } from '@/lib/api-guard.js';

async function verifyAuth(request, permission) {
  const auth = await requireAuth(request, { permission });
  if (auth.error) throw Object.assign(new Error('You do not have access to this action.'), { status: 403 });
  return auth.user;
}

// POST - Add items to existing order
export async function POST(request, context) {
  try {
    const user = await verifyAuth(request, 'orders.update');
    const { params } = context;
    const { id: orderId } = await params;
    const body = await request.json();
    const { items } = body;
    
    if (!items || items.length === 0) {
      return Response.json(
        { error: 'Please add at least one item.' },
        { status: 400 }
      );
    }
    
    const orderRepo = new OrderRepository();
    
    // Verify order exists and is not completed/cancelled
    const order = await orderRepo.getById(orderId);
    if (!order) {
      return Response.json(
        { error: 'This order could not be found.' },
        { status: 404 }
      );
    }
    
    if (['completed', 'cancelled', 'awaiting_payment'].includes(order.status)) {
      return Response.json(
        {
          error: order.status === 'awaiting_payment'
            ? 'This table is awaiting payment. Unlock by cancelling the bill request first, or finish checkout.'
            : 'This order is already finished, so new items cannot be added.',
        },
        { status: 400 }
      );
    }
    
    // Add items only — KOT is issued explicitly via /kot (Save KOT / Send to Kitchen).
    await orderRepo.addItems(orderId, items);

    // Get updated order
    const updatedOrder = await orderRepo.getById(orderId);
    const orderItems = await orderRepo.getOrderItems(orderId);
    
    return Response.json({ 
      success: true,
      message: 'Items added to the order. Send a KOT when ready for the kitchen.',
      order: updatedOrder,
      items: orderItems,
      kot: null,
    });
    
  } catch (error) {
    console.error('Add items error:', error);
    const authFail = /authorization|session|token/i.test(error.message || '');
    return Response.json(
      { error: authFail ? 'Please sign in again to continue.' : 'Could not add items. Please try again.' },
      { status: authFail ? 401 : 500 }
    );
  }
}

// PATCH - Void a line item
export async function PATCH(request, context) {
  try {
    const user = await verifyAuth(request, 'orders.update');
    const { params } = context;
    const { id: orderId } = await params;
    const body = await request.json();
    const itemId = body.item_id || body.id;
    const reason = String(body.reason || body.void_reason || '').trim();

    if (!itemId) {
      return Response.json({ error: 'Missing item id.' }, { status: 400 });
    }
    if (!reason) {
      return Response.json({ error: 'A void reason is required.' }, { status: 400 });
    }

    const orderRepo = new OrderRepository();
    const order = await orderRepo.getById(orderId);
    if (!order) {
      return Response.json({ error: 'This order could not be found.' }, { status: 404 });
    }

    const item = await orderRepo.db.get(
      `SELECT * FROM order_items WHERE id = ? AND order_id = ?`,
      [itemId, orderId]
    );
    if (!item) {
      return Response.json({ error: 'Order item not found.' }, { status: 404 });
    }

    const itemStatus = item.status || 'pending';
    const unprepared = ['pending'].includes(itemStatus);
    // Waiter: only void unprepared lines; admin/cashier: any open-order line
    if (user.role === 'waiter' && !unprepared) {
      return Response.json(
        { error: 'Only a cashier or admin can void items already sent to the kitchen.' },
        { status: 403 }
      );
    }
    if (!['admin', 'cashier', 'waiter'].includes(user.role)) {
      return Response.json({ error: 'You cannot void items.' }, { status: 403 });
    }

    await orderRepo.voidItem(orderId, itemId, reason);
    const items = await orderRepo.getOrderItems(orderId);
    const updated = await orderRepo.getById(orderId);

    return Response.json({ success: true, order: updated, items });
  } catch (error) {
    console.error('Void item error:', error);
    return Response.json(
      { error: error.message || 'Could not void this item.' },
      { status: 400 }
    );
  }
}
