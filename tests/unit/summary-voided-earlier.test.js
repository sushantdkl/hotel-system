import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PosDatabase } from '../../lib/db/index.js';
import { ensureAccountingSchema, postJournal } from '../../lib/accounting.js';
import { reverseJournal } from '../../lib/accounting-corrections.js';
import { ensureBusinessDaySchema } from '../../lib/business-days.js';
import { ensureExpenseVoidSchema, voidExpense } from '../../lib/expense-links.js';
import { ensureLedgerSchema } from '../../lib/inventory-ledger.js';
import { buildSummaryReport } from '../../lib/summary-report.js';
import { summaryAccountRows } from '../../lib/summary-account.js';

const dbPath = path.join(os.tmpdir(), `summary-voided-earlier-${process.pid}-${Date.now()}.db`);
const db = new PosDatabase(dbPath);

test.after(() => {
  try { db.close(); } catch { /* already closed */ }
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* absent */ }
  }
});

const cashPurchase = (id, date, dayId, amount) => postJournal(db, {
  entry_date: date, memo: `Purchase ${id}`, source_type: 'expense', source_id: id, business_day_id: dayId,
  lines: [
    { code: '5010', debit: amount, credit: 0 },
    { code: '1010', debit: 0, credit: amount, drawer_id: 1 },
  ],
});

test('voiding an earlier-day purchase does not net today\'s cash purchase into a plus', async () => {
  await ensureAccountingSchema(db);
  await ensureBusinessDaySchema(db);
  await ensureExpenseVoidSchema(db);
  await ensureLedgerSchema(db);

  const yesterday = '2026-04-10';
  const today = '2026-04-11';
  const yDay = (await db.run(`INSERT INTO business_days (business_date,status,opening_cash) VALUES (?,'closed',0)`, [yesterday])).lastInsertRowid;
  const tDay = (await db.run(`INSERT INTO business_days (business_date,status,opening_cash) VALUES (?,'open',2500)`, [today])).lastInsertRowid;

  const old = await cashPurchase(9001, yesterday, yDay, 600);
  await reverseJournal(db, { journal_id: old, reason: 'void yesterday purchase', business_day_id: tDay });
  await cashPurchase(9002, today, tDay, 500);
  // Same-day mistake and void still cancel each other out.
  const sameDay = await cashPurchase(9003, today, tDay, 300);
  await reverseJournal(db, { journal_id: sameDay, reason: 'same-day void', business_day_id: tDay });

  const summary = await buildSummaryReport(db, { start: today, end: today });
  const cash = summary.accounts.cash;
  assert.equal(cash.movements.expense.net, -500);
  assert.equal(cash.movements.voided_expense.net, 600);
  assert.equal(cash.closing, 2600);

  const rows = summaryAccountRows(cash, { cash: true });
  const row = (label) => rows.find((r) => r.label === label);
  assert.equal(row('Purchases, Expenses & Suppliers').sign, '-');
  assert.equal(row('Purchases, Expenses & Suppliers').value, 500);
  assert.equal(row('Earlier Entries Voided').signedValue, 600);

  const outflow = summary.cash_flow.outflow.find((r) => r.source === 'expense');
  assert.equal(outflow.amount, 500);
  assert.equal(summary.cash_flow.inflow.find((r) => r.source === 'voided_expense').amount, 600);
});

test('voiding an earlier-day expense reverses it on that day, not in today\'s drawer', async () => {
  const oldDate = '2026-04-20';
  const today = '2026-04-21';
  const oldDay = (await db.run(`INSERT INTO business_days (business_date,status,opening_cash) VALUES (?,'closed',1000)`, [oldDate])).lastInsertRowid;
  const tDay = (await db.run(`INSERT INTO business_days (business_date,status,opening_cash) VALUES (?,'closed',2000)`, [today])).lastInsertRowid;
  const exp = (await db.run(
    `INSERT INTO expenses (description,category,amount,expense_date,purchase_date,payment_method,business_day_id,status)
     VALUES ('random mart','Purchase',600,?,?,'cash',?,'active')`,
    [oldDate, oldDate, oldDay]
  )).lastInsertRowid;
  await cashPurchase(exp, oldDate, oldDay, 600);

  const { reversal_journal_id } = await voidExpense(db, exp, { reason: 'entered twice', businessDayId: tDay });
  const reversal = await db.get(`SELECT entry_date, business_day_id FROM journal_entries WHERE id=?`, [reversal_journal_id]);
  assert.equal(String(reversal.entry_date).slice(0, 10), oldDate);
  assert.equal(Number(reversal.business_day_id), Number(oldDay));

  const todaySummary = await buildSummaryReport(db, { start: today, end: today });
  assert.equal(todaySummary.accounts.cash.closing, 2000);
  const oldSummary = await buildSummaryReport(db, { start: oldDate, end: oldDate });
  assert.equal(oldSummary.accounts.cash.closing, 1000);
});
