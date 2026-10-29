import { ensureSqliteTable } from '@/lib/db/ensure-sqlite-table.js';
import { serialPkSql } from '@/lib/db/schema-helpers.js';
import { businessDaySummary, currentBusinessDay } from '@/lib/business-days.js';
import { getNepaliDateString, getNepaliDateTime } from '@/lib/time-utils.js';

export const CASH_COUNT_DENOMINATIONS = [1000, 500, 100, 50, 20, 10, 5, 2, 1];
const VALID_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const fail = (message, status = 400, extra = {}) => {
  throw Object.assign(new Error(message), { status, ...extra });
};

export async function ensureScheduledCashCountSchema(db) {
  if (db.driver === 'postgres') {
    const ready = await db.get(`SELECT to_regclass('public.scheduled_cash_counts') AS table_name`);
    if (!ready?.table_name) {
      fail('Scheduled cash count schema is not installed. Run npm run db:migrate.', 503, { code: 'schema_missing', expose: true });
    }
    return;
  }
  const pk = serialPkSql(db);
  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS scheduled_cash_counts (
    ${pk}, count_date TEXT NOT NULL, scheduled_time TEXT NOT NULL,
    cashier_id INTEGER NOT NULL, business_day_id INTEGER,
    counted_cash REAL NOT NULL, expected_cash REAL NOT NULL, cash_difference REAL NOT NULL,
    denominations TEXT NOT NULL, expected_breakdown TEXT,
    submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(count_date, cashier_id)
  )`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_scheduled_cash_counts_date ON scheduled_cash_counts(count_date, submitted_at)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_scheduled_cash_counts_cashier ON scheduled_cash_counts(cashier_id, count_date)`);
}

async function countSettings(db) {
  const rows = await db.all(`SELECT setting_key, setting_value FROM system_settings
    WHERE setting_key IN ('cashier_cash_count_schedule_enabled','cashier_cash_count_time')`).catch(() => []);
  const settings = Object.fromEntries((rows || []).map((row) => [row.setting_key, row.setting_value]));
  const enabled = !['false', '0', 'off', 'no'].includes(String(settings.cashier_cash_count_schedule_enabled ?? 'false').toLowerCase());
  const candidate = String(settings.cashier_cash_count_time || '14:00');
  return { enabled, scheduledTime: VALID_TIME.test(candidate) ? candidate : '14:00' };
}

export async function scheduledCashCountStatus(db, user, now = new Date()) {
  const countDate = getNepaliDateString(now);
  // This is a cashier drawer control, not a store-wide operational lock.
  // Bypass before touching settings/schema so waiter, kitchen and admin work
  // remains available even if the cash-count subsystem is unavailable.
  if (user?.role !== 'cashier') {
    return { enabled: false, due: false, completed: false, scheduledTime: null, countDate, timeZone: 'Asia/Kathmandu' };
  }
  await ensureScheduledCashCountSchema(db);
  const { enabled, scheduledTime } = await countSettings(db);
  if (!enabled) {
    return { enabled, due: false, completed: false, scheduledTime, countDate, timeZone: 'Asia/Kathmandu' };
  }
  const completed = await db.get(
    `SELECT id, counted_cash, submitted_at FROM scheduled_cash_counts WHERE cashier_id=? AND count_date=?`,
    [user.id, countDate]
  );
  const due = !completed && getNepaliDateTime(now).slice(11, 16) >= scheduledTime;
  return {
    enabled,
    due,
    completed: !!completed,
    scheduledTime,
    countDate,
    timeZone: 'Asia/Kathmandu',
    submission: completed ? { id: completed.id, countedCash: round2(completed.counted_cash), submittedAt: completed.submitted_at } : null,
  };
}

function normalizeDenominations(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Enter the quantity for each cash denomination.');
  const counts = {};
  let total = 0;
  for (const denomination of CASH_COUNT_DENOMINATIONS) {
    const raw = input[denomination] ?? input[String(denomination)] ?? 0;
    const quantity = raw === '' ? 0 : Number(raw);
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 100000) {
      fail(`Enter a whole, non-negative quantity for Rs ${denomination}.`);
    }
    counts[denomination] = quantity;
    total += denomination * quantity;
  }
  return { counts, total: round2(total) };
}

