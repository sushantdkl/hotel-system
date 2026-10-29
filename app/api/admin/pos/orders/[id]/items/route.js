import { NextResponse } from 'next/server';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import Database from '@/lib/db/index.js';
import { assertVisibleStockAvailable, deductStockForItems, restoreStockForItems, ensureStockSchema, markOrderStockConsumed } from '@/lib/stock.js';
import { getOrderWorkspace, logPosEvent, ensureKotProSchema } from '@/lib/kot-service.js';
import { createComboSnapshot } from '@/lib/combos.js';
import { ensureMenuVariantsSchema } from '@/lib/menu-variants.js';
import { resolvePosItemInput } from '@/lib/pos-item-input.js';

async function loadOpenOrder(db, orderId) {
  const order = await db.get('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (!order) throw Object.assign(new Error('Order not found.'), { status: 404 });
  if (['completed', 'cancelled'].includes(String(order.status || ''))) {
    throw Object.assign(new Error('This order can no longer be edited.'), { status: 409 });
  }
  // Allow add/edit after bill screen — drop back to preparing so more KOTs can go out.
  if (String(order.status || '') === 'awaiting_payment') {
    await db.run(
      `UPDATE orders SET status = 'preparing', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [orderId]
    );
    if (order.table_id) {
      await db.run(
        `UPDATE tables SET status = 'cooking', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [order.table_id]
      ).catch(() => {});
    }
    order.status = 'preparing';
  }
  return order;
}

async function isReopenedOrder(db, orderId) {
  const bill = await db.get(
    `SELECT id FROM bills WHERE order_id = ? AND LOWER(COALESCE(status,'')) = 'reopened' ORDER BY id DESC LIMIT 1`,
    [orderId]
  );
  return Boolean(bill);
}

/** Add one or more unsent items to the draft. Deducts stock at add time (existing lifecycle). */
export async function POST(request, context) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'waiter', 'cashier'], permission: 'orders.update' });
    if (auth.error) return auth.error;
    const { id } = await context.params;
    const orderId = parseInt(id, 10);
    const body = await request.json();
    const incoming = Array.isArray(body.items) ? body.items : [];
    if (!incoming.length) return NextResponse.json({ error: 'Add at least one item.' }, { status: 400 });

    const db = Database.getInstance();
    await ensureKotProSchema(db);
    await ensureStockSchema(db);
    await ensureMenuVariantsSchema(db);

    const resolved = [];
    const result = await db.transaction(async (tx) => {
      await loadOpenOrder(tx, orderId);
      for (const raw of incoming) {
        const menuId = raw.menu_item_id ? parseInt(raw.menu_item_id, 10) : null;
        const menu = menuId ? await tx.get('SELECT id, name, base_price, is_available FROM menu_items WHERE id = ?', [menuId]) : null;
        if (menuId && (!menu || !menu.is_available)) {
          throw Object.assign(new Error('One of the selected items is no longer available.'), { status: 409 });
        }
        const resolvedInput = resolvePosItemInput(raw, menu);
        const name = resolvedInput.name;
        const quantity = Math.max(1, Math.min(999, parseInt(raw.quantity, 10) || 1));
        const variant = raw.variant_name || null;
        let price = resolvedInput.price;
        if (variant) {
          const variantRow = await tx.get('SELECT price, price_modifier FROM menu_item_variants WHERE menu_item_id = ? AND variant_name = ?', [menuId, variant]);
          if (!variantRow) throw Object.assign(new Error(`The selected variation for "${name}" is no longer available.`), { status: 409, code: 'variant_unavailable' });
          price = variantRow.price != null ? Number(variantRow.price) : price + Number(variantRow.price_modifier || 0);
        }
        const displayName = variant ? `${name} (${variant})` : name;
        const comboSnapshot = await createComboSnapshot(tx, { menu_item_id: menuId, item_name: displayName }, { channel: 'pos' });
        await assertVisibleStockAvailable(tx, {
          menu_item_id: menuId,
          item_name: displayName,
          variant_name: variant,
        }, quantity);
        const inserted = await tx.run(
          `INSERT INTO order_items
            (order_id, item_id, menu_item_id, item_name, variant_name, quantity, price, subtotal, special_instructions, status, sent_quantity, combo_snapshot, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, CURRENT_TIMESTAMP)`,
          [orderId, menuId, menuId, displayName, variant, quantity, price, price * quantity, raw.special_instructions || null, comboSnapshot]
        );
        resolved.push({
          order_item_id: inserted.lastInsertRowid,
          menu_item_id: menuId,
          item_name: displayName,
          variant_name: variant,
          quantity,
          price,
          subtotal: price * quantity,
          special_instructions: raw.special_instructions || null,
          combo_snapshot: comboSnapshot,
        });
      }
      await deductStockForItems(tx, resolved, { orderId, performedBy: auth.user.id });
      if (resolved.length) {
        await markOrderStockConsumed(tx, orderId);
      }
      await tx.run('UPDATE orders SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [orderId]);
      return true;
    });
    void result;

    await logPosEvent(db, {
      action: 'item_added', actor_id: auth.user.id, actor_name: auth.user.full_name,
      order_id: orderId, detail: resolved,
    });
    const workspace = await getOrderWorkspace(db, orderId);
    return NextResponse.json({ success: true, workspace });
  } catch (error) {
    if (error?.status && error.status < 500) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return handleRouteError(error, 'Could not add items.');
  }
}

