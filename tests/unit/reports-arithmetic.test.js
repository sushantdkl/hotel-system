/**
 * Arithmetic and scoping guarantees for the reporting engine.
 *
 * These drive the real builders in lib/reports.js against a stub database that
 * records every statement and answers from canned rows, so the assertions cover
 * both the numbers that come out and the SQL that goes in — the two places the
 * reporting bugs actually lived.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildReport, dateKey, eachDay, previousRange } from '@/lib/reports.js';
import { resolvePeriodRange, nepalRangeUtcBounds, nepalOperationalRangeBounds } from '@/lib/report-dates.js';
import { cashFlowStatement } from '@/lib/accounting-reports.js';

/**
 * Stub db. `answers` is a list of [substring, rows] pairs; the first entry
 * whose substring appears in the statement wins. Everything else returns [].
 */
function stubDb(answers = [], { driver = 'sqlite' } = {}) {
  const statements = [];
  const lookup = (sql) => {
    for (const [needle, rows] of answers) if (sql.includes(needle)) return rows;
    return [];
  };
  return {
    driver,
    statements,
    async all(sql, params = []) {
      statements.push({ sql, params });
      return lookup(sql);
    },
    async get(sql, params = []) {
      statements.push({ sql, params });
      return lookup(sql)[0] ?? {};
    },
  };
}

const sqlFor = (db, needle) => db.statements.filter((s) => s.sql.includes(needle));
const range = (start, end) => ({ start, end });

/* ---- date windows ------------------------------------------------ */

test('a date range is inclusive of both endpoints', () => {
  const days = eachDay(range('2026-08-01', '2026-08-05'));
  assert.equal(days.length, 5);
  assert.equal(days[0].date, '2026-08-01');
  assert.equal(days[4].date, '2026-08-05');
});

test('a single-day range yields exactly one day, not zero', () => {
  assert.equal(eachDay(range('2026-08-24', '2026-08-24')).length, 1);
});

test('Postgres DATE values normalize to an ISO report date', () => {
  assert.equal(dateKey(new Date(2026, 7, 25, 0, 0, 0)), '2026-08-25');
});

test('the previous period is the same length and ends the day before', () => {
  const prev = previousRange(range('2026-08-08', '2026-08-14'));
  assert.deepEqual(
    { start: prev.start, end: prev.end, spanDays: prev.spanDays },
    { start: '2026-08-01', end: '2026-08-07', spanDays: 7 }
  );
});

test('the previous period of a single day is the day before', () => {
  const prev = previousRange(range('2026-03-01', '2026-03-01'));
  assert.deepEqual([prev.start, prev.end], ['2026-02-28', '2026-02-28']);
});

test('a Nepal day maps to a UTC window that starts 5h45m early and is end-exclusive', () => {
  const { startUtc, endUtcExclusive } = nepalRangeUtcBounds('2026-08-24', '2026-08-24');
  assert.equal(startUtc, '2026-08-23 18:15:00');
  assert.equal(endUtcExclusive, '2026-08-24 18:15:00');
});

test('a PostgreSQL Nepal day uses local wall-clock bounds for legacy timestamp columns', () => {
  assert.deepEqual(
    nepalOperationalRangeBounds('postgres', '2026-08-24', '2026-08-24'),
    { start: '2026-08-24 00:00:00', endExclusive: '2026-08-25 00:00:00' }
  );
});

test('last_month resolves to a whole calendar month, not a rolling 30 days', () => {
  const r = resolvePeriodRange('last_month');
  assert.match(r.start, /-01$/);
  assert.equal(r.start.slice(0, 7), r.end.slice(0, 7));
});

/* ---- Nepal-local bucketing --------------------------------------- */

test('hour and weekday buckets shift bill timestamps into Nepal time', async () => {
  const db = stubDb();
  await buildReport(db, 'sales', range('2026-08-01', '2026-08-07'), {});

  const hourly = sqlFor(db, "strftime('%H'");
  assert.ok(hourly.length > 0, 'sales tab must bucket by hour');
  for (const { sql } of hourly) {
    assert.match(
      sql,
      /strftime\('%H', datetime\([^)]*'\+5 hours', '\+45 minutes'\)\)/,
      'hour buckets must be taken from Nepal-local time, not raw UTC'
    );
  }

  for (const { sql } of sqlFor(db, "strftime('%w'")) {
    assert.match(sql, /strftime\('%w', datetime\([^)]*'\+5 hours', '\+45 minutes'\)\)/);
  }
});

