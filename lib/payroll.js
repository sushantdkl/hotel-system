/**
 * Payroll + employee performance, both built on data the POS already keeps.
 *
 * Payroll: users.salary / hire_date / position + a salary_payments ledger.
 * Performance: no separate attendance table exists, so metrics are derived from
 * real activity — orders taken and their value (waiter_id on orders), bills
 * settled and revenue (cashier_id on bills), and wastage logged (employee_id on
 * wastage_log). "Attendance" is not tracked by the system, so it is reported as
 * activity (days with orders) rather than invented.
 */

import { ensureSqliteTable } from '@/lib/db/ensure-sqlite-table.js';
import { ensureColumn, serialPkSql } from '@/lib/db/schema-helpers.js';
import { ensureAccountingSchema, postJournal, currentDrawerId, deleteJournalBySource, primaryBankAccountId } from '@/lib/accounting.js';
import { currentBusinessDayId } from '@/lib/business-days.js';
import { nepalDateString } from '@/lib/report-dates.js';

export async function ensurePayrollSchema(db) {
  const pk = serialPkSql(db);
  await ensureColumn(db, 'users', 'salary', 'DOUBLE PRECISION');
  await ensureColumn(db, 'users', 'hire_date', 'DATE');
  await ensureColumn(db, 'users', 'position', 'TEXT');
  await ensureSqliteTable(
    db,
    `
    CREATE TABLE IF NOT EXISTS salary_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      period_label TEXT,
      paid_on DATE NOT NULL DEFAULT CURRENT_DATE,
      method TEXT DEFAULT 'cash',
      note TEXT,
      paid_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `
  );
  await ensureColumn(db, 'salary_payments', 'business_day_id', 'INTEGER');
  await ensureColumn(db, 'salary_payments', 'gross_amount', 'DOUBLE PRECISION');
  await ensureColumn(db, 'salary_payments', 'advance_deduction', 'DOUBLE PRECISION DEFAULT 0');
  await ensureSqliteTable(
    db,
    `CREATE TABLE IF NOT EXISTS salary_advances (
      ${pk}, employee_id INTEGER NOT NULL, amount REAL NOT NULL,
      advanced_on DATE NOT NULL DEFAULT CURRENT_DATE, method TEXT DEFAULT 'cash',
      note TEXT, given_by INTEGER, business_day_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`
  );
}

const positiveMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

export async function listPayrollOverview(db) {
  return db.all(`
    SELECT u.id, u.full_name, u.username, u.role, u.position, u.salary, u.is_active,
      COALESCE((SELECT SUM(a.amount) FROM salary_advances a WHERE a.employee_id = u.id), 0) AS total_advanced,
      COALESCE((SELECT SUM(p.advance_deduction) FROM salary_payments p WHERE p.employee_id = u.id), 0) AS total_deducted,
      COALESCE((SELECT SUM(a.amount) FROM salary_advances a WHERE a.employee_id = u.id), 0)
        - COALESCE((SELECT SUM(p.advance_deduction) FROM salary_payments p WHERE p.employee_id = u.id), 0) AS advance_outstanding,
      COALESCE((SELECT SUM(COALESCE(p.gross_amount, p.amount)) FROM salary_payments p WHERE p.employee_id = u.id), 0) AS total_salary_recorded,
      (SELECT MAX(p.paid_on) FROM salary_payments p WHERE p.employee_id = u.id) AS last_paid_on
    FROM users u
    ORDER BY CASE WHEN COALESCE(u.is_active, 0) = 1 THEN 0 ELSE 1 END, u.full_name, u.username
  `);
}

export async function advanceOutstanding(db, employeeId) {
  const row = await db.get(`
    SELECT
      COALESCE((SELECT SUM(amount) FROM salary_advances WHERE employee_id = ?), 0)
      - COALESCE((SELECT SUM(advance_deduction) FROM salary_payments WHERE employee_id = ?), 0) AS amount
  `, [employeeId, employeeId]);
  return Math.max(0, positiveMoney(row?.amount));
}

export async function listAdvances(db, employeeId = null) {
  const where = employeeId ? 'WHERE a.employee_id = ?' : '';
  return db.all(
    `SELECT a.*, u.full_name AS employee_name, u.username AS employee_username,
            giver.full_name AS given_by_name
     FROM salary_advances a
     LEFT JOIN users u ON a.employee_id = u.id
     LEFT JOIN users giver ON a.given_by = giver.id
     ${where}
     ORDER BY a.advanced_on DESC, a.id DESC`,
    employeeId ? [employeeId] : []
  );
}

