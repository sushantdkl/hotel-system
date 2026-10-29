import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PosDatabase } from '../../lib/db/index.js';
import { accountBalance, accountBalanceAsOf, ensureAccountingSchema, postExpenseJournal, postJournal } from '../../lib/accounting.js';
import { addBusinessInvestment, businessFundingProfile, updateBusinessInvestment, repairFundedExpenseCashSplit } from '../../lib/business-funding.js';
import { ensureBusinessDaySchema } from '../../lib/business-days.js';
import { buildSummaryReport } from '../../lib/summary-report.js';
import { nepalDateString } from '../../lib/report-dates.js';

const dbPath = path.join(os.tmpdir(), `business-funding-test-${process.pid}-${Date.now()}.db`);
const db = new PosDatabase(dbPath);

test.after(() => {
  try { db.close(); } catch { /* already closed */ }
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* already gone */ }
  }
});

test('funding requires consent, uses current pool for prior dates, and replaces transfers on edit', async () => {
  await ensureAccountingSchema(db);
  await addBusinessInvestment(db, { amount: 1000, date: '2026-01-10', note: 'Opening capital', createdBy: 1 });

  await assert.rejects(
    () => db.transaction((tx) => postExpenseJournal(tx, {
      id: 91, amount: 600, description: 'Stock', payment_method: 'cash', expense_date: '2026-01-11', logged_by: 1,
    })),
    (error) => error.code === 'business_funding_required' && error.shortfall === 600 && error.available === 1000
  );

  // Prior-day purchase may use the current funding pool; shortfall credits 1050
  // on the expense date (no today cash top-up).
  await db.transaction((tx) => postExpenseJournal(tx, {
    id: 92, amount: 100, description: 'Earlier expense', payment_method: 'cash', expense_date: '2026-01-09', logged_by: 1, use_business_funding: true,
  }));
  const priorLines = await db.all(
    `SELECT a.code, jl.debit, jl.credit
     FROM journal_lines jl
     JOIN journal_entries je ON je.id=jl.journal_id
     JOIN accounts a ON a.id=jl.account_id
     WHERE je.source_type='expense' AND je.source_id=92
     ORDER BY a.code`
  );
  assert.equal(String((await db.get(`SELECT entry_date FROM journal_entries WHERE source_type='expense' AND source_id=92`)).entry_date).slice(0, 10), '2026-01-09');
  assert.ok(priorLines.some((l) => l.code === '1050' && Number(l.credit) === 100));
  assert.ok(!priorLines.some((l) => l.code === '1010' && Number(l.credit) > 0), 'fully funded prior expense must not credit cash');
  assert.equal(await accountBalance(db, '1050'), 900);
  assert.equal(
    (await db.get(`SELECT COUNT(*) AS c FROM journal_entries WHERE source_type='business_funding_use' AND source_id=92`)).c,
    0,
    'no separate cash top-up journal'
  );

  await db.transaction((tx) => postExpenseJournal(tx, {
    id: 91, amount: 600, description: 'Stock', payment_method: 'cash', expense_date: '2026-01-11', logged_by: 1, use_business_funding: true,
  }));
  assert.equal(await accountBalance(db, '1050'), 300);
  assert.equal(await accountBalance(db, '1010'), 0);

  await db.transaction((tx) => postExpenseJournal(tx, {
    id: 91, amount: 800, description: 'Stock corrected', payment_method: 'cash', expense_date: '2026-01-11', logged_by: 1, use_business_funding: true,
  }));
  assert.equal(await accountBalance(db, '1050'), 100);
  assert.equal(await accountBalance(db, '1010'), 0);

  const profile = await businessFundingProfile(db);
  assert.equal(profile.totalInvested, 1000);
  assert.equal(profile.totalUsed, 900);
  assert.equal(profile.availableBalance, 100);
  assert.ok(profile.history.some((row) => row.source_type === 'expense' && Number(row.source_id) === 92 && Number(row.amount) === -100));

  assert.equal(await accountBalance(db, '3010'), -1000, 'owner investment is a capital credit, not revenue');
  assert.equal(await accountBalance(db, '5020'), 900, 'prior-day + corrected expense recognized exactly once each');
  assert.equal(await accountBalance(db, '4010'), 0, 'business funding never creates sales revenue');
  assert.equal((await db.get(`SELECT COUNT(*) AS count FROM business_funding_transactions`)).count, 1);
  assert.equal((await db.get(`SELECT COUNT(*) AS count FROM journal_entries WHERE source_type='expense' AND source_id=91`)).count, 1);
});

