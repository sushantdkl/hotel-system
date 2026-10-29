import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { PosDatabase } from '../../lib/db/index.js';
import { postJournal } from '../../lib/accounting.js';
import { businessDaySummary, openBusinessDay } from '../../lib/business-days.js';
import { getNepaliDateString } from '../../lib/time-utils.js';

async function withDb(run) {
  const file = path.join(os.tmpdir(), `business-day-funding-${process.pid}-${Date.now()}-${Math.random()}.db`);
  const db = new PosDatabase(file);
  try { await run(db); }
  finally {
    try { db.close(); } catch { /* already closed */ }
    for (const suffix of ['', '-shm', '-wal']) try { fs.unlinkSync(`${file}${suffix}`); } catch { /* absent */ }
  }
}

const actor = { id: 1, full_name: 'Admin', role: 'admin' };

test('funding is visible and an unfunded negative drawer becomes a closing blocker', async () => withDb(async (db) => {
  const day = await openBusinessDay(db, { business_date: getNepaliDateString(), opening_cash: 0 }, actor);
  const drawer = await db.get(`SELECT id FROM cash_drawers WHERE is_active=1 ORDER BY id LIMIT 1`);
  await postJournal(db, { entry_date: day.business_date, source_type: 'business_funding_use', source_id: 50, business_day_id: day.id, lines: [{ code: '1010', debit: 100, credit: 0, drawer_id: drawer.id }, { code: '1050', debit: 0, credit: 100 }] });
  await postJournal(db, { entry_date: day.business_date, source_type: 'expense', source_id: 50, business_day_id: day.id, lines: [{ code: '5020', debit: 100, credit: 0 }, { code: '1010', debit: 0, credit: 100, drawer_id: drawer.id }] });
  const summary = await businessDaySummary(db, day.id);
  assert.equal(summary.cash.expected_cash, 0);
  assert.equal(summary.cash.breakdown.business_funding_in, 100);
  assert.equal(summary.cash.breakdown.cash_expenses, 100);
  assert.equal(summary.blockers.canCloseNormally, true);
  await postJournal(db, { entry_date: day.business_date, source_type: 'expense', source_id: 51, business_day_id: day.id, lines: [{ code: '5020', debit: 100, credit: 0 }, { code: '1010', debit: 0, credit: 100, drawer_id: drawer.id }] });
  const negative = await businessDaySummary(db, day.id);
  assert.equal(negative.cash.expected_cash, -100);
  assert.equal(negative.blockers.canCloseNormally, false);
  assert.match(negative.blockers.items.find((item) => item.key === 'negative_expected_cash')?.message || '', /below zero/i);
}));
