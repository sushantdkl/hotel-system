import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PosDatabase } from '../../lib/db/index.js';
import { ensureAccountingSchema, postJournal } from '../../lib/accounting.js';
import { ensureBusinessDaySchema, businessDayIdForCalendarDate } from '../../lib/business-days.js';
import { repairExpenseBusinessDayAlignment, ensureExpenseVoidSchema } from '../../lib/expense-links.js';
import { ensureLedgerSchema } from '../../lib/inventory-ledger.js';
import { buildSummaryReport } from '../../lib/summary-report.js';

const dbPath = path.join(os.tmpdir(), `expense-day-align-${process.pid}-${Date.now()}.db`);
const db = new PosDatabase(dbPath);

test.after(() => {
  try { db.close(); } catch { /* already closed */ }
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* absent */ }
  }
});

test('backdated cash expense is reattached to its expense-date business day', async () => {
  await ensureAccountingSchema(db);
  await ensureBusinessDaySchema(db);
  await ensureExpenseVoidSchema(db);
  await ensureLedgerSchema(db);

  const yesterday = '2026-03-10';
  const today = '2026-03-11';
  const yDay = await db.run(
    `INSERT INTO business_days (business_date,status,opening_cash) VALUES (?,'closed',0)`,
    [yesterday]
  );
  const tDay = await db.run(
    `INSERT INTO business_days (business_date,status,opening_cash) VALUES (?,'open',0)`,
    [today]
  );
  await db.run(
    `INSERT INTO business_day_sessions (business_day_id,session_number,status,opening_cash)
     VALUES (?,1,'open',0)`,
    [tDay.lastInsertRowid]
  );
  await db.run(
    `INSERT INTO drawer_sessions (drawer_id,status,opening_amount,business_day_id,opened_at)
     VALUES (1,'open',0,?,?)`,
    [tDay.lastInsertRowid, `${today} 08:00:00`]
  );

  await postJournal(db, {
    entry_date: yesterday,
    memo: 'Cash sale',
    source_type: 'bill',
    business_day_id: yDay.lastInsertRowid,
    lines: [
      { code: '1010', debit: 2000, credit: 0, drawer_id: 1 },
      { code: '4010', debit: 0, credit: 2000 },
    ],
  });

  // Bug reproduction: expense dated yesterday but tagged to today's open day.
  const exp = await db.run(
    `INSERT INTO expenses
       (description,category,amount,expense_date,purchase_date,payment_method,business_day_id,status)
     VALUES ('fdbdrfbdfb','Infrastructure & Assets',1000,?,?, 'cash',?,'active')`,
    [yesterday, yesterday, tDay.lastInsertRowid]
  );
  // Insert the invalid legacy journal shape directly. Current
  // postExpenseJournal() correctly rejects this before it can be created.
  await postJournal(db, {
    entry_date: yesterday,
    memo: 'Legacy mistagged expense',
    source_type: 'expense',
    source_id: exp.lastInsertRowid,
    business_day_id: tDay.lastInsertRowid,
    lines: [
      { code: '5020', debit: 1000, credit: 0, memo: 'Infrastructure & Assets' },
      { code: '1010', debit: 0, credit: 1000, drawer_id: 1 },
    ],
  });

  const misTagged = await db.get(
    `SELECT business_day_id FROM journal_entries WHERE source_type='expense' AND source_id=?`,
    [exp.lastInsertRowid]
  );
  assert.equal(Number(misTagged.business_day_id), Number(tDay.lastInsertRowid));

  const fixed = await repairExpenseBusinessDayAlignment(db);
  assert.ok(fixed >= 1);

  const row = await db.get(`SELECT business_day_id FROM expenses WHERE id=?`, [exp.lastInsertRowid]);
  assert.equal(Number(row.business_day_id), Number(yDay.lastInsertRowid));
  const journal = await db.get(
    `SELECT business_day_id FROM journal_entries WHERE source_type='expense' AND source_id=?`,
    [exp.lastInsertRowid]
  );
  assert.equal(Number(journal.business_day_id), Number(yDay.lastInsertRowid));

  const summary = await buildSummaryReport(db, { start: yesterday, end: yesterday });
  assert.equal(summary.expenses.cash, 1000);
  assert.equal(summary.accounts.cash.movements.expense?.credit, 1000);
});

test('businessDayIdForCalendarDate reuses an existing closed day', async () => {
  const id = await businessDayIdForCalendarDate(db, '2026-03-10');
  const again = await businessDayIdForCalendarDate(db, '2026-03-10');
  assert.equal(id, again);
});
