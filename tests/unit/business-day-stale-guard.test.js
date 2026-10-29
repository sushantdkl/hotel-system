import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PosDatabase } from '../../lib/db/index.js';
import { getNepaliDateString } from '../../lib/time-utils.js';
import { businessDayContext, openBusinessDay } from '../../lib/business-days.js';

const actor = { id: 1, full_name: 'Admin One', role: 'admin' };

test('an older open day cannot be continued after a later business-day record exists', async () => {
  const dbPath = path.join(os.tmpdir(), `business-day-stale-guard-${process.pid}-${Date.now()}.db`);
  const db = new PosDatabase(dbPath);
  try {
    const today = getNepaliDateString();
    const cursor = new Date(`${today}T12:00:00+05:45`);
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const yesterday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu' }).format(cursor);
    const opened = await openBusinessDay(db, { business_date: yesterday, opening_cash: 500 }, actor);
    await db.run(
      `INSERT INTO business_days (business_date,status,opened_at,closed_at,opening_cash,opening_note)
       VALUES (?,'closed',?,?,0,?)`,
      [today, `${today} 00:00:00`, `${today} 23:59:59`, 'Historical calendar-date backfill; no opening count was available.']
    );

    const context = await businessDayContext(db);
    assert.equal(context.current.id, opened.id);
    assert.equal(context.laterBusinessDay.business_date, today);

    await assert.rejects(
      openBusinessDay(db, {
        action: 'continue_stale',
        business_date: yesterday,
        confirm_continue_stale: true,
        reason: 'Continue the old shift',
      }, actor),
      /cannot be continued because a later Business Day/
    );
  } finally {
    try { db.close(); } catch { /* already closed */ }
    for (const suffix of ['', '-shm', '-wal']) {
      try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* already gone */ }
    }
  }
});
