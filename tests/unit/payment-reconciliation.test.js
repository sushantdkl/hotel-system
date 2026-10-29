import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { PosDatabase } from '../../lib/db/index.js';
import { businessDaySummary, openBusinessDay } from '../../lib/business-days.js';
import { nepalDateString } from '../../lib/report-dates.js';
import { accountBalance, postJournal, postSaleJournal } from '../../lib/accounting.js';
import { getCorrectionJournalPreview, refundBill, reverseCorrectionByJournal, voidPaidBill } from '../../lib/bill-corrections.js';
import { correctCustomerCreditPaymentMethod, customerLedgerHistory, outstandingCreditBills, receivableAgeing } from '../../lib/accounting-receivables.js';
import { reverseJournal } from '../../lib/accounting-corrections.js';
import { completeBillPayment, reviseBillSettlement } from '../../lib/bills-admin.js';
import {
  collectCreditBalance,
  ensureSplitPaymentSchema,
  recordInitialSplitSettlement,
  validateAllocations,
  writeOffCreditBalance,
} from '../../lib/split-payments.js';
import { buildPaymentReconciliation } from '../../lib/payment-reconciliation.js';
import { ensureLedgerSchema } from '../../lib/inventory-ledger.js';
import { paySupplier, supplierLedgerHistory, supplierOpenInvoices } from '../../lib/accounting-suppliers.js';
import { ensureStockMovementsTable } from '../../lib/stock-movements.js';
import { ensureRecipeTables, logWastage } from '../../lib/recipes.js';
import { createPurchase } from '../../lib/purchases.js';
import { buildReport } from '../../lib/reports.js';
import { composeAnalytics } from '../../lib/analytics.js';
import { buildSummaryReport } from '../../lib/summary-report.js';
import { businessFundingProfile } from '../../lib/business-funding.js';
import { ensureColumn } from '../../lib/db/schema-helpers.js';

const dbPath = path.join(os.tmpdir(), `payment-reconciliation-${process.pid}-${Date.now()}.db`);
const db = new PosDatabase(dbPath);
const actor = { id: 1, full_name: 'Admin', role: 'admin' };
const today = nepalDateString();

test.after(() => {
  try { db.close(); } catch { /* already closed */ }
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* already gone */ }
  }
});

let businessDayId;
let customerId;

test('setup an open day and customer', async () => {
  const day = await openBusinessDay(db, { business_date: today, opening_cash: 1000 }, actor);
  businessDayId = day.id;
  await ensureSplitPaymentSchema(db);
  // Production adds this via migrations 049/050; the void/restock path in
  // bill-corrections reads it, so the fixture must carry it too.
  await ensureColumn(db, 'order_items', 'combo_snapshot', 'TEXT');
  const customer = await db.run(
    `INSERT INTO customers (name,phone,credit_limit,current_credit) VALUES ('Reconciliation Customer','9800000001',5000,0)`
  );
  customerId = customer.lastInsertRowid;
  assert.ok(businessDayId);
  assert.ok(customerId);
});

async function makeCreditBill({ number, total }) {
  const order = await db.run(
    `INSERT INTO orders (order_number,status,customer_id,customer_name,business_day_id)
     VALUES (?, 'completed', ?, 'Reconciliation Customer', ?)`,
    [`ORDER-${number}`, customerId, businessDayId]
  );
  const bill = await db.run(
    `INSERT INTO bills
       (bill_number,order_id,subtotal,grand_total,status,customer_id,outstanding_amount,payment_status,business_day_id,created_at)
     VALUES (?,?,?,?, 'unpaid', ?,0,'unpaid',?,CURRENT_TIMESTAMP)`,
    [number, order.lastInsertRowid, total, total, customerId, businessDayId]
  );
  const customer = await db.get('SELECT * FROM customers WHERE id=?', [customerId]);
  const allocations = validateAllocations([{ method: 'credit', amount: total }], total, {
    customer, allowCredit: true, actorRole: 'admin',
  });
  await recordInitialSplitSettlement(db, {
    billId: bill.lastInsertRowid,
    billNumber: number,
    total,
    allocations,
    customer,
    actorId: actor.id,
    requestKey: `initial-${number}`,
    businessDayId,
  });
  return bill.lastInsertRowid;
}