test('on Postgres Nepal wall-clock timestamps are bucketed without a second offset', async () => {
  const db = stubDb([], { driver: 'postgres' });
  await buildReport(db, 'sales', range('2026-08-01', '2026-08-07'), {});
  const hourly = sqlFor(db, 'EXTRACT(HOUR FROM');
  assert.ok(hourly.length > 0);
  for (const { sql } of hourly) {
    assert.doesNotMatch(sql, /AT TIME ZONE|5 hours|45 minutes/);
    assert.match(sql, /EXTRACT\(HOUR FROM \(b\.created_at\)\)/);
  }
});

/* ---- finance: one expense definition, three places ---------------- */

test('the expense KPI, the daily trend and the ledger all exclude stock purchases', async () => {
  const db = stubDb();
  await buildReport(db, 'finance', range('2026-08-01', '2026-08-07'), {});

  const expenseReads = db.statements.filter((s) => /FROM expenses/.test(s.sql));
  assert.equal(expenseReads.length, 4, 'KPI totals, daily rollup, ledger table and ledger payment split');
  for (const { sql } of expenseReads) {
    assert.match(
      sql,
      /source_type IS NULL OR (e\.)?source_type <> 'purchase'/,
      'a purchase-sourced expense is stock, not operating spend, and must be excluded consistently'
    );
  }
});

test('selecting a business day scopes expenses to that day rather than the calendar range', async () => {
  const db = stubDb();
  await buildReport(db, 'finance', range('2026-08-01', '2026-08-07'), { businessDayId: 42 });
  for (const { sql, params } of db.statements.filter((s) => /FROM expenses/.test(s.sql))) {
    assert.match(sql, /business_day_id = \?/);
    assert.deepEqual(params, [42]);
  }
});

test('the monthly revenue chart reads enough newest days for 24 BS months, then reads oldest-first', async () => {
  const db = stubDb();
  await buildReport(db, 'finance', range('2026-08-01', '2026-08-07'), {});
  const [monthly] = sqlFor(db, 'LIMIT 800');
  assert.ok(monthly, 'finance tab charts monthly revenue');
  assert.match(monthly.sql, /ORDER BY day DESC\s+LIMIT 800/, 'the window must cover at least 24 BS months');
  assert.match(monthly.sql, /\)\s*recent\s+ORDER BY day ASC/, 'the chart must still read left to right');
});

test('profit is revenue minus operating expenses, and the daily rows add up to it', async () => {
  const db = stubDb([
    ['AS revenue FROM bills', [{ revenue: 100000 }]],
    ['GROUP BY COALESCE(category', [{ category: 'rent', count: 1, amount: 30000 }]],
    ['AS d, COALESCE(SUM(amount), 0) AS amount', [{ d: '2026-08-01', amount: 30000 }]],
  ]);
  const report = await buildReport(db, 'finance', range('2026-08-01', '2026-08-02'), {});
  const kpi = (key) => report.kpis.find((k) => k.key === key).value;

  assert.equal(kpi('revenue'), 100000);
  assert.equal(kpi('expenses'), 30000);
  assert.equal(kpi('profit'), 70000);
  assert.equal(kpi('margin'), 70);

  const summary = report.tables.find((t) => t.id === 'profit-summary');
  assert.equal(summary.rows.reduce((s, r) => s + r.expenses, 0), kpi('expenses'));
});

test('an empty period reports zeros, never NaN or a division by zero', async () => {
  const report = await buildReport(stubDb(), 'finance', range('2026-08-01', '2026-08-07'), {});
  for (const kpi of report.kpis) {
    assert.equal(Number.isFinite(kpi.value), true, `${kpi.key} must be a finite number`);
    assert.equal(kpi.value, 0);
  }
  for (const row of report.tables.find((t) => t.id === 'profit-summary').rows) {
    assert.equal(row.marginPct, 0, 'a day with no revenue has 0% margin, not NaN%');
  }
});

/* ---- sales: reconciliation follows the selected business day ------ */

