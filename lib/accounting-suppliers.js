/**
 * Supplier accounting — all derived from the Accounts Payable account (2010)
 * with the supplier sub-ledger tag on each line. No separate balances table:
 *
 *   - a credit purchase posts Cr AP (2010) tagged supplier_id
 *   - a supplier payment posts Dr AP (2010, supplier) / Cr cash|bank
 *
 * Outstanding = Σ(credit - debit) on 2010 per supplier. Ageing applies payments
 * FIFO against the oldest open invoices.
 */

import { postJournal, accountIdByCode, accountBalance, paymentAccountCode, currentDrawerId, primaryBankAccountId } from './accounting.js';
import { currentBusinessDayId } from './business-days.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const bad = (m) => Object.assign(new Error(m), { status: 400 });

/** AP account id, memoised per call chain by the caller passing db. */
async function apId(db) {
  return accountIdByCode(db, '2010');
}

/** Per-supplier outstanding payable (only those with a non-zero balance). */
export async function supplierPayables(db) {
  const ap = await apId(db);
  const rows = await db.all(
    `SELECT s.id, s.name, s.phone,
       COALESCE(SUM(jl.credit - jl.debit), 0) AS outstanding
     FROM suppliers s
     JOIN journal_lines jl ON jl.supplier_id = s.id AND jl.account_id = ?
     GROUP BY s.id, s.name, s.phone
     HAVING COALESCE(SUM(jl.credit - jl.debit), 0) > 0.009
     ORDER BY outstanding DESC`,
    [ap]
  );
  return rows.map((r) => ({ id: r.id, name: r.name, phone: r.phone, outstanding: round2(r.outstanding) }));
}

/** Statement of one supplier's AP movements (oldest first). */
export async function supplierStatement(db, supplierId, { from = null, to = null } = {}) {
  const ap = await apId(db);
  const params = [ap, supplierId];
  let where = '';
  if (from) { where += ' AND je.entry_date >= ?'; params.push(from); }
  if (to) { where += ' AND je.entry_date <= ?'; params.push(to); }
  return db.all(
    `SELECT je.id AS journal_id, je.entry_date, je.created_at, je.memo, je.source_type,
            original.source_type AS reversed_source_type, jl.debit, jl.credit,
            (SELECT CASE payment_account.code
                      WHEN '1010' THEN 'cash'
                      WHEN '1050' THEN 'business_funding'
                      ELSE 'online'
                    END
             FROM journal_lines payment_line
             JOIN accounts payment_account ON payment_account.id=payment_line.account_id
             WHERE payment_line.journal_id=CASE
                     WHEN je.source_type='reversal' AND original.source_type='supplier_payment' THEN original.id
                     ELSE je.id
                   END
               AND payment_line.credit>0
               AND payment_account.code<>'2010'
             ORDER BY payment_line.id LIMIT 1) AS payment_method
     FROM journal_lines jl JOIN journal_entries je ON jl.journal_id = je.id
     LEFT JOIN journal_entries original ON je.source_type='reversal' AND original.id=je.source_id
     WHERE jl.account_id = ? AND jl.supplier_id = ?${where}
     ORDER BY je.entry_date, je.id, jl.id`,
    params
  );
}

