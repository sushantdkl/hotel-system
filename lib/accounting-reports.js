/**
 * Financial statements — Trial Balance, Profit & Loss, Balance Sheet.
 *
 * All read-only: every number is derived from journal_lines. No balances are
 * stored, so these can never drift from the ledger. The one primitive is
 * accountSums(): per-account debit/credit totals within a date window; the
 * three statements are just different framings of it.
 */

const num = (n) => Number(n || 0);
const round2 = (n) => Math.round(num(n) * 100) / 100;

/**
 * Per-account debit/credit totals. Only lines whose journal falls in the window
 * are summed (the join is filtered inside a subquery so accounts with no
 * in-range activity still return zero rather than leaking out-of-range totals).
 */
async function accountSums(db, { from = null, to = null, businessDayId = null } = {}) {
  const params = [];
  let dateWhere = '1=1';
  if (from) { dateWhere += ' AND je.entry_date >= ?'; params.push(from); }
  if (to) { dateWhere += ' AND je.entry_date <= ?'; params.push(to); }
  if (businessDayId) { dateWhere += ' AND je.business_day_id = ?'; params.push(businessDayId); }
  const rows = await db.all(
    `SELECT a.id, a.code, a.name, a.type, a.subtype, a.parent_id,
       COALESCE(m.d, 0) AS debit, COALESCE(m.c, 0) AS credit
     FROM accounts a
     LEFT JOIN (
       SELECT jl.account_id, SUM(jl.debit) AS d, SUM(jl.credit) AS c
       FROM journal_lines jl JOIN journal_entries je ON jl.journal_id = je.id
       WHERE ${dateWhere}
       GROUP BY jl.account_id
     ) m ON m.account_id = a.id
     ORDER BY a.code`,
    params
  );
  return rows.map((r) => ({ ...r, debit: num(r.debit), credit: num(r.credit) }));
}

/** Debit-normal accounts (asset/expense) carry a positive balance as debit-credit. */
const DEBIT_NORMAL = new Set(['asset', 'expense']);
const signed = (r) => (DEBIT_NORMAL.has(r.type) ? r.debit - r.credit : r.credit - r.debit);

/** Trial Balance as of `to`. Total debits must equal total credits. */
export async function trialBalance(db, { to = null } = {}) {
  const rows = await accountSums(db, { to });
  const lines = rows
    .map((r) => {
      const bal = round2(r.debit - r.credit); // raw debit-credit
      return { code: r.code, name: r.name, type: r.type, debit: bal > 0 ? bal : 0, credit: bal < 0 ? -bal : 0 };
    })
    .filter((l) => l.debit !== 0 || l.credit !== 0);
  const totalDebit = round2(lines.reduce((s, l) => s + l.debit, 0));
  const totalCredit = round2(lines.reduce((s, l) => s + l.credit, 0));
  return { lines, totalDebit, totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.01 };
}

/** Profit & Loss for [from, to]. Income minus expense = net profit. */
export async function profitAndLoss(db, { from = null, to = null, businessDayId = null } = {}) {
  const rows = await accountSums(db, { from, to, businessDayId });
  const income = rows
    .filter((r) => r.type === 'income' && r.parent_id)
    .map((r) => ({ code: r.code, name: r.name, amount: round2(r.credit - r.debit) }))
    .filter((r) => r.amount !== 0);
  const expense = rows
    .filter((r) => r.type === 'expense' && r.parent_id)
    .map((r) => ({ code: r.code, name: r.name, amount: round2(r.debit - r.credit) }))
    .filter((r) => r.amount !== 0);
  const totalIncome = round2(income.reduce((s, r) => s + r.amount, 0));
  const totalExpense = round2(expense.reduce((s, r) => s + r.amount, 0));
  return { income, expense, totalIncome, totalExpense, netProfit: round2(totalIncome - totalExpense) };
}

/**
 * Balance Sheet as of `to`. Because income/expense are never closed to equity,
 * current-period earnings (income - expense to date) are shown within equity so
 * that Assets = Liabilities + Equity holds exactly.
 */
export async function balanceSheet(db, { to = null } = {}) {
  const rows = await accountSums(db, { to });
  const pick = (type) =>
    rows
      .filter((r) => r.type === type && r.parent_id)
      .map((r) => ({ code: r.code, name: r.name, amount: round2(signed(r)) }))
      .filter((r) => r.amount !== 0);

  const assets = pick('asset');
  const liabilities = pick('liability');
  const equityAccounts = pick('equity');

  const totalIncome = round2(rows.filter((r) => r.type === 'income').reduce((s, r) => s + (r.credit - r.debit), 0));
  const totalExpense = round2(rows.filter((r) => r.type === 'expense').reduce((s, r) => s + (r.debit - r.credit), 0));
  const currentEarnings = round2(totalIncome - totalExpense);

  const equity = [...equityAccounts, { code: '—', name: 'Current earnings', amount: currentEarnings }].filter((r) => r.amount !== 0);

  const totalAssets = round2(assets.reduce((s, r) => s + r.amount, 0));
  const totalLiabilities = round2(liabilities.reduce((s, r) => s + r.amount, 0));
  const totalEquity = round2(equity.reduce((s, r) => s + r.amount, 0));

  return {
    assets,
    liabilities,
    equity,
    totalAssets,
    totalLiabilities,
    totalEquity,
    balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
  };
}

