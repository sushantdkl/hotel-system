/**
 * Throwaway probe: build every report × every period and print what happened.
 *
 *   DB_NAME=dev.db node scripts/probe-reports.mjs
 *   DB_NAME=fresh.db node scripts/probe-reports.mjs --fresh
 *
 * `--fresh` deletes the database file first, so the run exercises a brand new
 * install created from the shipped base schema — the case where lazily-created
 * tables (refunds, split payments, recipes, stock movements, the journal) do
 * not exist yet.
 */
import fs from 'node:fs';
import path from 'node:path';

const fresh = process.argv.includes('--fresh');
const dbFile = path.join(process.cwd(), 'databases', process.env.DB_NAME || 'dev.db');
if (fresh) {
  for (const suffix of ['', '-wal', '-shm']) {
    const f = `${dbFile}${suffix}`;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

const { default: Database } = await import('../lib/db/index.js');
const {
  buildReport, REPORT_TABS, getFilterOptions, ensureReportSchema, supportedFilters,
} = await import('../lib/reports.js');
const { resolvePeriodRange } = await import('../lib/report-dates.js');
const { composeAnalytics } = await import('../lib/analytics.js');
const { buildSummaryReport } = await import('../lib/summary-report.js');
const { trialBalance, profitAndLoss, balanceSheet, cashFlowStatement } = await import('../lib/accounting-reports.js');
const { kitchenAnalytics } = await import('../lib/kitchen-analytics.js');

const db = Database.getInstance();

const PERIODS = ['today', 'yesterday', 'last7', 'this_month', 'last_month', 'year', 'week', 'month'];
const CUSTOM = { period: 'custom', startDate: '2020-01-01', endDate: '2030-12-31' };

const results = [];
let failures = 0;

async function probe(name, fn) {
  const started = Date.now();
  try {
    const value = await fn();
    results.push({ name, ok: true, ms: Date.now() - started, value });
  } catch (error) {
    failures += 1;
    results.push({ name, ok: false, ms: Date.now() - started, error: `${error.message}` });
  }
}

const money = (n) => (Number(n) || 0).toFixed(2);
const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);
const kpi = (report, key) => report.kpis?.find((k) => k.key === key)?.value;

if (typeof ensureReportSchema === 'function') {
  await probe('ensureReportSchema', async () => {
    await ensureReportSchema(db);
    return 'prepared';
  });
}

/* ---- reports hub: every tab × every period ---------------------- */
for (const period of PERIODS) {
  const range = resolvePeriodRange(period);
  for (const tab of REPORT_TABS) {
    await probe(`reports/${tab}/${period}`, async () => {
      const report = await buildReport(db, tab, range, {});
      const tables = report.tables || (report.table ? [report.table] : []);
      return [
        `kpis=${report.kpis?.length ?? 0}`,
        `charts=${Object.keys(report.charts || {}).length}`,
        `rows=${tables.reduce((s, t) => s + (t.rows?.length || 0), 0)}`,
        report.kpis?.[0] ? `${report.kpis[0].key}=${money(report.kpis[0].value)}` : '',
      ].filter(Boolean).join(' ');
    });
  }
}

/* ---- reports hub: a wide custom range + filters ------------------ */
{
  const range = resolvePeriodRange(CUSTOM.period, CUSTOM.startDate, CUSTOM.endDate);
  for (const tab of REPORT_TABS) {
    await probe(`reports/${tab}/all-time`, async () => {
      const report = await buildReport(db, tab, range, {});
      return `kpis=${report.kpis?.length ?? 0}`;
    });
  }
  await probe('reports/filter-options', async () => {
    const options = await getFilterOptions(db);
    return `employees=${options.employees.length} categories=${options.categories.length} methods=${options.paymentMethods.join('|') || 'none'}`;
  });
  await probe('reports/sales/filtered', async () => {
    const report = await buildReport(db, 'sales', range, { paymentMethod: 'cash', orderType: 'dine_in', search: 'a' });
    return `kpis=${report.kpis?.length ?? 0}`;
  });
  await probe('reports/sales/business-day', async () => {
    const day = await db.get('SELECT id FROM business_days ORDER BY id DESC LIMIT 1').catch(() => null);
    if (!day) return 'no business days in this database';
    const report = await buildReport(db, 'sales', range, { businessDayId: day.id });
    return `businessDay=${day.id} kpis=${report.kpis?.length ?? 0}`;
  });
}

/* ---- reconciliation: KPI vs the breakdown beneath it ------------- */
await probe('RECONCILE sales: received KPIs vs payment breakdown', async () => {
  const range = resolvePeriodRange('custom', CUSTOM.startDate, CUSTOM.endDate);
  const report = await buildReport(db, 'sales', range, {});
  const breakdown = (report.charts?.byPayment || []).reduce((s, r) => s + Number(r.value || 0), 0);
  const collected = Number(kpi(report, 'cash_received') || 0)
    + Number(kpi(report, 'digital_received') || 0)
    + Number(kpi(report, 'credit_sales') || 0);
  const delta = Math.abs(breakdown - collected);
  return `breakdown=${money(breakdown)} kpiSum=${money(collected)} delta=${money(delta)}${delta > 0.01 ? '  <== MISMATCH' : ''}`;
});

await probe('RECONCILE sales: item sales - discounts = net item sales', async () => {
  const range = resolvePeriodRange('custom', CUSTOM.startDate, CUSTOM.endDate);
  const report = await buildReport(db, 'sales', range, {});
  const gross = Number(kpi(report, 'gross') || 0);
  const disc = Number(kpi(report, 'discounts') || 0);
  const net = Number(kpi(report, 'net_item_sales') || 0);
  const delta = Math.abs(gross - disc - net);
  return `${money(gross)} - ${money(disc)} = ${money(net)} delta=${money(delta)}${delta > 0.01 ? '  <== MISMATCH' : ''}`;
});

/*
 * The bills basis and the journal basis must differ by exactly the amount the
 * two definitions explain — never by an unexplained residue.
 *
 *   billed total - still unpaid - refunds  ==  journal revenue.net
 *
 * Reports counts what was BILLED; the Summary Report counts what was POSTED to
 * the ledger, which is money actually received less reversals. Skipped when the
 * journal is empty (nothing has been posted yet), because then the difference
 * is the whole of revenue and says nothing.
 */
await probe('RECONCILE bills basis vs journal basis', async () => {
  const wide = resolvePeriodRange('custom', CUSTOM.startDate, CUSTOM.endDate);
  const entries = await db.get('SELECT COUNT(*) AS c FROM journal_entries').catch(() => ({ c: 0 }));
  if (!num(entries?.c)) return 'skipped — nothing posted to the ledger on this database';

  const sales = await buildReport(db, 'sales', wide, {});
  const summary = await buildSummaryReport(db, { start: wide.start, end: wide.end });
  const k = (key) => Number(sales.kpis.find((x) => x.key === key)?.value || 0);

  const expected = k('billed_total') - k('receivables') - k('refunds');
  const actual = Number(summary.revenue?.net || 0);
  const delta = Math.abs(expected - actual);
  return `billed ${money(k('billed_total'))} - unpaid ${money(k('receivables'))} - refunds ${money(k('refunds'))}`
    + ` = ${money(expected)} vs ledger ${money(actual)} delta=${money(delta)}`
    + (delta > 0.01 ? '  <== UNEXPLAINED' : '');
});

await probe('RECONCILE the ledger balances itself', async () => {
  const row = await db.get('SELECT COALESCE(SUM(debit),0) AS d, COALESCE(SUM(credit),0) AS c FROM journal_lines')
    .catch(() => null);
  if (!row) return 'skipped — no journal on this database';
  const delta = Math.abs(num(row.d) - num(row.c));
  return `debits ${money(row.d)} vs credits ${money(row.c)} delta=${money(delta)}`
    + (delta > 0.01 ? '  <== OUT OF BALANCE' : '');
});

/* ---- every declared filter must actually reach the query ---------- */
/*
 * Can't diff results (a filter may legitimately match everything on small
 * data), so diff the SQL and params each builder emits with and without the
 * filter. Identical means the filter was dropped on the floor.
 */
await probe('FILTERS reach the query on every tab', async () => {
  const recorder = () => {
    const seen = [];
    return {
      driver: 'sqlite',
      seen,
      async all(sql, params = []) { seen.push(`${sql}||${JSON.stringify(params)}`); return []; },
      async get(sql, params = []) { seen.push(`${sql}||${JSON.stringify(params)}`); return {}; },
    };
  };
  const sample = {
    businessDayId: 7, employeeId: 3, categoryId: 2, foodGroup: 'beverage',
    paymentMethod: 'cash', orderType: 'dine_in', search: 'abc',
  };
  const filterRange = resolvePeriodRange('last7');
  const broken = [];
  for (const tab of REPORT_TABS) {
    const base = recorder();
    await buildReport(base, tab, filterRange, {});
    const baseline = base.seen.join('|');
    for (const [name, value] of Object.entries(sample)) {
      const one = recorder();
      await buildReport(one, tab, filterRange, { [name]: value });
      const reaches = one.seen.join('|') !== baseline;
      const declared = supportedFilters(tab).includes(name);
      if (reaches !== declared) {
        broken.push(`${tab}.${name} ${declared ? 'declared but ignored' : 'applied but undeclared'}`);
      }
    }
  }
  if (broken.length) throw new Error(broken.join('; '));
  return 'declaration matches behaviour on every tab/filter pair';
});

/* ---- other report surfaces --------------------------------------- */
for (const period of ['today', 'last7', 'this_month']) {
  const range = resolvePeriodRange(period);
  await probe(`analytics/${period}`, async () => {
    const data = await composeAnalytics(db, range, {}, {});
    return `sections=${Object.keys(data).length}`;
  });
  await probe(`summary-report/${period}`, async () => {
    const data = await buildSummaryReport(db, range);
    return `revenueNet=${money(data.revenue?.net)} profitNet=${money(data.profit?.net)}`;
  });
}

for (const [name, fn] of [
  ['financial/trial-balance', () => trialBalance(db, { to: '2030-12-31' })],
  ['financial/pnl', () => profitAndLoss(db, { from: '2020-01-01', to: '2030-12-31' })],
  ['financial/balance-sheet', () => balanceSheet(db, { to: '2030-12-31' })],
  ['financial/cash-flow', () => cashFlowStatement(db, { from: '2020-01-01', to: '2030-12-31' })],
]) {
  await probe(name, async () => {
    const report = await fn();
    if ('balanced' in report) {
      // Assert, don't just report: an unbalanced trial balance or balance sheet
      // means the double entry is broken, which is the whole point of deriving
      // these from journal_lines. This used to print `balanced=false` and pass.
      if (!report.balanced) {
        const detail = 'totalDebit' in report
          ? `debits ${money(report.totalDebit)} vs credits ${money(report.totalCredit)}`
          : `assets ${money(report.totalAssets)} vs liabilities+equity ${money(report.totalLiabilities + report.totalEquity)}`;
        throw new Error(`does not balance — ${detail}`);
      }
      return 'balanced';
    }
    if ('netProfit' in report) return `netProfit=${money(report.netProfit)}`;
    return `netChange=${money(report.netChange)}`;
  });
}

await probe('kitchen-analytics', async () => {
  const data = await kitchenAnalytics(db);
  return `orders=${data.orders_today} busiestHour=${data.busiest_hour}`;
});

/* ---- output ------------------------------------------------------ */
const width = Math.max(...results.map((r) => r.name.length));
for (const r of results) {
  const status = r.ok ? 'ok  ' : 'FAIL';
  const detail = r.ok ? r.value : r.error;
  console.log(`${status} ${r.name.padEnd(width)}  ${detail}`);
}
console.log(`\n${results.length - failures}/${results.length} passed` + (fresh ? ' (fresh empty database)' : ''));
process.exit(failures ? 1 : 0);
