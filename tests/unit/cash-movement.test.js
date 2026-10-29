/**
 * Cash In / Cash Out drawer movements — journaled, never sales revenue.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PosDatabase } from '../../lib/db/index.js';
import { ensureAccountingSchema, accountBalance, paymentAccountCode, postJournal } from '../../lib/accounting.js';
import { recordBankMovement, recordCashExchange, recordCashMovement, listBankMovements, listCashExchanges, listCashMovements } from '../../lib/accounting-cash.js';
import { reverseJournal } from '../../lib/accounting-corrections.js';
import { cashFlow, digitalReceipts } from '../../lib/summary-report.js';
import { openBusinessDay, businessDaySummary } from '../../lib/business-days.js';
import { getNepaliDateString } from '../../lib/time-utils.js';

const dbPath = path.join(os.tmpdir(), `cash-movement-test-${process.pid}-${Date.now()}.db`);
const db = new PosDatabase(dbPath);

test.after(() => {
  try { db.close(); } catch { /* already closed */ }
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* already gone */ }
  }
});

const admin = { id: 1, full_name: 'Admin One', role: 'admin' };

test('every legacy digital method posts to the one Online bank account', async () => {
  await ensureAccountingSchema(db);
  for (const method of ['online', 'bank', 'bank_transfer', 'cheque', 'card', 'qr', 'fonepay', 'esewa', 'khalti']) {
    assert.equal(paymentAccountCode(method), '1020');
  }
  const activeBanks = await db.all(`SELECT id FROM bank_accounts WHERE is_active = 1`);
  assert.equal(activeBanks.length, 1);
});

test('owner contribution cash-in increases drawer expected cash without sales revenue', async () => {
  await ensureAccountingSchema(db);
  const day = await openBusinessDay(db, { business_date: getNepaliDateString(), opening_cash: 1000 }, admin);
  const drawer = await db.get(`SELECT id FROM cash_drawers ORDER BY id LIMIT 1`);

  const before = await accountBalance(db, '1010', { drawerId: drawer.id });
  const result = await recordCashMovement(db, {
    direction: 'in',
    movement_type: 'owner_contribution',
    amount: 500,
    reason: 'Owner put float in till',
    created_by: admin.id,
    drawer_id: drawer.id,
    business_day_id: day.id,
    external_ref: `test-in-${Date.now()}`,
  });
  assert.equal(result.direction, 'in');
  assert.equal(result.amount, 500);

  const after = await accountBalance(db, '1010', { drawerId: drawer.id });
  assert.equal(after, before + 500);

  const sales = await db.get(
    `SELECT COALESCE(SUM(jl.credit),0) AS rev
     FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_id JOIN accounts a ON a.id=jl.account_id
     WHERE a.code='4010' AND je.source_type='cash_movement'`
  );
  assert.equal(Number(sales.rev), 0);

  const summary = await businessDaySummary(db, day.id);
  assert.ok(Number(summary.cash.breakdown.cash_in) >= 500);
  assert.equal(Number(summary.cash.expected_cash), Number(summary.cash.breakdown.opening_cash) + Number(summary.cash.ledger_movement));

  const history = await listCashMovements(db, { drawerId: drawer.id });
  assert.ok(history.some((row) => Number(row.cash_delta) === 500));
});

test('cash-out to safe decreases drawer cash and posts to safe asset', async () => {
  await ensureAccountingSchema(db);
  const drawer = await db.get(`SELECT id FROM cash_drawers ORDER BY id LIMIT 1`);
  const day = await db.get(`SELECT id FROM business_days WHERE status='open' ORDER BY id DESC LIMIT 1`);

  // Seed safe with a prior journal so transfer_from_safe isn't required here.
  await postJournal(db, {
    memo: 'Seed safe',
    source_type: 'manual',
    created_by: admin.id,
    business_day_id: day.id,
    lines: [
      { code: '1030', debit: 200, credit: 0 },
      { code: '3010', debit: 0, credit: 200 },
    ],
  });

  const beforeCash = await accountBalance(db, '1010', { drawerId: drawer.id });
  const beforeSafe = await accountBalance(db, '1030');

  await recordCashMovement(db, {
    direction: 'out',
    movement_type: 'transfer_to_safe',
    amount: 200,
    reason: 'Moved evening float to safe',
    created_by: admin.id,
    drawer_id: drawer.id,
    business_day_id: day.id,
    external_ref: `test-out-${Date.now()}`,
  });

  assert.equal(await accountBalance(db, '1010', { drawerId: drawer.id }), beforeCash - 200);
  assert.equal(await accountBalance(db, '1030'), beforeSafe + 200);
});

