import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { PosDatabase } from '../../lib/db/index.js';
import { accountBalance, ensureAccountingSchema, postExpenseJournal, postJournal } from '../../lib/accounting.js';
import { listCorrections } from '../../lib/accounting-corrections.js';
import { composeAnalytics } from '../../lib/analytics.js';
import { closingReconciliation } from '../../lib/summary-report.js';
import { ensureBusinessDaySchema, openBusinessDay } from '../../lib/business-days.js';
import { correctExpensePaymentMethod, ensureExpenseVoidSchema } from '../../lib/expense-links.js';
import { getNepaliDateString } from '../../lib/time-utils.js';
import { listHistoricalActivity } from '../../lib/historical-activity.js';

function shiftDate(value, days) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test('a closed-day expense payment method is corrected with an audit journal', async () => {
  const file = path.join(os.tmpdir(), `expense-payment-correction-${process.pid}-${Date.now()}.db`);
  const db = new PosDatabase(file);
  try {
    const actor = { id: 1, full_name: 'Admin', role: 'admin' };
    const day = await openBusinessDay(db, { business_date: getNepaliDateString(), opening_cash: 500 }, actor);
    await ensureExpenseVoidSchema(db);
    const inserted = await db.run(
      `INSERT INTO expenses
       (description,category,amount,expense_date,purchase_date,payment_method,logged_by,business_day_id)
       VALUES ('Gas refill','utilities',100,?,?,'cash',?,?)`,
      [day.business_date, day.business_date, actor.id, day.id]
    );
    const expenseId = inserted.lastInsertRowid;
    await postExpenseJournal(db, {
      id: expenseId, amount: 100, category: 'utilities', description: 'Gas refill',
      payment_method: 'cash', expense_date: day.business_date, logged_by: actor.id,
      business_day_id: day.id,
    });
    await db.run(
      `UPDATE journal_entries SET created_at=datetime(CURRENT_TIMESTAMP,'-2 minutes')
       WHERE source_type='expense' AND source_id=?`,
      [expenseId]
    );
    await db.run(
      `UPDATE business_day_sessions
       SET status='closed',closed_at=datetime(CURRENT_TIMESTAMP,'-1 minute'),expected_cash=400,counted_cash=500,cash_difference=100
       WHERE business_day_id=?`,
      [day.id]
    );
    await db.run(
      `UPDATE business_days
       SET status='closed',closed_at=datetime(CURRENT_TIMESTAMP,'-1 minute'),expected_cash=400,counted_cash=500,cash_difference=100
       WHERE id=?`,
      [day.id]
    );

    // node-postgres returns DATE columns as Date objects. Simulate that driver
    // shape so the correction must normalize the value before journal posting.
    const originalGet = db.get.bind(db);
    db.get = async (sql, params) => {
      const row = await originalGet(sql, params);
      if (row && /bd\.business_date/.test(sql) && row.business_date) {
        return { ...row, business_date: new Date(`${row.business_date}T00:00:00Z`) };
      }
      return row;
    };

    const correction = await correctExpensePaymentMethod(db, {
      expenseId, paymentMethod: 'online', reason: 'Bank statement confirms online payment', performedBy: actor.id,
    });
    assert.equal(correction.previous_method, 'cash');
    assert.equal(correction.method, 'online');
    assert.equal((await db.get('SELECT payment_method FROM expenses WHERE id=?', [expenseId])).payment_method, 'online');
    const journal = await db.get('SELECT * FROM journal_entries WHERE id=?', [correction.journal_id]);
    assert.equal(journal.business_day_id, day.id);
    assert.equal(String(journal.entry_date).slice(0, 10), day.business_date);
    assert.match(journal.memo, /Bank statement confirms online payment/);
    assert.equal(await accountBalance(db, '1010'), 500);
    assert.equal(await accountBalance(db, '1020'), -100);
    const history = await listCorrections(db);
    assert.equal(history.some((row) => row.id === correction.journal_id && row.source_type === 'expense_payment_method_correction'), true);
    const closing = await closingReconciliation(db, day.business_date, day.business_date);
    assert.equal(closing.expected_cash, 400);
    assert.equal(closing.adjusted_expected_cash, 500);
    assert.deepEqual(closing.post_close_adjustments, { entries: 1, cash_delta: 100 });

    const second = await correctExpensePaymentMethod(db, {
      expenseId, paymentMethod: 'owner_pocket', reason: 'Owner confirms personal payment', performedBy: actor.id,
    });
    assert.equal(second.previous_method, 'online');
    assert.equal(await accountBalance(db, '1020'), 0);
    assert.equal(await accountBalance(db, '3010'), -100);

    await assert.rejects(
      correctExpensePaymentMethod(db, { expenseId, paymentMethod: 'owner_pocket', reason: 'same again', performedBy: actor.id }),
      /already uses/
    );
    await verifyHistoricalPurchaseCorrections(db, actor);
  } finally {
    try { db.close(); } catch { /* already closed */ }
    for (const suffix of ['', '-shm', '-wal']) {
      try { fs.unlinkSync(`${file}${suffix}`); } catch { /* absent */ }
    }
  }
});

