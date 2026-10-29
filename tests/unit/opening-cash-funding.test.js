import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PosDatabase } from '../../lib/db/index.js';
import {
  accountBalance,
  ensureAccountingSchema,
  postExpenseJournal,
  postJournal,
} from '../../lib/accounting.js';
import { ensureBusinessDaySchema } from '../../lib/business-days.js';
import {
  listOpeningCashMovements,
  prepareExpenseFunding,
  transferOpeningReserveToFunding,
} from '../../lib/business-funding.js';

const dbPath = path.join(os.tmpdir(), `opening-funding-test-${process.pid}-${Date.now()}.db`);
const db = new PosDatabase(dbPath);

test.after(() => {
  try { db.close(); } catch { /* already closed */ }
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* absent */ }
  }
});

test('bank shortfall for a prior-day expense uses current bank balance', async () => {
  await ensureAccountingSchema(db);

  await postJournal(db, {
    entry_date: '2026-02-10',
    memo: 'Later QR sale',
    source_type: 'bill',
    source_id: 1,
    lines: [
      { code: '1020', debit: 500, credit: 0 },
      { code: '4010', debit: 0, credit: 500 },
    ],
  });

  await assert.rejects(
    () => prepareExpenseFunding(db, {
      id: 201,
      amount: 800,
      description: 'Backdated purchase',
      expense_date: '2026-02-01',
      payment_method: 'online',
    }, '1020'),
    (error) => error.code === 'business_funding_required'
      && error.payment_balance === 500
      && error.shortfall === 300
  );

  await postJournal(db, {
    entry_date: '2026-02-10',
    memo: 'Funding',
    source_type: 'business_funding_investment',
    source_id: 9,
    lines: [
      { code: '1050', debit: 300, credit: 0 },
      { code: '3010', debit: 0, credit: 300 },
    ],
  });

  const result = await prepareExpenseFunding(db, {
    id: 202,
    amount: 800,
    description: 'Backdated purchase funded',
    expense_date: '2026-02-01',
    use_business_funding: true,
    logged_by: 1,
  }, '1020');
  assert.equal(result.amount, 300);
  assert.equal(result.balance, 500);
  // prepareExpenseFunding only computes the shortfall; posting happens on the expense journal.
  assert.equal(await accountBalance(db, '1050'), 300);
  assert.equal(await accountBalance(db, '1020'), 500);

  await postExpenseJournal(db, {
    id: 202,
    amount: 800,
    description: 'Backdated purchase funded',
    payment_method: 'online',
    expense_date: '2026-02-01',
    use_business_funding: true,
    logged_by: 1,
  });
  assert.equal(await accountBalance(db, '1050'), 0);
  assert.equal(await accountBalance(db, '1020'), 0);
});

test('opening cash reserve removals list and transfer into Business Funding once', async () => {
  await ensureBusinessDaySchema(db);
  const day = await db.run(
    `INSERT INTO business_days (business_date, status, opening_cash) VALUES ('2026-03-01','open',800)`
  );
  const openingJournal = await postJournal(db, {
    entry_date: '2026-03-01',
    memo: 'Opening cash movement - Cash Reserve / Safe',
    source_type: 'opening_cash_movement',
    external_ref: `opening-cash:${day.lastInsertRowid}:store_session_opened:1000:800:cash_reserve`,
    business_day_id: day.lastInsertRowid,
    lines: [
      { code: '1030', debit: 200, credit: 0, memo: 'Cash Reserve / Safe' },
      { code: '1010', debit: 0, credit: 200, memo: 'Removed from drawer' },
    ],
  });

  await postJournal(db, {
    entry_date: '2026-03-01',
    memo: 'Opening cash movement - Owner Withdrawal',
    source_type: 'opening_cash_movement',
    external_ref: `opening-cash:${day.lastInsertRowid}:store_session_opened:800:700:owner_withdrawal`,
    business_day_id: day.lastInsertRowid,
    lines: [
      { code: '3010', debit: 100, credit: 0, memo: 'Owner Withdrawal' },
      { code: '1010', debit: 0, credit: 100, memo: 'Removed from drawer' },
    ],
  });

  const listed = await listOpeningCashMovements(db, {});
  assert.equal(listed.movements.length, 2);
  assert.equal(listed.totals.removed, 300);
  assert.equal(listed.totals.transferable, 200);
  const reserveRow = listed.movements.find((row) => row.reason === 'cash_reserve');
  assert.equal(reserveRow.transferable, true);
  assert.equal(listed.movements.find((row) => row.reason === 'owner_withdrawal').transferable, false);

  const first = await transferOpeningReserveToFunding(db, { journalIds: [openingJournal], createdBy: 1 });
  assert.equal(first.total, 200);
  assert.equal(await accountBalance(db, '1030'), 0);
  assert.equal(await accountBalance(db, '1050'), 200);

  const again = await transferOpeningReserveToFunding(db, { journalIds: [openingJournal], createdBy: 1 });
  assert.equal(again.total, 0, 'already-transferred rows are skipped');
  assert.equal(await accountBalance(db, '1050'), 200);

  const after = await listOpeningCashMovements(db, { reason: 'cash_reserve' });
  assert.equal(after.movements[0].transferred, true);
  assert.equal(after.movements[0].transferable, false);
});