test('online money in/out uses settled bank and reverses cleanly', async () => {
  await ensureAccountingSchema(db);
  await db.run(`INSERT INTO bank_accounts (name,account_id) SELECT 'Test Bank',id FROM accounts WHERE code='1020'`);
  const bank = await db.get(`SELECT id FROM bank_accounts WHERE name='Test Bank' ORDER BY id DESC LIMIT 1`);
  const day = await db.get(`SELECT id FROM business_days WHERE status='open' ORDER BY id DESC LIMIT 1`);

  const incoming = await recordBankMovement(db, {
    kind: 'online_in', movement_type: 'owner_contribution', amount: 400,
    bank_account_id: bank.id, note: 'Owner sent working capital', created_by: admin.id,
    business_day_id: day.id, external_ref: `bank-in-${Date.now()}`,
  });
  assert.equal(await accountBalance(db, '1020', { bankAccountId: bank.id }), 400);
  assert.equal(await accountBalance(db, '4010'), 0, 'online funding is not sales revenue');

  const outgoing = await recordBankMovement(db, {
    kind: 'online_out', movement_type: 'owner_withdrawal', amount: 150,
    bank_account_id: bank.id, note: 'Owner withdrew personal funds', created_by: admin.id,
    business_day_id: day.id, external_ref: `bank-out-${Date.now()}`,
  });
  assert.equal(await accountBalance(db, '1020', { bankAccountId: bank.id }), 250);

  await reverseJournal(db, { journal_id: outgoing.journalId, reason: 'Entered twice', created_by: admin.id });
  assert.equal(await accountBalance(db, '1020', { bankAccountId: bank.id }), 400);
  const reversal = await db.get(`SELECT business_day_id FROM journal_entries WHERE source_type='reversal' AND source_id=?`, [outgoing.journalId]);
  assert.equal(Number(reversal.business_day_id), Number(day.id));
  const history = await listBankMovements(db);
  assert.ok(history.some((row) => Number(row.journal_id) === Number(outgoing.journalId) && Number(row.bank_delta) === -150));
  assert.ok(history.some((row) => Number(row.reversed_journal_id) === Number(outgoing.journalId) && Number(row.bank_delta) === 150));
  assert.ok(incoming.journalId);
});

test('cash movement reversal remains in history and nets the original side', async () => {
  const drawer = await db.get(`SELECT id FROM cash_drawers ORDER BY id LIMIT 1`);
  const day = await db.get(`SELECT id,business_date FROM business_days WHERE status='open' ORDER BY id DESC LIMIT 1`);
  const movement = await recordCashMovement(db, {
    direction: 'in', movement_type: 'owner_contribution', amount: 75,
    reason: 'Temporary change float', created_by: admin.id, drawer_id: drawer.id,
    business_day_id: day.id, external_ref: `reverse-cash-${Date.now()}`,
  });
  const reversalId = await reverseJournal(db, {
    journal_id: movement.journalId, reason: 'Entered by mistake', created_by: admin.id, business_day_id: day.id,
  });

  const history = await listCashMovements(db, { drawerId: drawer.id });
  assert.equal(Number(history.find((row) => row.id === movement.journalId)?.reversal_id), reversalId);
  assert.equal(Number(history.find((row) => row.id === reversalId)?.reversed_journal_id), movement.journalId);
  assert.equal(Number(history.find((row) => row.id === reversalId)?.cash_delta), -75);

  const flow = await cashFlow(db, day.business_date, day.business_date);
  const recorded = flow.inflow.find((row) => row.source === 'cash_movement');
  assert.equal(recorded?.amount || 0, 500);
  const summary = await businessDaySummary(db, day.id);
  assert.equal(Number(summary.cash.breakdown.cash_in), 500);
});

test('accounting histories paginate and filter before returning rows', async () => {
  const bankPage = await listBankMovements(db, { paged: true, pageSize: 1 });
  assert.equal(bankPage.rows.length, 1);
  assert.ok(bankPage.pagination.total >= 3);
  assert.ok(bankPage.pagination.total_pages >= 3);

  const bankSearch = await listBankMovements(db, { paged: true, search: 'Owner sent working capital' });
  assert.ok(bankSearch.rows.every((row) => row.memo.includes('Owner sent working capital')));
  assert.ok(bankSearch.pagination.total >= 1);

  const cashOut = await listCashMovements(db, { paged: true, direction: 'out' });
  assert.ok(cashOut.rows.length >= 1);
  assert.ok(cashOut.rows.every((row) => Number(row.cash_delta) < 0));
});

test('exchange reversal nets cash and online totals and stays in exchange history', async () => {
  const drawer = await db.get(`SELECT id FROM cash_drawers ORDER BY id LIMIT 1`);
  const day = await db.get(`SELECT id,business_date FROM business_days WHERE status='open' ORDER BY id DESC LIMIT 1`);
  const exchange = await recordCashExchange(db, {
    from_method: 'online', to_method: 'cash', amount: 100, charge: 5,
    note: 'Test exchange', created_by: admin.id, drawer_id: drawer.id, business_day_id: day.id,
    external_ref: `reverse-exchange-${Date.now()}`,
  });
  const reversalId = await reverseJournal(db, {
    journal_id: exchange.journalId, reason: 'Customer cancelled', created_by: admin.id, business_day_id: day.id,
  });

  const history = await listCashExchanges(db);
  assert.equal(Number(history.find((row) => row.id === exchange.journalId)?.reversal_id), reversalId);
  assert.equal(Number(history.find((row) => row.id === reversalId)?.cash_in), 95);
  assert.equal(Number(history.find((row) => row.id === reversalId)?.online_out), 100);

  const digital = await digitalReceipts(db, day.business_date, day.business_date);
  assert.equal(digital.totals.exchange, 0);
  const summary = await businessDaySummary(db, day.id);
  assert.equal(Number(summary.cash.breakdown.money_exchange_out), 0);
});

test('rejects cash-out without a reason', async () => {
  await ensureAccountingSchema(db);
  const drawer = await db.get(`SELECT id FROM cash_drawers ORDER BY id LIMIT 1`);
  await assert.rejects(
    () => recordCashMovement(db, {
      direction: 'out',
      movement_type: 'other',
      amount: 10,
      reason: 'x',
      created_by: admin.id,
      drawer_id: drawer.id,
    }),
    /reason/i
  );
});