test('credit collection and several write-offs reconcile without double-counting', async () => {
  const billId = await makeCreditBill({ number: 'RECON-CREDIT', total: 100 });
  await collectCreditBalance(db, {
    billId,
    allocations: [{ method: 'cash', amount: 40, cash_tendered: 40 }],
    actorId: actor.id,
    actorRole: 'admin',
    requestKey: 'collect-recon-credit',
  });
  await writeOffCreditBalance(db, {
    billId, amount: 30, reason: 'First adjustment', actorId: actor.id,
    actorRole: 'admin', allowCreditWriteOff: true, requestKey: 'writeoff-recon-1',
  });
  await writeOffCreditBalance(db, {
    billId, amount: 30, reason: 'Second adjustment', actorId: actor.id,
    actorRole: 'admin', allowCreditWriteOff: true, requestKey: 'writeoff-recon-2',
  });

  const journals = await db.all(`SELECT id FROM journal_entries WHERE source_type='credit_writeoff' ORDER BY id`);
  assert.equal(journals.length, 2, 'partial write-offs keep separate journals');

  const report = await buildPaymentReconciliation(db, { start: today, end: today }, businessDayId);
  const row = report.bills.find((entry) => entry.billId === billId);
  assert.equal(row.result, 'balanced');
  assert.equal(row.received, 40);
  assert.equal(row.writtenOff, 60);
  assert.equal(row.outstanding, 0);
  assert.equal(report.credit.sold, 100);
  assert.equal(report.credit.collected, 40);
  assert.equal(report.credit.writtenOff, 60);
  assert.equal(report.credit.difference, 0);
});

test('void reverses sale, collections, write-offs and settlement rows together', async () => {
  const bill = await db.get(`SELECT id FROM bills WHERE bill_number='RECON-CREDIT'`);
  const result = await voidPaidBill(db, {
    bill_id: bill.id, reason: 'Test complete reversal', restock: false, created_by: actor.id,
  });

  assert.deepEqual(result.refund_by_method, [{ method: 'cash', amount: 40 }]);
  assert.ok(result.reversed_journals.length >= 4, 'sale, collection and both write-offs are reversed');

  const updated = await db.get(`SELECT status,payment_status,outstanding_amount FROM bills WHERE id=?`, [bill.id]);
  assert.equal(updated.status, 'voided');
  assert.equal(updated.payment_status, 'voided');
  assert.equal(Number(updated.outstanding_amount), 0);

  const activePayments = await db.get(
    `SELECT COUNT(*) AS count FROM bill_payments
     WHERE bill_id=? AND LOWER(COALESCE(settlement_status,'received')) NOT IN ('voided','cancelled','failed')`,
    [bill.id]
  );
  const activeAllocations = await db.get(
    `SELECT COUNT(*) AS count FROM bill_payment_allocations
     WHERE bill_id=? AND LOWER(COALESCE(settlement_status,'received')) NOT IN ('voided','cancelled','failed')`,
    [bill.id]
  );
  assert.equal(Number(activePayments.count), 0);
  assert.equal(Number(activeAllocations.count), 0);

  const customerLedger = await db.get(
    `SELECT COALESCE(SUM(debit-credit),0) AS balance FROM customer_ledger WHERE bill_id=?`,
    [bill.id]
  );
  const customer = await db.get(`SELECT current_credit FROM customers WHERE id=?`, [customerId]);
  assert.equal(Number(customerLedger.balance), 0);
  assert.equal(Number(customer.current_credit), 0);

  const report = await buildPaymentReconciliation(db, { start: today, end: today }, businessDayId);
  const row = report.bills.find((entry) => entry.billId === bill.id);
  assert.equal(row.result, 'voided_clear');
});

test('credit collection and write-off reject a voided bill', async () => {
  const bill = await db.get(`SELECT id FROM bills WHERE bill_number='RECON-CREDIT'`);
  await db.run(`UPDATE bills SET outstanding_amount=10 WHERE id=?`, [bill.id]);
  await assert.rejects(
    collectCreditBalance(db, { billId: bill.id, allocations: [{ method: 'cash', amount: 10 }], actorId: actor.id, actorRole: 'admin', requestKey: 'void-collect' }),
    /voided bill cannot take/i
  );
  await assert.rejects(
    writeOffCreditBalance(db, { billId: bill.id, amount: 10, actorId: actor.id, actorRole: 'admin', allowCreditWriteOff: true, requestKey: 'void-writeoff' }),
    /voided bill cannot have customer credit written off/i
  );
});

