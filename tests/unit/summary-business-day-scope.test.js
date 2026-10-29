import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PosDatabase } from '../../lib/db/index.js';
import { ensureAccountingSchema, postJournal } from '../../lib/accounting.js';
import { ensureBusinessDaySchema } from '../../lib/business-days.js';
import { buildSummaryReport } from '../../lib/summary-report.js';
import { ensureReportSchema } from '../../lib/reports.js';

const dbPath = path.join(os.tmpdir(), `summary-business-scope-${process.pid}-${Date.now()}.db`);
const db = new PosDatabase(dbPath);
const actor = { id: 1, full_name: 'Scope Test Admin', role: 'admin' };
const date = '2000-01-01';

test.after(() => {
  try { db.close(); } catch {}
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(`${dbPath}${suffix}`); } catch {}
  }
});

test('single-day summary uses business-day cash scope across the midnight boundary', async () => {
  await ensureReportSchema(db);
  await ensureAccountingSchema(db);
  await ensureBusinessDaySchema(db);
  const inserted = await db.run(
    `INSERT INTO business_days (business_date,status,opening_cash,expected_cash,counted_cash,cash_difference)
     VALUES (?,'closed',1000,1150,1150,0)`, [date]
  );
  const day = { id: inserted.lastInsertRowid };
  await db.run(
    `INSERT INTO business_day_sessions
      (business_day_id,session_number,status,opening_cash,expected_cash,counted_cash,cash_difference)
     VALUES (?,1,'closed',1000,1150,1150,0)`, [day.id]
  );
  const drawer = await db.get(`SELECT id FROM cash_drawers WHERE is_active=1 ORDER BY id LIMIT 1`);

  // The journal is created today but belongs to yesterday's restaurant day.
  // A calendar-only report would miss it and disagree with the drawer close.
  await postJournal(db, {
    memo: 'Late business-day cash movement', source_type: 'manual_adjustment',
    business_day_id: day.id, created_by: actor.id,
    lines: [
      { code: '1010', debit: 150, credit: 0, drawer_id: drawer.id },
      { code: '3010', debit: 0, credit: 150 },
    ],
  });
  const summary = await buildSummaryReport(db, { start: date, end: date });
  assert.equal(summary.accounts.cash.basis, 'business_day');
  assert.equal(summary.accounts.cash.opening, 1000);
  assert.equal(summary.accounts.cash.closing, 1150);
  assert.equal(summary.cash_flow.opening, 1000);
  assert.equal(summary.cash_flow.closing, 1150);
  assert.equal(summary.money_position.cash.closing, 1150);
  assert.equal(summary.closing.expected_cash, 1150);
  assert.equal(summary.closing.counted_cash, 1150);
});

test('single-day summary includes cash moved between same-day store sessions', async () => {
  const secondDate = '2000-01-02';
  const inserted = await db.run(
    `INSERT INTO business_days (business_date,status,opening_cash,expected_cash,counted_cash,cash_difference)
     VALUES (?,'closed',9590,7695,7695,0)`, [secondDate]
  );
  const dayId = inserted.lastInsertRowid;
  await db.run(
    `INSERT INTO business_day_sessions
      (business_day_id,session_number,status,opening_cash,expected_cash,counted_cash,cash_difference)
     VALUES (?,1,'closed',9590,11090,11090,0),
            (?,2,'closed',9590,7695,7695,0)`, [dayId, dayId]
  );
  const drawer = await db.get(`SELECT id FROM cash_drawers WHERE is_active=1 ORDER BY id LIMIT 1`);

  const postCash = (amount, sourceType, credit = false) => postJournal(db, {
    memo: sourceType, source_type: sourceType, business_day_id: dayId, created_by: actor.id,
    lines: credit
      ? [{ code: '3010', debit: amount, credit: 0 }, { code: '1010', debit: 0, credit: amount, drawer_id: drawer.id }]
      : [{ code: '1010', debit: amount, credit: 0, drawer_id: drawer.id }, { code: '4010', debit: 0, credit: amount }],
  });
  await postCash(9035, 'bill');
  await postCash(1100, 'credit_collection');
  // Mid-day reopen bridge — must still affect closing because day.opening_cash
  // stays at the morning float. Day-open (store_session_opened) bridges do not.
  await postJournal(db, {
    memo: 'opening_cash_movement',
    source_type: 'opening_cash_movement',
    external_ref: `opening-cash:${dayId}:store_session_reopened:11090:9590:cash_reserve`,
    business_day_id: dayId,
    created_by: actor.id,
    lines: [
      { code: '3010', debit: 1500, credit: 0 },
      { code: '1010', debit: 0, credit: 1500, drawer_id: drawer.id },
    ],
  });
  await postCash(5370, 'expense', true);
  await postCash(5000, 'savings_deposit', true);
  await postCash(160, 'exchange', true);

  const summary = await buildSummaryReport(db, { start: secondDate, end: secondDate });
  assert.equal(summary.accounts.cash.opening, 9590);
  assert.equal(summary.accounts.cash.movements.opening_cash_movement.net, -1500);
  assert.equal(summary.accounts.cash.closing, 7695);
  assert.equal(summary.cash_flow.closing, 7695);
  assert.equal(summary.money_position.cash.closing, 7695);
  assert.equal(summary.closing.expected_cash, 7695);
});

test('single-day summary does not double-count day-open bridge when opening is 0', async () => {
  const thirdDate = '2000-01-03';
  const inserted = await db.run(
    `INSERT INTO business_days (business_date,status,opening_cash,expected_cash,counted_cash,cash_difference)
     VALUES (?,'open',0,NULL,NULL,NULL)`, [thirdDate]
  );
  const dayId = inserted.lastInsertRowid;
  await db.run(
    `INSERT INTO business_day_sessions
      (business_day_id,session_number,status,opening_cash)
     VALUES (?,1,'open',0)`, [dayId]
  );
  const drawer = await db.get(`SELECT id FROM cash_drawers WHERE is_active=1 ORDER BY id LIMIT 1`);

  // Prior counted 6965 → declared opening 0. Already reflected in opening_cash=0.
  await postJournal(db, {
    memo: 'Opening cash movement - Owner Withdrawal',
    source_type: 'opening_cash_movement',
    external_ref: `opening-cash:${dayId}:store_session_opened:6965:0:owner_withdrawal`,
    business_day_id: dayId,
    created_by: actor.id,
    lines: [
      { code: '3010', debit: 6965, credit: 0 },
      { code: '1010', debit: 0, credit: 6965, drawer_id: drawer.id },
    ],
  });
  await postJournal(db, {
    memo: 'Cash sale', source_type: 'bill', business_day_id: dayId, created_by: actor.id,
    lines: [
      { code: '1010', debit: 2367.5, credit: 0, drawer_id: drawer.id },
      { code: '4010', debit: 0, credit: 2367.5 },
    ],
  });
  await postJournal(db, {
    memo: 'Cash expense', source_type: 'expense', business_day_id: dayId, created_by: actor.id,
    lines: [
      { code: '5020', debit: 870, credit: 0 },
      { code: '1010', debit: 0, credit: 870, drawer_id: drawer.id },
    ],
  });

  const summary = await buildSummaryReport(db, { start: thirdDate, end: thirdDate });
  assert.equal(summary.accounts.cash.opening, 0);
  assert.equal(summary.accounts.cash.movements.opening_cash_movement, undefined);
  assert.equal(summary.accounts.cash.closing, 1497.5);
  assert.equal(summary.cash_flow.closing, 1497.5);
  assert.equal(summary.money_position.cash.closing, 1497.5);
});
