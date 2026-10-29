import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PosDatabase } from '../../lib/db/index.js';
import { getNepaliDateString } from '../../lib/time-utils.js';
import { businessDayContext, businessDaySummary, openBusinessDay, closeBusinessDay } from '../../lib/business-days.js';
import { postSaleJournal } from '../../lib/accounting.js';

const actor = { id: 1, full_name: 'Admin One', role: 'admin' };
const yesterday = (() => {
  const date = new Date(`${getNepaliDateString()}T12:00:00+05:45`);
  date.setUTCDate(date.getUTCDate() - 1);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu' }).format(date);
})();

async function withDb(run) {
  const dbPath = path.join(os.tmpdir(), `business-day-manual-close-${process.pid}-${Date.now()}-${Math.random()}.db`);
  const db = new PosDatabase(dbPath);
  try { await run(db); }
  finally {
    try { db.close(); } catch { /* already closed */ }
    for (const suffix of ['', '-shm', '-wal']) {
      try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* already gone */ }
    }
  }
}

test('stale days remain open until an explicit physical count and manual finalization', async () => withDb(async (db) => {
  const opened = await openBusinessDay(db, { business_date: yesterday, opening_cash: 500 }, actor);
  const context = await businessDayContext(db);
  assert.equal(context.current.id, opened.id);
  assert.ok(context.activeSession);
  assert.equal(context.current.counted_cash, null);
  await closeBusinessDay(db, { counted_cash: 490, closing_note: 'Physical count was short by ten' }, actor);
  const countedButNotFinalized = await businessDayContext(db);
  assert.equal(countedButNotFinalized.current.id, opened.id);
  assert.equal(countedButNotFinalized.activeSession == null, true);
  assert.equal(Number(countedButNotFinalized.current.counted_cash), 490);
  let audit = await db.get(`SELECT action FROM business_day_audit WHERE business_day_id=? ORDER BY id DESC LIMIT 1`, [opened.id]);
  assert.equal(audit.action, 'store_session_closed');

  const todayDay = await openBusinessDay(db, {
    business_date: getNepaliDateString(), opening_cash: 490,
    action: 'start_next', confirm_next_day: true,
  }, actor);
  audit = await db.get(`SELECT action FROM business_day_audit WHERE business_day_id=? ORDER BY id DESC LIMIT 1`, [opened.id]);
  assert.equal(audit.action, 'business_day_finalized');

  await postSaleJournal(db, {
    bill_id: 9001,
    bill_number: 'PRIOR-DAY-ORDER',
    parts: [{ method: 'cash', amount: 100 }],
    business_day_id: opened.id,
    created_by: actor.id,
  });
  const saleJournal = await db.get(`SELECT entry_date, business_day_id FROM journal_entries WHERE source_type='bill' AND source_id=9001`);
  assert.equal(saleJournal.entry_date, yesterday);
  assert.equal(saleJournal.business_day_id, opened.id);
  const currentDrawer = await businessDaySummary(db, todayDay.id);
  assert.equal(currentDrawer.cash.expected_cash, 590);
  assert.equal(currentDrawer.cash.breakdown.cash_collections, 100);

  const twoDaysAgo = new Date(`${yesterday}T12:00:00+05:45`);
  twoDaysAgo.setUTCDate(twoDaysAgo.getUTCDate() - 1);
  const staleDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu' }).format(twoDaysAgo);
  await db.run(`UPDATE business_days SET business_date=? WHERE id=?`, [staleDate, todayDay.id]);
  await db.run(`INSERT INTO orders (order_number,status,business_day_id,created_at) VALUES ('AUTO-BLOCK','pending',?,CURRENT_TIMESTAMP)`, [todayDay.id]);
  const blocked = await businessDayContext(db);
  assert.equal(blocked.current.id, todayDay.id);
  assert.equal(blocked.current.isStale, true);
  assert.ok(blocked.activeSession);
}));
