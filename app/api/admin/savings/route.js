import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { accountBalance } from '@/lib/accounting.js';
import { createSavingsDeposit, ensureSavingsSchema } from '@/lib/savings.js';
import { nepalDateString } from '@/lib/report-dates.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
function shift(date, days) { const d = new Date(`${date}T12:00:00+05:45`); d.setDate(d.getDate() + days); return nepalDateString(d); }

async function period(db, start, end) {
  const row = await db.get(`SELECT COALESCE(SUM(amount),0) AS total,
    COALESCE(SUM(CASE WHEN source_account='cash' THEN amount ELSE 0 END),0) AS cash,
    COALESCE(SUM(CASE WHEN source_account='online' THEN amount ELSE 0 END),0) AS online,
    COUNT(*) AS count FROM savings_deposits WHERE status='active' AND deposit_date BETWEEN ? AND ?`, [start, end]);
  return { start, end, total: round2(row.total), cash: round2(row.cash), online: round2(row.online), count: Number(row.count || 0) };
}

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'savings.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensureSavingsSchema(db);
    const q = new URL(request.url).searchParams;
    const today = nepalDateString();
    const monthStart = `${today.slice(0, 7)}-01`;
    const from = q.get('from') || monthStart;
    const to = q.get('to') || today;
    const search = String(q.get('search') || '').trim().toLowerCase();
    const type = q.get('type') || 'all';
    const source = q.get('source') || 'all';
    const status = q.get('status') || 'active';
    const page = Math.max(1, Number(q.get('page')) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.get('pageSize')) || 50));
    const params = [from, to];
    let where = `d.deposit_date BETWEEN ? AND ?`;
    if (search) { where += ` AND (LOWER(d.destination_name) LIKE ? OR LOWER(COALESCE(d.reference_number,'')) LIKE ? OR LOWER(COALESCE(d.notes,'')) LIKE ?)`; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    if (type !== 'all') { where += ` AND d.deposit_type=?`; params.push(type); }
    if (source !== 'all') { where += ` AND d.source_account=?`; params.push(source); }
    if (status !== 'all') { where += ` AND d.status=?`; params.push(status); }
    const count = await db.get(`SELECT COUNT(*) AS n,COALESCE(SUM(d.amount),0) AS total FROM savings_deposits d WHERE ${where}`, params);
    const rows = await db.all(`SELECT d.*,u.full_name AS created_by_name FROM savings_deposits d LEFT JOIN users u ON u.id=d.created_by
      WHERE ${where} ORDER BY d.deposit_date DESC,d.id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, params);
    const periods = await Promise.all([period(db, today, today), period(db, shift(today, -2), today), period(db, shift(today, -6), today), period(db, monthStart, today)]);
    const clearing = await db.get(`SELECT COALESCE(SUM(jl.debit-jl.credit),0) AS balance FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id WHERE a.code IN ('1020','1100','1110','1120','1130','1140')`);
    return NextResponse.json({ rows, pagination: { page, pageSize, total: Number(count.n || 0), pages: Math.max(1, Math.ceil(Number(count.n || 0) / pageSize)) },
      listed_total: round2(count.total), periods: { today: periods[0], last3: periods[1], last7: periods[2], month: periods[3] },
      balances: { cash: round2(await accountBalance(db, '1010')), online: round2(clearing.balance), savings: round2(await accountBalance(db, '1040')) } });
  } catch (error) { return handleRouteError(error, 'Failed to load savings deposits.'); }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'savings.manage' });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const deposit = await createSavingsDeposit(db, await request.json(), auth.user?.id);
    return NextResponse.json({ message: 'Savings deposit recorded.', deposit }, { status: 201 });
  } catch (error) { return handleRouteError(error, 'Failed to record savings deposit.'); }
}