export async function submitScheduledCashCount(db, user, input, now = new Date()) {
  if (user?.role !== 'cashier') fail('Only a cashier can submit the scheduled drawer count.', 403);
  const status = await scheduledCashCountStatus(db, user, now);
  if (!status.enabled) fail('Scheduled cash counting is not enabled.', 409);
  if (status.completed) fail('Today\'s scheduled cash count has already been submitted.', 409, { code: 'cash_count_completed' });
  if (!status.due) fail(`The cash count is available at ${status.scheduledTime} Nepal time.`, 409, { code: 'cash_count_not_due' });

  const { counts, total } = normalizeDenominations(input?.denominations);
  const day = await currentBusinessDay(db);
  const summary = day ? await businessDaySummary(db, day) : null;
  const expected = round2(summary?.cash?.expected_cash || 0);
  const difference = round2(total - expected);
  const expectedBreakdown = summary ? {
    cash: summary.cash,
    collections: summary.collections,
    outflows: summary.outflows,
    businessDate: day.business_date,
    businessDayStatus: day.status,
  } : {
    cash: { expected_cash: 0, breakdown: { opening_cash: 0 }, ledger_movement: 0 },
    note: 'No open business day existed when this count was submitted.',
  };

  try {
    const inserted = await db.run(`INSERT INTO scheduled_cash_counts
      (count_date, scheduled_time, cashier_id, business_day_id, counted_cash, expected_cash,
       cash_difference, denominations, expected_breakdown)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      status.countDate, status.scheduledTime, user.id, day?.id || null, total, expected,
      difference, JSON.stringify(counts), JSON.stringify(expectedBreakdown),
    ]);
    return {
      id: inserted.lastInsertRowid,
      countDate: status.countDate,
      countedCash: total,
      submittedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (/unique|duplicate/i.test(String(error?.message || ''))) {
      fail('Today\'s scheduled cash count has already been submitted.', 409, { code: 'cash_count_completed' });
    }
    throw error;
  }
}

const parseJson = (value, fallback) => {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
};

export async function listScheduledCashCounts(db, { page = 1, pageSize = 30, date = '' } = {}) {
  await ensureScheduledCashCountSchema(db);
  const p = Math.max(1, Number(page) || 1);
  const size = Math.min(100, Math.max(10, Number(pageSize) || 30));
  const where = date ? 'WHERE c.count_date=?' : '';
  const params = date ? [date] : [];
  const total = Number((await db.get(`SELECT COUNT(*) AS n FROM scheduled_cash_counts c ${where}`, params))?.n || 0);
  const rows = await db.all(`SELECT c.*, u.full_name AS cashier_name, u.username AS cashier_username,
      bd.business_date
    FROM scheduled_cash_counts c
    JOIN users u ON u.id=c.cashier_id
    LEFT JOIN business_days bd ON bd.id=c.business_day_id
    ${where}
    ORDER BY c.count_date DESC, c.submitted_at DESC, c.id DESC
    LIMIT ${size} OFFSET ${(p - 1) * size}`, params);
  return {
    rows: rows.map((row) => ({
      id: row.id,
      countDate: String(row.count_date || '').slice(0, 10),
      scheduledTime: row.scheduled_time,
      submittedAt: row.submitted_at,
      cashier: row.cashier_name || row.cashier_username || `Cashier #${row.cashier_id}`,
      businessDayId: row.business_day_id,
      businessDate: row.business_date ? String(row.business_date).slice(0, 10) : null,
      countedCash: round2(row.counted_cash),
      expectedCash: round2(row.expected_cash),
      difference: round2(row.cash_difference),
      denominations: parseJson(row.denominations, {}),
      expectedBreakdown: parseJson(row.expected_breakdown, {}),
    })),
    pagination: { page: p, pageSize: size, total, totalPages: Math.max(1, Math.ceil(total / size)) },
  };
}