async function verifyHistoricalPurchaseCorrections(db, actor) {
    const today = getNepaliDateString();
    const purchaseDate = shiftDate(today, -45);
    const fundingDate = shiftDate(purchaseDate, -1);
    await ensureExpenseVoidSchema(db);
    await ensureBusinessDaySchema(db);
    await ensureAccountingSchema(db);
    await db.run(`CREATE TABLE IF NOT EXISTS suppliers (id INTEGER PRIMARY KEY, name TEXT)`);
    await db.run(
      `CREATE TABLE IF NOT EXISTS purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_id INTEGER, supplier TEXT,
        invoice_number TEXT, invoice_date TEXT, subtotal REAL, tax REAL, discount REAL,
        shipping REAL, total REAL, status TEXT, received_by INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    );
    const dayResult = await db.run(
      `INSERT INTO business_days
       (business_date,status,opened_at,closed_at,opening_cash,expected_cash,counted_cash,cash_difference)
       VALUES (?,'closed',?,datetime(CURRENT_TIMESTAMP,'-1 minute'),500,400,500,100)`,
      [purchaseDate, `${purchaseDate} 08:00:00`]
    );
    const dayId = dayResult.lastInsertRowid;
    await db.run(
      `INSERT INTO business_day_sessions
       (business_day_id,session_number,status,opened_at,closed_at,opening_cash,expected_cash,counted_cash,cash_difference)
       VALUES (?,1,'closed',?,datetime(CURRENT_TIMESTAMP,'-1 minute'),500,400,500,100)`,
      [dayId, `${purchaseDate} 08:00:00`]
    );
    const purchaseResult = await db.run(
      `INSERT INTO purchases
       (invoice_number,invoice_date,subtotal,tax,discount,shipping,total,status,received_by)
       VALUES ('HIST-001',?,100,0,0,0,100,'received',?)`,
      [purchaseDate, actor.id]
    );
    const purchaseId = purchaseResult.lastInsertRowid;
    const expenseResult = await db.run(
      `INSERT INTO expenses
       (description,category,amount,expense_date,purchase_date,payment_method,logged_by,source_type,source_id,business_day_id)
       VALUES ('Historical purchase','inventory_purchase',100,?,?,'owner_pocket',?,'purchase',?,?)`,
      [purchaseDate, purchaseDate, actor.id, purchaseId, dayId]
    );
    const expenseId = expenseResult.lastInsertRowid;
    await postExpenseJournal(db, {
      id: expenseId, amount: 100, category: 'inventory_purchase', description: 'Historical purchase',
      payment_method: 'owner_pocket', expense_date: purchaseDate, logged_by: actor.id,
      source_type: 'purchase', business_day_id: dayId,
    });
    await postJournal(db, {
      entry_date: fundingDate,
      memo: 'Historical funding fixture',
      source_type: 'business_funding_investment',
      source_id: 999,
      business_day_id: dayId,
      lines: [
        { code: '1050', debit: 1000, credit: 0 },
        { code: '3010', debit: 0, credit: 1000 },
      ],
    });

    const expectedBucket = {
      online: 'online',
      business_funding: 'funding',
      owner_pocket: 'funding',
      credit: 'credit',
      cash: 'cash',
    };
    for (const paymentMethod of ['online', 'business_funding', 'owner_pocket', 'credit', 'cash']) {
      const correction = await correctExpensePaymentMethod(db, {
        expenseId,
        paymentMethod,
        reason: `Historical correction to ${paymentMethod}`,
        performedBy: actor.id,
      });
      const journal = await db.get('SELECT entry_date,business_day_id FROM journal_entries WHERE id=?', [correction.journal_id]);
      assert.equal(String(journal.entry_date).slice(0, 10), purchaseDate);
      assert.equal(Number(journal.business_day_id), Number(dayId));

      const historical = await composeAnalytics(db, { start: purchaseDate, end: purchaseDate });
      const purchases = historical.suppliers.purchasing.purchases;
      for (const bucket of ['cash', 'online', 'funding', 'credit']) {
        assert.equal(purchases[bucket].amount, bucket === expectedBucket[paymentMethod] ? 100 : 0);
      }
      assert.equal(purchases.total, 100);
    }

    const current = await composeAnalytics(db, { start: today, end: today });
    assert.equal(current.suppliers.purchasing.purchases.total, 0);
    const activity = await listHistoricalActivity(db, { from: purchaseDate, to: purchaseDate });
    const paymentChanges = activity.changes.filter((row) => row.action === 'payment corrected' && Number(row.purchase_id) === Number(purchaseId));
    assert.equal(paymentChanges.length, 5);
}