export async function recordAdvance(db, data, givenBy = null) {
  const employeeId = Number(data.employee_id);
  const amount = positiveMoney(data.amount);
  if (!employeeId) throw Object.assign(new Error('Choose the employee receiving the advance.'), { status: 400 });
  if (!(amount > 0)) throw Object.assign(new Error('Advance amount must be greater than zero.'), { status: 400 });

  const employee = await db.get('SELECT id, full_name, username FROM users WHERE id = ?', [employeeId]);
  if (!employee) throw Object.assign(new Error('Employee not found.'), { status: 404 });

  await ensureAccountingSchema(db);
  const businessDayId = await currentBusinessDayId(db, { required: true });
  return db.transaction(async (tx) => {
    const result = await tx.run(
      `INSERT INTO salary_advances (employee_id, amount, advanced_on, method, note, given_by, business_day_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [employeeId, amount, data.advanced_on || nepalDateString(), data.method || 'cash', data.note || null, givenBy, businessDayId]
    );
    const advance = await tx.get(
      'SELECT * FROM salary_advances WHERE id = ?',
      [result.lastInsertRowid]
    );
    const method = String(data.method || 'cash').toLowerCase();
    const creditCode = method === 'cash' ? '1010' : '1020';
    const drawerId = creditCode === '1010' ? await currentDrawerId(tx) : null;
    const bankAccountId = creditCode === '1020' ? await primaryBankAccountId(tx) : null;
    await postJournal(tx, {
      entry_date: data.advanced_on || null,
      memo: `Salary advance — ${employee.full_name || employee.username}`,
      source_type: 'salary_advance',
      source_id: advance.id,
      created_by: givenBy,
      business_day_id: businessDayId,
      lines: [
        { code: '1310', debit: amount, credit: 0, memo: 'employee advance' },
        { code: creditCode, debit: 0, credit: amount, drawer_id: drawerId, bank_account_id: bankAccountId },
      ],
    });
    return advance;
  });
}

export async function deleteAdvance(db, id) {
  const businessDayId = await currentBusinessDayId(db, { required: true });
  const advance = await db.get('SELECT * FROM salary_advances WHERE id = ?', [id]);
  if (!advance) throw Object.assign(new Error('Salary advance not found.'), { status: 404 });
  if (Number(advance.business_day_id || 0) !== Number(businessDayId)) {
    throw Object.assign(new Error('An advance from a closed business day cannot be deleted.'), { status: 409 });
  }
  const totals = await db.get(
    `SELECT COALESCE((SELECT SUM(amount) FROM salary_advances WHERE employee_id = ?), 0) AS advanced,
            COALESCE((SELECT SUM(advance_deduction) FROM salary_payments WHERE employee_id = ?), 0) AS deducted`,
    [advance.employee_id, advance.employee_id]
  );
  if (positiveMoney(totals.advanced) - positiveMoney(advance.amount) < positiveMoney(totals.deducted)) {
    throw Object.assign(new Error('This advance has already been included in payroll and cannot be deleted.'), { status: 409 });
  }
  await db.transaction(async (tx) => {
    await deleteJournalBySource(tx, 'salary_advance', id);
    await tx.run(`DELETE FROM salary_advances WHERE id = ?`, [id]);
  });
}

export async function listPayments(db, employeeId = null) {
  if (employeeId) {
    return db.all(
      `SELECT p.*, u.full_name AS employee_name
       FROM salary_payments p LEFT JOIN users u ON p.employee_id = u.id
       WHERE p.employee_id = ? ORDER BY p.paid_on DESC, p.id DESC`,
      [employeeId]
    );
  }
  return db.all(
    `SELECT p.*, u.full_name AS employee_name
     FROM salary_payments p LEFT JOIN users u ON p.employee_id = u.id
     ORDER BY p.paid_on DESC, p.id DESC`
  );
}

export async function recordPayment(db, data, paidBy = null) {
  const amount = positiveMoney(data.amount);
  const advanceDeduction = positiveMoney(data.advance_deduction);
  const grossAmount = positiveMoney(data.gross_amount ?? (amount + advanceDeduction));
  if (!data.employee_id) throw Object.assign(new Error('Which employee is this payment for?'), { status: 400 });
  if (amount < 0 || grossAmount <= 0 || advanceDeduction < 0 || positiveMoney(amount + advanceDeduction) !== grossAmount) {
    throw Object.assign(new Error('Gross salary must equal the cash/bank payment plus the advance deduction.'), { status: 400 });
  }
  const outstanding = await advanceOutstanding(db, data.employee_id);
  if (advanceDeduction > outstanding) {
    throw Object.assign(new Error(`Advance deduction cannot exceed the outstanding Rs ${outstanding}.`), { status: 400 });
  }

  await ensureAccountingSchema(db);
  const businessDayId = await currentBusinessDayId(db, { required: true });
  // Insert the payment and its journal atomically: Dr Payroll, Cr the medium
  // it was paid from (cash out of the drawer, otherwise bank).
  return db.transaction(async (tx) => {
    await tx.run(
      `INSERT INTO salary_payments (employee_id, amount, gross_amount, advance_deduction, period_label, paid_on, method, note, paid_by, business_day_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.employee_id, amount, grossAmount, advanceDeduction, data.period_label || null, data.paid_on || nepalDateString(), data.method || 'cash', data.note || null, paidBy, businessDayId]
    );
    const payment = await tx.get(`SELECT * FROM salary_payments WHERE id = (SELECT MAX(id) FROM salary_payments WHERE employee_id = ?)`, [data.employee_id]);
    if (grossAmount > 0) {
      const method = String(data.method || 'cash').toLowerCase();
      const creditCode = method === 'cash' ? '1010' : '1020'; // non-cash payout goes through Bank
      const drawerId = creditCode === '1010' ? await currentDrawerId(tx) : null;
      const bankAccountId = creditCode === '1020' ? await primaryBankAccountId(tx) : null;
      await postJournal(tx, {
        entry_date: data.paid_on || null,
        memo: `Salary payment${data.period_label ? ` — ${data.period_label}` : ''}`,
        source_type: 'payroll',
        source_id: payment.id,
        created_by: paidBy,
        business_day_id: businessDayId,
        lines: [
          { code: '5030', debit: grossAmount, credit: 0, memo: 'gross payroll' },
          ...(advanceDeduction > 0 ? [{ code: '1310', debit: 0, credit: advanceDeduction, memo: 'advance deduction' }] : []),
          ...(amount > 0 ? [{ code: creditCode, debit: 0, credit: amount, drawer_id: drawerId, bank_account_id: bankAccountId }] : []),
        ],
      });
    }
    return payment;
  });
}