test('customer credit payment method correction moves Cash to Online without changing the paid balance', async () => {
  const billId = await makeCreditBill({ number: 'RECON-METHOD-CORRECTION', total: 75 });
  await collectCreditBalance(db, {
    billId,
    allocations: [{ method: 'cash', amount: 75, cash_tendered: 75 }],
    actorId: actor.id,
    actorRole: 'admin',
    requestKey: 'collect-method-correction',
  });
  const payment = await db.get(
    `SELECT bp.id FROM bill_payments bp JOIN customer_ledger cl ON cl.payment_id=bp.id
     WHERE bp.bill_id=? AND cl.entry_type='credit_payment'`,
    [billId]
  );
  const before = {
    cash: await accountBalance(db, '1010'),
    online: await accountBalance(db, '1020'),
    customer: Number((await db.get('SELECT current_credit FROM customers WHERE id=?', [customerId])).current_credit),
  };

  const corrected = await correctCustomerCreditPaymentMethod(db, {
    paymentId: payment.id,
    method: 'online',
    reason: 'Customer paid online; cashier selected cash.',
    actorId: actor.id,
    requestKey: 'correct-method-to-online',
  });
  assert.equal(corrected.previous_method, 'cash');
  assert.equal(corrected.method, 'online');
  assert.equal(await accountBalance(db, '1010'), before.cash - 75);
  assert.equal(await accountBalance(db, '1020'), before.online + 75);
  assert.equal(Number((await db.get('SELECT current_credit FROM customers WHERE id=?', [customerId])).current_credit), before.customer);
  assert.equal((await db.get('SELECT payment_method FROM bill_payments WHERE id=?', [payment.id])).payment_method, 'online');
  assert.equal((await db.get('SELECT method FROM bill_payment_allocations WHERE payment_id=?', [payment.id])).method, 'online');
  assert.equal(Number((await db.get('SELECT outstanding_amount FROM bills WHERE id=?', [billId])).outstanding_amount), 0);
  assert.equal(Number((await db.get(`SELECT COUNT(*) AS n FROM bill_audit WHERE bill_id=? AND event='credit_payment_method_corrected'`, [billId])).n), 1);

  await correctCustomerCreditPaymentMethod(db, {
    paymentId: payment.id,
    method: 'cash',
    reason: 'Manager verified it was cash after reviewing the receipt.',
    actorId: actor.id,
    requestKey: 'correct-method-back-to-cash',
  });
  assert.equal(await accountBalance(db, '1010'), before.cash);
  assert.equal(await accountBalance(db, '1020'), before.online);
});

test('reversing a bill journal performs a full void and removes its credit', async () => {
  const before = Number((await db.get(`SELECT current_credit FROM customers WHERE id=?`, [customerId])).current_credit || 0);
  const billId = await makeCreditBill({ number: 'RECON-JOURNAL-CREDIT', total: 70 });
  const journal = await db.get(`SELECT id FROM journal_entries WHERE source_type='bill' AND source_id=?`, [billId]);
  assert.ok(journal?.id);

  // Reproduce the old half-correction: accounting was reversed, but the bill
  // and customer ledger were left active.
  await db.transaction((tx) => reverseJournal(tx, {
    journal_id: journal.id,
    reason: 'Legacy ledger-only reversal',
    created_by: actor.id,
  }));

  const preview = await getCorrectionJournalPreview(db, journal.id);
  assert.equal(preview.action, 'void_bill');
  assert.equal(preview.bill.id, billId);
  assert.equal(Number(preview.bill.credit.outstanding), 70);
  assert.ok(preview.journal.reversal_id);

  const result = await reverseCorrectionByJournal(db, {
    journal_id: journal.id,
    reason: 'Wrong customer credit bill',
    restock: false,
    created_by: actor.id,
  });
  assert.equal(result.action, 'void_bill');

  const bill = await db.get(`SELECT status,payment_status,outstanding_amount FROM bills WHERE id=?`, [billId]);
  assert.equal(bill.status, 'voided');
  assert.equal(bill.payment_status, 'voided');
  assert.equal(Number(bill.outstanding_amount), 0);
  const after = Number((await db.get(`SELECT current_credit FROM customers WHERE id=?`, [customerId])).current_credit || 0);
  assert.equal(after, before);
  assert.equal((await outstandingCreditBills(db, customerId)).some((row) => row.id === billId), false);
  const ageing = await receivableAgeing(db);
  assert.equal(ageing.some((row) => row.customer_id === customerId && Number(row.total) > after + 0.001), false);
});

test('reversing an unrelated journal remains ledger-only', async () => {
  const journalId = await postJournal(db, {
    memo: 'Standalone correction test',
    source_type: 'manual_adjustment',
    source_id: 987654,
    business_day_id: businessDayId,
    lines: [
      { code: '1010', debit: 5, credit: 0, memo: 'test debit' },
      { code: '3010', debit: 0, credit: 5, memo: 'test credit' },
    ],
  });
  const preview = await getCorrectionJournalPreview(db, journalId);
  assert.equal(preview.action, 'reverse_journal');
  assert.equal(preview.bill, null);

  const before = Number((await db.get(`SELECT COUNT(*) AS count FROM bill_corrections`)).count);
  const result = await reverseCorrectionByJournal(db, {
    journal_id: journalId,
    reason: 'Standalone test reversal',
    created_by: actor.id,
  });
  assert.equal(result.action, 'reverse_journal');
  assert.ok(result.journal_id);
  const after = Number((await db.get(`SELECT COUNT(*) AS count FROM bill_corrections`)).count);
  assert.equal(after, before);
});

