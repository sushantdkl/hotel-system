import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureSqliteTable } from '@/lib/db/ensure-sqlite-table.js';
import { ensureColumn } from '@/lib/db/schema-helpers.js';
import { readListParams, resolveOrderBy, buildSearch, paginateQuery } from '@/lib/paginate.js';
import { businessDayIdForCalendarDate, currentBusinessDayId } from '@/lib/business-days.js';
import { nepalDateString } from '@/lib/report-dates.js';
import { correctClosedManualExpense, correctExpensePaymentMethod, ensureExpenseVoidSchema, repairExpenseBusinessDayAlignment, voidExpense } from '@/lib/expense-links.js';
import { normalizePaymentMethod } from '@/lib/payment-allocations.js';
import { isAdminLike } from '@/lib/roles.js';

async function ensureExpensesReady(db) {
  await ensureSqliteTable(
    db,
    `
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      expense_date TEXT,
      purchase_date TEXT,
      supplier TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `
  );
  await ensureColumn(db, 'expenses', 'notes', 'TEXT');
  await ensureColumn(db, 'expenses', 'purchase_date', 'TEXT');
  await ensureColumn(db, 'expenses', 'payment_method', "TEXT DEFAULT 'cash'");
  await ensureColumn(db, 'expenses', 'logged_by', 'INTEGER');
  await ensureColumn(db, 'expenses', 'receipt_url', 'TEXT');
  await ensureColumn(db, 'expenses', 'source_type', 'TEXT');
  await ensureColumn(db, 'expenses', 'source_id', 'INTEGER');
  await ensureExpenseVoidSchema(db);
  await repairExpenseBusinessDayAlignment(db);
}

/**
 * Expenses with a source_type are owned by automation (a purchase, a wastage
 * entry). Editing or deleting them here would desync them from their source,
 * so they are read-only from this route. Manual expenses keep source_type NULL.
 */
const LINKED_EXPENSE_HINT = {
  purchase: 'Edit or void the purchase instead.',
  wastage: 'Edit the wastage entry instead.',
};

async function rejectIfLinked(db, id) {
  const row = await db.get('SELECT source_type FROM expenses WHERE id = ?', [id]);
  if (row?.source_type) {
    return NextResponse.json(
      {
        error: `This expense was generated automatically. ${LINKED_EXPENSE_HINT[row.source_type] || 'Change the record it came from instead.'}`,
      },
      { status: 409 }
    );
  }
  return null;
}

function mapExpenseRow(row) {
  if (!row) return row;
  const date = row.purchase_date || row.expense_date || null;
  return {
    ...row,
    purchase_date: date,
    expense_date: date,
  };
}

/** The date an expense is "on" — purchase_date wins, expense_date is the fallback. */
const EXPENSE_DATE = `COALESCE(e.purchase_date, CAST(e.expense_date AS TEXT))`;

const EXPENSE_SORTS = {
  created_at: 'e.created_at',
  purchase_date: EXPENSE_DATE,
  expense_date: EXPENSE_DATE,
  description: 'e.description',
  category: 'e.category',
  amount: 'e.amount',
  supplier: 'e.supplier',
  payment_method: 'e.payment_method',
};

const EXPENSE_SEARCH_COLUMNS = ['e.description', 'e.category', 'e.supplier', 'e.notes', 'e.payment_method'];

/**
 * The KPI tiles and the two charts describe the whole filtered range, not the
 * page on screen, so they are aggregated in SQL. Summing a page of fifty in the
 * browser would have quietly reported the wrong spend the moment paging landed.
 */
