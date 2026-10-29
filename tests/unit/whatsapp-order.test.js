import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWhatsAppOrderMessage, buildWhatsAppOrderUrl } from '../../lib/whatsapp-order.js';

const savedOrder = {
  order_number: 'WEB-123',
  customer_name: 'Asha Rai',
  customer_phone: '9800000001',
  order_type: 'delivery',
  delivery_address: 'Lazimpat, Kathmandu',
  nearby_landmark: 'Opposite the bank',
  customer_note: 'Less spicy',
  items: [{ item_name: 'Chicken Momo', quantity: 2, price: 180, subtotal: 360 }],
  subtotal: 360,
  discount: 20,
  delivery_charge: 50,
  grand_total: 390,
};

test('WhatsApp message is built from the saved order with all checkout details', () => {
  const message = buildWhatsAppOrderMessage(savedOrder);
  assert.match(message, /Order: #WEB-123/);
  assert.match(message, /Asha Rai/);
  assert.match(message, /Delivery/);
  assert.match(message, /Lazimpat, Kathmandu/);
  assert.match(message, /Opposite the bank/);
  assert.match(message, /Less spicy/);
  assert.match(message, /2 x Chicken Momo/);
  assert.match(message, /Total: Rs\. 390/);
});

test('optional blank fields are omitted instead of producing empty labels', () => {
  const message = buildWhatsAppOrderMessage({
    ...savedOrder,
    order_type: 'takeaway',
    delivery_address: '',
    nearby_landmark: '',
    customer_note: '',
  });
  assert.doesNotMatch(message, /Address:/);
  assert.doesNotMatch(message, /Landmark:/);
  assert.doesNotMatch(message, /Note:/);
});

test('WhatsApp URL normalizes the configured number and safely encodes the message', () => {
  const message = buildWhatsAppOrderMessage(savedOrder);
  const url = buildWhatsAppOrderUrl('+977 980-817-4841', message);
  assert.match(url, /^https:\/\/wa\.me\/9779808174841\?text=/);
  assert.equal(decodeURIComponent(url.split('?text=')[1]), message);
});
