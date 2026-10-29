import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PosDatabase } from '../../lib/db/index.js';
import { accountBalance, postExpenseJournal } from '../../lib/accounting.js';
import { openBusinessDay } from '../../lib/business-days.js';
import { correctClosedManualExpense, ensureExpenseVoidSchema } from '../../lib/expense-links.js';
import { getNepaliDateString } from '../../lib/time-utils.js';

test('a closed manual expense uses an append-only amount correction and immutable date', async () => {
  const file = path.join(os.tmpdir(), `closed-expense-correction-${process.pid}-${Date.now()}.db`);
  const db = new PosDatabase(file);
  try {
    const actor = { id: 1, full_name: 'Admin', role: 'admin' };
    const day = await openBusinessDay(db, { business_date: getNepaliDateString(), opening_cash: 500 }, actor);
    await ensureExpenseVoidSchema(db);
    const inserted = await db.run(`INSERT INTO expenses (description,category,amount,expense_date,purchase_date,payment_method,logged_by,business_day_id) VALUES ('Gas refill','utilities',100,?,?,'cash',?,?)`, [day.business_date, day.business_date, actor.id, day.id]);
    const expenseId = inserted.lastInsertRowid;
    await postExpenseJournal(db, { id: expenseId, amount: 100, category: 'utilities', description: 'Gas refill', payment_method: 'cash', expense_date: day.business_date, logged_by: actor.id, business_day_id: day.id });
    await db.run(`UPDATE business_day_sessions SET status='closed',closed_at=CURRENT_TIMESTAMP WHERE business_day_id=?`, [day.id]);
    await db.run(`UPDATE business_days SET status='closed',closed_at=CURRENT_TIMESTAMP WHERE id=?`, [day.id]);
    const corrected = await correctClosedManualExpense(db, { expenseId, changes: { description: 'Gas cylinder refill', category: 'utilities', amount: 80, purchase_date: day.business_date, payment_method: 'cash', notes: 'Correct receipt' }, reason: 'Receipt total was entered incorrectly', performedBy: actor.id, requestKey: 'closed-expense-test-1' });
    assert.equal(corrected.amount, 80);
    assert.equal(await accountBalance(db, '1010'), 420);
    assert.equal((await db.all(`SELECT id FROM journal_entries WHERE source_type='expense' AND source_id=?`, [expenseId])).length, 1);
    const correction = await db.get(`SELECT * FROM journal_entries WHERE source_type='expense_edit_correction' AND external_ref=?`, [`expense-edit:${expenseId}:closed-expense-test-1`]);
    assert.ok(correction);
    assert.equal(correction.business_day_id, day.id);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM expense_change_audit WHERE expense_id=?', [expenseId])).count, 1);
    await correctClosedManualExpense(db, { expenseId, changes: { ...corrected, amount: 80, purchase_date: day.business_date, payment_method: 'cash' }, reason: 'Duplicate request must be harmless', performedBy: actor.id, requestKey: 'closed-expense-test-1' });
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM expense_change_audit WHERE expense_id=?', [expenseId])).count, 1);
    await assert.rejects(correctClosedManualExpense(db, { expenseId, changes: { ...corrected, purchase_date: '2026-01-01', payment_method: 'cash' }, reason: 'Wrong date', performedBy: actor.id }), /cannot be moved/);
  } finally {
    try { db.close(); } catch { /* already closed */ }
    for (const suffix of ['', '-shm', '-wal']) { try { fs.unlinkSync(`${file}${suffix}`); } catch { /* absent */ } }
  }
});
