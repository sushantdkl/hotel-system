const money = (value) => `Rs. ${Number(value || 0).toLocaleString('en-IN', {
  minimumFractionDigits: Number(value || 0) % 1 ? 2 : 0,
  maximumFractionDigits: 2,
})}`;

/** Build the message from the order returned by the server, never stale form state. */
export function buildWhatsAppOrderMessage(order, {
  restaurantName = 'Raithane Daure Chulo',
  pickupName = 'Raithane Daure Chulo',
} = {}) {
  const items = Array.isArray(order?.items) ? order.items : [];
  const lines = [
    `Hello ${restaurantName}! I'd like to place an order.`,
    '',
    `Order: #${order?.order_number || ''}`,
    '',
    'Items:',
    ...items.map((item) => `- ${item.quantity} x ${item.item_name}${item.variant_name ? ` (${item.variant_name})` : ''} - ${money(item.subtotal)}`),
    '',
    `Subtotal: ${money(order?.subtotal)}`,
  ];

  if (Number(order?.discount || 0) > 0) lines.push(`${order?.promotion_name || 'Discount'}: -${money(order.discount)}`);
  if (order?.order_type === 'delivery' || Number(order?.delivery_charge || 0) > 0) {
    lines.push(`Delivery charge: ${money(order?.delivery_charge)}`);
  }
  lines.push(`Total: ${money(order?.grand_total)}`, '');
  lines.push(`Customer name: ${order?.customer_name || ''}`);
  lines.push(`Phone: ${order?.customer_phone || ''}`);
  lines.push(`Order type: ${order?.order_type === 'delivery' ? 'Delivery' : 'Pickup'}`);
  if (order?.order_type === 'delivery') lines.push(`Delivery location: ${order?.delivery_address || ''}`);
  else lines.push(`Pickup from: ${pickupName}`);
  if (order?.nearby_landmark) lines.push(`Nearby landmark: ${order.nearby_landmark}`);
  if (order?.customer_note) lines.push(`Customer note: ${order.customer_note}`);
  return lines.join('\n');
}

export function buildWhatsAppOrderUrl(number, message) {
  const digits = String(number || '').replace(/\D/g, '');
  if (!digits) throw new Error('Restaurant WhatsApp number is not configured.');
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