async function buildSummary(db, where, params) {
  const [totals, byCategory, daily] = await Promise.all([
    db.get(
      `SELECT COUNT(*) AS entries,
              COALESCE(SUM(e.amount), 0) AS total,
              COALESCE(SUM(CASE WHEN e.source_type = 'purchase' THEN e.amount ELSE 0 END), 0) AS purchases,
              COALESCE(SUM(CASE WHEN e.source_type = 'wastage' THEN e.amount ELSE 0 END), 0) AS losses,
              COALESCE(SUM(CASE WHEN e.source_type IS NULL THEN e.amount ELSE 0 END), 0) AS operating
       FROM expenses e WHERE ${where}`,
      params
    ),
    db.all(
      `SELECT e.category AS category, COALESCE(SUM(e.amount), 0) AS total
       FROM expenses e WHERE ${where}
       GROUP BY e.category ORDER BY total DESC`,
      params
    ),
    db.all(
      `SELECT ${EXPENSE_DATE} AS day, COALESCE(SUM(e.amount), 0) AS total
       FROM expenses e WHERE ${where}
       GROUP BY ${EXPENSE_DATE} ORDER BY day`,
      params
    ),
  ]);

  return {
    entries: Number(totals?.entries || 0),
    total: Number(totals?.total || 0),
    purchases: Number(totals?.purchases || 0),
    losses: Number(totals?.losses || 0),
    operating: Number(totals?.operating || 0),
    byCategory: (byCategory || []).map((r) => ({ category: r.category, total: Number(r.total || 0) })),
    daily: (daily || []).map((r) => ({ date: String(r.day || '').slice(0, 10), total: Number(r.total || 0) })),
  };
}

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'expenses.manage' });
    if (auth.error) return auth.error;

    const db = Database.getInstance();
    await ensureExpensesReady(db);

    const { searchParams } = new URL(request.url);
    const { page, pageSize, exportAll, sort, dir, search } = readListParams(searchParams);

    const conditions = ['1=1'];
    const params = [];
    const status = String(searchParams.get('status') || 'active').toLowerCase();
    if (status === 'voided') conditions.push("LOWER(COALESCE(e.status,'active'))='voided'");
    else if (status !== 'all') conditions.push("LOWER(COALESCE(e.status,'active'))<>'voided'");

    const focusedId = Number(searchParams.get('id'));
    if (focusedId > 0) {
      conditions.push('e.id = ?');
      params.push(focusedId);
    }

    const category = searchParams.get('category');
    if (category && category !== 'all') {
      conditions.push('e.category = ?');
      params.push(category);
    }
    // `origin` is the owner-facing version of source_type: manual means nobody's
    // automation wrote it, so it is a NULL check rather than a value match.
    const origin = searchParams.get('origin') || searchParams.get('source_type');
    if (origin === 'manual') {
      conditions.push('e.source_type IS NULL');
    } else if (origin && origin !== 'all') {
      conditions.push('e.source_type = ?');
      params.push(origin);
    }
    const fromDate = searchParams.get('from');
    if (fromDate) {
      conditions.push(`${EXPENSE_DATE} >= ?`);
      params.push(fromDate);
    }
    const toDate = searchParams.get('to');
    if (toDate) {
      conditions.push(`${EXPENSE_DATE} <= ?`);
      params.push(toDate);
    }

    const searchClause = buildSearch(search, EXPENSE_SEARCH_COLUMNS);
    if (searchClause.clause) {
      conditions.push(searchClause.clause);
      params.push(...searchClause.params);
    }

    const where = conditions.join(' AND ');

    const { rows, pagination } = await paginateQuery(db, {
      columns: 'e.*, u.full_name as logged_by_name, bd.status as business_day_status, bd.business_date',
      from: 'expenses e LEFT JOIN users u ON e.logged_by = u.id LEFT JOIN business_days bd ON bd.id=e.business_day_id',
      where,
      params,
      orderBy: resolveOrderBy(sort, dir, EXPENSE_SORTS, 'created_at', 'e.id'),
      page,
      pageSize,
      exportAll,
    });

    return NextResponse.json({
      expenses: rows.map(mapExpenseRow),
      pagination,
      summary: await buildSummary(db, where, params),
    });
  } catch (error) {
    return handleRouteError(error, 'Failed to fetch expenses');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'expenses.manage' });
    if (auth.error) return auth.error;

    const data = await request.json();
    const db = Database.getInstance();
    await ensureExpensesReady(db);
    // An open store session is still required to enter expenses, but the row
    // and its journal belong to the expense date's business day (purchases do
    // the same for invoice date).
    await currentBusinessDayId(db, { required: true });
    const dateVal = data.purchase_date || data.expense_date || nepalDateString();
    const businessDayId = await businessDayIdForCalendarDate(db, dateVal, {
      note: 'Historical day created for a late-entered expense.',
    });

    const { ensureAccountingSchema, postExpenseJournal } = await import('@/lib/accounting.js');
    await ensureAccountingSchema(db);

    // Insert + journal in one transaction: an expense never exists without its
    // journal, and a posting failure never leaves a half-recorded expense.
    const expense = await db.transaction(async (tx) => {
      const result = await tx.run(
        `
        INSERT INTO expenses (
          description, category, amount, expense_date, purchase_date, supplier, notes,
          payment_method, logged_by, receipt_url, business_day_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          data.description,
          data.category,
          data.amount,
          dateVal,
          dateVal,
          data.supplier || null,
          data.notes || null,
          normalizePaymentMethod(data.payment_method || 'cash'),
          auth.user?.id || null,
          data.receipt_url || null,
          businessDayId,
        ]
      );
      const row = mapExpenseRow(await tx.get('SELECT * FROM expenses WHERE id = ?', [result.lastInsertRowid]));
      await postExpenseJournal(tx, {
        id: row.id,
        amount: row.amount,
        category: row.category,
        description: row.description,
        payment_method: row.payment_method || 'cash',
        expense_date: row.expense_date,
        logged_by: auth.user?.id || null,
        source_type: null,
        business_day_id: businessDayId,
        use_business_funding: Boolean(data.use_business_funding),
      });
      return row;
    });

    return NextResponse.json(
      { message: 'Expense created successfully', expense },
      { status: 201 }
    );
  } catch (error) {
    return handleRouteError(error, 'Failed to create expense');
  }
}

export async function PUT(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'expenses.manage' });
    if (auth.error) return auth.error;

    const data = await request.json();
    const db = Database.getInstance();
    await ensureExpensesReady(db);
    const blocked = await rejectIfLinked(db, data.id);
    if (blocked) return blocked;
    const existing = await db.get(`SELECT e.*,bd.status AS business_day_status FROM expenses e LEFT JOIN business_days bd ON bd.id=e.business_day_id WHERE e.id=?`, [data.id]);
    if (!existing) return NextResponse.json({ error: 'Expense not found.' }, { status: 404 });
    if (existing.business_day_status === 'closed') {
      if (!isAdminLike(auth.user?.role)) return NextResponse.json({ error: 'Only an administrator or manager can correct a closed business day expense.' }, { status: 403 });
      const corrected = await correctClosedManualExpense(db, { expenseId: data.id, changes: data, reason: data.correction_reason, performedBy: auth.user?.id || null, requestKey: data.request_key, useBusinessFunding: Boolean(data.use_business_funding) });
      return NextResponse.json({ message: 'Closed expense corrected with an audit trail.', expense: mapExpenseRow(corrected) });
    }
    const openDayId = await currentBusinessDayId(db, { required: true });
    if (Number(existing.business_day_id || 0) !== Number(openDayId)) {
      return NextResponse.json({ error: 'This expense does not belong to the active business day.' }, { status: 409 });
    }

    const dateVal = data.purchase_date || data.expense_date || nepalDateString();
    const businessDayId = await businessDayIdForCalendarDate(db, dateVal, {
      note: 'Historical day created for a late-entered expense.',
    });
    if (Number(businessDayId) !== Number(existing.business_day_id)) {
      return NextResponse.json({ error: 'An expense cannot be moved to another business day. Void it and enter the corrected record instead.' }, { status: 409 });
    }

    const expense = await db.transaction(async (tx) => {
      await tx.run(
        `
        UPDATE expenses
        SET description = ?, category = ?, amount = ?,
            expense_date = ?, purchase_date = ?, supplier = ?, notes = ?,
            payment_method = ?, receipt_url = ?, business_day_id = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
        [
          data.description,
          data.category,
          data.amount,
          dateVal,
          dateVal,
          data.supplier || null,
          data.notes || null,
          normalizePaymentMethod(data.payment_method || 'cash'),
          data.receipt_url || null,
          businessDayId,
          data.id,
        ]
      );
      const row = mapExpenseRow(await tx.get('SELECT * FROM expenses WHERE id = ?', [data.id]));
      // Re-post the journal so the ledger tracks the edit (idempotent replace).
      const { ensureAccountingSchema, postExpenseJournal } = await import('@/lib/accounting.js');
      await ensureAccountingSchema(tx);
      await postExpenseJournal(tx, {
        id: row.id,
        amount: row.amount,
        category: row.category,
        description: row.description,
        payment_method: row.payment_method || 'cash',
        expense_date: row.expense_date,
        logged_by: row.logged_by || auth.user?.id || null,
        source_type: null,
        business_day_id: businessDayId,
        use_business_funding: Boolean(data.use_business_funding),
      });
      return row;
    });

    return NextResponse.json({ message: 'Expense updated successfully', expense });
  } catch (error) {
    return handleRouteError(error, 'Failed to update expense');
  }
}