export async function deletePayment(db, id) {
  const businessDayId = await currentBusinessDayId(db, { required: true });
  const payment = await db.get(`SELECT business_day_id FROM salary_payments WHERE id=?`, [id]);
  if (Number(payment?.business_day_id || 0) !== Number(businessDayId)) {
    throw Object.assign(new Error('A salary payment from a closed business day cannot be deleted.'), { status: 409 });
  }
  await db.transaction(async (tx) => {
    await deleteJournalBySource(tx, 'payroll', id);
    await tx.run(`DELETE FROM salary_payments WHERE id = ?`, [id]);
  });
}

/**
 * One row per employee with the metrics the system can honestly produce.
 * Everything is aggregated in SQL and bounded by the number of employees.
 */
export async function getPerformance(db) {
  const employees = await db.all(
    `SELECT id, full_name, username, role, is_active, hire_date, position FROM users ORDER BY full_name`
  );

  const [orders, bills, wastage] = await Promise.all([
    db.all(
      `SELECT o.waiter_id AS uid,
              COUNT(DISTINCT o.id) AS orders_handled,
              COUNT(DISTINCT date(o.created_at, '+5 hours', '+45 minutes')) AS active_days,
              COALESCE(SUM(oi.subtotal), 0) AS sales,
              MAX(o.created_at) AS last_order_at
       FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
       WHERE o.waiter_id IS NOT NULL
       GROUP BY o.waiter_id`
    ),
    db.all(
      `SELECT b.cashier_id AS uid,
              COUNT(*) AS bills_settled,
              COALESCE(SUM(b.grand_total), 0) AS revenue
       FROM bills b WHERE b.cashier_id IS NOT NULL AND b.status = 'paid'
       GROUP BY b.cashier_id`
    ),
    db.all(
      `SELECT w.employee_id AS uid,
              COUNT(*) AS wastage_entries,
              COALESCE(SUM(w.total_cost), 0) AS wastage_cost
       FROM wastage_log w WHERE w.employee_id IS NOT NULL
       GROUP BY w.employee_id`
    ),
  ]);

  const byId = (rows) => new Map(rows.map((r) => [Number(r.uid), r]));
  const o = byId(orders);
  const b = byId(bills);
  const w = byId(wastage);

  return employees.map((e) => {
    const oo = o.get(Number(e.id)) || {};
    const bb = b.get(Number(e.id)) || {};
    const ww = w.get(Number(e.id)) || {};
    return {
      id: e.id,
      full_name: e.full_name || e.username,
      role: e.role,
      position: e.position || null,
      hire_date: e.hire_date || null,
      is_active: Number(e.is_active) === 1,
      orders_handled: Number(oo.orders_handled || 0),
      active_days: Number(oo.active_days || 0),
      sales: Number(oo.sales || 0),
      last_order_at: oo.last_order_at || null,
      bills_settled: Number(bb.bills_settled || 0),
      revenue: Number(bb.revenue || 0),
      wastage_entries: Number(ww.wastage_entries || 0),
      wastage_cost: Number(ww.wastage_cost || 0),
    };
  });
}
