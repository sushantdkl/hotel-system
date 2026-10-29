import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PosDatabase } from '../../lib/db/index.js';
import { getNepaliDateString } from '../../lib/time-utils.js';
import {
  businessDayIdForCalendarDate,
  closeBusinessDay,
  openBusinessDay,
} from '../../lib/business-days.js';

const actor = { id: 1, full_name: 'Admin One', role: 'admin' };

function addDaysStr(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00+05:45`);
  d.setUTCDate(d.getUTCDate() + n);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu' }).format(d);
}

test('historical shell is adopted on start_next; real closed days are not', async () => {
  // One DB only — ensureAccountingSchema caches a process-wide SEEDED flag, so a
  // second PosDatabase in the same process would skip creating cash_drawers.
  const dbPath = path.join(os.tmpdir(), `business-day-adopt-${process.pid}-${Date.now()}.db`);
  const db = new PosDatabase(dbPath);
  try {
    const today = getNepaliDateString();
    const yesterday = addDaysStr(today, -1);

    const prior = await openBusinessDay(db, { business_date: yesterday, opening_cash: 2460 }, actor);
    await closeBusinessDay(db, { counted_cash: 8955, closing_note: 'Day closed successfully.' }, actor);

    // Reproduce production: expense dated today while yesterday is still the
    // current (session-closed but not finalized) business day.
    const shellId = await businessDayIdForCalendarDate(db, today, {
      note: 'Historical day created for a late-entered expense.',
    });
    assert.ok(shellId);
    const shell = await db.get(`SELECT * FROM business_days WHERE id=?`, [shellId]);
    assert.equal(shell.status, 'closed');
    assert.equal(shell.business_date, today);
    assert.equal(Number(shell.opening_cash), 0);

    const opened = await openBusinessDay(db, {
      action: 'start_next',
      confirm_next_day: true,
      opening_cash: 2500,
      opening_cash_reason: 'cash_reserve',
      opening_note: 'Real open after late expense',
    }, actor);

    assert.equal(opened.id, shellId);
    assert.equal(opened.status, 'open');
    assert.equal(opened.adopted, true);
    assert.equal(Number(opened.opening_cash), 2500);
    assert.equal(opened.active_session?.status, 'open');
    assert.equal(Number(opened.active_session?.opening_cash), 2500);

    const priorRow = await db.get(`SELECT status FROM business_days WHERE id=?`, [prior.id]);
    assert.equal(priorRow.status, 'closed');

    const audit = await db.get(
      `SELECT action FROM business_day_audit WHERE business_day_id=? AND action='business_day_adopted' ORDER BY id DESC LIMIT 1`,
      [shellId]
    );
    assert.equal(audit?.action, 'business_day_adopted');

    // Second case: a real closed day (ordinary note + store session) must not be claimable.
    await db.run(
      `UPDATE business_day_sessions SET status='closed', closed_at=CURRENT_TIMESTAMP, closed_by=?
       WHERE business_day_id=? AND status='open'`,
      [actor.id, opened.id]
    );
    await db.run(
      `UPDATE business_days SET status='closed', closed_at=CURRENT_TIMESTAMP, closed_by=?,
        opening_note='Ordinary closed day' WHERE id=?`,
      [actor.id, opened.id]
    );

    let error = null;
    try {
      await openBusinessDay(db, { business_date: today, opening_cash: 1000 }, actor);
    } catch (err) {
      error = err;
    }
    assert.equal(error?.code, 'business_date_exists');
  } finally {
    try { db.close(); } catch { /* already closed */ }
    for (const suffix of ['', '-shm', '-wal']) {
      try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* already gone */ }
    }
  }
});
