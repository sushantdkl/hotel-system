/**
 * The single definition of "a bill that counts as trade", shared by every
 * reporting surface.
 *
 * Before this file existed, four surfaces each had their own idea:
 *
 *   Reports hub      status IN ('paid','partially_paid')                  created_at
 *   Analytics        + 'reopened','refunded'                              COALESCE(paid_at, created_at)
 *   Summary Report   + 'refunded'                                         created_at
 *   Dashboard        status IN ('paid','reopened')                        COALESCE(paid_at, created_at)
 *
 * So the same day produced four different revenue figures depending on which
 * page the owner opened, and a bill that was raised at 11pm and settled after
 * midnight fell on different days on different screens.
 *
 * The rules below are the agreed ones. Change them here and every report moves
 * together — that is the point of the file.
 */

/**
 * Statuses that count as trade.
 *
 *  - paid            settled in full.
 *  - partially_paid  counted at FULL bill value. The sale happened; the unpaid
 *                    remainder is a receivable, reported separately as
 *                    outstanding dues. Revenue is not reduced by it.
 *  - reopened        a settled bill pulled back open for correction. Still a
 *                    real sale, and excluding it made bills vanish from reports
 *                    mid-correction.
 *  - refunded        still a real sale. The refund is reported as its own
 *                    deduction (see Refunds), so dropping the bill entirely
 *                    would double-count the reversal.
 *
 * Voided and cancelled bills are absent deliberately: those are bills that
 * should never have existed, as opposed to sales that were later reversed.
 */
export const COUNTED_BILL_STATUSES = ['paid', 'partially_paid', 'reopened', 'refunded'];

/** Statuses that mean "this bill never happened". Never counted as trade. */
export const VOID_BILL_STATUSES = ['void', 'voided', 'cancelled', 'canceled'];

/** Statuses for a bill that is still open on the floor. */
export const OPEN_BILL_STATUSES = ['unpaid', 'open', 'pending', 'in_progress'];

const quoted = (values) => values.map((v) => `'${v}'`).join(',');

/**
 * SQL predicate for a countable bill.
 * @param {string} alias table alias for `bills` in the query (default `b`).
 */
export function countedBillSql(alias = 'b') {
  return `LOWER(COALESCE(${alias}.status, 'paid')) IN (${quoted(COUNTED_BILL_STATUSES)})`;
}

/** SQL predicate for a bill still open on the floor (not yet settled). */
export function openBillSql(alias = 'b') {
  return `LOWER(COALESCE(${alias}.status, 'unpaid')) IN (${quoted(OPEN_BILL_STATUSES)})`;
}

/** SQL predicate for a voided/cancelled bill. */
export function voidedBillSql(alias = 'b') {
  return `LOWER(COALESCE(${alias}.status, '')) IN (${quoted(VOID_BILL_STATUSES)})`;
}

/**
 * The timestamp a bill is reported against: **when the bill was created**.
 *
 * Not `paid_at`, and not `COALESCE(paid_at, created_at)`. A bill belongs to the
 * day the sale was rung up. Anchoring on payment moved late-night covers into
 * the next day on some screens and not others, which is exactly what made the
 * reports disagree.
 *
 * `business_day_id` still wins when a business day is explicitly selected —
 * that is an operator-declared boundary and outranks the clock.
 */
export function billDateColumn(alias = 'b') {
  return `${alias}.created_at`;
}

/**
 * Order items that were actually sold — voided/cancelled lines removed.
 * @param {string} alias table alias for `order_items` (default `oi`).
 */
export function liveItemSql(alias = 'oi') {
  return `COALESCE(${alias}.status, '') NOT IN ('voided', 'cancelled')`;
}

/**
 * How a payment method is bucketed for reporting.
 *
 * Deliberately not an allow-list. `method IN ('cash','qr')` silently reported
 * nothing at all for card, eSewa, Khalti and every other provider — and the
 * seed data alone already contains card and esewa. Anything that is not cash
 * and not credit is digital.
 */
export const CASH_METHODS = ['cash'];
// `room` = charged to a hotel stay: on account, collected at hotel checkout.
export const CREDIT_METHODS = ['credit', 'due', 'unpaid', 'on_credit', 'payable', 'room', 'package'];
export const FUNDING_METHODS = ['owner_pocket', 'business_funding'];

/**
 * Fixed filter choices for every report. Raw DB values differ by surface
 * (POS stores `qr`, purchases store `bank_transfer`, expenses store either),
 * so the UI offers buckets instead of the literal strings.
 */
export const PAYMENT_FILTER_OPTIONS = [
  { id: 'cash', label: 'Cash' },
  { id: 'online', label: 'Online' },
  { id: 'funding', label: 'Owner / Business Funding' },
  { id: 'credit', label: 'Credit' },
];

/** Map a UI filter value (or a legacy raw method) onto cash | digital | credit. */
export function normalizePaymentFilterBucket(value) {
  const m = String(value || '').toLowerCase().trim();
  if (!m) return null;
  if (m === 'cash' || CASH_METHODS.includes(m)) return 'cash';
  if (m === 'credit' || CREDIT_METHODS.includes(m)) return 'credit';
  if (m === 'funding' || FUNDING_METHODS.includes(m)) return 'funding';
  // online / bank / qr / digital / card / esewa / bank_transfer / …
  if (
    m === 'online' || m === 'bank' || m === 'digital' || m === 'qr'
    || m === 'bank_transfer' || m === 'card' || m === 'esewa' || m === 'khalti'
    || m === 'fonepay' || m === 'cheque' || m === 'mobile' || m === 'other'
  ) return 'digital';
  return 'digital';
}