test('reversing a customer collection reopens only that credit amount', async () => {
  const creditBefore = Number((await db.get(`SELECT current_credit FROM customers WHERE id=?`, [customerId])).current_credit || 0);
  const billId = await makeCreditBill({ number: 'RECON-REVERSE-COLLECTION', total: 100 });
  await collectCreditBalance(db, {
    billId,
    allocations: [{ method: 'cash', amount: 40, cash_tendered: 40 }],
    actorId: actor.id,
    actorRole: 'admin',
    requestKey: 'reverse-one-collection',
  });
  const journal = await db.get(
    `SELECT id,source_id FROM journal_entries WHERE source_type='credit_collection' AND external_ref='reverse-one-collection:cash:0:journal'`
  );
  const preview = await getCorrectionJournalPreview(db, journal.id);
  assert.equal(preview.action, 'reverse_credit_collection');

  const result = await reverseCorrectionByJournal(db, {
    journal_id: journal.id, reason: 'Collection entered twice', created_by: actor.id,
  });
  assert.equal(result.action, 'reverse_credit_collection');
  assert.equal(result.amount, 40);

  const bill = await db.get(`SELECT status,payment_status,outstanding_amount FROM bills WHERE id=?`, [billId]);
  assert.equal(bill.status, 'unpaid');
  assert.equal(bill.payment_status, 'unpaid');
  assert.equal(Number(bill.outstanding_amount), 100);
  const payment = await db.get(`SELECT settlement_status FROM bill_payments WHERE id=?`, [journal.source_id]);
  assert.equal(payment.settlement_status, 'voided');
  const reversals = await customerLedgerHistory(db, { status: 'reversed', search: 'Reconciliation Customer' });
  assert.ok(reversals.some((row) => row.bill_id === billId && row.status === 'reversed' && row.debit === 40));
  const creditAfter = Number((await db.get(`SELECT current_credit FROM customers WHERE id=?`, [customerId])).current_credit || 0);
  assert.equal(creditAfter, creditBefore + 100);
});

test('reversing a write-off restores the receivable without voiding the bill', async () => {
  const creditBefore = Number((await db.get(`SELECT current_credit FROM customers WHERE id=?`, [customerId])).current_credit || 0);
  const billId = await makeCreditBill({ number: 'RECON-REVERSE-WRITEOFF', total: 80 });
  await writeOffCreditBalance(db, {
    billId, amount: 30, reason: 'Incorrect approval', actorId: actor.id,
    actorRole: 'admin', allowCreditWriteOff: true, requestKey: 'reverse-one-writeoff',
  });
  const journal = await db.get(
    `SELECT id FROM journal_entries WHERE source_type='credit_writeoff' AND external_ref='reverse-one-writeoff:journal'`
  );
  const preview = await getCorrectionJournalPreview(db, journal.id);
  assert.equal(preview.action, 'reverse_credit_writeoff');

  const result = await reverseCorrectionByJournal(db, {
    journal_id: journal.id, reason: 'Write-off was not approved', created_by: actor.id,
  });
  assert.equal(result.action, 'reverse_credit_writeoff');
  assert.equal(result.amount, 30);

  const bill = await db.get(`SELECT status,payment_status,outstanding_amount FROM bills WHERE id=?`, [billId]);
  assert.equal(bill.status, 'unpaid');
  assert.equal(bill.payment_status, 'unpaid');
  assert.equal(Number(bill.outstanding_amount), 80);
  const creditAfter = Number((await db.get(`SELECT current_credit FROM customers WHERE id=?`, [customerId])).current_credit || 0);
  assert.equal(creditAfter, creditBefore + 80);
});

test('reversing a linked payment and discount restores the whole credit settlement everywhere', async () => {
  await ensureStockMovementsTable(db);
  await ensureRecipeTables(db);
  await ensureLedgerSchema(db);
  await ensureColumn(db, 'expenses', 'payment_method', "TEXT DEFAULT 'cash'");
  const range = { start: today, end: today };
  const reportValue = (report, key) => Number(report.kpis.find((row) => row.key === key)?.value || 0);
  const analyticsValue = (analytics, key) => Number(analytics.sales.reportKpis.find((row) => row.key === key)?.value || 0);
  const beforeReport = await buildReport(db, 'sales', range, {});
  const beforeAnalytics = await composeAnalytics(db, range, {}, { businessDayId });
  const beforeSummary = await buildSummaryReport(db, range);
  const beforeClosing = await businessDaySummary(db, businessDayId);

  const billId = await makeCreditBill({ number: 'RECON-LINKED-SETTLEMENT', total: 100 });
  await collectCreditBalance(db, {
    billId,
    allocations: [{ method: 'cash', amount: 98, cash_tendered: 98 }],
    actorId: actor.id,
    actorRole: 'admin',
    requestKey: 'linked-settlement',
  });
  await writeOffCreditBalance(db, {
    billId,
    amount: 2,
    reason: 'Linked settlement discount',
    actorId: actor.id,
    actorRole: 'admin',
    allowCreditWriteOff: true,
    requestKey: 'linked-settlement:discount',
  });
  const collection = await db.get(
    `SELECT id FROM journal_entries WHERE source_type='credit_collection' AND external_ref='linked-settlement:cash:0:journal'`
  );
  const writeOff = await db.get(
    `SELECT id FROM journal_entries WHERE source_type='credit_writeoff' AND external_ref='linked-settlement:discount:journal'`
  );

  const result = await reverseCorrectionByJournal(db, {
    journal_id: collection.id,
    reason: 'Whole settlement entered incorrectly',
    created_by: actor.id,
  });
  assert.equal(result.bundled_settlement, true);
  assert.equal(result.amount, 100);
  assert.deepEqual(result.reversed_journals.map((row) => row.source_type).sort(), ['credit_collection', 'credit_writeoff']);
  assert.ok(await db.get(`SELECT id FROM journal_entries WHERE source_type='reversal' AND source_id=?`, [writeOff.id]));

  const bill = await db.get(`SELECT outstanding_amount,payment_status,status FROM bills WHERE id=?`, [billId]);
  assert.equal(Number(bill.outstanding_amount), 100);
  assert.equal(bill.payment_status, 'unpaid');
  assert.equal(bill.status, 'unpaid');

  const afterReport = await buildReport(db, 'sales', range, {});
  const afterAnalytics = await composeAnalytics(db, range, {}, { businessDayId });
  const afterSummary = await buildSummaryReport(db, range);
  const afterClosing = await businessDaySummary(db, businessDayId);
  assert.equal(reportValue(afterReport, 'cash_received'), reportValue(beforeReport, 'cash_received'));
  assert.equal(reportValue(afterReport, 'credit_collections'), reportValue(beforeReport, 'credit_collections'));
  assert.equal(analyticsValue(afterAnalytics, 'credit_collections'), analyticsValue(beforeAnalytics, 'credit_collections'));
  assert.equal(Number(afterSummary.ledger.cash), Number(beforeSummary.ledger.cash));
  assert.equal(Number(afterClosing.cash.breakdown.credit_collections), Number(beforeClosing.cash.breakdown.credit_collections));
  assert.equal(Number(afterClosing.collections.cash), Number(beforeClosing.collections.cash));
  assert.equal(Number(afterClosing.collections.net_collected), Number(beforeClosing.collections.net_collected));
  assert.equal(Number(afterClosing.cash.breakdown.void_returns), Number(beforeClosing.cash.breakdown.void_returns));
});

