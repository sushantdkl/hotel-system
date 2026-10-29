import pg from 'pg';
import { buildWhatsAppOrderMessage, buildWhatsAppOrderUrl } from '../lib/whatsapp-order.js';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3002';
const createdOrderIds = [];

const postOrder = (body) => fetch(`${baseUrl}/api/public/orders`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

try {
  const item = (await pool.query(
    'SELECT id FROM menu_items WHERE COALESCE(is_available,1)=1 ORDER BY id LIMIT 1'
  )).rows[0];
  if (!item) throw new Error('No available menu item exists for checkout verification.');
  const stamp = Date.now();
  const common = {
    customer_phone: '9800000001',
    items: [{ menu_item_id: item.id, quantity: 2 }],
  };

  const missingName = await postOrder({
    ...common, customer_name: '', order_type: 'takeaway', idempotency_key: `missing-name-${stamp}`,
  });
  const missingAddress = await postOrder({
    ...common, customer_name: 'Checkout Test', order_type: 'delivery', delivery_address: '', idempotency_key: `missing-address-${stamp}`,
  });
  if (missingName.status !== 400 || missingAddress.status !== 400) {
    throw new Error(`Checkout validation failed: name=${missingName.status}, address=${missingAddress.status}`);
  }

  const deliveryKey = `delivery-checkout-${stamp}`;
  const note = 'Medium spicy & no peanuts — call "me".';
  const deliveryPayload = {
    ...common,
    customer_name: 'Delivery Checkout Test',
    order_type: 'delivery',
    delivery_address: 'New Baneshwor, Kathmandu',
    nearby_landmark: 'Opposite ABC Bank',
    customer_note: note,
    idempotency_key: deliveryKey,
  };
  const deliveryResponse = await postOrder(deliveryPayload);
  const delivery = await deliveryResponse.json();
  if (deliveryResponse.status !== 201) throw new Error(`Delivery checkout failed: ${deliveryResponse.status} ${delivery.error}`);
  const deliveryRow = (await pool.query('SELECT * FROM orders WHERE idempotency_key=$1', [deliveryKey])).rows[0];
  createdOrderIds.push(deliveryRow.id);

  const retryResponse = await postOrder(deliveryPayload);
  const retry = await retryResponse.json();
  const duplicateCount = Number((await pool.query('SELECT COUNT(*) FROM orders WHERE idempotency_key=$1', [deliveryKey])).rows[0].count);
  const message = buildWhatsAppOrderMessage(delivery.order);
  const url = buildWhatsAppOrderUrl('9779808174841', message);

  const pickupKey = `pickup-checkout-${stamp}`;
  const pickupResponse = await postOrder({
    ...common,
    customer_name: 'Pickup Checkout Test',
    order_type: 'takeaway',
    customer_note: 'Pack sauce separately.',
    idempotency_key: pickupKey,
  });
  const pickup = await pickupResponse.json();
  if (pickupResponse.status !== 201) throw new Error(`Pickup checkout failed: ${pickupResponse.status} ${pickup.error}`);
  const pickupRow = (await pool.query('SELECT * FROM orders WHERE idempotency_key=$1', [pickupKey])).rows[0];
  createdOrderIds.push(pickupRow.id);

  const assertions = {
    saved_before_message: Boolean(deliveryRow?.id && delivery.order?.order_number === deliveryRow.order_number),
    online_queue_number: String(deliveryRow.order_number).startsWith('WEB-') && deliveryRow.status === 'pending',
    delivery_details_saved: deliveryRow.customer_name === deliveryPayload.customer_name
      && deliveryRow.customer_phone === deliveryPayload.customer_phone
      && deliveryRow.delivery_address === deliveryPayload.delivery_address
      && deliveryRow.nearby_landmark === deliveryPayload.nearby_landmark
      && deliveryRow.customer_note === note,
    pickup_saved: pickupRow.order_type === 'takeaway' && pickup.order.order_type === 'takeaway',
    idempotent_retry: retryResponse.ok && retry.idempotent === true && duplicateCount === 1,
    message_has_details: message.includes(deliveryPayload.customer_name)
      && message.includes(deliveryPayload.delivery_address)
      && message.includes(note)
      && message.includes(deliveryRow.order_number),
    url_round_trip: decodeURIComponent(url.split('?text=')[1]) === message,
    line_breaks_present: message.split('\n').length >= 10,
  };
  if (Object.values(assertions).some((passed) => !passed)) {
    throw new Error(`Checkout verification failed: ${JSON.stringify(assertions)}`);
  }
  console.log(JSON.stringify({ deliveryOrder: deliveryRow.order_number, pickupOrder: pickupRow.order_number, duplicateCount, assertions }, null, 2));
} finally {
  for (const id of createdOrderIds) {
    await pool.query('DELETE FROM order_items WHERE order_id=$1', [id]);
    await pool.query('DELETE FROM orders WHERE id=$1', [id]);
  }
  await pool.end();
}
