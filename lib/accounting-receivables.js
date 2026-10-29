/**
 * Accounts Receivable helpers — customer credit outstanding, ageing, statements.
 * Mirrors AP style; payments reuse collectCreditBalance on individual bills.
 */

import { ensureSplitPaymentSchema, collectCreditBalance, writeOffCreditBalance } from '@/lib/split-payments.js';
import { nepalDateString } from '@/lib/report-dates.js';
import { accountBalance, postJournal, primaryBankAccountId } from '@/lib/accounting.js';
import { normalizePaymentMethod } from '@/lib/payment-allocations.js';
import { recordAudit } from '@/lib/bills-admin.js';
import { isAdminLike } from './roles.js';

const num = (n) => Number(n || 0);
const round2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;

function ageBucket(dueDate, today) {
  if (!dueDate) return '0-30';
  const due = new Date(`${String(dueDate).slice(0, 10)}T12:00:00+05:45`);
  const now = new Date(`${today}T12:00:00+05:45`);
  const days = Math.max(0, Math.floor((now - due) / 86400000));
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

export async function customerReceivables(db, { from = null, to = null } = {}) {
  await ensureSplitPaymentSchema(db);
  const params = [];
  // A balance has no single date, so period filters narrow the list by ledger
  // *activity* in that window (still showing each customer's current total owed) —
  // otherwise "Today" vs "Yesterday" would always show the same untouched list.
  let activityWhere = '';
  if (from || to) {
    const conds = ['cl.customer_id = customers.id'];
    if (from) { conds.push("date(cl.created_at, '+5 hours', '+45 minutes') >= date(?)"); params.push(from); }
    if (to) { conds.push("date(cl.created_at, '+5 hours', '+45 minutes') <= date(?)"); params.push(to); }
    activityWhere = `AND EXISTS (SELECT 1 FROM customer_ledger cl WHERE ${conds.join(' AND ')})`;
  }
  const rows = await db.all(
    `SELECT id, name, phone, credit_limit, current_credit, is_vip, is_blacklisted
     FROM customers
     WHERE COALESCE(current_credit, 0) > 0.009
     ${activityWhere}
     ORDER BY current_credit DESC`,
    params
  );
  return (rows || []).map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    credit_limit: round2(r.credit_limit),
    outstanding: round2(r.current_credit),
    is_vip: Boolean(r.is_vip),
    is_blacklisted: Boolean(r.is_blacklisted),
  }));
}