test('explicit Business Funding and Owner Pocket payments never create cash or bank movement', async () => {
  const fundingBefore = await accountBalance(db, '1050');
  const cashBefore = await accountBalance(db, '1010');
  const bankBefore = await accountBalance(db, '1020');
  const equityBefore = await accountBalance(db, '3010');
  const expenseBefore = await accountBalance(db, '5020');

  await postExpenseJournal(db, {
    id: 93, amount: 50, description: 'Paid from funding', payment_method: 'business_funding', expense_date: '2026-01-11', logged_by: 1,
  });
  await postExpenseJournal(db, {
    id: 94, amount: 75, description: 'Paid personally', payment_method: 'owner_pocket', expense_date: '2026-01-11', logged_by: 1,
  });

  assert.equal(await accountBalance(db, '1050'), fundingBefore - 50);
  assert.equal(await accountBalance(db, '1010'), cashBefore);
  assert.equal(await accountBalance(db, '1020'), bankBefore);
  assert.equal(await accountBalance(db, '3010'), equityBefore - 75);
  assert.equal(await accountBalance(db, '5020'), expenseBefore + 125);
  const profile = await businessFundingProfile(db);
  assert.ok(profile.history.some((row) => row.source_type === 'expense' && Number(row.source_id) === 93 && Number(row.amount) === -50));
  assert.ok(!profile.history.some((row) => row.source_type === 'expense' && Number(row.source_id) === 94), 'Owner Pocket must not appear as Business Funding use');

  await assert.rejects(
    () => postExpenseJournal(db, {
      id: 95, amount: 9999, description: 'Too much', payment_method: 'business_funding', expense_date: '2026-01-11', logged_by: 1,
    }),
    (error) => error.code === 'business_funding_insufficient'
  );
});

test('an investment date can be corrected without duplicating funds or breaking history', async () => {
  const investment = await db.get(`SELECT * FROM business_funding_transactions ORDER BY id LIMIT 1`);
  await updateBusinessInvestment(db, { id: investment.id, date: '2026-01-08', note: 'Entered late' });

  // As of the investment date (before the 2026-01-09 funded expense) the pool is full.
  assert.equal(await accountBalanceAsOf(db, '1050', '2026-01-08'), 1000);
  assert.equal((await db.get(`SELECT transaction_date FROM business_funding_transactions WHERE id=?`, [investment.id])).transaction_date, '2026-01-08');
  assert.equal((await db.get(`SELECT COUNT(*) AS count FROM business_funding_transactions`)).count, 1);
  assert.equal((await db.get(`SELECT COUNT(*) AS count FROM journal_entries WHERE source_type='business_funding_investment' AND source_id=?`, [investment.id])).count, 1);

  // Funding shortfall is dated on the expense date; moving the investment after
  // those uses would leave the pool negative on the use date.
  const tooLate = '2026-01-12';
  await assert.rejects(
    () => updateBusinessInvestment(db, { id: investment.id, date: tooLate, note: 'Too late' }),
    (error) => error.code === 'business_funding_history_conflict'
  );
  assert.equal((await db.get(`SELECT transaction_date FROM business_funding_transactions WHERE id=?`, [investment.id])).transaction_date, '2026-01-08');
});