/** Edit quantity / notes. Sent lines may be increased (extra unsent for a new KOT).
 *  Reducing below already-sent qty requires cancel-with-reason (or a reopened bill). */
export async function PATCH(request, context) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'waiter', 'cashier'], permission: 'orders.update' });
    if (auth.error) return auth.error;
    const { id } = await context.params;
    const orderId = parseInt(id, 10);
    const body = await request.json();
    const itemId = parseInt(body.order_item_id, 10);
    if (!Number.isFinite(itemId)) return NextResponse.json({ error: 'Missing item.' }, { status: 400 });

    const db = Database.getInstance();
    await ensureKotProSchema(db);
    let beforeItem = null;
    let afterItem = null;
    await db.transaction(async (tx) => {
      await loadOpenOrder(tx, orderId);
      const reopened = await isReopenedOrder(tx, orderId);
      const item = await tx.get('SELECT * FROM order_items WHERE id = ? AND order_id = ?', [itemId, orderId]);
      if (!item) throw Object.assign(new Error('Item not found.'), { status: 404 });
      if (['voided', 'cancelled'].includes(String(item.status || ''))) throw Object.assign(new Error('Item already removed.'), { status: 409 });
      const sentQty = Number(item.sent_quantity || 0);
      beforeItem = {
        order_item_id: item.id,
        item_name: item.item_name,
        variant_name: item.variant_name,
        quantity: Number(item.quantity || 0),
        price: Number(item.price || 0),
        subtotal: Number(item.subtotal || 0),
        special_instructions: item.special_instructions || null,
      };
      const newQty = body.quantity != null ? Math.max(1, Math.min(999, parseInt(body.quantity, 10) || 1)) : Number(item.quantity);
      // Already-sent lines: may increase (extra unsent qty for a new KOT) or shrink
      // only the unsent portion. Cutting below sent qty requires cancel-with-reason.
      if (sentQty > 0 && !reopened && newQty < sentQty) {
        throw Object.assign(new Error('This item was already sent on a KOT — cancel it with a reason instead.'), { status: 409, code: 'already_sent' });
      }
      const price = Number(item.price || 0);
      const delta = newQty - Number(item.quantity);
      if (delta > 0) {
        await assertVisibleStockAvailable(tx, {
          menu_item_id: item.menu_item_id || item.item_id,
          item_name: item.item_name,
          variant_name: item.variant_name,
        }, delta);
        await deductStockForItems(tx, [{ menu_item_id: item.menu_item_id || item.item_id, item_name: item.item_name, variant_name: item.variant_name, quantity: delta, combo_snapshot: item.combo_snapshot }], { orderId });
        await markOrderStockConsumed(tx, orderId);
      } else if (delta < 0) {
        await restoreStockForItems(tx, [{ menu_item_id: item.menu_item_id || item.item_id, item_name: item.item_name, variant_name: item.variant_name, quantity: -delta, combo_snapshot: item.combo_snapshot }], { orderId, reason: reopened ? 'Reopened quantity reduced' : 'Unsent quantity reduced' });
      }
      // Keep sent_quantity ≤ quantity so Print KOT only covers truly new portions.
      const nextSent = reopened && sentQty > 0 ? Math.min(sentQty, newQty) : Math.min(sentQty, newQty);
      await tx.run(
        `UPDATE order_items SET quantity = ?, sent_quantity = ?, subtotal = ?, special_instructions = COALESCE(?, special_instructions) WHERE id = ?`,
        [newQty, nextSent, price * newQty, body.special_instructions ?? null, itemId]
      );
      afterItem = {
        ...beforeItem,
        quantity: newQty,
        subtotal: price * newQty,
        special_instructions: body.special_instructions ?? item.special_instructions ?? null,
      };
    });

    await logPosEvent(db, {
      action: 'item_edited', actor_id: auth.user.id, actor_name: auth.user.full_name,
      order_id: orderId, previous_value: JSON.stringify(beforeItem), new_value: JSON.stringify(afterItem), detail: afterItem,
    });
    const workspace = await getOrderWorkspace(db, orderId);
    return NextResponse.json({ success: true, workspace });
  } catch (error) {
    if (error?.status && error.status < 500) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return handleRouteError(error, 'Could not edit the item.');
  }
}

