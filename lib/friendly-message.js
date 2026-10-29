/**
 * Human-friendly toast / alert copy for the POS UI.
 */

const FRIENDLY = {
  empty_cart: {
    title: 'Cart is empty',
    description: 'Add at least one item before completing the bill.',
    variant: 'warning',
  },
  insufficient_payment: {
    title: 'Not enough cash',
    description: 'The amount paid is less than the bill total. Please check and try again.',
    variant: 'warning',
  },
  payment_invalid: {
    title: 'Check payment allocation',
    description: 'Cash, QR and Credit must exactly match the invoice total.',
    variant: 'warning',
  },
  sale_success: {
    title: 'Sale complete',
    description: 'Bill saved successfully. You can print the receipt if needed.',
    variant: 'success',
  },
  sale_failed: {
    title: 'Could not complete the sale',
    description: 'Something went wrong while saving this bill. Please try again.',
    variant: 'error',
  },
  order_success: {
    title: 'Order sent',
    description: 'Kitchen has been notified. Great work!',
    variant: 'success',
  },
  order_failed: {
    title: 'Order could not be sent',
    description: 'Please check your connection and try again.',
    variant: 'error',
  },
  stock_low: {
    title: 'Low stock warning',
    description: 'Some items are running low. Consider restocking soon.',
    variant: 'warning',
  },
  stock_out: {
    title: 'Out of stock',
    description: 'This item does not have enough stock left.',
    variant: 'error',
  },
  save_success: {
    title: 'Saved',
    description: 'Your changes were saved successfully.',
    variant: 'success',
  },
  save_failed: {
    title: 'Could not save',
    description: 'Please try again in a moment.',
    variant: 'error',
  },
  delete_success: {
    title: 'Removed',
    description: 'Item was removed successfully.',
    variant: 'success',
  },
  delete_failed: {
    title: 'Could not remove',
    description: 'Please try again.',
    variant: 'error',
  },
  load_failed: {
    title: 'Could not load data',
    description: 'Please refresh the page and try again.',
    variant: 'error',
  },
  network: {
    title: 'Connection problem',
    description: 'Please check your internet connection and try again.',
    variant: 'error',
  },
  custom_added: {
    title: 'Custom item added',
    description: 'The item is now in the cart.',
    variant: 'success',
  },
  invalid_custom: {
    title: 'Missing details',
    description: 'Please enter a name and a valid price for the custom item.',
    variant: 'warning',
  },
  customer_required: {
    title: 'Customer details needed',
    description: 'Enter phone first. Existing customers load automatically; new numbers need a name.',
    variant: 'warning',
  },
  items_added: {
    title: 'Items added',
    description: 'The items were added to the order.',
    variant: 'success',
  },
  payment_success: {
    title: 'Payment received',
    description: 'The bill has been paid successfully.',
    variant: 'success',
  },
  payment_failed: {
    title: 'Payment could not be completed',
    description: 'Please check the amounts and try again.',
    variant: 'error',
  },
  amount_mismatch: {
    title: 'Amount does not match',
    description: 'The amount paid does not match the bill total. Please check and try again.',
    variant: 'warning',
  },
  zero_reason_required: {
    title: 'Reason required',
    description: 'Enter a reason before completing a Rs 0 bill.',
    variant: 'warning',
  },
  invalid_amount: {
    title: 'Invalid amount',
    description: 'Please enter a valid payment amount.',
    variant: 'warning',
  },
  order_cancelled: {
    title: 'Order cancelled',
    description: 'The order was cancelled and the table was released.',
    variant: 'success',
  },
  bill_unlocked: {
    title: 'Ordering unlocked',
    description: 'Guests can order more items again.',
    variant: 'success',
  },
  item_voided: {
    title: 'Item voided',
    description: 'The line was removed from the bill and stock was restored.',
    variant: 'success',
  },
  pin_mismatch: {
    title: 'PINs do not match',
    description: 'Please enter the same PIN in both fields.',
    variant: 'warning',
  },
  pin_invalid: {
    title: 'Invalid PIN',
    description: 'PIN must be exactly 4 digits.',
    variant: 'warning',
  },
  session_expired: {
    title: 'Please sign in again',
    description: 'Your session has expired. Log in to continue.',
    variant: 'warning',
  },
  upload_failed: {
    title: 'Image upload failed',
    description: 'Please try a different image or try again later.',
    variant: 'error',
  },
  kitchen_ready: {
    title: 'Order ready',
    description: 'All items are prepared and ready for pickup.',
    variant: 'success',
  },
  kitchen_item_ready: {
    title: 'Item ready',
    description: 'Marked as ready for the waiter.',
    variant: 'success',
  },
  duplicate_phone: {
    title: 'Phone already saved',
    description: 'A customer with this phone number is already in your list. Try searching for them instead.',
    variant: 'warning',
  },
  duplicate: {
    title: 'Already exists',
    description: 'This record is already saved.',
    variant: 'warning',
  },
  validation: {
    title: 'Please check the form',
    description: 'Some details look incomplete or incorrect.',
    variant: 'warning',
  },
};

