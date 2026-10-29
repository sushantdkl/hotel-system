import { NextResponse } from 'next/server';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import Database from '@/lib/db/index.js';
import { cancelKot } from '@/lib/kot-service.js';
import { formatNepalDateTime } from '@/lib/report-dates.js';

/**
 * GET /api/admin/pos/kots/[id] — single KOT with its items, for the
 * click-to-preview popup on bills/order/report screens. Deliberately no extra
 * permission beyond being one of the roles that can already see a KOT on the
 * board — this only reads a ticket the caller could already see there.
 */
export async function GET(request, context) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'waiter', 'cashier', 'kitchen'], permission: 'kots.view' });
    if (auth.error) return auth.error;

    const { id } = await context.params;
    const kotId = parseInt(id, 10);
    if (!Number.isFinite(kotId)) return NextResponse.json({ error: 'Invalid KOT.' }, { status: 400 });

    const db = Database.getInstance();
    const kot = await db.get(
      `SELECT k.*, o.order_number, o.table_number, o.notes AS order_notes
       FROM kots k JOIN orders o ON o.id = k.order_id
       WHERE k.id = ?`,
      [kotId]
    );
    if (!kot) return NextResponse.json({ error: 'KOT not found.' }, { status: 404 });

    const items = await db.all(
      `SELECT COALESCE(oi.item_name, mi.name, 'Item') AS item_name, ki.quantity, ki.status, ki.special_instructions
       FROM kot_items ki
       LEFT JOIN order_items oi ON oi.id = ki.order_item_id
       LEFT JOIN menu_items mi ON mi.id = ki.menu_item_id
       WHERE ki.kot_id = ? ORDER BY ki.id`,
      [kotId]
    );

    return NextResponse.json({
      kot: {
        id: kot.id,
        kotNumber: kot.kot_number || `KOT-${kot.id}`,
        station: kot.station || null,
        status: kot.status || null,
        orderNumber: kot.order_number,
        tableNumber: kot.table_number || null,
        orderNotes: kot.order_notes || null,
        cancelReason: kot.cancel_reason || kot.void_reason || null,
        printedAt: kot.printed_at,
        startedAt: kot.started_at,
        completedAt: kot.completed_at,
        printedAtDisplay: formatNepalDateTime(kot.printed_at),
        startedAtDisplay: formatNepalDateTime(kot.started_at),
        completedAtDisplay: formatNepalDateTime(kot.completed_at),
        items: (items || []).map((i) => ({
          name: i.item_name, quantity: Number(i.quantity) || 0,
          status: i.status || null, instructions: i.special_instructions || null,
        })),
      },
    });
  } catch (error) {
    return handleRouteError(error, 'Could not load the kitchen ticket.');
  }
}

/** Cancel a KOT snapshot with a mandatory custom reason. */
async function cancelKotRequest(request, context) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'waiter', 'cashier', 'kitchen'], permission: 'kots.cancel' });
    if (auth.error) return auth.error;

    const { id } = await context.params;
    const kotId = parseInt(id, 10);
    if (!Number.isFinite(kotId)) return NextResponse.json({ error: 'Invalid KOT.' }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const db = Database.getInstance();
    const { kot } = await cancelKot(db, {
      kotId,
      reason: body.reason,
      prepared: body.prepared === true,
      actor: auth.user,
    });

    return NextResponse.json({ success: true, kot, message: 'KOT cancelled.' });
  } catch (error) {
    if (error?.status && error.status < 500) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return handleRouteError(error, 'Could not cancel the kitchen ticket.');
  }
}

export async function PATCH(request, context) {
  return cancelKotRequest(request, context);
}

export async function DELETE(request, context) {
  return cancelKotRequest(request, context);
}
