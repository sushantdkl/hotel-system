import { nepalOperationalRangeBounds } from '@/lib/report-dates.js';
import { paymentsUnionSql } from '@/lib/report-scope.js';

const VOID_STATES = new Set(['void', 'voided', 'cancelled', 'canceled']);
const CREDIT_METHODS = new Set(['credit', 'due', 'unpaid']);
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const round2 = (value) => Math.round((num(value) + Number.EPSILON) * 100) / 100;

function billScope(db, range, businessDayId) {
  if (businessDayId) return { sql: 'b.business_day_id = ?', params: [businessDayId] };
  const { start, endExclusive } = nepalOperationalRangeBounds(db.driver, range.start, range.end);
  return { sql: 'b.created_at >= ? AND b.created_at < ?', params: [start, endExclusive] };
}

function paymentKind(method) {
  const normalized = String(method || '').toLowerCase();
  if (CREDIT_METHODS.has(normalized)) return 'credit';
  return normalized === 'cash' ? 'cash' : 'digital';
}

function ledgerKind(row) {
  const type = String(row.entry_type || '').toLowerCase();
  const note = String(row.note || '').toLowerCase();
  if (type === 'credit_sale') return 'creditSale';
  if (type === 'credit_payment') return 'creditCollection';
  if (type === 'adjustment' && note.startsWith('credit collection reversal')) return 'creditCollection';
  if (type === 'adjustment' && note.startsWith('write-off')) return 'writeOff';
  return 'other';
}

/**
 * Reconcile the complete lifecycle of bills raised in the selected period.
 * Payment dates are deliberately not filtered: this is the bill cohort's
 * resolution "to date", while the normal collection KPIs remain period cash
 * activity. Keeping those two bases separate prevents old credit collections
 * from being presented as new sales.
 */