/** Remove an item. Sent items may be removed only while the bill is reopened. */
export async function DELETE(request, context) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'waiter', 'cashier'], permission: 'orders.update' });
    if (auth.error) return auth.error;
    const { id } = await context.params;
    const orderId = parseInt(id, 10);
    const { searchParams } = new URL(request.url);
    const itemId = parseInt(searchParams.get('order_item_id') || '', 10);
    if (!Number.isFinite(itemId)) return NextResponse.json({ error: 'Missing item.' }, { status: 400 });

    const db = Database.getInstance();
    await ensureKotProSchema(db);
    let removedItem = null;
    await db.transaction(async (tx) => {
      await loadOpenOrder(tx, orderId);
      const reopened = await isReopenedOrder(tx, orderId);
      const item = await tx.get('SELECT * FROM order_items WHERE id = ? AND order_id = ?', [itemId, orderId]);
      if (!item) throw Object.assign(new Error('Item not found.'), { status: 404 });
      if (Number(item.sent_quantity || 0) > 0 && !reopened) {
        throw Object.assign(new Error('This item was already sent on a KOT — cancel it with a reason instead.'), { status: 409, code: 'already_sent' });
      }
      removedItem = {
        order_item_id: item.id,
        menu_item_id: item.menu_item_id || item.item_id || null,
        item_name: item.item_name,
        variant_name: item.variant_name,
        quantity: Number(item.quantity || 0),
        price: Number(item.price || 0),
        subtotal: Number(item.subtotal || (Number(item.price || 0) * Number(item.quantity || 0))),
        special_instructions: item.special_instructions || null,
      };
      await restoreStockForItems(tx, [{ menu_item_id: item.menu_item_id || item.item_id, item_name: item.item_name, variant_name: item.variant_name, quantity: item.quantity, combo_snapshot: item.combo_snapshot }], { orderId, reason: reopened ? 'Reopened item removed' : 'Unsent item removed' });
      await tx.run('DELETE FROM order_items WHERE id = ?', [itemId]);
    });

    await logPosEvent(db, {
      action: 'item_removed', actor_id: auth.user.id, actor_name: auth.user.full_name,
      order_id: orderId, previous_value: JSON.stringify(removedItem), detail: removedItem,
    });
    const workspace = await getOrderWorkspace(db, orderId);
    return NextResponse.json({ success: true, workspace });
  } catch (error) {
    if (error?.status && error.status < 500) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return handleRouteError(error, 'Could not remove the item.');
  }
}
