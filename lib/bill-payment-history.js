const INACTIVE_SETTLEMENTS = new Set(['voided', 'cancelled', 'failed']);

/**
 * A split-payment allocation is backed by a bill_payments row. Prefer the
 * allocation view whenever it exists, otherwise the same money appears twice.
 */
export function billPaymentHistory(payments = [], allocations = []) {
  const source = allocations.length ? allocations : payments;
  return source.filter((payment) => !INACTIVE_SETTLEMENTS.has(
    String(payment.settlementStatus || payment.settlement_status || 'received').toLowerCase()
  ));
}
