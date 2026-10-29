/**
 * Regression tests for the reporting audit: the shared bill scope, payment
 * coverage across both storage paths, resilience on an install that has never
 * used a feature, the cashier whitelist, and one-word-one-meaning labelling.
 *
 * Each test corresponds to a bug the probe run actually surfaced.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ADMIN_ONLY_REPORT_TABS, CASHIER_REPORT_TABS, FILTER_SUPPORT,
  FILTER_UNAVAILABLE_REASON, REPORT_TABS,
  allowedReportTabs, buildReport, supportedFilters,
} from '@/lib/reports.js';
import {
  COUNTED_BILL_STATUSES, billDateColumn, countedBillSql, openBillSql,
  paymentBucket, paymentsUnionSql, voidedBillSql,
} from '@/lib/report-scope.js';

function stubDb(answers = [], { driver = 'sqlite' } = {}) {
  const statements = [];
  const lookup = (sql) => {
    for (const [needle, rows] of answers) if (sql.includes(needle)) return rows;
    return [];
  };
  return {
    driver,
    statements,
    async all(sql, params = []) { statements.push({ sql, params }); return lookup(sql); },
    async get(sql, params = []) { statements.push({ sql, params }); return lookup(sql)[0] ?? {}; },
  };
}

const sqlFor = (db, needle) => db.statements.filter((s) => s.sql.includes(needle));
const range = (start, end) => ({ start, end });

/* ---- the shared bill scope --------------------------------------- */

test('every reporting surface agrees on which bills count', () => {
  assert.deepEqual(
    [...COUNTED_BILL_STATUSES].sort(),
    ['paid', 'partially_paid', 'refunded', 'reopened']
  );
  const sql = countedBillSql('b');
  for (const status of COUNTED_BILL_STATUSES) assert.match(sql, new RegExp(`'${status}'`));
  for (const excluded of ['void', 'voided', 'cancelled']) {
    assert.equal(sql.includes(`'${excluded}'`), false, `${excluded} bills are not trade`);
  }
});

test('counted, open and voided bill sets do not overlap', () => {
  const counted = countedBillSql('b');
  const open = openBillSql('b');
  const voided = voidedBillSql('b');
  for (const status of ['unpaid', 'open', 'in_progress']) {
    assert.equal(counted.includes(`'${status}'`), false, `${status} is not settled trade`);
    assert.ok(open.includes(`'${status}'`));
  }
  for (const status of ['void', 'voided', 'cancelled', 'canceled']) {
    assert.ok(voided.includes(`'${status}'`));
    assert.equal(counted.includes(`'${status}'`), false);
  }
});

test('a partially paid bill counts at full value, not at the amount collected', async () => {
  const db = stubDb([
    ['AS gross', [{ gross: 5000, net: 5000, tax: 0, discounts: 0, service_charge: 0, orders: 1 }]],
  ]);
  const report = await buildReport(db, 'sales', range('2026-08-01', '2026-08-07'), {});
  const kpi = (key) => report.kpis.find((k) => k.key === key).value;
  assert.equal(kpi('billed_total'), 5000, 'the sale happened at its full value');
  const [totals] = sqlFor(db, 'AS gross');
  assert.match(totals.sql, /'partially_paid'/);
  assert.match(totals.sql, /SUM\(b\.grand_total\)/, 'full bill value, never the collected part');
});

test('refunded and reopened bills stay in the reports', async () => {
  const db = stubDb();
  await buildReport(db, 'sales', range('2026-08-01', '2026-08-07'), {});
  const [totals] = sqlFor(db, 'AS gross');
  assert.match(totals.sql, /'refunded'/, 'a refunded bill was still a sale; the refund is deducted separately');
  assert.match(totals.sql, /'reopened'/, 'a bill under correction must not vanish from the report');
});

