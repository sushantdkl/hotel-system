import { NextResponse } from 'next/server';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import Database from '@/lib/db/index.js';
import { calculateBillTotals, parseSettingsRates } from '@/lib/billing-totals.js';
import { getOrderWorkspace, logPosEvent, ensureKotProSchema } from '@/lib/kot-service.js';
import { ensureOrderColumns } from '@/lib/online-orders.js';

async function buildProforma(db, orderId, { discount = 0 } = {}) {
  const workspace = await getOrderWorkspace(db, orderId);
  if (!workspace) throw Object.assign(new Error('Order not found.'), { status: 404 });

  const rows = await db.all('SELECT setting_key, setting_value FROM system_settings');
  const settings = {};
  for (const r of rows || []) settings[r.setting_key] = r.setting_value;
  const { vatPercent, servicePercent } = parseSettingsRates(settings);

  const subtotal = workspace.items.reduce((s, it) => s + Number(it.subtotal || 0), 0);
  const totals = calculateBillTotals(subtotal, {
    discountAmount: Number(discount) > 0 ? Number(discount) : undefined,
    vatPercent,
    servicePercent,
    deliveryFee: String(workspace.order?.order_type || '').toLowerCase() === 'delivery' ? Number(workspace.order?.delivery_fee || 0) : 0,
  });

  return { workspace, settings, totals, vatPercent, servicePercent };
}

/** Live proforma for the current order (no state change). */
export async function GET(request, context) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'waiter', 'cashier'], permission: 'bills.view' });
    if (auth.error) return auth.error;
    const { id } = await context.params;
    const orderId = parseInt(id, 10);
    const db = Database.getInstance();
    await ensureOrderColumns(db);
    const { workspace, totals } = await buildProforma(db, orderId);
    return NextResponse.json({ success: true, proforma: { ...workspace, totals } });
  } catch (error) {
    return handleRouteError(error, 'Could not build the bill.');
  }
}

/**
 * Proceed to billing: block while unsent items remain, move the order into the
 * billing/awaiting-payment state and return the server-computed proforma.
 */
export async function POST(request, context) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'waiter', 'cashier'], permission: 'bills.request' });
    if (auth.error) return auth.error;
    const { id } = await context.params;
    const orderId = parseInt(id, 10);
    if (!Number.isFinite(orderId)) return NextResponse.json({ error: 'Invalid order.' }, { status: 400 });
    const body = await request.json().catch(() => ({}));

    const db = Database.getInstance();
    await ensureOrderColumns(db);
    await ensureKotProSchema(db);

    const workspace = await getOrderWorkspace(db, orderId);
    if (!workspace) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    if (['completed', 'cancelled'].includes(String(workspace.order.status || ''))) {
      return NextResponse.json({ error: 'This order is already closed.' }, { status: 409 });
    }
    if (workspace.unsent_count > 0) {
      return NextResponse.json({
        error: `There are ${workspace.unsent_count} unsent item(s). Print their KOT before billing, or cancel them.`,
        code: 'unsent_items',
        unsent_count: workspace.unsent_count,
      }, { status: 409 });
    }
    if (!workspace.items.length) {
      return NextResponse.json({ error: 'This order has no billable items.', code: 'empty_order' }, { status: 409 });
    }

    const table_id = workspace.order.table_id;
    await db.run("UPDATE orders SET status = 'awaiting_payment', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [orderId]);
    if (table_id) {
      await db.run("UPDATE tables SET status = 'awaiting_payment', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [table_id]);
    }

    await logPosEvent(db, {
      action: 'order_moved_to_billing', actor_id: auth.user.id, actor_name: auth.user.full_name,
      order_id: orderId, table_id,
    });

    const { workspace: fresh, totals } = await buildProforma(db, orderId, { discount: body.discount });
    return NextResponse.json({ success: true, proforma: { ...fresh, totals } });
  } catch (error) {
    return handleRouteError(error, 'Could not proceed to billing.');
  }
}
