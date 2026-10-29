import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { checkRateLimit, clientIp } from '@/lib/rate-limit.js';
import { ensureOrderColumns } from '@/lib/online-orders.js';
import { nextDocumentNumber } from '@/lib/document-numbers.js';
import { currentBusinessDayId } from '@/lib/business-days.js';
import { calculateDeliveryPricing, loadDeliveryPricing } from '@/lib/delivery-pricing.js';
import { ensureMenuVariantsSchema } from '@/lib/menu-variants.js';
import { loadOnlineOrderMinimum } from '@/lib/online-order-minimum.js';
import { ensurePromotionSchema, evaluatePromotion, recordPromotionRedemption } from '@/lib/promotions.js';
import { comboAvailableOn, createComboSnapshot, getCombosForMenuItems } from '@/lib/combos.js';
import { assertVisibleStockAvailable } from '@/lib/stock.js';

async function savedOrderResponse(db, order) {
  const items = await db.all(
    `SELECT item_name, quantity, price, subtotal
       FROM order_items WHERE order_id = ? ORDER BY id`,
    [order.id]
  );
  const subtotal = items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
  const discount = Number(order.discount_amount || 0);
  const promotion = order.promotion_id ? await db.get('SELECT name FROM promotions WHERE id = ?', [order.promotion_id]).catch(() => null) : null;
  return {
    order_number: order.order_number,
    customer_name: order.customer_name,
    customer_phone: order.customer_phone,
    order_type: order.order_type,
    delivery_address: order.delivery_address || '',
    nearby_landmark: order.nearby_landmark || '',
    customer_note: order.customer_note || '',
    items,
    subtotal,
    discount,
    promotion_name: promotion?.name || '',
    promotion_code: order.promotion_code || '',
    delivery_charge: Number(order.delivery_fee || 0),
    delivery_pricing_label: order.delivery_pricing_label || '',
    delivery_distance_km: order.delivery_distance_km == null ? null : Number(order.delivery_distance_km),
    grand_total: Math.max(0, subtotal - discount) + Number(order.delivery_fee || 0),
  };
}