test('cash, credit and refund figures follow the business day when one is picked', async () => {
  const db = stubDb();
  await buildReport(db, 'sales', range('2026-08-01', '2026-08-07'), { businessDayId: 7 });

  // Each of these reads a table that is not joined to `bills`, so it cannot
  // reuse the bill scope and used to fall back to the calendar range — leaving
  // the cash figure showing the wrong period on the day being closed.
  const scoped = [
    ['money received', (sql) => sql.includes('AS bucket')],
    ['credit collections', (sql) => sql.includes('FROM customer_ledger')],
    ['refunds', (sql) => sql.includes('FROM bill_corrections')],
    ['cancelled orders', (sql) => sql.includes("o.status = 'cancelled'")],
  ];
  for (const [label, matches] of scoped) {
    const reads = db.statements.filter((s) => matches(s.sql));
    assert.ok(reads.length > 0, `${label} is read by the sales tab`);
    for (const { sql, params } of reads) {
      assert.match(sql, /business_day_id = \?/, `${label} must honour the business-day filter`);
      assert.ok(params.includes(7), `${label} must be scoped to the selected day`);
    }
  }
});

test('tax is read from vat_amount when the tax column is zero', async () => {
  const db = stubDb();
  await buildReport(db, 'sales', range('2026-08-01', '2026-08-07'), {});
  const [totals] = sqlFor(db, 'AS gross');
  assert.match(
    totals.sql,
    /CASE WHEN COALESCE\(b\.vat_amount, 0\) <> 0 THEN b\.vat_amount ELSE COALESCE\(b\.tax, 0\) END/,
    'COALESCE(tax, vat_amount) never falls through, because tax defaults to 0 rather than NULL'
  );
});

test('every sales KPI carries a plain-language definition', async () => {
  const report = await buildReport(stubDb(), 'sales', range('2026-08-01', '2026-08-07'), {});
  for (const kpi of report.kpis) {
    assert.equal(typeof kpi.hint, 'string', `${kpi.key} needs a definition an owner can read`);
    assert.ok(kpi.hint.length > 10);
  }
});

test('Net Sales excludes tax and refunds while Billed Total does not', async () => {
  const db = stubDb([
    ['AS gross', [{ gross: 100000, net: 113000, tax: 13000, discounts: 0, service_charge: 0, orders: 10 }]],
    ["refund_reversal", [{ amount: 3000 }]],
  ]);
  const report = await buildReport(db, 'sales', range('2026-08-01', '2026-08-07'), {});
  const kpi = (key) => report.kpis.find((k) => k.key === key).value;

  assert.equal(kpi('billed_total'), 113000);
  assert.equal(kpi('tax'), 13000);
  assert.equal(kpi('net'), 113000 - 13000 - 3000);
  assert.equal(report.reconciliation.netSales, kpi('net'));
});

/* ---- inventory --------------------------------------------------- */

test('purchase history is queried directly, not sliced out of capped movements', async () => {
  const db = stubDb();
  await buildReport(db, 'inventory', range('2026-08-01', '2026-08-07'), {});
  const purchases = db.statements.filter((s) =>
    s.sql.includes("m.change_type IN ('purchase_receipt', 'manual_restock')")
  );
  assert.equal(purchases.length, 1, 'deliveries must not depend on what survived the movement cap');
});

/* ---- cash flow --------------------------------------------------- */

test('the cash flow statement covers digital wallets, not just cash and bank', async () => {
  const db = stubDb();
  await cashFlowStatement(db, { from: '2026-08-01', to: '2026-08-07' });
  const [statement] = db.statements;
  for (const code of ['1010', '1020', '1100', '1110', '1120', '1130', '1140']) {
    assert.match(statement.sql, new RegExp(`'${code}'`), `account ${code} must be in scope`);
  }
});

test('condensing a long cash flow keeps the bucket net exact', async () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({
    source_type: 'bill',
    memo: `Bill INV-${i}`,
    inflow: 100 + i,
    outflow: 0,
  }));
  const db = stubDb([['FROM journal_lines', rows]]);
  const statement = await cashFlowStatement(db, { from: '2026-08-01', to: '2026-08-07' });

  const expected = rows.reduce((s, r) => s + r.inflow, 0);
  assert.equal(statement.operating.net, expected);
  assert.equal(statement.netChange, expected);
  assert.ok(statement.operating.inflows.length <= 26, 'the tail is rolled into one summarised row');
  assert.equal(
    statement.operating.inflows.reduce((s, l) => s + l.amount, 0),
    expected,
    'the listed lines must still add up to the net'
  );
});
