import { ensureColumn, serialPkSql } from '@/lib/db/schema-helpers.js';
import { ensureSqliteTable } from '@/lib/db/ensure-sqlite-table.js';
import { currentDrawerId, postJournal, postSaleJournal, paymentAccountCode, primaryBankAccountId } from '@/lib/accounting.js';
import { toCents, fromCents, validateAllocations } from '@/lib/payment-allocations.js';
import { currentBusinessDayId } from '@/lib/business-days.js';
import { isAdminLike } from './roles.js';
import { postRoomChargeToFolio } from './hotel/room-charges.js';
export { toCents, fromCents, validateAllocations } from '@/lib/payment-allocations.js';

const paymentKey = (requestKey, method, index) => `${requestKey}:${method}:${index}`;
// Credit (customer ledger), room (hotel folio) and package (meal-plan allowance)
// are on account: no money received at the restaurant.
const isReceived = (method) => !['credit', 'room', 'package'].includes(method);
const SETTLEMENT_STATUS = { credit: 'outstanding', room: 'room_charge', package: 'package_allowance' };
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

export async function ensureSplitPaymentSchema(db) {
  await ensureColumn(db, 'bills', 'customer_id', 'INTEGER');
  await ensureColumn(db, 'bills', 'outstanding_amount', 'NUMERIC(14,2) DEFAULT 0');
  await ensureColumn(db, 'bills', 'payment_status', "TEXT DEFAULT 'unpaid'");
  await ensureColumn(db, 'bills', 'idempotency_key', 'TEXT');
  for (const [name, ddl] of [
    ['provider', 'TEXT'], ['verification_status', "TEXT DEFAULT 'not_required'"],
    ['settlement_status', "TEXT DEFAULT 'received'"], ['verified_by', 'INTEGER'],
    ['customer_id', 'INTEGER'], ['due_date', 'DATE'], ['notes', 'TEXT'],
    ['cash_tendered', 'NUMERIC(14,2)'], ['change_amount', 'NUMERIC(14,2) DEFAULT 0'],
    ['idempotency_key', 'TEXT'],
  ]) await ensureColumn(db, 'bill_payments', name, ddl);
  await ensureColumn(db, 'bill_payments', 'business_day_id', 'INTEGER');
  await ensureColumn(db, 'bill_payment_allocations', 'business_day_id', 'INTEGER').catch(() => false);
  await ensureColumn(db, 'customer_ledger', 'business_day_id', 'INTEGER').catch(() => false);

  if (db.driver === 'postgres') {
    const ready = await db.get(
      `SELECT to_regclass('public.bill_payment_allocations') AS allocations,
              to_regclass('public.customer_ledger') AS customer_ledger`
    );
    if (!ready?.allocations || !ready?.customer_ledger) throw Object.assign(new Error('Split-payment schema is not installed. Run database migration 026 (npm run db:migrate).'), { status: 503, code: 'schema_missing', expose: true });
    return;
  }

  const pk = serialPkSql(db);
  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS bill_payment_allocations (
    ${pk}, bill_id INTEGER NOT NULL, payment_id INTEGER, method TEXT NOT NULL, amount REAL NOT NULL,
    provider TEXT, reference_number TEXT, verification_status TEXT DEFAULT 'not_required',
    settlement_status TEXT DEFAULT 'received', customer_id INTEGER, due_date DATE, notes TEXT,
    created_by INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, idempotency_key TEXT NOT NULL UNIQUE,
    business_day_id INTEGER)`);
  await ensureColumn(db, 'bill_payment_allocations', 'business_day_id', 'INTEGER');
  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS customer_ledger (
    ${pk}, customer_id INTEGER NOT NULL, bill_id INTEGER, payment_id INTEGER, entry_type TEXT NOT NULL,
    debit REAL NOT NULL DEFAULT 0, credit REAL NOT NULL DEFAULT 0, due_date DATE, note TEXT,
    created_by INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, idempotency_key TEXT NOT NULL UNIQUE)`);
  await ensureColumn(db, 'customer_ledger', 'business_day_id', 'INTEGER');
  await db.run('CREATE UNIQUE INDEX IF NOT EXISTS ux_bills_idempotency_key ON bills(idempotency_key) WHERE idempotency_key IS NOT NULL').catch(() => {});
  await db.run('CREATE UNIQUE INDEX IF NOT EXISTS ux_bill_payments_idempotency_key ON bill_payments(idempotency_key) WHERE idempotency_key IS NOT NULL').catch(() => {});
}