/** SQL boolean: this method column falls in the given bucket. */
export function paymentColumnMatchesBucketSql(column, bucket) {
  if (bucket === 'cash') {
    return `LOWER(COALESCE(${column}, '')) IN (${quoted(CASH_METHODS)})`;
  }
  if (bucket === 'credit') {
    return `LOWER(COALESCE(${column}, '')) IN (${quoted(CREDIT_METHODS)})`;
  }
  if (bucket === 'funding') {
    return `LOWER(COALESCE(${column}, '')) IN (${quoted(FUNDING_METHODS)})`;
  }
  return `LOWER(COALESCE(${column}, '')) NOT IN (${quoted([...CASH_METHODS, ...CREDIT_METHODS, ...FUNDING_METHODS])})`;
}

export function paymentBucketSql(column) {
  return `CASE
    WHEN LOWER(COALESCE(${column}, '')) IN (${quoted(CASH_METHODS)}) THEN 'cash'
    WHEN LOWER(COALESCE(${column}, '')) IN (${quoted(CREDIT_METHODS)}) THEN 'credit'
    WHEN LOWER(COALESCE(${column}, '')) IN (${quoted(FUNDING_METHODS)}) THEN 'funding'
    ELSE 'digital'
  END`;
}

/** Same bucketing in JS, for rows already fetched. */
export function paymentBucket(method) {
  const m = String(method || '').toLowerCase();
  if (CASH_METHODS.includes(m)) return 'cash';
  if (CREDIT_METHODS.includes(m)) return 'credit';
  if (FUNDING_METHODS.includes(m)) return 'funding';
  return 'digital';
}

/** Sum currency amounts into cash / digital / credit from row payment_method. */
export function paymentBucketTotals(rows, amountKey = 'total', methodKey = 'payment_method') {
  const totals = { cash: 0, digital: 0, credit: 0, funding: 0 };
  for (const row of rows || []) {
    const amount = Number(row?.[amountKey]) || 0;
    if (!amount) continue;
    totals[paymentBucket(row?.[methodKey])] += amount;
  }
  return totals;
}

/**
 * A settlement row that actually landed. Cancelled/voided/failed settlements
 * are not money.
 */
export function settledPaymentSql(alias) {
  return `LOWER(COALESCE(${alias}.settlement_status, 'received')) NOT IN ('cancelled', 'voided', 'failed')`;
}

/**
 * Payments read across BOTH storage paths, de-duplicated.
 *
 * Payments are written two ways: `bill_payments` (the original single-row
 * form) and `bill_payment_allocations` (the newer split/itemised form). A
 * figure that reads only one path under-reports without any error — which is
 * why the cash KPI could disagree with the payment breakdown printed directly
 * beneath it.
 *
 * Allocations win where they exist for a bill; `bill_payments` fills in for
 * bills that predate split settlement.
 */
export function paymentsUnionSql({ settledOnly = true } = {}) {
  const allocationFilter = settledOnly ? `WHERE ${settledPaymentSql('bpa')}` : '';
  const paymentFilter = settledOnly ? `AND ${settledPaymentSql('bp')}` : '';
  return `SELECT bpa.bill_id, LOWER(COALESCE(bpa.method, 'other')) AS method, bpa.amount,
                 bpa.provider, bpa.created_at, bpa.business_day_id
          FROM bill_payment_allocations bpa
          ${allocationFilter}
          UNION ALL
          SELECT bp.bill_id, LOWER(COALESCE(bp.payment_method, 'other')) AS method, bp.amount,
                 bp.provider, bp.created_at, bp.business_day_id
          FROM bill_payments bp
          WHERE NOT EXISTS (SELECT 1 FROM bill_payment_allocations ba2 WHERE ba2.bill_id = bp.bill_id)
            ${paymentFilter}`;
}

/**
 * Tax on a bill. `bills.tax` and `bills.vat_amount` both default to 0 rather
 * than NULL, so `COALESCE(tax, vat_amount, 0)` never falls through and silently
 * reports zero tax when only vat_amount was written.
 */
export function billTaxSql(alias = 'b') {
  return `CASE WHEN COALESCE(${alias}.vat_amount, 0) <> 0 THEN ${alias}.vat_amount ELSE COALESCE(${alias}.tax, 0) END`;
}

/**
 * Human-readable statement of the basis, shown on screen so an owner can tell
 * why two reports built from different sources may differ slightly.
 */
export const BILL_BASIS_NOTE =
  'Counts bills marked paid, partially paid, reopened or refunded, dated by when the bill was raised. '
  + 'Partially paid bills count at full value — the unpaid remainder appears under outstanding dues. '
  + 'Voided and cancelled bills are excluded.';

export const JOURNAL_BASIS_NOTE =
  'Built from posted accounting journal entries rather than from the bills table, so it reflects what was '
  + 'booked to the ledger. Small differences from the sales reports are expected where entries were posted '
  + 'or adjusted outside the billing flow.';