export function friendlyMessage(key, overrides = {}) {
  const base = FRIENDLY[key] || {
    title: 'Notice',
    description: typeof key === 'string' ? key : 'Please try again.',
    variant: 'default',
  };
  return {
    title: overrides.title || base.title,
    description: overrides.description || base.description,
    variant: overrides.variant || base.variant,
  };
}

/** Map raw API / Error text into a friendly toast payload. */
export function friendlyFromError(error, fallbackKey = 'sale_failed') {
  const code = error?.code || '';
  if (code === 'duplicate_phone') return friendlyMessage('duplicate_phone', {
    description: error?.error || FRIENDLY.duplicate_phone.description,
  });
  if (code === 'duplicate') return friendlyMessage('duplicate', {
    description: error?.error || FRIENDLY.duplicate.description,
  });
  if (code === 'validation') return friendlyMessage('validation', {
    description: error?.error || FRIENDLY.validation.description,
  });

  const raw = (typeof error === 'string' ? error : error?.message || error?.error || '').toLowerCase();

  if (!raw) return friendlyMessage(fallbackKey);

  if (raw.includes('network') || raw.includes('fetch') || raw.includes('failed to fetch')) {
    return friendlyMessage('network');
  }
  if (raw.includes('stock') || raw.includes('inventory')) {
    return friendlyMessage('stock_out', {
      description: error?.message || error?.error || FRIENDLY.stock_out.description,
    });
  }
  if (raw.includes('unique') || raw.includes('already') || raw.includes('duplicate')) {
    if (raw.includes('phone')) {
      return friendlyMessage('duplicate_phone', {
        description: error?.error || FRIENDLY.duplicate_phone.description,
      });
    }
    return friendlyMessage('duplicate', {
      description: error?.error || error?.message || FRIENDLY.duplicate.description,
    });
  }
  if (raw.includes('empty')) return friendlyMessage('empty_cart');
  if (raw.includes('zero') && raw.includes('reason')) {
    return friendlyMessage('zero_reason_required', {
      description: error?.error || error?.message || FRIENDLY.zero_reason_required.description,
    });
  }
  if (raw.includes('does not match') || raw.includes('amount_mismatch') || code === 'amount_mismatch') {
    return friendlyMessage('amount_mismatch', {
      description: error?.error || error?.message || FRIENDLY.amount_mismatch.description,
    });
  }
  if (raw.includes('insufficient') || raw.includes('less than')) {
    return friendlyMessage('insufficient_payment');
  }
  if (raw.includes('valid payment amount') || raw.includes('invalid amount')) {
    return friendlyMessage('invalid_amount', {
      description: error?.error || error?.message || FRIENDLY.invalid_amount.description,
    });
  }

  // Prefer API human error text when it is already friendly
  const apiText = error?.error || error?.message;
  if (apiText && !/sqlite|constraint|pragma|undefined/i.test(apiText)) {
    return friendlyMessage(fallbackKey, { description: apiText });
  }

  return friendlyMessage(fallbackKey, {
    description: sanitizeTechnical(apiText || FRIENDLY[fallbackKey]?.description),
  });
}

function sanitizeTechnical(text) {
  if (!text) return FRIENDLY.sale_failed.description;
  // Hide raw SQL / sqlite jargon from customers
  if (/sqlite|no such column|constraint|pragma|undefined|null/i.test(text)) {
    return 'We hit a technical snag. Please try again, or contact support if it keeps happening.';
  }
  return text;
}