async function insertReceivedPayment(db, { billId, allocation, actorId, customerId, requestKey, index, businessDayId }) {
  const key = paymentKey(requestKey, allocation.method, index);
  const result = await db.run(
    `INSERT INTO bill_payments (bill_id, amount, payment_method, reference_number, provider,
       verification_status, settlement_status, verified_by, customer_id, due_date, notes,
       cash_tendered, change_amount, idempotency_key, business_day_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'received', ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [billId, allocation.amount, allocation.method, allocation.reference, allocation.provider,
      'not_required', null,
      customerId, allocation.dueDate, allocation.notes, allocation.cashTendered || null,
      allocation.change || 0, key, businessDayId]
  );
  return { id: result.lastInsertRowid, key };
}

async function insertAllocation(db, { billId, paymentId = null, allocation, actorId, customerId, key, businessDayId }) {
  await db.run(
    `INSERT INTO bill_payment_allocations (bill_id, payment_id, method, amount, provider, reference_number,
       verification_status, settlement_status, customer_id, due_date, notes, created_by, idempotency_key, business_day_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [billId, paymentId, allocation.method, allocation.amount, allocation.provider, allocation.reference,
      'not_required',
      SETTLEMENT_STATUS[allocation.method] || 'received',
      customerId, allocation.dueDate, allocation.notes, actorId, key, businessDayId]
  );
}

/** Record a new invoice's Cash/QR/AR/room allocation and its single sales journal.
 *  `room` is the in-house stay (from lockChargeableStay) for `room` allocations. */
export async function recordInitialSplitSettlement(db, {
  billId, billNumber, total, tax = 0, allocations, customer = null, actorId = null, requestKey, businessDayId = null, room = null, outlet = 'restaurant',
}) {
  await ensureSplitPaymentSchema(db);
  const received = allocations.filter((row) => isReceived(row.method));
  const roomCents = allocations.filter((row) => row.method === 'room').reduce((sum, row) => sum + row.cents, 0);
  const packageCents = allocations.filter((row) => row.method === 'package').reduce((sum, row) => sum + row.cents, 0);
  if ((roomCents > 0 || packageCents > 0) && !room?.id) fail('Charge to room requires an in-house guest.');
  const credit = allocations.filter((row) => row.method === 'credit').reduce((sum, row) => sum + row.cents, 0);
  const customerId = customer?.id || null;
  const dayId = businessDayId || await currentBusinessDayId(db, { required: true, allowStale: true });

  for (let index = 0; index < allocations.length; index += 1) {
    const allocation = allocations[index];
    let paymentId = null;
    let key = paymentKey(requestKey, allocation.method, index);
    if (isReceived(allocation.method)) {
      const payment = await insertReceivedPayment(db, { billId, allocation, actorId, customerId, requestKey, index, businessDayId: dayId });
      paymentId = payment.id;
      key = payment.key;
    }
    await insertAllocation(db, { billId, paymentId, allocation, actorId, customerId, key, businessDayId: dayId });
    if (allocation.method === 'credit') {
      await db.run(
        `INSERT INTO customer_ledger (customer_id, bill_id, entry_type, debit, credit, due_date, note, created_by, idempotency_key, business_day_id)
         VALUES (?, ?, 'credit_sale', ?, 0, ?, ?, ?, ?, ?)`,
        [customerId, billId, allocation.amount, allocation.dueDate, allocation.notes || `Credit sale ${billNumber}`, actorId, `${key}:ledger`, dayId]
      );
    }
  }

  if (credit > 0) {
    await db.run('UPDATE customers SET current_credit = COALESCE(current_credit,0) + ? WHERE id = ?', [fromCents(credit), customerId]);
  }
  const outstanding = fromCents(credit);
  const status = outstanding > 0 ? 'partially_paid' : 'paid';
  await db.run(
    `UPDATE bills SET customer_id=?, outstanding_amount=?, payment_status=?, status=?, paid_at=${outstanding > 0 ? 'NULL' : 'CURRENT_TIMESTAMP'} WHERE id=?`,
    [customerId, outstanding, status, status, billId]
  );
  const journalId = await postSaleJournal(db, {
    bill_id: billId,
    bill_number: billNumber,
    parts: allocations.map((row) => ({ method: row.method, amount: row.amount, customer_id: row.method === 'credit' ? customerId : null })),
    tax_amount: tax,
    created_by: actorId,
    business_day_id: dayId,
  });
  if (roomCents > 0) {
    await postRoomChargeToFolio(db, { stay: room, billId, billNumber, amount: fromCents(roomCents), journalId, actorId, businessDayId: dayId, outlet });
  }
  return {
    status,
    outstanding,
    received: fromCents(received.reduce((sum, row) => sum + row.cents, 0)),
    allocations: allocations.map((row) => ({ method: row.method, amount: row.amount, provider: row.provider, reference: row.reference, due_date: row.dueDate, cash_tendered: row.cashTendered, change: row.change || 0 })),
  };
}

/** Record an ADDITIONAL payment on an already-paid/reopened bill without replacing
 *  the original sale journal. Posts a separate `bill_supplement` journal. */
export async function recordSupplementalSettlement(db, {
  billId, billNumber, total, tax = 0, allocations, customer = null, actorId = null, requestKey, businessDayId = null,
}) {
  await ensureSplitPaymentSchema(db);
  const customerId = customer?.id || null;
  const dayId = businessDayId || await currentBusinessDayId(db, { required: true, allowStale: true });
  const paymentRows = [];

  for (let index = 0; index < allocations.length; index += 1) {
    const allocation = allocations[index];
    let paymentId = null;
    let key = paymentKey(requestKey, allocation.method, index);
    if (allocation.method !== 'credit') {
      const payment = await insertReceivedPayment(db, { billId, allocation, actorId, customerId, requestKey, index, businessDayId: dayId });
      paymentId = payment.id;
      key = payment.key;
      paymentRows.push({ id: paymentId, method: allocation.method, amount: allocation.amount });
    } else {
      await db.run(
        `INSERT INTO customer_ledger (customer_id, bill_id, entry_type, debit, credit, due_date, note, created_by, idempotency_key, business_day_id)
         VALUES (?, ?, 'credit_sale', ?, 0, ?, ?, ?, ?, ?)`,
        [customerId, billId, allocation.amount, allocation.dueDate, allocation.notes || `Credit supplement ${billNumber}`, actorId, `${key}:ledger`, dayId]
      );
      if (customerId) {
        await db.run('UPDATE customers SET current_credit = COALESCE(current_credit,0) + ? WHERE id = ?', [allocation.amount, customerId]);
      }
    }
    await insertAllocation(db, { billId, paymentId, allocation, actorId, customerId, key, businessDayId: dayId });
  }

  const drawerId = await currentDrawerId(db);
  const bankAccountId = await primaryBankAccountId(db);
  const lines = [];
  for (const a of allocations) {
    if (a.method === 'credit') {
      lines.push({ code: '1300', debit: a.amount, credit: 0, customer_id: customerId, memo: 'Customer receivable (supplement)' });
    } else {
      const code = paymentAccountCode(a.method);
      lines.push({
        code,
        debit: a.amount,
        credit: 0,
        drawer_id: code === '1010' ? drawerId : null,
        bank_account_id: code === '1020' ? bankAccountId : null,
        memo: `${a.method} supplement`,
      });
    }
  }
  const totalAmt = allocations.reduce((s, a) => s + Number(a.amount || 0), 0);
  const taxAmt = Math.min(totalAmt, Math.max(0, Number(tax) || 0));
  lines.push({ code: '4010', debit: 0, credit: totalAmt - taxAmt, memo: 'Sales revenue (supplement)' });
  if (taxAmt > 0) lines.push({ code: '2020', debit: 0, credit: taxAmt, memo: 'VAT / tax payable (supplement)' });

  await postJournal(db, {
    memo: `Supplemental sale — bill ${billNumber || billId}`,
    source_type: 'bill_supplement',
    source_id: paymentRows[0]?.id || billId,
    external_ref: `${requestKey}:supplement-journal`,
    created_by: actorId,
    business_day_id: dayId,
    lines,
  });

  const creditOutstanding = allocations.filter((a) => a.method === 'credit').reduce((s, a) => s + Number(a.amount || 0), 0);
  return {
    status: creditOutstanding > 0 ? 'partially_paid' : 'paid',
    outstanding: creditOutstanding,
    received: allocations.filter((a) => a.method !== 'credit').reduce((s, a) => s + Number(a.amount || 0), 0),
    allocations: allocations.map((row) => ({
      method: row.method, amount: row.amount, provider: row.provider, reference: row.reference,
      due_date: row.dueDate, cash_tendered: row.cashTendered, change: row.change || 0,
    })),
  };
}

/** Collect an existing customer receivable. The credit is not new revenue. */
export async function collectCreditBalance(db, {
  billId, allocations: rawAllocations, actorId = null, actorRole = 'admin', requestKey,
}) {
  await ensureSplitPaymentSchema(db);
  const duplicate = await db.get('SELECT id FROM bill_payment_allocations WHERE idempotency_key LIKE ? LIMIT 1', [`${requestKey}:%`]);
  if (duplicate) {
    const bill = await db.get('SELECT outstanding_amount, payment_status FROM bills WHERE id=?', [billId]);
    return { idempotent: true, outstanding: Number(bill?.outstanding_amount || 0), status: bill?.payment_status };
  }

  return db.transaction(async () => {
    const lock = db.driver === 'postgres' ? ' FOR UPDATE' : '';
    const bill = await db.get(`SELECT * FROM bills WHERE id=?${lock}`, [billId]);
    if (!bill) fail('Bill not found.', 404);
    if (['void','voided','cancelled','canceled'].includes(String(bill.status || '').toLowerCase())) {
      fail('A voided bill cannot take a customer payment.', 409);
    }
    const outstandingCents = toCents(bill.outstanding_amount);
    if (outstandingCents <= 0) fail('This bill has no outstanding customer credit.', 409);
    const requestedCents = (rawAllocations || []).reduce((sum, row) => sum + toCents(row.amount), 0);
    if (requestedCents <= 0 || requestedCents > outstandingCents) fail('Collection amount must be greater than zero and no more than the outstanding balance.');
    const customer = await db.get('SELECT * FROM customers WHERE id=?', [bill.customer_id]);
    if (!customer) fail('The bill is not linked to a customer.', 409);
    const allocations = validateAllocations(rawAllocations, fromCents(requestedCents), { customer, allowCredit: false, actorRole });
    const drawerId = await currentDrawerId(db);
    const bankAccountId = await primaryBankAccountId(db);
    const businessDayId = await currentBusinessDayId(db, { required: true, allowStale: true });

    for (let index = 0; index < allocations.length; index += 1) {
      const allocation = allocations[index];
      const payment = await insertReceivedPayment(db, { billId, allocation, actorId, customerId: customer.id, requestKey, index, businessDayId });
      await insertAllocation(db, { billId, paymentId: payment.id, allocation, actorId, customerId: customer.id, key: payment.key, businessDayId });
      await db.run(
        `INSERT INTO customer_ledger (customer_id, bill_id, payment_id, entry_type, debit, credit, note, created_by, idempotency_key, business_day_id)
         VALUES (?, ?, ?, 'credit_payment', 0, ?, ?, ?, ?, ?)`,
        [customer.id, billId, payment.id, allocation.amount, allocation.notes || `Credit collection ${bill.bill_number}`, actorId, `${payment.key}:ledger`, businessDayId]
      );
      await postJournal(db, {
        memo: `Credit collection — bill ${bill.bill_number}`,
        source_type: 'credit_collection',
        source_id: payment.id,
        external_ref: `${payment.key}:journal`,
        created_by: actorId,
        business_day_id: businessDayId,
        lines: [
          { code: allocation.method === 'cash' ? '1010' : '1020', debit: allocation.amount, credit: 0, drawer_id: allocation.method === 'cash' ? drawerId : null, bank_account_id: allocation.method === 'online' ? bankAccountId : null, memo: `${allocation.method} collection` },
          { code: '1300', debit: 0, credit: allocation.amount, customer_id: customer.id, memo: 'Customer receivable collected' },
        ],
      });
    }

    const remaining = fromCents(outstandingCents - requestedCents);
    const status = remaining > 0 ? 'partially_paid' : 'paid';
    await db.run(
      `UPDATE customers SET current_credit = CASE
         WHEN COALESCE(current_credit,0) - ? < 0 THEN 0
         ELSE COALESCE(current_credit,0) - ? END WHERE id=?`,
      [fromCents(requestedCents), fromCents(requestedCents), customer.id]
    );
    await db.run(
      `UPDATE bills SET outstanding_amount=?, payment_status=?, status=?, paid_at=${remaining > 0 ? 'NULL' : 'CURRENT_TIMESTAMP'} WHERE id=?`,
      [remaining, status, status, billId]
    );
    return { collected: fromCents(requestedCents), outstanding: remaining, status, allocations };
  });
}

/**
 * Forgive part or all of one bill's outstanding customer credit — a discount
 * or goodwill write-off, not a cash collection. Books Dr Discounts &
 * Write-offs (5070) / Cr Accounts Receivable (1300); same FIFO-per-bill shape
 * as collectCreditBalance. `entry_type` is pinned to 'adjustment' because
 * Postgres CHECKs customer_ledger.entry_type to a fixed list that doesn't
 * include a dedicated write-off value — the real label lives in `note`.
 */
export async function writeOffCreditBalance(db, {
  billId, amount, reason, actorId = null, actorRole = 'admin', allowCreditWriteOff = false, requestKey,
}) {
  await ensureSplitPaymentSchema(db);
  if (!isAdminLike(actorRole) && !(actorRole === 'cashier' && allowCreditWriteOff)) {
    fail('You do not have permission to discount customer credit.', 403);
  }
  if (requestKey) {
    const duplicate = await db.get('SELECT id FROM customer_ledger WHERE idempotency_key = ?', [requestKey]);
    if (duplicate) {
      const bill = await db.get('SELECT outstanding_amount, payment_status FROM bills WHERE id=?', [billId]);
      return { idempotent: true, outstanding: Number(bill?.outstanding_amount || 0), status: bill?.payment_status };
    }
  }

  return db.transaction(async () => {
    const lock = db.driver === 'postgres' ? ' FOR UPDATE' : '';
    const bill = await db.get(`SELECT * FROM bills WHERE id=?${lock}`, [billId]);
    if (!bill) fail('Bill not found.', 404);
    if (['void','voided','cancelled','canceled'].includes(String(bill.status || '').toLowerCase())) {
      fail('A voided bill cannot have customer credit written off.', 409);
    }
    const outstandingCents = toCents(bill.outstanding_amount);
    if (outstandingCents <= 0) fail('This bill has no outstanding customer credit.', 409);
    const writeOffCents = toCents(amount);
    if (writeOffCents <= 0 || writeOffCents > outstandingCents) fail('Write-off amount must be greater than zero and no more than the outstanding balance.');
    const customer = await db.get('SELECT * FROM customers WHERE id=?', [bill.customer_id]);
    if (!customer) fail('The bill is not linked to a customer.', 409);
    const businessDayId = await currentBusinessDayId(db, { required: true, allowStale: true });
    const writeOffAmount = fromCents(writeOffCents);
    const key = requestKey || `writeoff:${billId}:${Date.now()}`;

    const ledgerInsert = await db.run(
      `INSERT INTO customer_ledger (customer_id, bill_id, entry_type, debit, credit, note, created_by, idempotency_key, business_day_id)
       VALUES (?, ?, 'adjustment', 0, ?, ?, ?, ?, ?)`,
      [customer.id, billId, writeOffAmount, `Write-off — bill ${bill.bill_number}${reason ? `: ${reason}` : ''}`, actorId, key, businessDayId]
    );
    const ledgerId = ledgerInsert?.lastInsertRowid ?? (await db.get(
      `SELECT id FROM customer_ledger WHERE idempotency_key=?`, [key]
    ))?.id;

    await postJournal(db, {
      memo: `Credit write-off — bill ${bill.bill_number}${reason ? `: ${reason}` : ''}`,
      source_type: 'credit_writeoff',
      // Each partial write-off is a separate event. Using the bill id here
      // caused a later write-off to replace the earlier journal.
      source_id: ledgerId,
      external_ref: `${key}:journal`,
      created_by: actorId,
      business_day_id: businessDayId,
      lines: [
        { code: '5070', debit: writeOffAmount, credit: 0, memo: 'Discount / write-off' },
        { code: '1300', debit: 0, credit: writeOffAmount, customer_id: customer.id, memo: 'Customer receivable written off' },
      ],
    });

    const remaining = fromCents(outstandingCents - writeOffCents);
    const status = remaining > 0 ? 'partially_paid' : 'paid';
    await db.run(
      `UPDATE customers SET current_credit = CASE
         WHEN COALESCE(current_credit,0) - ? < 0 THEN 0
         ELSE COALESCE(current_credit,0) - ? END WHERE id=?`,
      [writeOffAmount, writeOffAmount, customer.id]
    );
    await db.run(
      `UPDATE bills SET outstanding_amount=?, payment_status=?, status=?, paid_at=${remaining > 0 ? 'NULL' : 'CURRENT_TIMESTAMP'} WHERE id=?`,
      [remaining, status, status, billId]
    );
    return { writtenOff: writeOffAmount, outstanding: remaining, status };
  });
}