test('past-day Summary cash only drops by the unfunded portion after Business Funding', async () => {
  await ensureBusinessDaySchema(db);
  const { ensureExpenseVoidSchema } = await import('../../lib/expense-links.js');
  await ensureExpenseVoidSchema(db);
  const dayDate = '2026-02-01';
  const day = await db.run(
    `INSERT INTO business_days (business_date,status,opening_cash) VALUES (?,'closed',0)`,
    [dayDate]
  );
  await postJournal(db, {
    entry_date: dayDate,
    memo: 'Cash sale',
    source_type: 'bill',
    business_day_id: day.lastInsertRowid,
    lines: [
      { code: '1010', debit: 500, credit: 0, drawer_id: 1 },
      { code: '4010', debit: 0, credit: 500 },
    ],
  });
  await addBusinessInvestment(db, { amount: 2000, date: '2026-01-15', note: 'Extra capital', createdBy: 1 });

  await db.run(
    `INSERT INTO expenses
       (id, description, category, amount, expense_date, purchase_date, payment_method, business_day_id, status, source_type)
     VALUES (501, 'Big stock buy', 'Purchases', 1800, ?, ?, 'cash', ?, 'active', 'purchase')`,
    [dayDate, dayDate, day.lastInsertRowid]
  );
  await postExpenseJournal(db, {
    id: 501,
    amount: 1800,
    description: 'Big stock buy',
    category: 'Purchases',
    payment_method: 'cash',
    expense_date: dayDate,
    business_day_id: day.lastInsertRowid,
    source_type: 'purchase',
    use_business_funding: true,
  });

  const lines = await db.all(
    `SELECT a.code, jl.credit FROM journal_lines jl
     JOIN journal_entries je ON je.id=jl.journal_id
     JOIN accounts a ON a.id=jl.account_id
     WHERE je.source_type='expense' AND je.source_id=501 AND jl.credit>0`
  );
  const cashCredit = Number(lines.find((l) => l.code === '1010')?.credit || 0);
  const fundingCredit = Number(lines.find((l) => l.code === '1050')?.credit || 0);
  assert.equal(cashCredit, 500);
  assert.equal(fundingCredit, 1300);

  const summary = await buildSummaryReport(db, { start: dayDate, end: dayDate });
  assert.equal(summary.purchases.cash, 500);
  assert.equal(summary.purchases.funding, 1300);
  assert.equal(summary.accounts.cash.movements.expense?.credit, 500);
  assert.equal(summary.accounts.cash.closing, 0);
});

test('repairFundedExpenseCashSplit converts legacy today cash top-ups', async () => {
  await ensureAccountingSchema(db);
  const { ensureExpenseVoidSchema } = await import('../../lib/expense-links.js');
  await ensureExpenseVoidSchema(db);
  // Seed funding so the re-post can cover the shortfall.
  await addBusinessInvestment(db, { amount: 500, date: '2026-02-01', note: 'Repair capital', createdBy: 1 });
  const dayDate = '2026-02-10';
  const day = await db.run(
    `INSERT INTO business_days (business_date,status,opening_cash) VALUES (?,'closed',0)`,
    [dayDate]
  );
  await postJournal(db, {
    entry_date: dayDate,
    source_type: 'bill',
    business_day_id: day.lastInsertRowid,
    lines: [
      { code: '1010', debit: 200, credit: 0, drawer_id: 1 },
      { code: '4010', debit: 0, credit: 200 },
    ],
  });
  await db.run(
    `INSERT INTO expenses
       (id, description, category, amount, expense_date, purchase_date, payment_method, business_day_id, status)
     VALUES (777, 'Legacy funded', 'Operating', 500, ?, ?, 'cash', ?, 'active')`,
    [dayDate, dayDate, day.lastInsertRowid]
  );
  // Legacy shape: full cash credit + today funding top-up.
  await postJournal(db, {
    entry_date: dayDate,
    source_type: 'expense',
    source_id: 777,
    business_day_id: day.lastInsertRowid,
    lines: [
      { code: '5020', debit: 500, credit: 0 },
      { code: '1010', debit: 0, credit: 500, drawer_id: 1 },
    ],
  });
  await postJournal(db, {
    entry_date: nepalDateString(),
    source_type: 'business_funding_use',
    source_id: 777,
    lines: [
      { code: '1010', debit: 300, credit: 0, drawer_id: 1 },
      { code: '1050', debit: 0, credit: 300 },
    ],
  });

  const fixed = await repairFundedExpenseCashSplit(db);
  assert.ok(fixed >= 1);
  assert.equal(
    (await db.get(`SELECT COUNT(*) AS c FROM journal_entries WHERE source_type='business_funding_use' AND source_id=777`)).c,
    0
  );
  const credits = await db.all(
    `SELECT a.code, jl.credit FROM journal_lines jl
     JOIN journal_entries je ON je.id=jl.journal_id
     JOIN accounts a ON a.id=jl.account_id
     WHERE je.source_type='expense' AND je.source_id=777 AND jl.credit>0`
  );
  assert.equal(Number(credits.find((c) => c.code === '1010')?.credit || 0), 200);
  assert.equal(Number(credits.find((c) => c.code === '1050')?.credit || 0), 300);
});