/** Flat, all-supplier AP history for the Supplier Ledger history tab. */
export async function supplierLedgerHistory(db, { from = null, to = null, status = 'all', search = null, limit = 200 } = {}) {
  const ap = await apId(db);
  const params = [ap];
  let where = '1=1';
  if (from) { where += ' AND je.entry_date >= ?'; params.push(from); }
  if (to) { where += ' AND je.entry_date <= ?'; params.push(to); }
  if (status === 'charged') where += " AND jl.credit > 0 AND je.source_type <> 'reversal'";
  else if (status === 'paid') where += " AND jl.debit > 0 AND je.source_type <> 'reversal'";
  else if (status === 'reversed') where += " AND je.source_type = 'reversal'";
  if (search) { where += ' AND s.name LIKE ?'; params.push(`%${search}%`); }
  params.push(Math.min(500, Math.max(1, Number(limit) || 200)));

  const rows = await db.all(
    `SELECT jl.id, je.id AS journal_id, je.entry_date AS date, je.memo, je.source_type,
            jl.debit, jl.credit, s.id AS supplier_id, s.name AS supplier_name, s.phone AS supplier_phone,
            (SELECT CASE payment_account.code
                      WHEN '1010' THEN 'cash'
                      WHEN '1050' THEN 'business_funding'
                      ELSE 'online'
                    END
             FROM journal_lines payment_line
             JOIN accounts payment_account ON payment_account.id=payment_line.account_id
             LEFT JOIN journal_entries original ON original.id=je.source_id AND je.source_type='reversal'
             WHERE payment_line.journal_id=CASE
                     WHEN je.source_type='reversal' AND original.source_type='supplier_payment' THEN original.id
                     ELSE je.id
                   END
               AND payment_line.credit>0
               AND payment_account.code<>'2010'
             ORDER BY payment_line.id LIMIT 1) AS payment_method
     FROM journal_lines jl
     JOIN journal_entries je ON je.id = jl.journal_id
     JOIN suppliers s ON s.id = jl.supplier_id
     WHERE jl.account_id = ? AND ${where}
     ORDER BY je.entry_date DESC, je.id DESC, jl.id DESC
     LIMIT ?`,
    params
  );

  return (rows || []).map((row) => ({
    ...row,
    debit: round2(row.debit),
    credit: round2(row.credit),
    status: row.source_type === 'reversal' ? 'reversed' : Number(row.credit) > 0 ? 'charged' : 'paid',
  }));
}

/** All liability accounts with their current balance (credit - debit). */
export async function liabilityLedger(db) {
  return db.all(
    `SELECT a.code, a.name, a.subtype,
       COALESCE(SUM(jl.credit - jl.debit), 0) AS balance
     FROM accounts a
     LEFT JOIN journal_lines jl ON jl.account_id = a.id
     WHERE a.type = 'liability' AND a.parent_id IS NOT NULL
     GROUP BY a.id ORDER BY a.code`
  );
}

