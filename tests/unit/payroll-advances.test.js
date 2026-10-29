import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PosDatabase } from '../../lib/db/index.js';
import { getNepaliDateString } from '../../lib/time-utils.js';
import { openBusinessDay } from '../../lib/business-days.js';
import {
  advanceOutstanding,
  ensurePayrollSchema,
  listPayrollOverview,
  recordAdvance,
  recordPayment,
} from '../../lib/payroll.js';

const dbPath = path.join(os.tmpdir(), `payroll-advances-test-${process.pid}-${Date.now()}.db`);
const db = new PosDatabase(dbPath);
const actor = { id: 1, full_name: 'Admin', role: 'admin' };
let employeeId;

test.after(() => {
  try { db.close(); } catch { /* already closed */ }
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* already gone */ }
  }
});

test('setup payroll and an open business day', async () => {
  await ensurePayrollSchema(db);
  const employee = await db.get(`SELECT id FROM users WHERE role <> 'admin' ORDER BY id LIMIT 1`);
  assert.ok(employee?.id);
  employeeId = employee.id;
  await openBusinessDay(db, {
    business_date: getNepaliDateString(),
    opening_cash: 10000,
    opening_note: 'Payroll advance test',
  }, actor);
});

test('salary advance creates an outstanding employee balance', async () => {
  const advance = await recordAdvance(db, {
    employee_id: employeeId,
    amount: 3000,
    method: 'cash',
    note: 'Emergency advance',
  }, actor.id);
  assert.equal(Number(advance.amount), 3000);
  assert.equal(await advanceOutstanding(db, employeeId), 3000);

  const journal = await db.get(`SELECT id FROM journal_entries WHERE source_type = 'salary_advance' AND source_id = ?`, [advance.id]);
  const lines = await db.all(`SELECT a.code, l.debit, l.credit FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.journal_id = ? ORDER BY a.code`, [journal.id]);
  assert.deepEqual(lines.map((line) => [line.code, Number(line.debit), Number(line.credit)]), [
    ['1010', 0, 3000],
    ['1310', 3000, 0],
  ]);
});

test('payroll deduction settles the advance and pays only the net amount', async () => {
  const payment = await recordPayment(db, {
    employee_id: employeeId,
    gross_amount: 10000,
    advance_deduction: 3000,
    amount: 7000,
    method: 'cash',
    period_label: 'August 2026',
  }, actor.id);
  assert.equal(Number(payment.gross_amount), 10000);
  assert.equal(Number(payment.advance_deduction), 3000);
  assert.equal(Number(payment.amount), 7000);
  assert.equal(await advanceOutstanding(db, employeeId), 0);

  const overview = await listPayrollOverview(db);
  const employee = overview.find((row) => Number(row.id) === Number(employeeId));
  assert.equal(Number(employee.total_advanced), 3000);
  assert.equal(Number(employee.total_deducted), 3000);
  assert.equal(Number(employee.advance_outstanding), 0);
});

test('payroll cannot deduct more than the outstanding advance', async () => {
  await assert.rejects(
    () => recordPayment(db, {
      employee_id: employeeId,
      gross_amount: 1000,
      advance_deduction: 1,
      amount: 999,
      method: 'cash',
    }, actor.id),
    /cannot exceed the outstanding/i
  );
});