test('legacy opening-cash refs still resolve Cash Reserve and allow transfer', async () => {
  await ensureBusinessDaySchema(db);
  const day = await db.run(
    `INSERT INTO business_days (business_date, status, opening_cash) VALUES ('2026-03-05','closed',0)`
  );
  const journalId = await postJournal(db, {
    entry_date: '2026-03-05',
    memo: 'Opening cash movement - Cash Reserve / Safe (sqlite-week-demo)',
    source_type: 'opening_cash_movement',
    external_ref: `sqlite-week-demo:opening:2026-03-05:5000:0`,
    business_day_id: day.lastInsertRowid,
    lines: [
      { code: '1030', debit: 5000, credit: 0, memo: 'Cash Reserve / Safe' },
      { code: '1010', debit: 0, credit: 5000, memo: 'Removed from drawer' },
    ],
  });
  const listed = await listOpeningCashMovements(db, {});
  const row = listed.movements.find((m) => m.id === journalId);
  assert.equal(row.reason, 'cash_reserve');
  assert.equal(row.destination_name, 'Cash Reserve / Safe');
  assert.equal(row.transferable, true);
});

test('online prior-day expense posts against current bank without inventing historical bank', async () => {
  const bankBefore = await accountBalance(db, '1020');
  await postJournal(db, {
    entry_date: '2026-04-10',
    memo: 'Bank sale',
    source_type: 'bill',
    source_id: 44,
    lines: [
      { code: '1020', debit: 1000, credit: 0 },
      { code: '4010', debit: 0, credit: 1000 },
    ],
  });
  await postExpenseJournal(db, {
    id: 310,
    amount: 400,
    description: 'Old invoice paid online',
    payment_method: 'online',
    expense_date: '2026-04-01',
    logged_by: 1,
  });
  assert.equal(await accountBalance(db, '1020'), bankBefore + 600);
});

test('open-day cash expense ignores day-open bridge when checking available cash', async () => {
  await ensureBusinessDaySchema(db);
  // Reuse the single allowed open day (unique index idx_business_days_one_open).
  let day = await db.get(`SELECT id, opening_cash FROM business_days WHERE status='open' ORDER BY id DESC LIMIT 1`);
  if (!day) {
    const inserted = await db.run(
      `INSERT INTO business_days (business_date, status, opening_cash) VALUES ('2026-05-01','open',0)`
    );
    day = { id: inserted.lastInsertRowid, opening_cash: 0 };
  } else {
    await db.run(`UPDATE business_days SET opening_cash=0 WHERE id=?`, [day.id]);
    day = { ...day, opening_cash: 0 };
  }
  const dayId = day.id;
  const drawer = await db.get(`SELECT id FROM cash_drawers WHERE is_active=1 ORDER BY id LIMIT 1`);

  // Bridge prior counted 6965 → opening 0 (owner withdrawal). Must not make cash "short".
  await postJournal(db, {
    entry_date: '2026-05-01',
    memo: 'Opening cash movement - Owner Withdrawal',
    source_type: 'opening_cash_movement',
    external_ref: `opening-cash:${dayId}:store_session_opened:6965:0:owner_withdrawal`,
    business_day_id: dayId,
    lines: [
      { code: '3010', debit: 6965, credit: 0 },
      { code: '1010', debit: 0, credit: 6965, drawer_id: drawer?.id },
    ],
  });
  await postJournal(db, {
    entry_date: '2026-05-01',
    memo: 'Cash sale',
    source_type: 'bill',
    business_day_id: dayId,
    lines: [
      { code: '1010', debit: 500, credit: 0, drawer_id: drawer?.id },
      { code: '4010', debit: 0, credit: 500 },
    ],
  });

  const result = await prepareExpenseFunding(db, {
    id: 501,
    amount: 200,
    description: 'Veggies',
    expense_date: '2026-05-01',
    business_day_id: dayId,
    payment_method: 'cash',
  }, '1010');
  assert.equal(result.amount, 0);
  assert.equal(result.balance, 500);
});
