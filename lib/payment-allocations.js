export const toCents = (value) => {
  if (value === '' || value == null || typeof value === 'boolean') return 0;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw Object.assign(new Error('Payment amounts must be valid numbers.'), { status: 400 });
  }
  return Math.round(number * 100);
};

export const fromCents = (value) => Math.round(Number(value || 0)) / 100;

const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};

const ONLINE_ALIASES = new Set(['online', 'bank', 'bank_transfer', 'cheque', 'card', 'qr', 'fonepay', 'esewa', 'khalti']);

export function normalizePaymentMethod(value) {
  const method = String(value || '').trim().toLowerCase();
  return ONLINE_ALIASES.has(method) ? 'online' : method;
}

export function validateAllocations(rawAllocations, expectedAmount, {
  customer = null,
  allowCredit = true,
  actorRole = 'admin',
  room = null, // in-house stay resolved by the caller; required for `room` rows
} = {}) {
  const expected = toCents(expectedAmount);
  if (expected <= 0) fail('The invoice amount must be greater than zero.');
  const rows = Array.isArray(rawAllocations) ? rawAllocations : [];
  const allocations = rows.map((raw) => {
    const method = normalizePaymentMethod(raw?.method);
    if (!['cash', 'online', 'credit', 'room'].includes(method)) fail('Use Cash, Online, Credit or Room for each allocation.');
    const cents = toCents(raw.amount);
    if (cents < 0) fail('Payment allocations cannot be negative.');
    return {
      method,
      cents,
      amount: fromCents(cents),
      cashTenderedCents: toCents(raw.cash_tendered),
      provider: String(raw.provider || '').trim().slice(0, 80) || null,
      reference: String(raw.reference || raw.reference_number || '').trim().slice(0, 120) || null,
      verified: raw.verified === true,
      dueDate: raw.due_date || null,
      notes: String(raw.notes || '').trim().slice(0, 500) || null,
    };
  }).filter((row) => row.cents > 0);

  if (!allocations.length) fail('Allocate at least one payment amount.');
  const allocated = allocations.reduce((sum, row) => sum + row.cents, 0);
  if (allocated !== expected) {
    const direction = allocated < expected ? 'under' : 'over';
    fail(`Payment allocation is ${direction} by Rs. ${fromCents(Math.abs(expected - allocated)).toFixed(2)}.`);
  }

  for (const row of allocations) {
    if (row.cents > expected) fail('An allocation cannot exceed the remaining invoice amount.');
    if (row.method === 'cash') {
      if (row.cashTenderedCents < row.cents) fail('Cash tendered must cover the cash allocation.');
      row.changeCents = row.cashTenderedCents - row.cents;
      row.cashTendered = fromCents(row.cashTenderedCents);
      row.change = fromCents(row.changeCents);
    }
    if (row.method === 'online') {
      row.provider = null;
      row.verified = true;
    }
    if (row.method === 'credit') {
      if (!allowCredit) fail('Credit cannot be added while collecting an existing balance.');
      if (!['admin', 'manager', 'cashier'].includes(String(actorRole || '').toLowerCase())) {
        fail('Administrator, manager or cashier permission is required for credit.', 403);
      }
      if (!customer?.id) fail('Credit requires an identified customer.');
      if (customer.is_blacklisted) fail('Credit is disabled for this customer.', 403);
      // No credit_limit cap here by design — staff can extend credit past a
      // customer's limit at their own judgment; the limit is advisory only.
    }
    if (row.method === 'room' && !room?.id) fail('Charge to room is not available for this payment.');
  }
  return allocations;
}
