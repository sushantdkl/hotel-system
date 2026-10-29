import { OrderRepository } from '@/lib/db/repositories/orders.js';
import { requireAuth } from '@/lib/api-guard.js';
import { isAdminLike } from '@/lib/roles.js';

async function verifyAuth(request, permission) {
  const auth = await requireAuth(request, { permission });
  if (auth.error) throw Object.assign(new Error('You do not have access to this action.'), { status: 403 });
  return auth.user;
}

// GET - List orders
export async function GET(request) {
  try {
    const user = await verifyAuth(request, 'orders.view');
    const { searchParams } = new URL(request.url);
    
    const filters = {
      status: searchParams.get('status'),
      waiter_id: searchParams.get('waiter_id'),
      order_type: searchParams.get('order_type'),
      limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')) : null
    };
    
    // Remove null values
    Object.keys(filters).forEach(key => filters[key] === null && delete filters[key]);
    
    const orderRepo = new OrderRepository();
    // Write-on-read cleanup only when explicitly requested (not on kitchen polls)
    if (searchParams.get('heal') === '1') {
      await orderRepo.cancelOrphanTableOrders();
    }

    if (searchParams.get('board') === 'kitchen' || searchParams.get('include_items') === '1') {
      const board = await orderRepo.getKitchenBoard({
        limit: filters.limit || 40,
      });
      return Response.json(board);
    }

    const orders = await orderRepo.getAll(filters);
    
    return Response.json({ orders });
    
  } catch (error) {
    console.error('Get orders error:', error);
    const authFail = /authorization|session|token/i.test(error.message || '');
    return Response.json(
      {
        error: authFail ? 'Please sign in again to continue.' : 'Could not load orders. Please refresh.',
        details: authFail ? undefined : error.message,
      },
      { status: authFail ? 401 : 500 }
    );
  }
}

// POST - Create order
export async function POST(request) {
  try {
    const user = await verifyAuth(request, 'orders.create');
    const orderData = await request.json();
    
    // Add waiter_id from authenticated user if role is waiter
    if (user.role === 'waiter') {
      orderData.waiter_id = user.id;
    } else if (!orderData.waiter_id && user.id) {
      orderData.waiter_id = user.id;
    }

    // Takeaway / customer: same customers table as admin billing
    const wantsCustomer =
      orderData.customer_mode === 'customer' ||
      (!!orderData.customer_phone && String(orderData.order_type || '').includes('take'));

    if (wantsCustomer && orderData.customer_phone) {
      try {
        const Database = (await import('@/lib/db/index.js')).default;
        const { resolveCustomerForSale } = await import('@/lib/customers.js');
        const db = Database.getInstance();
        const customerInfo = await resolveCustomerForSale(db, {
          mode: 'customer',
          phone: orderData.customer_phone,
          name: orderData.customer_name,
          address: orderData.customer_address || '',
          amount: 0,
          recordSale: false,
        });
        orderData.customer_name = customerInfo.customer_name;
        orderData.customer_phone = customerInfo.customer_phone;
        orderData.customer_id = customerInfo.customer_id;
      } catch (e) {
        return Response.json(
          { error: e.message || 'Please check customer details.', code: 'customer_invalid' },
          { status: 400 }
        );
      }
    }
    
    // Block walk-in onto reserved tables unless force + admin
    if (orderData.table_id && !orderData.reservation_id) {
      const { upcomingHoldWarning } = await import('@/lib/reservation-conflicts.js');
      const Database = (await import('@/lib/db/index.js')).default;
      const warning = await upcomingHoldWarning(orderData.table_id, Database.getInstance());
      if (warning) {
        const canForce = isAdminLike(user.role) && orderData.force === true;
        if (!canForce) {
          return Response.json(
            {
              error: warning.message,
              code: warning.code,
              reservation: {
                id: warning.reservation?.id,
                name: warning.reservation?.name,
                time: warning.reservation?.time,
                guests: warning.reservation?.guests,
              },
              alternatives: warning.alternatives || [],
            },
            { status: 409 }
          );
        }
        orderData.notes = [
          orderData.notes || '',
          `Override reserved table: ${warning.reservation?.name} (${orderData.force_reason || 'host override'})`,
        ]
          .filter(Boolean)
          .join('\n');
      }
    }

    const orderRepo = new OrderRepository();
    const result = await orderRepo.create(orderData);
    // Items stay unsent until an explicit KOT send (/kot).
    
    const order = await orderRepo.getById(result.order_id);
    
    return Response.json({ 
      success: true, 
      order,
      order_id: result.order_id,
      order_number: result.order_number,
      kot: null,
      stock: result.stock || null,
    }, { status: 201 });
    
  } catch (error) {
    console.error('Create order error:', error);
    return Response.json(
      { error: 'We could not send this order. Please try again.', code: 'order_failed' },
      { status: 500 }
    );
  }
}

// PATCH - Update order status
export async function PATCH(request) {
  try {
    const user = await verifyAuth(request, 'orders.update');
    const { id, status, cancel_reason } = await request.json();
    
    const orderRepo = new OrderRepository();
    
    if (status === 'cancelled') {
      const reason = String(cancel_reason || '').trim();
      if (!reason) {
        return Response.json({ error: 'A cancel reason is required.' }, { status: 400 });
      }
      if (!['admin', 'cashier', 'waiter'].includes(user.role)) {
        return Response.json({ error: 'You do not have permission to cancel orders.' }, { status: 403 });
      }
      const items = await orderRepo.getOrderItems(id);
      const activeItems = (items || []).filter((item) => !['voided', 'cancelled'].includes(item.status));
      if (activeItems.length > 0 && user.role === 'waiter') {
        return Response.json({ error: 'Only a cashier or admin can cancel an order that already has items.' }, { status: 403 });
      }
      await orderRepo.cancelOrder(id, reason, { actorId: user.id });
      try {
        const { cancelReservationForOrder, CANCEL_REASON } = await import('@/lib/leads.js');
        await cancelReservationForOrder(id, CANCEL_REASON.RESTAURANT);
      } catch (e) {
        console.warn('Reservation cancel hook:', e?.message || e);
      }
    } else {
      await orderRepo.updateStatus(id, status);
    }
    
    const order = await orderRepo.getById(id);
    
    return Response.json({ success: true, order });
    
  } catch (error) {
    console.error('Update order error:', error);
    const status = error.status || 500;
    return Response.json(
      { error: error.message || 'Could not update the order. Please try again.' },
      { status: [400, 403, 404, 409].includes(status) ? status : 500 }
    );
  }
}