test('bills are dated by when they were raised, not when they were paid', async () => {
  assert.equal(billDateColumn('b'), 'b.created_at');
  const db = stubDb();
  await buildReport(db, 'sales', range('2026-08-01', '2026-08-07'), {});
  const billQueries = db.statements.filter((s) => /FROM bills b/.test(s.sql));
  assert.ok(billQueries.length > 0);
  for (const { sql } of billQueries) {
    assert.equal(
      /COALESCE\(\s*b\.paid_at/.test(sql),
      false,
      'anchoring on paid_at moves late-night covers into the next day'
    );
  }
});

/* ---- payments: both storage paths, bucketed not enumerated -------- */

test('payment figures read both bill_payments and bill_payment_allocations', () => {
  const sql = paymentsUnionSql();
  assert.match(sql, /FROM bill_payment_allocations/);
  assert.match(sql, /FROM bill_payments/);
  assert.match(sql, /NOT EXISTS \(SELECT 1 FROM bill_payment_allocations/, 'no bill may be counted twice');
});

test('non-cash, non-credit methods are all reported as digital rather than dropped', () => {
  for (const method of ['qr', 'card', 'esewa', 'khalti', 'fonepay', 'bank_transfer', 'something_new']) {
    assert.equal(paymentBucket(method), 'digital', `${method} must be reported somewhere`);
  }
  assert.equal(paymentBucket('cash'), 'cash');
  for (const method of ['credit', 'due', 'unpaid']) assert.equal(paymentBucket(method), 'credit');
  for (const method of ['owner_pocket', 'business_funding']) assert.equal(paymentBucket(method), 'funding');
});

test('payment filter buckets treat qr and bank_transfer as the same Online option', async () => {
  const { normalizePaymentFilterBucket, paymentColumnMatchesBucketSql } = await import('@/lib/report-scope.js');
  assert.equal(normalizePaymentFilterBucket('online'), 'digital');
  assert.equal(normalizePaymentFilterBucket('qr'), 'digital');
  assert.equal(normalizePaymentFilterBucket('bank_transfer'), 'digital');
  assert.equal(normalizePaymentFilterBucket('cash'), 'cash');
  assert.equal(normalizePaymentFilterBucket('credit'), 'credit');
  assert.equal(normalizePaymentFilterBucket('owner_pocket'), 'funding');
  const sql = paymentColumnMatchesBucketSql('e.payment_method', 'digital');
  assert.match(sql, /NOT IN/);
  assert.match(sql, /'cash'/);
});

test('the received KPIs are built from both payment paths, not an allow-list', async () => {
  const db = stubDb();
  await buildReport(db, 'sales', range('2026-08-01', '2026-08-07'), {});
  const received = db.statements.find((s) => s.sql.includes('AS bucket'));
  assert.ok(received, 'received money is bucketed, not enumerated');
  assert.match(received.sql, /FROM bill_payment_allocations/);
  assert.match(received.sql, /FROM bill_payments/);
  assert.equal(
    /method IN \('cash','qr'\)/.test(received.sql),
    false,
    'an allow-list of two literals reported card and eSewa nowhere at all'
  );
});

test('received KPIs and the payment breakdown sum to the same number', async () => {
  // One bill settled across four methods, of which only one is cash and none is QR.
  const payments = [
    { method: 'cash', amount: 100, count: 1 },
    { method: 'card', amount: 200, count: 1 },
    { method: 'esewa', amount: 300, count: 1 },
    { method: 'credit', amount: 400, count: 1 },
  ];
  const db = stubDb([
    // the breakdown chart
    ['GROUP BY pay.method', payments],
    // the bucketed KPI query over the same rows
    ['AS bucket', [
      { bucket: 'cash', amount: 100 },
      { bucket: 'digital', amount: 500 },
      { bucket: 'credit', amount: 400 },
    ]],
  ]);
  const report = await buildReport(db, 'sales', range('2026-08-01', '2026-08-07'), {});
  const kpi = (key) => Number(report.kpis.find((k) => k.key === key)?.value || 0);

  const breakdown = report.charts.byPayment.reduce((s, r) => s + Number(r.value || 0), 0);
  const kpiSum = kpi('cash_received') + kpi('digital_received') + kpi('credit_sales');

  assert.equal(breakdown, 1000);
  assert.equal(kpiSum, 1000, 'the KPI row and the breakdown beneath it must agree');
});

test('money received excludes payments taken against a voided bill', async () => {
  const db = stubDb();
  await buildReport(db, 'sales', range('2026-08-01', '2026-08-07'), {});
  const received = db.statements.find((s) => s.sql.includes('AS bucket'));
  assert.ok(received);
  assert.match(
    received.sql,
    /JOIN bills b ON b\.id = pay\.bill_id/,
    'reading the payment tables alone counts cash from bills that were later voided'
  );
  assert.match(received.sql, /'partially_paid'/, 'and it must apply the shared counted-bill scope');
});

/* ---- resilience on an install that never used a feature ---------- */

const OPTIONAL = /recipes|recipe_items|stock_movements|wastage_log|bill_corrections|bill_payment_allocations|customer_ledger|business_days|purchases|journal_/;

test('every report renders when the optional tables do not exist', async () => {
  const exploding = {
    driver: 'sqlite',
    async all(sql) { if (OPTIONAL.test(sql)) throw new Error('no such table'); return []; },
    async get(sql) { if (OPTIONAL.test(sql)) throw new Error('no such table'); return {}; },
  };
  for (const tab of REPORT_TABS) {
    const report = await buildReport(exploding, tab, range('2026-08-01', '2026-08-07'), {});
    assert.ok(report, `${tab} must render on an install that never used these features`);
    assert.ok(Array.isArray(report.kpis), `${tab} must still return KPIs`);
  }
});

test('a report renders even when every single query fails', async () => {
  const dead = {
    driver: 'sqlite',
    async all() { throw new Error('database is locked'); },
    async get() { throw new Error('database is locked'); },
  };
  for (const tab of REPORT_TABS) {
    const report = await buildReport(dead, tab, range('2026-08-01', '2026-08-07'), {});
    assert.ok(Array.isArray(report.kpis), `${tab} degrades to an empty report, never a 500`);
  }
});

/* ---- cashier whitelist ------------------------------------------- */

test('the cashier tab list is a real subset that withholds the financial reports', () => {
  for (const tab of CASHIER_REPORT_TABS) {
    assert.ok(REPORT_TABS.includes(tab), `${tab} must be a real report`);
  }
  assert.ok(CASHIER_REPORT_TABS.length < REPORT_TABS.length, 'a cashier sees fewer reports than an admin');
  for (const sensitive of ['finance', 'suppliers', 'customers', 'employees']) {
    assert.equal(CASHIER_REPORT_TABS.includes(sensitive), false, `${sensitive} is admin-only`);
    assert.ok(ADMIN_ONLY_REPORT_TABS.includes(sensitive));
  }
  assert.deepEqual(
    [...CASHIER_REPORT_TABS, ...ADMIN_ONLY_REPORT_TABS].sort(),
    [...REPORT_TABS].sort(),
    'every tab is either cashier-visible or admin-only, none unclassified'
  );
  assert.deepEqual(allowedReportTabs('admin'), REPORT_TABS);
  assert.deepEqual(allowedReportTabs('cashier'), CASHIER_REPORT_TABS);
  assert.deepEqual(allowedReportTabs(undefined), CASHIER_REPORT_TABS, 'unknown roles get the narrow list');
});

test('cashier report tabs can be granted and revoked independently', () => {
  const enabled = new Set(['report.sales.view', 'report.finance.view']);
  const allowed = allowedReportTabs('cashier', (permission) => enabled.has(permission));
  assert.ok(allowed.includes('sales'));
  assert.ok(allowed.includes('overview'), 'the internal overview follows sales access');
  assert.ok(allowed.includes('finance'));
  assert.equal(allowed.includes('orders'), false);
  assert.equal(allowed.includes('customers'), false);
});

/* ---- one word, one meaning --------------------------------------- */

test('no profit figure is labelled just "Profit"', async () => {
  for (const tab of ['overview', 'finance', 'menu', 'sales']) {
    const report = await buildReport(stubDb(), tab, range('2026-08-01', '2026-08-07'), {});
    const tables = report.tables || (report.table ? [report.table] : []);
    const labels = [
      ...(report.kpis || []).map((k) => k.label),
      ...tables.flatMap((t) => (t.columns || []).map((c) => c.label)),
    ].filter(Boolean);
    for (const label of labels.filter((l) => /profit/i.test(l))) {
      assert.notEqual(
        label.trim().toLowerCase(),
        'profit',
        `"${label}" on the ${tab} tab must name the deduction it makes`
      );
    }
  }
});

test('reports that show profit say which deduction they made and point at the other', async () => {
  for (const tab of ['overview', 'finance']) {
    const report = await buildReport(stubDb(), tab, range('2026-08-01', '2026-08-07'), {});
    const notes = (report.notes || []).join(' ');
    assert.match(notes, /food cost/i, `${tab} must explain the food-cost basis`);
    assert.match(notes, /Finance tab|Overview tab/, `${tab} must point at the other definition`);
  }
});

test('every report states the basis on which bills were counted', async () => {
  for (const tab of ['overview', 'sales', 'finance']) {
    const report = await buildReport(stubDb(), tab, range('2026-08-01', '2026-08-07'), {});
    const notes = (report.notes || []).join(' ');
    assert.match(notes, /partially paid/i, `${tab} must say how partially paid bills are treated`);
    assert.match(notes, /Voided and cancelled bills are excluded/, `${tab} must say what is left out`);
  }
});

test('the sales tab bands its KPIs instead of showing a flat wall of money', async () => {
  const report = await buildReport(stubDb(), 'sales', range('2026-08-01', '2026-08-07'), {});
  assert.ok(report.kpiGroups?.length >= 3, 'fourteen money figures need grouping');
  const grouped = report.kpiGroups.flatMap((g) => g.keys);
  for (const kpi of report.kpis) {
    assert.ok(grouped.includes(kpi.key), `${kpi.key} must sit in a named group`);
  }
  for (const group of report.kpiGroups) {
    assert.ok(group.title, 'each band names the question it answers');
    assert.ok(group.caption, 'each band explains itself in one line');
  }
});

test('the two "Net Sales" figures do not share a label, because they deduct differently', async () => {
  const { composeAnalytics } = await import('@/lib/analytics.js');
  const analytics = await composeAnalytics(
    { driver: 'sqlite', async all() { return []; }, async get() { return {}; } },
    range('2026-08-01', '2026-08-07'),
    {},
    {}
  );
  const analyticsLabel = analytics.primaryKpis.find((k) => k.key === 'net_sales').label;
  const report = await buildReport(stubDb(), 'sales', range('2026-08-01', '2026-08-07'), {});
  const reportLabel = report.kpis.find((k) => k.key === 'net').label;

  // Analytics: billed total - refunds (tax still in).
  // Reports:   billed total - tax - refunds.
  assert.notEqual(analyticsLabel, reportLabel, 'same name for different arithmetic is the bug');
  assert.match(reportLabel, /excl\. tax/i);
  assert.match(analyticsLabel, /after refunds/i);
});

/* ---- filters: declared support must match reality ----------------- */

const SAMPLE_FILTERS = {
  businessDayId: 7,
  employeeId: 3,
  paymentMethod: 'cash',
  orderType: 'dine_in',
  search: 'abc',
};

/** Records the SQL+params a builder emits, so we can tell if a filter bound. */
function recorder() {
  const seen = [];
  return {
    driver: 'sqlite',
    seen,
    async all(sql, params = []) { seen.push(`${sql}||${JSON.stringify(params)}`); return []; },
    async get(sql, params = []) { seen.push(`${sql}||${JSON.stringify(params)}`); return {}; },
  };
}

test('every filter a tab declares actually reaches its queries', async () => {
  const window = range('2026-08-01', '2026-08-07');
  const wrong = [];
  for (const tab of REPORT_TABS) {
    const base = recorder();
    await buildReport(base, tab, window, {});
    const baseline = base.seen.join('|');
    for (const [name, value] of Object.entries(SAMPLE_FILTERS)) {
      const probe = recorder();
      await buildReport(probe, tab, window, { [name]: value });
      const reaches = probe.seen.join('|') !== baseline;
      const declared = supportedFilters(tab).includes(name);
      if (reaches !== declared) {
        wrong.push(`${tab}.${name}: ${declared ? 'declared but ignored' : 'applied but undeclared'}`);
      }
    }
  }
  assert.deepEqual(wrong, [], 'a filter that silently does nothing destroys trust in the whole report');
});

test('the tabs that cannot honour a filter say why', () => {
  const all = Object.keys(SAMPLE_FILTERS);
  for (const [tab, supported] of Object.entries(FILTER_SUPPORT)) {
    for (const key of supported) {
      assert.ok(all.includes(key), `${tab} declares unknown filter ${key}`);
    }
    if (supported.length < all.length) {
      assert.ok(
        FILTER_UNAVAILABLE_REASON[tab],
        `${tab} withholds filters and must explain why on the disabled control`
      );
    }
  }
});

test('search narrows the inventory, reservations and suppliers reports', async () => {
  const window = range('2026-08-01', '2026-08-07');
  for (const tab of ['inventory', 'reservations', 'suppliers']) {
    const probe = recorder();
    await buildReport(probe, tab, window, { search: 'momo' });
    assert.ok(
      probe.seen.some((s) => s.includes('%momo%')),
      `${tab} must pass the search term to the database`
    );
  }
});

/* ---- outstanding dues: two questions, not two answers -------------- */

test('outstanding dues are split by whether a credit account exists', async () => {
  const db = stubDb([
    ['COALESCE(SUM(outstanding_amount), 0) AS amount', [{
      amount: 1500, customer_amount: 700, walkin_amount: 800, bills: 3,
    }]],
  ]);
  const report = await buildReport(db, 'sales', range('2026-08-01', '2026-08-07'), {});
  const r = report.reconciliation;

  assert.equal(r.outstandingReceivables, 1500);
  assert.equal(r.outstandingFromCustomers, 700);
  assert.equal(r.outstandingFromWalkIns, 800);
  assert.equal(
    r.outstandingFromCustomers + r.outstandingFromWalkIns,
    r.outstandingReceivables,
    'the split must account for the whole balance'
  );

  const kpi = report.kpis.find((k) => k.key === 'receivables');
  assert.match(kpi.hint, /Customer Ledger/, 'must explain why it can exceed the Customer Ledger figure');
});
