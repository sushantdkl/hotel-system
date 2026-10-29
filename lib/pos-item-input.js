function inputError(message, code) {
  return Object.assign(new Error(message), { status: 400, code });
}

/**
 * Resolve the editable parts of a POS line without trusting client prices for
 * catalog items. Custom items have no catalog price, so their operator-entered
 * price is validated here before it is persisted.
 */
export function resolvePosItemInput(raw, menuItem = null) {
  if (menuItem) {
    return {
      name: menuItem.name,
      price: Number(menuItem.base_price || 0),
    };
  }

  const name = String(raw?.item_name || '').trim();
  const price = Number(raw?.price);
  if (!name) {
    throw inputError('Enter a name for the custom item.', 'invalid_custom_item_name');
  }
  if (!Number.isFinite(price) || price <= 0) {
    throw inputError('Enter a valid price greater than zero for the custom item.', 'invalid_custom_item_price');
  }

  return { name, price };
}