test('reversing a supplier payment restores the supplier open balance', async () => {
  await ensureStockMovementsTable(db);
  await ensureRecipeTables(db);
  await ensureLedgerSchema(db);
  const supplier = await db.run(
    `INSERT INTO suppliers (name,normalized_name) VALUES ('Correction Supplier','correction supplier')`
  );
  await postJournal(db, {
    memo: 'Supplier credit invoice', source_type: 'expense', source_id: 987001,
    business_day_id: businessDayId,
    lines: [
      { code: '5010', debit: 100, credit: 0 },
      { code: '2010', debit: 0, credit: 100, supplier_id: supplier.lastInsertRowid },
    ],
  });
  const paymentJournal = await paySupplier(db, {
    supplier_id: supplier.lastInsertRowid, amount: 60, method: 'cash', note: 'Partial supplier payment', created_by: actor.id,
  });
  assert.equal((await supplierOpenInvoices(db, supplier.lastInsertRowid))[0].outstanding, 40);
  const preview = await getCorrectionJournalPreview(db, paymentJournal);
  assert.equal(preview.action, 'reverse_supplier_payment');

  const result = await reverseCorrectionByJournal(db, {
    journal_id: paymentJournal, reason: 'Supplier payment was entered twice', created_by: actor.id,
  });
  assert.equal(result.action, 'reverse_supplier_payment');
  const restored = await supplierOpenInvoices(db, supplier.lastInsertRowid);
  assert.equal(restored.reduce((sum, row) => sum + Number(row.outstanding || 0), 0), 100);
  const reversals = await supplierLedgerHistory(db, { status: 'reversed', search: 'Correction Supplier' });
  assert.ok(reversals.some((row) => row.journal_id === result.journal_id && row.credit === 60 && row.status === 'reversed'));
});

test('supplier payment can use Business Funding and cannot overdraw it', async () => {
  const supplier = await db.run(
    `INSERT INTO suppliers (name,normalized_name) VALUES ('Funding Supplier','funding supplier')`
  );
  await postJournal(db, {
    memo: 'Supplier credit invoice', source_type: 'expense', source_id: 987002,
    business_day_id: businessDayId,
    lines: [
      { code: '5010', debit: 1000, credit: 0 },
      { code: '2010', debit: 0, credit: 1000, supplier_id: supplier.lastInsertRowid },
    ],
  });
  await postJournal(db, {
    memo: 'Funding for supplier payment', source_type: 'business_funding_investment', source_id: 987002,
    business_day_id: businessDayId,
    lines: [
      { code: '1050', debit: 100, credit: 0 },
      { code: '3010', debit: 0, credit: 100 },
    ],
  });

  const journalId = await paySupplier(db, {
    supplier_id: supplier.lastInsertRowid,
    amount: 60,
    method: 'business_funding',
    note: 'Paid from funding pool',
    created_by: actor.id,
  });
  const lines = await db.all(
    `SELECT a.code,jl.debit,jl.credit FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id WHERE jl.journal_id=? ORDER BY a.code`,
    [journalId]
  );
  assert.deepEqual(lines.map((line) => [line.code, Number(line.debit), Number(line.credit)]), [
    ['1050', 0, 60],
    ['2010', 60, 0],
  ]);
  assert.equal(await accountBalance(db, '1050'), 40);
  assert.equal((await supplierOpenInvoices(db, supplier.lastInsertRowid))[0].outstanding, 940);
  const statement = await supplierLedgerHistory(db, { status: 'paid', search: 'Funding Supplier' });
  assert.equal(statement[0].payment_method, 'business_funding');
  assert.ok((await businessFundingProfile(db)).history.some((row) => row.id === journalId && row.source_type === 'supplier_payment'));

  await assert.rejects(
    paySupplier(db, {
      supplier_id: supplier.lastInsertRowid,
      amount: 50,
      method: 'business_funding',
      created_by: actor.id,
    }),
    (error) => error.code === 'business_funding_insufficient' && error.available === 40 && error.shortfall === 10
  );
  assert.equal(await accountBalance(db, '1050'), 40);
});