/** Payment-source correction is deliberately separate from normal editing so
 * a closed-day record can be fixed without rewriting its amount/date/details. */
export async function PATCH(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'expenses.payment_method_correct' });
    if (auth.error) return auth.error;

    const data = await request.json();
    const db = Database.getInstance();
    await ensureExpensesReady(db);
    const blocked = await rejectIfLinked(db, data.id);
    if (blocked) return blocked;

    const correction = await correctExpensePaymentMethod(db, {
      expenseId: data.id,
      paymentMethod: data.payment_method,
      reason: data.reason,
      performedBy: auth.user?.id || null,
      requestKey: data.request_key,
    });
    const expense = mapExpenseRow(await db.get('SELECT * FROM expenses WHERE id=?', [data.id]));
    return NextResponse.json({ message: 'Expense payment method corrected.', correction, expense });
  } catch (error) {
    return handleRouteError(error, 'Failed to correct expense payment method');
  }
}

export async function DELETE(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'expenses.manage' });
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    const db = Database.getInstance();
    await ensureExpensesReady(db);
    const businessDayId = await currentBusinessDayId(db, { required: true });

    const blocked = await rejectIfLinked(db, id);
    if (blocked) return blocked;
    const existing = await db.get('SELECT business_day_id FROM expenses WHERE id=?', [id]);
    if (Number(existing?.business_day_id || 0) !== Number(businessDayId)) {
      return NextResponse.json({ error: 'A closed business day expense cannot be deleted.' }, { status: 409 });
    }

    await voidExpense(db, id, {
      reason: searchParams.get('reason') || 'Removed from the expenses page',
      performedBy: auth.user?.id || null,
      businessDayId,
    });

    return NextResponse.json({ message: 'Expense voided successfully' });
  } catch (error) {
    return handleRouteError(error, 'Failed to delete expense');
  }
}