export async function buildPaymentReconciliation(db, range, businessDayId = null) {
  const scope = billScope(db, range, businessDayId);
  const bills = await db.all(
    `SELECT b.id,b.bill_number,b.status,b.grand_total,b.outstanding_amount,b.created_at
     FROM bills b WHERE ${scope.sql} ORDER BY b.created_at DESC,b.id DESC`,
    scope.params
  );
  if (!bills.length) return emptyReconciliation();

  const [payments, ledger] = await Promise.all([
    db.all(
      `SELECT pay.bill_id,pay.method,pay.amount,pay.provider,pay.created_at
       FROM (${paymentsUnionSql()}) pay
       JOIN bills b ON b.id=pay.bill_id
       WHERE ${scope.sql}`,
      scope.params
    ),
    db.all(
      `SELECT cl.customer_id,cl.bill_id,cl.entry_type,cl.debit,cl.credit,cl.note,cl.created_at
       FROM customer_ledger cl
       JOIN bills b ON b.id=cl.bill_id
       WHERE ${scope.sql}
       ORDER BY cl.created_at,cl.id`,
      scope.params
    ).catch(() => []),
  ]);

  const paymentMap = new Map();
  for (const payment of payments) {
    const entry = paymentMap.get(payment.bill_id) || { cash: 0, digital: 0, credit: 0, transactions: 0 };
    const kind = paymentKind(payment.method);
    entry[kind] += num(payment.amount);
    entry.transactions += 1;
    paymentMap.set(payment.bill_id, entry);
  }

  const ledgerMap = new Map();
  for (const row of ledger) {
    const entry = ledgerMap.get(row.bill_id) || { creditSale: 0, creditCollection: 0, writeOff: 0 };
    const kind = ledgerKind(row);
    if (kind === 'creditSale') entry.creditSale += num(row.debit) - num(row.credit);
    if (kind === 'creditCollection') entry.creditCollection += num(row.credit) - num(row.debit);
    if (kind === 'writeOff') entry.writeOff += num(row.credit) - num(row.debit);
    ledgerMap.set(row.bill_id, entry);
  }

  const details = bills.map((bill) => {
    const status = String(bill.status || '').toLowerCase();
    const isVoided = VOID_STATES.has(status);
    const payment = paymentMap.get(bill.id) || { cash: 0, digital: 0, credit: 0, transactions: 0 };
    const credit = ledgerMap.get(bill.id) || { creditSale: 0, creditCollection: 0, writeOff: 0 };
    const received = round2(payment.cash + payment.digital);
    const billTotal = round2(bill.grand_total);
    const outstanding = isVoided ? 0 : round2(Math.max(0, num(bill.outstanding_amount)));
    const writeOff = isVoided ? 0 : round2(Math.max(0, credit.writeOff));
    const difference = isVoided
      ? received
      : round2(received + writeOff + outstanding - billTotal);
    const result = isVoided
      ? (received > 0.009 ? 'voided_payment' : 'voided_clear')
      : difference > 0.009
        ? 'excess'
        : difference < -0.009
          ? 'missing'
          : 'balanced';
    return {
      billId: bill.id,
      billNumber: bill.bill_number,
      billStatus: status,
      createdAt: bill.created_at,
      billTotal,
      cashReceived: round2(payment.cash),
      digitalReceived: round2(payment.digital),
      received,
      soldOnCredit: round2(Math.max(credit.creditSale, payment.credit, 0)),
      creditCollected: round2(Math.max(0, credit.creditCollection)),
      writtenOff: writeOff,
      outstanding,
      difference,
      transactions: payment.transactions,
      result,
    };
  });

  const active = details.filter((row) => !VOID_STATES.has(row.billStatus));
  const voided = details.filter((row) => VOID_STATES.has(row.billStatus));
  const sum = (rows, field) => round2(rows.reduce((total, row) => total + num(row[field]), 0));
  const excess = sum(active.filter((row) => row.difference > 0), 'difference');
  const missing = round2(Math.abs(sum(active.filter((row) => row.difference < 0), 'difference')));
  const voidedPayments = sum(voided, 'received');
  const creditSold = sum(active, 'soldOnCredit');
  const creditCollected = sum(active, 'creditCollected');
  const writtenOff = sum(active, 'writtenOff');
  const outstanding = sum(active, 'outstanding');
  const creditDifference = round2(creditSold - creditCollected - writtenOff - outstanding);
  const rawPaymentRows = round2(sum(details, 'received') + sum(details, 'soldOnCredit'));
  const verifiedReceived = round2(active.reduce((total, row) => {
    const expected = Math.max(0, row.billTotal - row.writtenOff - row.outstanding);
    return total + Math.min(row.received, expected);
  }, 0));
  const needsAttention = round2(excess + missing + voidedPayments + Math.abs(creditDifference));

  return {
    status: needsAttention <= 0.009 ? 'balanced' : 'attention',
    basis: 'Bills raised in the selected period, resolved through the latest available payment and credit activity.',
    totals: {
      activeBills: active.length,
      activeBillValue: sum(active, 'billTotal'),
      rawPaymentRows,
      verifiedReceived,
      cashReceived: sum(active, 'cashReceived'),
      digitalReceived: sum(active, 'digitalReceived'),
      excessPayments: excess,
      missingSettlement: missing,
      voidedPayments,
      needsAttention,
    },
    credit: {
      sold: creditSold,
      collected: creditCollected,
      writtenOff,
      outstanding,
      difference: creditDifference,
      reconciled: Math.abs(creditDifference) <= 0.009,
    },
    counts: {
      balanced: active.filter((row) => row.result === 'balanced').length,
      excess: active.filter((row) => row.result === 'excess').length,
      missing: active.filter((row) => row.result === 'missing').length,
      voidedWithPayments: voided.filter((row) => row.result === 'voided_payment').length,
    },
    exceptions: details.filter((row) => !['balanced', 'voided_clear'].includes(row.result)),
    bills: details,
  };
}

function emptyReconciliation() {
  return {
    status: 'balanced',
    basis: 'Bills raised in the selected period, resolved through the latest available payment and credit activity.',
    totals: { activeBills: 0, activeBillValue: 0, rawPaymentRows: 0, verifiedReceived: 0, cashReceived: 0, digitalReceived: 0, excessPayments: 0, missingSettlement: 0, voidedPayments: 0, needsAttention: 0 },
    credit: { sold: 0, collected: 0, writtenOff: 0, outstanding: 0, difference: 0, reconciled: true },
    counts: { balanced: 0, excess: 0, missing: 0, voidedWithPayments: 0 },
    exceptions: [],
    bills: [],
  };
}