test('reversing a refund restores the bill refund balance without voiding the sale', async () => {
  const order = await db.run(
    `INSERT INTO orders (order_number,status,business_day_id) VALUES ('ORDER-REFUND-REVERSAL','completed',?)`,
    [businessDayId]
  );
  const bill = await db.run(
    `INSERT INTO bills (bill_number,order_id,subtotal,grand_total,status,outstanding_amount,payment_status,business_day_id)
     VALUES ('RECON-REFUND-REVERSAL',?,100,100,'paid',0,'paid',?)`,
    [order.lastInsertRowid, businessDayId]
  );
  const customer = await db.get(`SELECT * FROM customers WHERE id=?`, [customerId]);
  const allocations = validateAllocations([{ method: 'cash', amount: 100, cash_tendered: 100 }], 100, {
    customer, allowCredit: false, actorRole: 'admin',
  });
  await recordInitialSplitSettlement(db, {
    billId: bill.lastInsertRowid, billNumber: 'RECON-REFUND-REVERSAL', total: 100,
    allocations, customer, actorId: actor.id, requestKey: 'initial-refund-reversal', businessDayId,
  });
  const refundResult = await refundBill(db, {
    bill_id: bill.lastInsertRowid, amount: 30, method: 'cash', reason: 'Test refund', created_by: actor.id,
  });
  const preview = await getCorrectionJournalPreview(db, refundResult.journal_id);
  assert.equal(preview.action, 'reverse_refund');

  const result = await reverseCorrectionByJournal(db, {
    journal_id: refundResult.journal_id, reason: 'Refund entered against wrong bill', created_by: actor.id,
  });
  assert.equal(result.action, 'reverse_refund');
  assert.equal(result.refunded_total, 0);
  const updated = await db.get(`SELECT status,refunded_amount FROM bills WHERE id=?`, [bill.lastInsertRowid]);
  assert.equal(updated.status, 'paid');
  assert.equal(Number(updated.refunded_amount), 0);
});

test('reversing a purchase journal voids the purchase, stock and linked expense', async () => {
  const itemInsert = await db.run(
    `INSERT INTO inventory_items (item_name,name,quantity,unit,cost_per_unit,is_archived)
     VALUES ('Correction Test Stock','Correction Test Stock',10,'piece',4,0)`
  );
  const item = { id: itemInsert.lastInsertRowid, quantity: 10 };
  const beforeQuantity = 10;
  const purchase = await createPurchase(db, {
    supplier: 'Correction Supplier', invoice_number: 'CORRECTION-PURCHASE-1', invoice_date: today,
    payment_method: 'credit', received_by: actor.id,
    items: [{ inventory_item_id: item.id, quantity_ordered: 2, quantity_received: 2, unit_cost: 10 }],
  });
  const [purchaseMovement, linkedExpense] = await Promise.all([
    db.get(
      `SELECT business_day_id FROM stock_movements
       WHERE change_type='purchase_receipt' AND reference_id=? ORDER BY id DESC LIMIT 1`,
      [String(purchase.id)]
    ),
    db.get(`SELECT business_day_id FROM expenses WHERE id=?`, [purchase.expense_id]),
  ]);
  assert.equal(Number(purchaseMovement.business_day_id), Number(businessDayId));
  assert.equal(Number(linkedExpense.business_day_id), Number(businessDayId));
  const journal = await db.get(`SELECT id,business_day_id FROM journal_entries WHERE source_type='expense' AND source_id=?`, [purchase.expense_id]);
  assert.equal(Number(journal.business_day_id), Number(businessDayId));
  const preview = await getCorrectionJournalPreview(db, journal.id);
  assert.equal(preview.action, 'void_purchase');

  const result = await reverseCorrectionByJournal(db, {
    journal_id: journal.id, reason: 'Purchase invoice was duplicated', created_by: actor.id,
  });
  assert.equal(result.action, 'void_purchase');
  const [updatedPurchase, expense, updatedItem] = await Promise.all([
    db.get(`SELECT status FROM purchases WHERE id=?`, [purchase.id]),
    db.get(`SELECT status FROM expenses WHERE id=?`, [purchase.expense_id]),
    db.get(`SELECT quantity FROM inventory_items WHERE id=?`, [item.id]),
  ]);
  assert.equal(updatedPurchase.status, 'voided');
  assert.equal(expense.status, 'voided');
  assert.equal(Number(updatedItem.quantity), beforeQuantity);
});