const DAY = 24 * 60 * 60 * 1000;
function bucketOf(days) {
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

/**
 * FIFO ageing. For each supplier, credits are invoices and debits are payments
 * applied to the oldest open invoice first; whatever is still open is bucketed
 * by the invoice's age.
 */
export async function liabilityAgeing(db) {
  const ap = await apId(db);
  const rows = await db.all(
    `SELECT s.id AS supplier_id, s.name, je.entry_date, jl.debit, jl.credit
     FROM journal_lines jl
     JOIN journal_entries je ON jl.journal_id = je.id
     JOIN suppliers s ON jl.supplier_id = s.id
     WHERE jl.account_id = ?
     ORDER BY s.id, je.entry_date, je.id, jl.id`,
    [ap]
  );

  const now = Date.now();
  const bySupplier = new Map();
  for (const r of rows) {
    if (!bySupplier.has(r.supplier_id)) bySupplier.set(r.supplier_id, { name: r.name, invoices: [], payment: 0 });
    const s = bySupplier.get(r.supplier_id);
    const credit = round2(r.credit);
    const debit = round2(r.debit);
    if (credit > 0) s.invoices.push({ date: r.entry_date, open: credit });
    if (debit > 0) s.payment += debit;
  }

  const result = [];
  for (const [supplier_id, s] of bySupplier) {
    // Apply all payments FIFO to the oldest invoices.
    let pay = s.payment;
    for (const inv of s.invoices) {
      if (pay <= 0) break;
      const applied = Math.min(pay, inv.open);
      inv.open = round2(inv.open - applied);
      pay = round2(pay - applied);
    }
    const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    let total = 0;
    for (const inv of s.invoices) {
      if (inv.open <= 0.001) continue;
      const age = Math.max(0, Math.floor((now - new Date(`${String(inv.date).slice(0, 10)}T00:00:00`).getTime()) / DAY));
      buckets[bucketOf(age)] = round2(buckets[bucketOf(age)] + inv.open);
      total = round2(total + inv.open);
    }
    if (total > 0.001) result.push({ supplier_id, name: s.name, ...buckets, total });
  }
  return result.sort((a, b) => b.total - a.total);
}

/**
 * Open (not yet fully paid) purchase invoices for one supplier — same FIFO
 * payment allocation as liabilityAgeing, but scoped to a single supplier and
 * resolved back to the purchase record for display. View-only: a supplier
 * payment settles the oldest invoice(s) automatically, it isn't picked here.
 */
export async function supplierOpenInvoices(db, supplierId) {
  const ap = await apId(db);
  const rows = await db.all(
    `SELECT je.entry_date, je.source_type, je.source_id, je.memo, jl.debit, jl.credit
     FROM journal_lines jl
     JOIN journal_entries je ON jl.journal_id = je.id
     WHERE jl.account_id = ? AND jl.supplier_id = ?
     ORDER BY je.entry_date, je.id`,
    [ap, supplierId]
  );

  const invoices = [];
  let payment = 0;
  for (const r of rows) {
    const credit = round2(r.credit);
    const debit = round2(r.debit);
    if (credit > 0) invoices.push({
      expense_id: r.source_type === 'expense' ? r.source_id : null,
      source_type: r.source_type,
      description: r.memo || null,
      date: r.entry_date,
      open: credit,
      total: credit,
    });
    if (debit > 0) payment = round2(payment + debit);
  }
  let pay = payment;
  for (const inv of invoices) {
    if (pay <= 0) break;
    const applied = Math.min(pay, inv.open);
    inv.open = round2(inv.open - applied);
    pay = round2(pay - applied);
  }

  const open = invoices.filter((inv) => inv.open > 0.009);
  if (!open.length) return [];

  const expenseIds = open.map((inv) => inv.expense_id).filter(Boolean);
  const expenses = expenseIds.length
    ? await db.all(
        `SELECT id, source_id, description FROM expenses WHERE id IN (${expenseIds.map(() => '?').join(',')})`,
        expenseIds
      )
    : [];
  const expenseById = new Map(expenses.map((e) => [e.id, e]));

  const purchaseIds = expenses.map((e) => e.source_id).filter(Boolean);
  const purchases = purchaseIds.length
    ? await db.all(
        `SELECT id, invoice_number FROM purchases WHERE id IN (${purchaseIds.map(() => '?').join(',')})`,
        purchaseIds
      )
    : [];
  const purchaseById = new Map(purchases.map((p) => [p.id, p]));

  return open
    .map((inv) => {
      const expense = expenseById.get(inv.expense_id);
      const purchase = expense ? purchaseById.get(expense.source_id) : null;
      return {
        purchase_id: purchase?.id || null,
        invoice_number: purchase?.invoice_number || null,
        description: expense?.description || inv.description || (inv.source_type === 'reversal' ? 'Reversed supplier payment' : null),
        date: inv.date,
        total: inv.total,
        outstanding: inv.open,
      };
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

const CREDIT_PURCHASE_METHODS = ['credit', 'due', 'unpaid', 'on_credit', 'payable'];

/**
 * A supplier payment only posts a journal — the purchase keeps its "credit"
 * expense. This replays the payments (net of reversals) FIFO over each
 * supplier's live credit purchases, the same oldest-first rule the AP page
 * uses, so lists can say what is still due and how the rest was paid.
 *
 * @returns {Promise<Map<number, { due: number, paid: Record<'cash'|'digital'|'funding', number> }>>}
 *
 * ponytail: loads every credit purchase and supplier payment per call; fine
 * at restaurant volume, cache or persist allocations if it ever shows up slow.
 */
export async function creditPurchaseSettlements(db) {
  const ap = await apId(db);
  const [purchases, payments] = await Promise.all([
    db.all(
      `SELECT p.id, p.supplier_id, p.total
         FROM purchases p
         JOIN expenses e ON e.source_type = 'purchase' AND e.source_id = p.id
        WHERE COALESCE(p.status, '') NOT IN ('voided', 'draft')
          AND LOWER(COALESCE(e.payment_method, '')) IN (${CREDIT_PURCHASE_METHODS.map(() => '?').join(',')})
        ORDER BY COALESCE(p.invoice_date, CAST(p.created_at AS TEXT)), p.id`,
      CREDIT_PURCHASE_METHODS
    ),
    db.all(
      `SELECT jl.supplier_id, pay.id, pay.entry_date, SUM(jl.debit - jl.credit) AS amount,
              (SELECT CASE a.code WHEN '1010' THEN 'cash' WHEN '1050' THEN 'funding' ELSE 'digital' END
                 FROM journal_lines pl JOIN accounts a ON a.id = pl.account_id
                WHERE pl.journal_id = pay.id AND pl.credit > 0 AND a.code <> '2010'
                ORDER BY pl.id LIMIT 1) AS bucket
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.journal_id
         JOIN journal_entries pay ON pay.id = CASE WHEN je.source_type = 'reversal' THEN je.source_id ELSE je.id END
        WHERE jl.account_id = ? AND jl.supplier_id IS NOT NULL AND pay.source_type = 'supplier_payment'
        GROUP BY jl.supplier_id, pay.id, pay.entry_date
        ORDER BY pay.entry_date, pay.id`,
      [ap]
    ),
  ]);

  const result = new Map();
  const openBySupplier = new Map();
  for (const p of purchases) {
    const row = { due: round2(p.total), paid: {} };
    result.set(Number(p.id), row);
    if (!p.supplier_id) continue;
    const key = Number(p.supplier_id);
    if (!openBySupplier.has(key)) openBySupplier.set(key, []);
    openBySupplier.get(key).push(row);
  }
  for (const pay of payments) {
    let left = round2(pay.amount);
    const bucket = pay.bucket || 'cash';
    for (const row of openBySupplier.get(Number(pay.supplier_id)) || []) {
      if (left <= 0.001) break;
      if (row.due <= 0.001) continue;
      const applied = Math.min(left, row.due);
      row.due = round2(row.due - applied);
      row.paid[bucket] = round2((row.paid[bucket] || 0) + applied);
      left = round2(left - applied);
    }
  }
  return result;
}

/** Move the settled part of the listed credit purchases out of Credit into the bucket that paid it. */
export function applyCreditSettlements(totals, purchaseIds, settlements) {
  for (const id of purchaseIds) {
    const s = settlements.get(Number(id));
    if (!s) continue;
    for (const [bucket, amount] of Object.entries(s.paid)) {
      totals[bucket] = round2((totals[bucket] || 0) + amount);
      totals.credit = round2((totals.credit || 0) - amount);
    }
  }
  return totals;
}

/** Pay a supplier: Dr Accounts Payable (supplier) / Cr cash|bank|Business Funding. */
export async function paySupplier(db, { supplier_id, amount, method = 'cash', bank_account_id = null, note, external_ref = null, created_by = null, allow_over = false }) {
  const amt = round2(amount);
  if (!supplier_id) throw bad('Which supplier is this payment for?');
  if (!(amt > 0)) throw bad('Amount must be greater than zero.');
  const m = String(method).toLowerCase();
  const creditCode = m === 'cash'
    ? '1010'
    : m === 'business_funding'
      ? '1050'
      : ['bank', 'bank_transfer', 'cheque'].includes(m)
        ? '1020'
        : paymentAccountCode(m);

  if (!allow_over) {
    // accountBalance returns debit-credit; AP is credit-normal, so owed = -(debit-credit).
    const owed = round2(-(await accountBalance(db, '2010', { supplierId: supplier_id })));
    if (amt > owed + 0.001) throw bad(`This supplier is only owed ${owed}.`);
  }

  if (creditCode === '1050') {
    const available = round2(await accountBalance(db, '1050'));
    if (available + 0.001 < amt) {
      throw Object.assign(
        new Error(`Business Funding has Rs ${available.toFixed(2)} available, but Rs ${amt.toFixed(2)} is required.`),
        { status: 409, code: 'business_funding_insufficient', available, shortfall: round2(amt - available) }
      );
    }
  }

  const drawerId = creditCode === '1010' ? await currentDrawerId(db) : null;
  const resolvedBankId = creditCode === '1020' ? (bank_account_id || await primaryBankAccountId(db)) : null;
  const businessDayId = await currentBusinessDayId(db, { required: true });
  return db.transaction((tx) =>
    postJournal(tx, {
      memo: note || 'Supplier payment',
      source_type: 'supplier_payment',
      source_id: null,
      external_ref,
      created_by,
      business_day_id: businessDayId,
      lines: [
        { code: '2010', debit: amt, credit: 0, supplier_id, memo: 'AP settled' },
        { code: creditCode, debit: 0, credit: amt, drawer_id: drawerId, bank_account_id: resolvedBankId, memo: m === 'business_funding' ? 'Paid from Business Funding' : null },
      ],
    })
  );
}