export async function receivableAgeing(db) {
  await ensureSplitPaymentSchema(db);
  const today = nepalDateString(new Date());
  /*
   * Only open debit lines can age. The old query also OR'd in every
   * credit_sale / sale_credit row ever written — rows whose net is <= 0 and
   * which the loop below discards anyway — so it scanned the entire ledger
   * history on every page load to produce nothing extra.
   *
   * due_date falls back to the *Nepal* calendar date of the entry: date() on a
   * UTC column returns the UTC day, which for anything billed between midnight
   * and 05:45 NPT is the day before, pushing those lines a bucket early.
   */
  const ledgerRows = await db.all(
    `SELECT cl.id,cl.bill_id,cl.customer_id,c.name,
            COALESCE(cl.due_date, date(cl.created_at, '+5 hours', '+45 minutes')) AS due_date,
            COALESCE(cl.debit,0) AS debit,COALESCE(cl.credit,0) AS credit
     FROM customer_ledger cl
     JOIN customers c ON c.id=cl.customer_id
     LEFT JOIN bills b ON b.id=cl.bill_id
     WHERE b.id IS NULL OR LOWER(COALESCE(b.status,'')) NOT IN ('voided','cancelled')
     ORDER BY cl.created_at,cl.id`
  ).catch(() => []);

  // Net all activity for the same invoice before ageing it. Looking only at
  // positive debit rows left the original credit-sale charge visible after a
  // later collection, write-off or void adjustment had cleared that invoice.
  const invoiceBalances = new Map();
  for (const row of ledgerRows || []) {
    const key = row.bill_id ? `bill:${row.bill_id}` : `ledger:${row.id}`;
    const current = invoiceBalances.get(key) || { ...row, open_amt: 0 };
    current.open_amt = round2(current.open_amt + num(row.debit) - num(row.credit));
    if (String(row.due_date || '') < String(current.due_date || '')) current.due_date = row.due_date;
    invoiceBalances.set(key, current);
  }
  const open = Array.from(invoiceBalances.values()).filter((row) => row.open_amt > 0.009);

  // Prefer customer.current_credit as truth; allocate to buckets by oldest open debit lines.
  const byCustomer = new Map();
  for (const row of open || []) {
    const amt = round2(row.open_amt);
    if (!(amt > 0)) continue;
    const id = row.customer_id;
    if (!byCustomer.has(id)) {
      byCustomer.set(id, { supplier_id: id, customer_id: id, name: row.name, '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0, total: 0 });
    }
    const bucket = ageBucket(row.due_date, today);
    const rec = byCustomer.get(id);
    rec[bucket] = round2(rec[bucket] + amt);
    rec.total = round2(rec.total + amt);
  }

  // Sync totals to customers.current_credit when ledger open lines under/over-count.
  const customers = await customerReceivables(db);
  for (const c of customers) {
    if (!byCustomer.has(c.id)) {
      byCustomer.set(c.id, {
        supplier_id: c.id, customer_id: c.id, name: c.name,
        '0-30': c.outstanding, '31-60': 0, '61-90': 0, '90+': 0, total: c.outstanding,
      });
    } else {
      const rec = byCustomer.get(c.id);
      const drift = round2(rec.total - c.outstanding);
      if (Math.abs(drift) > 0.05) {
        /*
         * customers.current_credit stays authoritative for the total, and the
         * age buckets are scaled to fit it. That is deliberate — but it used to
         * happen silently, so a customer whose ledger lines no longer add up to
         * their balance looked perfectly healthy while the ageing split was
         * quietly fabricated.
         *
         * Same maths, now flagged: the UI can say the ageing breakdown for this
         * customer is approximate and by how much, instead of presenting a
         * rescaled guess as fact.
         */
        const scale = rec.total > 0 ? c.outstanding / rec.total : 1;
        for (const b of ['0-30', '31-60', '61-90', '90+']) rec[b] = round2(rec[b] * scale);
        rec.total = c.outstanding;
        rec.ageing_estimated = true;
        rec.ledger_drift = drift;
      }
    }
  }

  return Array.from(byCustomer.values()).filter((r) => r.total > 0.009).sort((a, b) => b.total - a.total);
}

export async function customerArStatement(db, customerId, { from = null, to = null } = {}) {
  await ensureSplitPaymentSchema(db);
  const params = [customerId];
  let dateWhere = '';
  if (from) { dateWhere += " AND date(cl.created_at, '+5 hours', '+45 minutes') >= date(?)"; params.push(from); }
  if (to) { dateWhere += " AND date(cl.created_at, '+5 hours', '+45 minutes') <= date(?)"; params.push(to); }

  const rows = await db.all(
    `SELECT cl.id, cl.created_at AS date, cl.entry_type AS memo,
            cl.debit, cl.credit, b.bill_number, cl.due_date, cl.note
     FROM customer_ledger cl
     LEFT JOIN bills b ON b.id = cl.bill_id
     WHERE cl.customer_id = ? ${dateWhere}
     ORDER BY cl.created_at ASC, cl.id ASC`,
    params
  );

  let running = 0;
  return (rows || []).map((r) => {
    running = round2(running + num(r.debit) - num(r.credit));
    return {
      id: r.id,
      date: r.date,
      memo: `${r.memo || ''}${r.bill_number ? ` · ${r.bill_number}` : ''}${r.note ? ` — ${r.note}` : ''}`,
      debit: round2(r.debit),
      credit: round2(r.credit),
      balance: running,
      due_date: r.due_date,
    };
  });
}

/**
 * Flat, all-customer ledger history — the "history panel" behind Customer
 * Ledger: every charge/payment/write-off line, newest first, filterable by
 * date range, status (charged vs paid/cleared) and customer name.
 */
export async function customerLedgerHistory(db, { from = null, to = null, status = 'all', search = null, limit = 200 } = {}) {
  await ensureSplitPaymentSchema(db);
  const params = [];
  let where = '1=1';
  if (from) { where += " AND date(cl.created_at, '+5 hours', '+45 minutes') >= date(?)"; params.push(from); }
  if (to) { where += " AND date(cl.created_at, '+5 hours', '+45 minutes') <= date(?)"; params.push(to); }
  if (status === 'charged') where += " AND cl.entry_type = 'credit_sale'";
  else if (status === 'paid') where += " AND (cl.entry_type = 'credit_payment' OR (cl.entry_type = 'adjustment' AND cl.credit > 0))";
  else if (status === 'reversed') where += " AND cl.entry_type = 'adjustment' AND cl.debit > 0 AND LOWER(COALESCE(cl.note,'')) LIKE '%reversal%'";
  if (search) { where += ' AND c.name LIKE ?'; params.push(`%${search}%`); }
  params.push(Math.min(500, Math.max(1, Number(limit) || 200)));

  const rows = await db.all(
    `SELECT cl.id, cl.created_at AS date, cl.entry_type, cl.debit, cl.credit, cl.note, cl.payment_id,
            bp.payment_method, bp.settlement_status,
            b.id AS bill_id, b.bill_number, b.order_id, c.id AS customer_id, c.name AS customer_name, c.phone AS customer_phone
     FROM customer_ledger cl
     JOIN customers c ON c.id = cl.customer_id
     LEFT JOIN bills b ON b.id = cl.bill_id
     LEFT JOIN bill_payments bp ON bp.id = cl.payment_id
     WHERE ${where}
     ORDER BY cl.created_at DESC, cl.id DESC
     LIMIT ?`,
    params
  );

  return (rows || []).map((r) => ({
    id: r.id,
    date: r.date,
    customer_id: r.customer_id,
    customer_name: r.customer_name,
    customer_phone: r.customer_phone,
    bill_id: r.bill_id,
    bill_number: r.bill_number,
    order_id: r.order_id,
    payment_id: r.payment_id,
    payment_method: r.entry_type === 'credit_payment' ? normalizePaymentMethod(r.payment_method) : null,
    can_correct_payment_method: r.entry_type === 'credit_payment' && Boolean(r.payment_id)
      && !['voided', 'cancelled', 'failed'].includes(String(r.settlement_status || 'received').toLowerCase()),
    status: r.entry_type === 'credit_sale'
      ? 'charged'
      : r.entry_type === 'credit_payment'
        ? 'paid'
        : (r.entry_type === 'adjustment' && Number(r.debit) > 0 && /reversal/i.test(String(r.note || '')))
          ? 'reversed'
          : r.entry_type === 'adjustment' ? 'cleared' : r.entry_type,
    debit: round2(r.debit),
    credit: round2(r.credit),
    note: r.note,
  }));
}

/**
 * Reclassify a received customer-credit payment between Cash and Online.
 * The payment amount, bill status and customer balance never change. An
 * append-only transfer journal preserves the original entry and its audit trail.
 */
export async function correctCustomerCreditPaymentMethod(db, {
  paymentId, method, reason, actorId = null, requestKey = null,
}) {
  await ensureSplitPaymentSchema(db);
  const nextMethod = normalizePaymentMethod(method);
  if (!['cash', 'online'].includes(nextMethod)) {
    throw Object.assign(new Error('Choose Cash or Online.'), { status: 400 });
  }
  const correctionReason = String(reason || '').trim();
  if (!correctionReason) throw Object.assign(new Error('Enter a reason for this correction.'), { status: 400 });
  if (!paymentId) throw Object.assign(new Error('Payment is required.'), { status: 400 });

  return db.transaction(async (tx) => {
    const lock = tx.driver === 'postgres' ? ' FOR UPDATE' : '';
    const payment = await tx.get(
      `SELECT bp.*,cl.id AS customer_ledger_id,cl.entry_type,b.bill_number,bd.business_date
       FROM bill_payments bp
       JOIN customer_ledger cl ON cl.payment_id=bp.id AND cl.entry_type='credit_payment'
       JOIN bills b ON b.id=bp.bill_id
       LEFT JOIN business_days bd ON bd.id=bp.business_day_id
       WHERE bp.id=?${lock}`,
      [paymentId]
    );
    if (!payment) throw Object.assign(new Error('This is not an editable customer-credit payment.'), { status: 404 });
    if (['voided', 'cancelled', 'failed'].includes(String(payment.settlement_status || 'received').toLowerCase())) {
      throw Object.assign(new Error('A voided or failed payment cannot be corrected.'), { status: 409 });
    }
    const previousMethod = normalizePaymentMethod(payment.payment_method);
    if (!['cash', 'online'].includes(previousMethod)) {
      throw Object.assign(new Error('Only received Cash or Online credit payments can be corrected.'), { status: 409 });
    }
    if (previousMethod === nextMethod) {
      throw Object.assign(new Error(`This payment is already recorded as ${nextMethod === 'cash' ? 'Cash' : 'Online'}.`), { status: 409 });
    }
    const amount = round2(payment.amount);
    const originalJournal = await tx.get(
      `SELECT je.id FROM journal_entries je
       WHERE je.source_type='credit_collection' AND je.source_id=? LIMIT 1`,
      [payment.id]
    );
    if (!originalJournal) {
      throw Object.assign(new Error('This payment is missing its original accounting journal. Run the journal backfill before correcting it.'), { status: 409 });
    }

    const originalCashLine = await tx.get(
      `SELECT jl.drawer_id FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id
       WHERE jl.journal_id=? AND a.code='1010' LIMIT 1`,
      [originalJournal.id]
    );
    const dayDrawer = await tx.get(
      `SELECT ds.drawer_id FROM drawer_sessions ds
       WHERE ds.business_day_id=? ORDER BY ds.opened_at,id LIMIT 1`,
      [payment.business_day_id]
    ).catch(() => null);
    const drawerId = originalCashLine?.drawer_id || dayDrawer?.drawer_id || null;
    const bankAccountId = await primaryBankAccountId(tx);
    if (!bankAccountId) throw Object.assign(new Error('Set up the Primary Bank before recording an Online correction.'), { status: 409 });

    const cashToOnline = previousMethod === 'cash';
    const journalId = await postJournal(tx, {
      entry_date: payment.business_date || undefined,
      memo: `Credit payment method corrected — ${payment.bill_number}: ${previousMethod} to ${nextMethod}. ${correctionReason}`,
      source_type: 'payment_method_correction',
      external_ref: requestKey || `credit-payment-method:${payment.id}:${Date.now()}`,
      created_by: actorId,
      business_day_id: payment.business_day_id || null,
      lines: cashToOnline ? [
        { code: '1020', debit: amount, credit: 0, bank_account_id: bankAccountId, memo: 'Corrected to Online' },
        { code: '1010', debit: 0, credit: amount, drawer_id: drawerId, memo: 'Remove mistaken Cash receipt' },
      ] : [
        { code: '1010', debit: amount, credit: 0, drawer_id: drawerId, memo: 'Corrected to Cash' },
        { code: '1020', debit: 0, credit: amount, bank_account_id: bankAccountId, memo: 'Remove mistaken Online receipt' },
      ],
    });

    await tx.run(
      `UPDATE bill_payments SET payment_method=?,provider=NULL,verification_status='not_required',settlement_status='received' WHERE id=?`,
      [nextMethod, payment.id]
    );
    await tx.run(
      `UPDATE bill_payment_allocations SET method=?,provider=NULL,verification_status='not_required',settlement_status='received' WHERE payment_id=?`,
      [nextMethod, payment.id]
    );
    await recordAudit(tx, {
      bill_id: payment.bill_id,
      event: 'credit_payment_method_corrected',
      actor_id: actorId,
      previous_value: { payment_id: payment.id, method: previousMethod, amount },
      new_value: { payment_id: payment.id, method: nextMethod, amount, journal_id: journalId },
      reason: correctionReason,
      ref: String(payment.id),
    });
    return { payment_id: payment.id, bill_id: payment.bill_id, amount, previous_method: previousMethod, method: nextMethod, journal_id: journalId };
  });
}

export async function outstandingCreditBills(db, customerId) {
  return db.all(
    `SELECT b.id, b.order_id, b.bill_number, b.grand_total, b.outstanding_amount, b.created_at, b.payment_status
     FROM bills b
     WHERE b.customer_id = ? AND COALESCE(b.outstanding_amount, 0) > 0.009
       AND LOWER(COALESCE(b.status,'')) NOT IN ('voided','cancelled')
     ORDER BY b.created_at ASC`,
    [customerId]
  );
}

/** Open credit bills with their active line items; one customer, or every customer when customerId is null. */
export async function openCreditBillsWithItems(db, customerId = null) {
  const where = `${customerId ? 'b.customer_id = ?' : 'b.customer_id IS NOT NULL'}
       AND COALESCE(b.outstanding_amount, 0) > 0.009
       AND LOWER(COALESCE(b.status,'')) NOT IN ('voided','cancelled')`;
  const params = customerId ? [customerId] : [];
  const [bills, items] = await Promise.all([
    db.all(
      `SELECT b.id, b.customer_id, b.order_id, b.bill_number, b.grand_total, b.outstanding_amount, b.created_at
       FROM bills b WHERE ${where} ORDER BY b.created_at ASC, b.id ASC`,
      params
    ),
    db.all(
      `SELECT oi.order_id, COALESCE(oi.item_name, mi.name, 'Item') AS item_name, oi.variant_name, oi.quantity, oi.subtotal
       FROM order_items oi
       LEFT JOIN menu_items mi ON mi.id = COALESCE(oi.menu_item_id, oi.item_id)
       WHERE oi.order_id IN (SELECT b.order_id FROM bills b WHERE ${where})
         AND LOWER(COALESCE(oi.status,'')) NOT IN ('voided','cancelled')
       ORDER BY oi.order_id, oi.id`,
      params
    ),
  ]);
  const itemsByOrder = new Map();
  for (const item of items || []) {
    if (!itemsByOrder.has(item.order_id)) itemsByOrder.set(item.order_id, []);
    itemsByOrder.get(item.order_id).push({ ...item, quantity: num(item.quantity), subtotal: round2(item.subtotal) });
  }
  return (bills || []).map((b) => ({
    ...b,
    grand_total: round2(b.grand_total),
    outstanding_amount: round2(b.outstanding_amount),
    items: itemsByOrder.get(b.order_id) || [],
  }));
}

/** Collect against the oldest outstanding credit bill(s) for a customer. */
export async function collectCustomerCredit(db, {
  customer_id, amount, method = 'cash', reference = null, bank_account_id = null, provider = null,
  note = null, actorId = null, actorRole = 'admin', external_ref = null,
}) {
  await ensureSplitPaymentSchema(db);
  const amt = round2(amount);
  if (!(amt > 0)) throw Object.assign(new Error('Enter a payment amount.'), { status: 400 });

  const customer = await db.get('SELECT * FROM customers WHERE id = ?', [customer_id]);
  if (!customer) throw Object.assign(new Error('Customer not found.'), { status: 404 });
  if (!(num(customer.current_credit) > 0)) {
    throw Object.assign(new Error('This customer has no outstanding credit.'), { status: 409 });
  }

  const bills = await outstandingCreditBills(db, customer_id);
  if (!bills.length) {
    throw Object.assign(new Error('No open credit invoices found for this customer. Adjust via Corrections if needed.'), { status: 409 });
  }

  let remaining = Math.min(amt, round2(customer.current_credit));
  const results = [];
  for (const bill of bills) {
    if (remaining <= 0.009) break;
    const due = round2(bill.outstanding_amount);
    const take = Math.min(remaining, due);
    const key = `${external_ref || 'ar-collect'}:${bill.id}:${take}`;
    const collection = await collectCreditBalance(db, {
      billId: bill.id,
      allocations: [{
        method,
        amount: take,
        cash_tendered: method === 'cash' ? take : undefined,
        reference: reference || note || undefined,
        bank_account_id: bank_account_id || undefined,
        provider: provider || undefined,
      }],
      actorId,
      actorRole,
      requestKey: key,
    });
    results.push({ bill_id: bill.id, bill_number: bill.bill_number, collected: take, ...collection });
    remaining = round2(remaining - take);
  }

  const collected = round2(amt - remaining);
  return { collected, remaining_unapplied: remaining, results };
}

/** Forgive part/all of a customer's outstanding credit — same FIFO-oldest-bill-first shape as collectCustomerCredit. */
export async function writeOffCustomerCredit(db, {
  customer_id, amount, reason = null, actorId = null, actorRole = 'admin', allowCreditWriteOff = false, external_ref = null,
}) {
  await ensureSplitPaymentSchema(db);
  const amt = round2(amount);
  if (!(amt > 0)) throw Object.assign(new Error('Enter a discount amount.'), { status: 400 });
  if (!isAdminLike(actorRole) && !(actorRole === 'cashier' && allowCreditWriteOff)) {
    throw Object.assign(new Error('You do not have permission to discount customer credit.'), { status: 403 });
  }

  const customer = await db.get('SELECT * FROM customers WHERE id = ?', [customer_id]);
  if (!customer) throw Object.assign(new Error('Customer not found.'), { status: 404 });
  if (!(num(customer.current_credit) > 0)) {
    throw Object.assign(new Error('This customer has no outstanding credit.'), { status: 409 });
  }

  const bills = await outstandingCreditBills(db, customer_id);
  if (!bills.length) {
    throw Object.assign(new Error('No open credit invoices found for this customer. Adjust via Corrections if needed.'), { status: 409 });
  }

  let remaining = Math.min(amt, round2(customer.current_credit));
  const results = [];
  for (const bill of bills) {
    if (remaining <= 0.009) break;
    const due = round2(bill.outstanding_amount);
    const take = Math.min(remaining, due);
    const key = `${external_ref || 'ar-writeoff'}:${bill.id}:${take}`;
    const writeOff = await writeOffCreditBalance(db, {
      billId: bill.id,
      amount: take,
      reason,
      actorId,
      actorRole,
      allowCreditWriteOff,
      requestKey: key,
    });
    results.push({ bill_id: bill.id, bill_number: bill.bill_number, written_off: take, ...writeOff });
    remaining = round2(remaining - take);
  }

  const writtenOff = round2(amt - remaining);
  return { writtenOff, remaining_unapplied: remaining, results };
}

export async function arAccountBalance(db) {
  return round2(await accountBalance(db, '1300'));
}