test('reversing a wastage journal restores stock and voids the loss expense', async () => {
  const item = await db.run(
    `INSERT INTO inventory_items (item_name,name,quantity,unit,cost_per_unit,is_archived)
     VALUES ('Correction Wastage Stock','Correction Wastage Stock',10,'piece',4,0)`
  );
  const wastage = await logWastage(db, {
    raw_material_id: item.lastInsertRowid, quantity: 2, unit: 'piece', reason: 'test', logged_by: actor.id,
  });
  const wastageMovements = await db.all(
    `SELECT id,change_type,reference_id,quantity_changed FROM stock_movements WHERE inventory_item_id=? ORDER BY id`,
    [item.lastInsertRowid]
  );
  assert.equal(wastageMovements.length, 1);
  assert.equal(wastageMovements[0].change_type, 'wastage');
  assert.equal(String(wastageMovements[0].reference_id), String(wastage.id));
  assert.equal(Number((await db.get(`SELECT quantity FROM inventory_items WHERE id=?`, [item.lastInsertRowid])).quantity), 8);
  const journal = await db.get(`SELECT id FROM journal_entries WHERE source_type='expense' AND source_id=?`, [wastage.expense_id]);
  const preview = await getCorrectionJournalPreview(db, journal.id);
  assert.equal(preview.action, 'void_wastage');

  const result = await reverseCorrectionByJournal(db, {
    journal_id: journal.id, reason: 'Wastage was entered against wrong item', created_by: actor.id,
  });
  assert.equal(result.action, 'void_wastage');
  const restoredMovements = await db.all(
    `SELECT change_type,quantity_changed FROM stock_movements WHERE inventory_item_id=? ORDER BY id`,
    [item.lastInsertRowid]
  );
  assert.equal(restoredMovements.length, 2);
  assert.equal(Number(restoredMovements[1].quantity_changed), 2);
  assert.equal(Number((await db.get(`SELECT quantity FROM inventory_items WHERE id=?`, [item.lastInsertRowid])).quantity), 10);
  assert.equal((await db.get(`SELECT status FROM wastage_log WHERE id=?`, [wastage.id])).status, 'voided');
  assert.equal((await db.get(`SELECT status FROM expenses WHERE id=?`, [wastage.expense_id])).status, 'voided');
});

test('settlement revision can create clean credit, then locks after credit activity', async () => {
  const order = await db.run(
    `INSERT INTO orders (order_number,status,customer_id,business_day_id) VALUES ('ORDER-REVISE','completed',?,?)`,
    [customerId, businessDayId]
  );
  const bill = await db.run(
    `INSERT INTO bills
       (bill_number,order_id,subtotal,grand_total,status,customer_id,outstanding_amount,payment_status,business_day_id)
     VALUES ('RECON-REVISE',?,100,100,'paid',?,0,'paid',?)`,
    [order.lastInsertRowid, customerId, businessDayId]
  );
  const customer = await db.get(`SELECT * FROM customers WHERE id=?`, [customerId]);
  const initial = validateAllocations([{ method: 'cash', amount: 100, cash_tendered: 100 }], 100, { customer, allowCredit: true, actorRole: 'admin' });
  await recordInitialSplitSettlement(db, {
    billId: bill.lastInsertRowid, billNumber: 'RECON-REVISE', total: 100,
    allocations: initial, customer, actorId: actor.id, requestKey: 'initial-revise', businessDayId,
  });

  await reviseBillSettlement(db, {
    billId: bill.lastInsertRowid,
    reason: 'Customer requested account credit',
    allocations: [{ method: 'credit', amount: 100 }],
    customerId,
    actorId: actor.id,
    actorRole: 'admin',
  });
  const revised = await db.get(`SELECT status,payment_status,outstanding_amount FROM bills WHERE id=?`, [bill.lastInsertRowid]);
  assert.equal(revised.status, 'partially_paid');
  assert.equal(revised.payment_status, 'partially_paid');
  assert.equal(Number(revised.outstanding_amount), 100);

  const report = await buildPaymentReconciliation(db, { start: today, end: today }, businessDayId);
  const row = report.bills.find((entry) => entry.billId === bill.lastInsertRowid);
  assert.equal(row.result, 'balanced');
  assert.equal(row.soldOnCredit, 100);
  assert.equal(row.outstanding, 100);

  await collectCreditBalance(db, {
    billId: bill.lastInsertRowid,
    allocations: [{ method: 'cash', amount: 25, cash_tendered: 25 }],
    actorId: actor.id, actorRole: 'admin', requestKey: 'collect-after-revise',
  });
  await assert.rejects(
    reviseBillSettlement(db, {
      billId: bill.lastInsertRowid, reason: 'Unsafe replacement',
      allocations: [{ method: 'cash', amount: 100, cash_tendered: 100 }],
      customerId, actorId: actor.id, actorRole: 'admin',
    }),
    /cannot be replaced after credit has been collected/i
  );
});

