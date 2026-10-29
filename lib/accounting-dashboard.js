/**
 * Owner finance dashboard — money at a glance from the ledger (Nepal dates).
 */

import { accountBalance } from './accounting.js';
import { profitAndLoss } from './accounting-reports.js';
import { nepalDateString } from './report-dates.js';
import { currentBusinessDay } from './business-days.js';
import { ensureColumn } from './db/schema-helpers.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (n) => Number(n || 0);

function addNepalDays(ymd, delta) {
  const d = new Date(`${ymd}T12:00:00+05:45`);
  d.setDate(d.getDate() + delta);
  return nepalDateString(d);
}

export async function financeDashboard(db) {
  await ensureColumn(db, 'expenses', 'status', "TEXT DEFAULT 'active'").catch(() => {});
  const today = nepalDateString(new Date());
  const activeBusinessDay = await currentBusinessDay(db);
  const activeBusinessDayId = activeBusinessDay?.id || null;
  const weekStart = addNepalDays(today, -6);
  const monthStart = `${today.slice(0, 7)}-01`;

  const [pnlToday, pnlWeek, pnlMonth] = await Promise.all([
    activeBusinessDayId ? profitAndLoss(db, { businessDayId: activeBusinessDayId }) : profitAndLoss(db, { from: today, to: today }),
    profitAndLoss(db, { from: weekStart, to: today }),
    profitAndLoss(db, { from: monthStart, to: today }),
  ]);

  const salesOf = (pnl) => round2(pnl.income.find((i) => i.code === '4010')?.amount || pnl.totalIncome || 0);

  const [cash, bank, apRaw, arRaw, invRaw] = await Promise.all([
    accountBalance(db, '1010'),
    accountBalance(db, '1020'),
    accountBalance(db, '2010'),
    accountBalance(db, '1300'),
    accountBalance(db, '1200').catch(() => 0),
  ]);

  const topCats = await db.all(
    `SELECT category, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n
     FROM expenses WHERE ${activeBusinessDayId ? 'business_day_id = ?' : 'expense_date = ?'}
       AND LOWER(COALESCE(status,'active'))<>'voided' AND COALESCE(category, '') <> ''
     GROUP BY category ORDER BY total DESC LIMIT 5`,
    [activeBusinessDayId || today]
  );

  const salesSeries = await db.all(
    `SELECT je.entry_date AS d, COALESCE(SUM(jl.credit - jl.debit), 0) AS sales
     FROM journal_lines jl
     JOIN journal_entries je ON jl.journal_id = je.id
     JOIN accounts a ON jl.account_id = a.id
     WHERE a.code = '4010' AND je.entry_date >= ?
     GROUP BY je.entry_date ORDER BY d`,
    [weekStart]
  );

  const recentLarge = await db.all(
    `SELECT je.id, je.entry_date, je.memo, je.source_type,
            (SELECT COALESCE(SUM(debit),0) FROM journal_lines WHERE journal_id = je.id) AS amount
     FROM journal_entries je
     ORDER BY je.id DESC
     LIMIT 40`
  ).catch(() => []);

  const large = (recentLarge || [])
    .filter((r) => num(r.amount) >= 5000)
    .slice(0, 8)
    .map((r) => ({
      id: r.id,
      date: r.entry_date,
      memo: r.memo,
      source: r.source_type,
      amount: round2(r.amount),
    }));

  const cashInOut = await db.get(
    `SELECT
       COALESCE(SUM(CASE WHEN je.source_type='reversal' THEN -jl.credit ELSE jl.debit END), 0) AS cash_in,
       COALESCE(SUM(CASE WHEN je.source_type='reversal' THEN -jl.debit ELSE jl.credit END), 0) AS cash_out
     FROM journal_lines jl
     JOIN journal_entries je ON je.id = jl.journal_id
     LEFT JOIN journal_entries original ON je.source_type='reversal' AND original.id=je.source_id
     JOIN accounts a ON a.id = jl.account_id
     WHERE a.code = '1010' AND ${activeBusinessDayId ? 'je.business_day_id = ?' : 'je.entry_date = ?'}`,
    [activeBusinessDayId || today]
  ).catch(() => ({ cash_in: 0, cash_out: 0 }));

  return {
    today: activeBusinessDay?.business_date || today,
    business_day_id: activeBusinessDayId,
    sales_today: salesOf(pnlToday),
    sales_week: salesOf(pnlWeek),
    sales_month: salesOf(pnlMonth),
    expenses_today: round2(pnlToday.totalExpense),
    expenses_month: round2(pnlMonth.totalExpense),
    profit_today: round2(pnlToday.netProfit),
    profit_month: round2(pnlMonth.netProfit),
    gross_profit_today: round2(pnlToday.totalIncome - (pnlToday.expense.find((e) => e.code === '5010')?.amount || 0)),
    cash_in_drawer: round2(cash),
    bank_balance: round2(bank),
    outstanding_ap: round2(-apRaw),
    outstanding_ar: round2(arRaw),
    inventory_value: round2(invRaw),
    cash_in_today: round2(cashInOut?.cash_in),
    cash_out_today: round2(cashInOut?.cash_out),
    top_expense_categories: topCats.map((r) => ({ category: r.category, total: round2(r.total), count: num(r.n) })),
    sales_trend: salesSeries.map((r) => ({ date: String(r.d).slice(0, 10), sales: round2(r.sales) })),
    recent_large_transactions: large,
  };
}