/**
 * Cash-flow style statement from movements across every liquid account in the
 * date window, classified by journal source_type.
 *
 * The account set matters: bill settlement posts card to 1100, eSewa to 1110,
 * Khalti to 1120, QR/Fonepay to 1130 and other online to 1140 (see
 * PAYMENT_ACCOUNTS in lib/accounting.js). Counting only 1010/1020 dropped every
 * digital receipt from the statement, which in this market is most of the
 * takings. Same set lib/summary-report.js treats as cash + bank.
 */
const LIQUID_CODES = ['1010', '1020', '1100', '1110', '1120', '1130', '1140'];
const LIQUID_CODES_SQL = LIQUID_CODES.map((c) => `'${c}'`).join(',');
export async function cashFlowStatement(db, { from = null, to = null, businessDayId = null } = {}) {
  const params = [];
  let dateWhere = '1=1';
  if (from) { dateWhere += ' AND je.entry_date >= ?'; params.push(from); }
  if (to) { dateWhere += ' AND je.entry_date <= ?'; params.push(to); }
  if (businessDayId) { dateWhere += ' AND je.business_day_id = ?'; params.push(businessDayId); }

  const rows = await db.all(
    `SELECT COALESCE(original.source_type,je.source_type) AS source_type,
            COALESCE(original.memo,je.memo) AS memo,
            SUM(CASE WHEN je.source_type='reversal' THEN -jl.credit ELSE jl.debit END) AS inflow,
            SUM(CASE WHEN je.source_type='reversal' THEN -jl.debit ELSE jl.credit END) AS outflow
     FROM journal_lines jl
     JOIN journal_entries je ON je.id = jl.journal_id
     LEFT JOIN journal_entries original ON je.source_type='reversal' AND original.id=je.source_id
     JOIN accounts a ON a.id = jl.account_id
     WHERE a.code IN (${LIQUID_CODES_SQL}) AND ${dateWhere}
     GROUP BY COALESCE(original.source_type,je.source_type),COALESCE(original.memo,je.memo)
     ORDER BY inflow DESC, outflow DESC`,
    params
  );

  const classify = (source) => {
    const s = String(source || '').toLowerCase();
    if (/(sale|bill_payment|credit_collect|walk.?in|pos)/.test(s)) return 'operating';
    if (/(purchase|supplier|expense|payroll|salary|rent|utility)/.test(s)) return 'operating';
    if (/(inventory|stock|cogs)/.test(s)) return 'operating';
    if (/(loan|owner|capital|equity|draw)/.test(s)) return 'financing';
    if (/(bank_transfer|deposit|withdraw|settlement)/.test(s)) return 'investing';
    return 'operating';
  };

  const buckets = {
    operating: { inflows: [], outflows: [], net: 0 },
    investing: { inflows: [], outflows: [], net: 0 },
    financing: { inflows: [], outflows: [], net: 0 },
  };

  for (const r of rows || []) {
    const bucket = classify(r.source_type);
    const inflow = round2(r.inflow);
    const outflow = round2(r.outflow);
    const label = r.memo || r.source_type || 'Other';
    if (inflow > 0) buckets[bucket].inflows.push({ name: label, amount: inflow, source: r.source_type });
    if (outflow > 0) buckets[bucket].outflows.push({ name: label, amount: outflow, source: r.source_type });
    buckets[bucket].net = round2(buckets[bucket].net + inflow - outflow);
  }

  /*
   * Rows are grouped by memo, and memos are largely free text ("Bill INV-1043"),
   * so a wide date range produced one line per transaction — thousands of rows
   * rendered as a "statement". Show the material lines and roll the tail into a
   * single summarised row. Bucket nets are computed above and are unaffected.
   */
  const LINE_LIMIT = 25;
  const condense = (lines) => {
    if (lines.length <= LINE_LIMIT) return lines.sort((a, b) => b.amount - a.amount);
    const sorted = lines.slice().sort((a, b) => b.amount - a.amount);
    const head = sorted.slice(0, LINE_LIMIT);
    const tail = sorted.slice(LINE_LIMIT);
    head.push({
      name: `Other (${tail.length} smaller entries)`,
      amount: round2(tail.reduce((sum, l) => sum + l.amount, 0)),
      source: 'aggregated',
    });
    return head;
  };
  for (const bucket of Object.values(buckets)) {
    bucket.inflows = condense(bucket.inflows);
    bucket.outflows = condense(bucket.outflows);
  }

  const netChange = round2(
    buckets.operating.net + buckets.investing.net + buckets.financing.net
  );

  return {
    from,
    to,
    operating: buckets.operating,
    investing: buckets.investing,
    financing: buckets.financing,
    netChange,
  };
}
