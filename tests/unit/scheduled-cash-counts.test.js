import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PosDatabase } from '../../lib/db/index.js';
import {
  listScheduledCashCounts,
  scheduledCashCountStatus,
  submitScheduledCashCount,
} from '../../lib/scheduled-cash-counts.js';

const file = path.join(os.tmpdir(), `scheduled-cash-counts-${process.pid}.db`);
const db = new PosDatabase(file);
const cashier = { id: 9001, role: 'cashier', full_name: 'Test Cashier' };
const before = new Date('2026-09-13T19:59:59+05:45');
const due = new Date('2026-09-13T20:00:00+05:45');

test.before(async () => {
  await db.run(`INSERT INTO users (id, username, password_hash, full_name, role, is_active)
    VALUES (?, 'scheduled-count-test', 'unused', 'Test Cashier', 'cashier', 1)`, [cashier.id]);
  for (const [key, value] of [
    ['cashier_cash_count_schedule_enabled', 'true'],
    ['cashier_cash_count_time', '20:00'],
  ]) {
    await db.run(`INSERT INTO system_settings(setting_key, setting_value) VALUES (?, ?)
      ON CONFLICT(setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value`, [key, value]);
  }
});

test.after(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(file + suffix); } catch { /* ignore */ } }
});

test('cash count becomes due at the configured Nepal-time boundary without exposing expected cash', async () => {
  const early = await scheduledCashCountStatus(db, cashier, before);
  assert.equal(early.due, false);
  const status = await scheduledCashCountStatus(db, cashier, due);
  assert.equal(status.due, true);
  assert.equal(status.scheduledTime, '20:00');
  assert.doesNotMatch(JSON.stringify(status), /expected/i);
});

test('security count never blocks waiter, kitchen or admin roles', async () => {
  for (const role of ['waiter', 'kitchen', 'admin']) {
    const status = await scheduledCashCountStatus(null, { id: 9900, role }, due);
    assert.equal(status.enabled, false, `${role} must bypass the cashier-only control`);
    assert.equal(status.due, false, `${role} must never receive a cash-count lock`);
  }
});

test('midday count schedule is independent from the original expected-cash reveal schedule', async () => {
  await db.run(`UPDATE system_settings SET setting_value='false' WHERE setting_key='cashier_cash_count_schedule_enabled'`);
  await db.run(`INSERT INTO system_settings(setting_key, setting_value) VALUES ('cashier_expected_cash_schedule_enabled', 'true')
    ON CONFLICT(setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value`);
  const status = await scheduledCashCountStatus(db, cashier, due);
  assert.equal(status.enabled, false);
  assert.equal(status.due, false);
  await db.run(`UPDATE system_settings SET setting_value='true' WHERE setting_key='cashier_cash_count_schedule_enabled'`);
});

test('denomination submission is one-per-cashier-per-day and admin history contains the reconciliation', async () => {
  const result = await submitScheduledCashCount(db, cashier, {
    denominations: { 1000: 2, 500: 1, 100: 3, 50: 2, 20: 1, 10: 2, 5: 1, 2: 2, 1: 1 },
  }, due);
  assert.equal(result.countedCash, 2950);

  const completed = await scheduledCashCountStatus(db, cashier, due);
  assert.equal(completed.due, false);
  assert.equal(completed.completed, true);
  await assert.rejects(
    submitScheduledCashCount(db, cashier, { denominations: {} }, due),
    { status: 409, code: 'cash_count_completed' }
  );

  const history = await listScheduledCashCounts(db, { date: '2026-09-13' });
  assert.equal(history.rows.length, 1);
  assert.equal(history.rows[0].countedCash, 2950);
  assert.equal(history.rows[0].expectedCash, 0);
  assert.equal(history.rows[0].difference, 2950);
  assert.equal(history.rows[0].denominations['500'], 1);
  assert.equal(history.rows[0].expectedBreakdown.note, 'No open business day existed when this count was submitted.');
});