test('ordinary partial payments are idempotent and cannot exceed the remaining balance', async () => {
  const order = await db.run(`INSERT INTO orders (order_number,status,business_day_id) VALUES ('ORDER-PARTIAL','completed',?)`, [businessDayId]);
  const bill = await db.run(
    `INSERT INTO bills
       (bill_number,order_id,subtotal,grand_total,status,outstanding_amount,payment_status,business_day_id)
     VALUES ('RECON-PARTIAL',?,100,100,'unpaid',100,'unpaid',?)`,
    [order.lastInsertRowid, businessDayId]
  );
  const first = await completeBillPayment(db, {
    billId: bill.lastInsertRowid, amount: 60, method: 'split',
    allocations: [
      { method: 'cash', amount: 30, cash_tendered: 30 },
      { method: 'qr', amount: 30, provider: 'Fonepay', verified: true },
    ],
    requestKey: 'partial-payment-1', actorId: actor.id,
  });
  assert.equal(first.collected, 60);
  assert.equal(first.remainingBalance, 40);

  const duplicate = await completeBillPayment(db, {
    billId: bill.lastInsertRowid, amount: 60, method: 'split',
    allocations: [
      { method: 'cash', amount: 30, cash_tendered: 30 },
      { method: 'qr', amount: 30, provider: 'Fonepay', verified: true },
    ],
    requestKey: 'partial-payment-1', actorId: actor.id,
  });
  assert.equal(duplicate.idempotent, true);
  assert.equal(duplicate.collected, 0);

  await assert.rejects(
    completeBillPayment(db, {
      billId: bill.lastInsertRowid, amount: 50, method: 'cash', requestKey: 'partial-payment-too-large', actorId: actor.id,
    }),
    /Only 40 is outstanding/
  );
  const final = await completeBillPayment(db, {
    billId: bill.lastInsertRowid, amount: 40, method: 'cash', requestKey: 'partial-payment-2', actorId: actor.id,
  });
  assert.equal(final.remainingBalance, 0);

  const payments = await db.get(`SELECT COUNT(*) AS count,COALESCE(SUM(amount),0) AS amount FROM bill_payments WHERE bill_id=?`, [bill.lastInsertRowid]);
  const journals = await db.get(`SELECT COUNT(*) AS count FROM journal_entries WHERE source_type='bill_payment' AND source_id IN (SELECT id FROM bill_payments WHERE bill_id=?)`, [bill.lastInsertRowid]);
  assert.equal(Number(payments.count), 3);
  assert.equal(Number(payments.amount), 100);
  assert.equal(Number(journals.count), 2);
});

test('reconciliation identifies excess and active voided payments bill by bill', async () => {
  const orderA = await db.run(`INSERT INTO orders (order_number,status,business_day_id) VALUES ('ORDER-EXCESS','completed',?)`, [businessDayId]);
  const billA = await db.run(
    `INSERT INTO bills (bill_number,order_id,subtotal,grand_total,status,outstanding_amount,payment_status,business_day_id)
     VALUES ('RECON-EXCESS',?,100,100,'paid',0,'paid',?)`,
    [orderA.lastInsertRowid, businessDayId]
  );
  await db.run(`INSERT INTO bill_payments (bill_id,amount,payment_method,settlement_status,business_day_id) VALUES (?,130,'cash','received',?)`, [billA.lastInsertRowid, businessDayId]);
  await postSaleJournal(db, { bill_id: billA.lastInsertRowid, bill_number: 'RECON-EXCESS', parts: [{ method: 'cash', amount: 100 }], business_day_id: businessDayId });

  const orderB = await db.run(`INSERT INTO orders (order_number,status,business_day_id) VALUES ('ORDER-VOID-ACTIVE','cancelled',?)`, [businessDayId]);
  const billB = await db.run(
    `INSERT INTO bills (bill_number,order_id,subtotal,grand_total,status,outstanding_amount,payment_status,business_day_id)
     VALUES ('RECON-VOID-ACTIVE',?,50,50,'voided',0,'voided',?)`,
    [orderB.lastInsertRowid, businessDayId]
  );
  await db.run(`INSERT INTO bill_payments (bill_id,amount,payment_method,settlement_status,business_day_id) VALUES (?,50,'cash','received',?)`, [billB.lastInsertRowid, businessDayId]);

  const report = await buildPaymentReconciliation(db, { start: today, end: today }, businessDayId);
  assert.equal(report.bills.find((row) => row.billId === billA.lastInsertRowid).result, 'excess');
  assert.equal(report.bills.find((row) => row.billId === billB.lastInsertRowid).result, 'voided_payment');
  assert.equal(report.totals.excessPayments, 30);
  assert.equal(report.totals.voidedPayments, 50);
  assert.equal(report.totals.needsAttention, 80);
});