/** Public checkout: persist once, then return the canonical saved order. */
export async function POST(request) {
  try {
    const ip = clientIp(request);
    const rl = await checkRateLimit({ key: `public_order:${ip}`, limit: 6, windowSeconds: 60 });
    if (!rl.ok) return NextResponse.json({ error: 'Too many orders too fast. Please wait a moment.' }, { status: 429 });

    const data = await request.json().catch(() => ({}));
    const name = String(data.customer_name || '').trim().slice(0, 80);
    const phone = String(data.customer_phone || '').trim().slice(0, 30);
    const deliveryAddress = String(data.delivery_address || data.location || '').trim().slice(0, 200);
    const nearbyLandmark = String(data.nearby_landmark || '').trim().slice(0, 160);
    const customerNote = String(data.customer_note || '').trim().slice(0, 500);
    const idempotencyKey = String(data.idempotency_key || '').trim().slice(0, 100);
    const orderType = ['delivery', 'takeaway'].includes(data.order_type) ? data.order_type : 'takeaway';
    const deliveryBandId = String(data.delivery_band_id || '').trim().slice(0, 80);
    const deliveryDistanceKm = data.delivery_distance_km;
    const items = Array.isArray(data.items) ? data.items : [];
    const phoneDigits = phone.replace(/\D/g, '');

    if (!name) return NextResponse.json({ error: 'Please enter your name.', field: 'name' }, { status: 400 });
    if (/[A-Za-z]/.test(phone) || phoneDigits.length < 10 || phoneDigits.length > 15) {
      return NextResponse.json({ error: 'Please enter a valid phone number.', field: 'phone' }, { status: 400 });
    }
    if (orderType === 'delivery' && !deliveryAddress) {
      return NextResponse.json({ error: 'Please enter a delivery location.', field: 'delivery_address' }, { status: 400 });
    }
    if (!items.length) return NextResponse.json({ error: 'Your cart is empty.' }, { status: 400 });
    if (!idempotencyKey) return NextResponse.json({ error: 'Please retry checkout from your cart.' }, { status: 400 });

    const db = Database.getInstance();
    await ensureOrderColumns(db);
    await ensureMenuVariantsSchema(db);
    await ensurePromotionSchema(db);

    const deliveryConfig = await loadDeliveryPricing(db);
    const delivery = calculateDeliveryPricing(deliveryConfig, {
      orderType,
      bandId: deliveryBandId,
      distanceKm: deliveryDistanceKm,
    });

    const existing = await db.get('SELECT * FROM orders WHERE idempotency_key = ?', [idempotencyKey]);
    if (existing) {
      const order = await savedOrderResponse(db, existing);
      return NextResponse.json({ message: 'Order already placed.', order_number: order.order_number, total: order.grand_total, order, idempotent: true });
    }

    // Re-price every line from the database. Client prices and totals are ignored.
    const resolved = [];
    const requestedIds = items.map((item) => Number(item.menu_item_id || item.id)).filter(Boolean);
    const combosByItem = await getCombosForMenuItems(db, requestedIds);
    for (const item of items) {
      const id = Number(item.menu_item_id || item.id);
      const quantity = Math.max(1, Math.min(50, parseInt(item.quantity, 10) || 1));
      if (!id) continue;
      const menuItem = await db.get('SELECT id, name, category_id, base_price, is_available FROM menu_items WHERE id = ?', [id]);
      if (!menuItem || !menuItem.is_available) continue;
      const combo = combosByItem.get(id);
      if (combo && !comboAvailableOn(combo, 'website')) continue;
      let price = Number(menuItem.base_price);
      let itemName = menuItem.name;
      let variantName = null;
      if (item.variant_name) {
        const variant = await db.get(
          'SELECT variant_name, price, price_modifier FROM menu_item_variants WHERE menu_item_id = ? AND variant_name = ?',
          [id, String(item.variant_name)]
        );
        if (!variant) continue;
        variantName = variant.variant_name;
        price = variant.price != null ? Number(variant.price) : price + Number(variant.price_modifier || 0);
        itemName = `${menuItem.name} (${variantName})`;
      }
      const comboSnapshot = await createComboSnapshot(db, { menu_item_id: id, item_name: itemName }, { channel: 'website' });
      resolved.push({ menu_item_id: id, category_id: menuItem.category_id, item_name: itemName, variant_name: variantName, quantity, price, subtotal: price * quantity, combo_snapshot: comboSnapshot });
    }
    if (!resolved.length) return NextResponse.json({ error: 'None of the selected items are available.' }, { status: 400 });
    for (const item of resolved) await assertVisibleStockAvailable(db, item, item.quantity);

    const subtotal = resolved.reduce((sum, item) => sum + item.subtotal, 0);
    const minimumOrderAmount = await loadOnlineOrderMinimum(db);
    if (minimumOrderAmount > 0 && subtotal < minimumOrderAmount) {
      const remaining = minimumOrderAmount - subtotal;
      return NextResponse.json(
        { error: `Minimum online order is Rs. ${minimumOrderAmount.toLocaleString('en-IN')}. Add Rs. ${remaining.toLocaleString('en-IN')} more.`, field: 'minimum_order' },
        { status: 400 }
      );
    }

    const promotion = await evaluatePromotion(db, {
      items: resolved,
      channel: 'website',
      couponCode: String(data.coupon_code || '').trim(),
      customerPhone: phone,
    });
    if (data.coupon_code && !promotion) {
      return NextResponse.json({ error: 'This coupon is invalid or not eligible for this cart.', field: 'coupon_code' }, { status: 400 });
    }

    const notes = orderType === 'delivery'
      ? `Online order (website) — Deliver to: ${deliveryAddress}${nearbyLandmark ? ` — Landmark: ${nearbyLandmark}` : ''}${customerNote ? ` — Note: ${customerNote}` : ''}`
      : `Online order (website) — Takeaway/pickup${customerNote ? ` — Note: ${customerNote}` : ''}`;

    let result;
    try {
      result = await db.transaction(async (tx) => {
        const businessDayId = await currentBusinessDayId(tx, { required: true });
        const orderNumber = await nextDocumentNumber(tx, { type: 'web_order', prefix: 'WEB' });
        const orderRes = await tx.run(
          `INSERT INTO orders (order_number, table_id, table_number, order_type, status, payment_status, waiter_id,
             customer_name, customer_phone, delivery_address, nearby_landmark, customer_note, idempotency_key,
             delivery_fee, delivery_distance_km, delivery_pricing_label, promotion_id, promotion_code, promotion_channel, discount_amount,
             notes, business_day_id, created_at, updated_at)
           VALUES (?, NULL, NULL, ?, 'pending', 'unpaid', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [orderNumber, orderType, name, phone, deliveryAddress || null, nearbyLandmark || null, customerNote || null, idempotencyKey,
            delivery.fee, delivery.distanceKm, delivery.label || null, promotion?.id || null, promotion?.code || null, promotion ? 'website' : null, promotion?.discount || 0, notes, businessDayId]
        );
        const orderId = orderRes.lastInsertRowid;
        for (const item of resolved) {
          await tx.run(
            `INSERT INTO order_items (order_id, item_id, menu_item_id, item_name, variant_name, quantity, price, subtotal, special_instructions, status, combo_snapshot, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, CURRENT_TIMESTAMP)`,
            [orderId, item.menu_item_id, item.menu_item_id, item.item_name, item.variant_name || null, item.quantity, item.price, item.subtotal, null, item.combo_snapshot || null]
          );
        }
        await recordPromotionRedemption(tx, { promotion, orderId, channel: 'website', customerPhone: phone });
        return { orderId };
      });
    } catch (error) {
      // A concurrent retry can win the unique idempotency-key race.
      if (!/unique|duplicate/i.test(String(error?.message || error?.code || ''))) throw error;
      const duplicate = await db.get('SELECT * FROM orders WHERE idempotency_key = ?', [idempotencyKey]);
      if (!duplicate) throw error;
      const order = await savedOrderResponse(db, duplicate);
      return NextResponse.json({ message: 'Order already placed.', order_number: order.order_number, total: order.grand_total, order, idempotent: true });
    }

    const saved = await db.get('SELECT * FROM orders WHERE id = ?', [result.orderId]);
    const order = await savedOrderResponse(db, saved);
    return NextResponse.json(
      { message: 'Order placed! We will call you to confirm.', order_number: order.order_number, total: order.grand_total, order },
      { status: 201 }
    );
  } catch (error) {
    console.error('public order error', error);
    const status = error?.status || 500;
    return NextResponse.json(
      { error: status >= 500 ? 'Could not place the order. Please try again or call us.' : error.message, field: error?.field },
      { status }
    );
  }
}
