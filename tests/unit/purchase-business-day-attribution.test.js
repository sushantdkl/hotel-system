import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { PosDatabase } from '../../lib/db/index.js';
import { ensureRecipeTables } from '../../lib/recipes.js';
import { businessDaySummary, closeBusinessDay, openBusinessDay } from '../../lib/business-days.js';
import { createPurchase, deletePurchase, updatePurchase, voidPurchase } from '../../lib/purchases.js';
import { listHistoricalActivity } from '../../lib/historical-activity.js';
import { getNepaliDateString } from '../../lib/time-utils.js';

function shiftDate(value, days) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test('late entry and later edits keep a purchase on its invoice-date business day', async () => {
  const file = path.join(os.tmpdir(), `purchase-business-day-${process.pid}-${Date.now()}.db`);
  const db = new PosDatabase(file);
  try {
    const actor = { id: 1, full_name: 'Admin', role: 'admin' };
    const today = getNepaliDateString();
    const invoiceDate = shiftDate(today, -10);
    await ensureRecipeTables(db);
    const historicalDay = await openBusinessDay(db, { business_date: invoiceDate, opening_cash: 1000 }, actor);
    await closeBusinessDay(db, { counted_cash: 1000 }, actor);
    const currentDay = await openBusinessDay(db, { action: 'start_next', confirm_next_day: true, opening_cash: 1000 }, actor);
    await db.run(
      `UPDATE business_days SET closed_at=datetime(CURRENT_TIMESTAMP,'-1 minute') WHERE id=?`,
      [historicalDay.id]
    );
    await db.run(
      `UPDATE business_day_sessions SET closed_at=datetime(CURRENT_TIMESTAMP,'-1 minute') WHERE business_day_id=?`,
      [historicalDay.id]
    );
    const item = await db.run(
      `INSERT INTO inventory_items (item_name,name,quantity,unit,purchase_unit,consumption_unit,conversion_factor,cost_per_unit,is_archived)
       VALUES ('Historical flour','Historical flour',0,'kg','kg','kg',1,0,0)`
    );

    const purchase = await createPurchase(db, {
      supplier: 'Historical Supplier',
      invoice_number: 'OLD-10-DAYS',
      invoice_date: invoiceDate,
      payment_method: 'cash',
      received_by: actor.id,
      performed_by: actor.id,
      items: [{ inventory_item_id: item.lastInsertRowid, quantity: 1, unit_cost: 100 }],
    });
    const expense = await db.get('SELECT * FROM expenses WHERE id=?', [purchase.expense_id]);
    const originalJournal = await db.get(
      `SELECT * FROM journal_entries WHERE source_type='expense' AND source_id=?`,
      [purchase.expense_id]
    );
    const receipt = await db.get(
      `SELECT * FROM stock_movements WHERE change_type='purchase_receipt' AND reference_id=? ORDER BY id LIMIT 1`,
      [String(purchase.id)]
    );
    assert.equal(Number(expense.business_day_id), Number(historicalDay.id));
    assert.equal(Number(originalJournal.business_day_id), Number(historicalDay.id));
    assert.equal(Number(receipt.business_day_id), Number(historicalDay.id));
    assert.notEqual(Number(expense.business_day_id), Number(currentDay.id));

    const afterLateEntry = await businessDaySummary(db, historicalDay.id);
    assert.equal(afterLateEntry.cash.original_expected_cash, 1000);
    assert.equal(afterLateEntry.cash.adjusted_expected_cash, 900);
    assert.deepEqual(afterLateEntry.post_close_adjustments, { entries: 1, cash_delta: -100 });

    await updatePurchase(db, purchase.id, {
      supplier: 'Historical Supplier',
      invoice_number: 'OLD-10-DAYS',
      invoice_date: invoiceDate,
      payment_method: 'cash',
      received_by: actor.id,
      items: [{ inventory_item_id: item.lastInsertRowid, quantity: 1, unit_cost: 150 }],
    });
    const correctedExpense = await db.get('SELECT * FROM expenses WHERE id=?', [purchase.expense_id]);
    const retainedOriginal = await db.get('SELECT * FROM journal_entries WHERE id=?', [originalJournal.id]);
    const editCorrection = await db.get(
      `SELECT * FROM journal_entries WHERE source_type='expense_edit_correction' AND external_ref LIKE ? ORDER BY id DESC LIMIT 1`,
      [`expense-edit:${purchase.expense_id}:%`]
    );
    assert.equal(Number(correctedExpense.amount), 150);
    assert.equal(Number(correctedExpense.business_day_id), Number(historicalDay.id));
    assert.ok(retainedOriginal, 'the original closed-day journal remains for audit');
    assert.equal(Number(editCorrection.business_day_id), Number(historicalDay.id));
    assert.equal(String(editCorrection.entry_date).slice(0, 10), invoiceDate);

    const afterEdit = await businessDaySummary(db, historicalDay.id);
    assert.equal(afterEdit.cash.adjusted_expected_cash, 850);
    assert.deepEqual(afterEdit.post_close_adjustments, { entries: 2, cash_delta: -150 });

    const activity = await listHistoricalActivity(db);
    const record = activity.records.find((row) => row.record_type === 'purchase' && Number(row.record_id) === Number(purchase.id));
    const purchaseChanges = activity.changes.filter((row) => Number(row.purchase_id) === Number(purchase.id));
    assert.equal(record.effective_date, invoiceDate);
    assert.equal(Number(purchaseChanges.find((row) => row.action === 'created').performed_by), actor.id);
    assert.deepEqual(purchaseChanges.map((row) => row.action).sort(), ['amount corrected', 'created', 'edited']);
    assert.equal(Number(purchaseChanges.find((row) => row.action === 'edited').before_data.total), 100);
    assert.equal(Number(purchaseChanges.find((row) => row.action === 'edited').after_data.total), 150);

    // Earlier-day void needs the previous-day permission and a real reason.
    await assert.rejects(
      voidPurchase(db, purchase.id, { reason: 'Duplicate invoice', performedBy: actor.id }),
      { status: 403, code: 'purchase_void_previous_day' }
    );
    await assert.rejects(
      voidPurchase(db, purchase.id, { reason: '  ', performedBy: actor.id, allowPreviousDay: true }),
      { status: 400 }
    );
    await voidPurchase(db, purchase.id, { reason: 'Duplicate invoice', performedBy: actor.id, allowPreviousDay: true });
    // The void lands on the invoice day, so that day returns to its counted cash.
    const afterVoid = await businessDaySummary(db, historicalDay.id);
    assert.equal(afterVoid.cash.adjusted_expected_cash, 1000);

    // Today's purchase: any void permission is enough.
    const todays = await createPurchase(db, {
      supplier: 'Historical Supplier',
      invoice_date: today,
      payment_method: 'cash',
      received_by: actor.id,
      performed_by: actor.id,
      items: [{ inventory_item_id: item.lastInsertRowid, quantity: 1, unit_cost: 50 }],
    });
    const voidedToday = await voidPurchase(db, todays.id, { reason: 'Typo', performedBy: actor.id });
    assert.equal(voidedToday.status, 'voided');

    await deletePurchase(db, purchase.id, { performedBy: actor.id });
    assert.equal(await db.get('SELECT id FROM purchases WHERE id=?', [purchase.id]), undefined);
    const retainedHistory = await listHistoricalActivity(db);
    assert.deepEqual(
      retainedHistory.changes
        .filter((row) => Number(row.purchase_id) === Number(purchase.id))
        .map((row) => row.action)
        .sort(),
      // Edit-correction journals are removed with the linked expense on hard delete;
      // purchase_change_audit still retains created/edited/voided/deleted.
      ['created', 'deleted', 'edited', 'voided']
    );
  } finally {
    try { db.close(); } catch { /* already closed */ }
    for (const suffix of ['', '-shm', '-wal']) {
      try { fs.unlinkSync(`${file}${suffix}`); } catch { /* absent */ }
    }
  }
});
