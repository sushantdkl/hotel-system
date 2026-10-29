/**
 * Double-entry accounting engine.
 *
 * The one rule: every economic event posts a balanced journal (sum of debits =
 * sum of credits) through postJournal(). Nothing stores a running balance — the
 * General Ledger, Cash Book and Bank Book are all derived from journal_lines.
 *
 * Journals carry (source_type, source_id) so a business event maps to exactly
 * one journal; reposting the same event replaces its journal rather than
 * duplicating it. That makes the auto-posting hooks safe to call more than once.
 *
 * The default Chart of Accounts is seeded here (idempotently) rather than in the
 * SQL migration, so Postgres and the SQLite dev fallback share one seed.
 */

import { ensureSqliteTable } from './db/ensure-sqlite-table.js';
import { serialPkSql, ensureColumn } from './db/schema-helpers.js';
import { nepalDateString } from './report-dates.js';

/* ------------------------------------------------------------------ seed data */

// code, name, type, subtype, parent code, is_system
export const SEED_ACCOUNTS = [
  ['1000', 'Assets', 'asset', null, null, 1],
  ['1010', 'Cash on Hand', 'asset', 'cash', '1000', 1],
  ['1020', 'Bank', 'asset', 'bank', '1000', 1],
  ['1030', 'Cash Reserve / Safe', 'asset', 'cash_reserve', '1000', 1],
  ['1040', 'Savings & Deposits', 'asset', 'savings', '1000', 1],
  ['1050', 'Business Funding', 'asset', 'business_funding', '1000', 1],
  ['1090', 'Suspense / Clearing', 'asset', 'suspense', '1000', 1],
  ['1100', 'Card Clearing', 'asset', 'clearing', '1000', 1],
  ['1110', 'eSewa Clearing', 'asset', 'clearing', '1000', 1],
  ['1120', 'Khalti Clearing', 'asset', 'clearing', '1000', 1],
  ['1130', 'QR / Fonepay Clearing', 'asset', 'clearing', '1000', 1],
  ['1140', 'Online Clearing', 'asset', 'clearing', '1000', 1],
  ['1200', 'Inventory', 'asset', 'inventory', '1000', 1],
  ['1300', 'Accounts Receivable', 'asset', 'receivable', '1000', 1],
  ['1310', 'Employee Salary Advances', 'asset', 'employee_advance', '1000', 1],
  ['2000', 'Liabilities', 'liability', null, null, 1],
  ['2010', 'Accounts Payable', 'liability', 'payable', '2000', 1],
  ['2020', 'VAT / Tax Payable', 'liability', 'tax', '2000', 1],
  ['3000', 'Equity', 'equity', null, null, 1],
  ['3010', "Owner's Equity", 'equity', null, '3000', 1],
  ['3020', 'Opening Balance Equity', 'equity', null, '3000', 1],
  ['4000', 'Income', 'income', null, null, 1],
  ['4010', 'Sales Revenue', 'income', 'sales', '4000', 1],
  ['4020', 'Other Income', 'income', null, '4000', 1],
  ['5000', 'Expenses', 'expense', null, null, 1],
  ['5010', 'Purchases', 'expense', 'purchases', '5000', 1],
  ['5020', 'Operating Expenses', 'expense', 'operating', '5000', 1],
  ['5030', 'Payroll', 'expense', 'payroll', '5000', 1],
  ['5040', 'Wastage / Inventory Loss', 'expense', 'wastage', '5000', 1],
  ['5050', 'Payment Processing Fees', 'expense', 'fees', '5000', 1],
  ['5060', 'Cash Over / Short', 'expense', 'variance', '5000', 1],
  ['5070', 'Discounts & Write-offs', 'expense', 'discount', '5000', 1],
];

/** Debit-normal account types — used to compute a signed balance. */
export const DEBIT_NORMAL = new Set(['asset', 'expense']);

/**
 * Payment method -> asset account code money lands in.
 *
 * The restaurant operates one online balance. Legacy names remain accepted so
 * old clients and historical corrections are safe, but every non-cash receipt
 * now posts directly to the Primary Bank instead of a clearing account.
 */
export const PAYMENT_ACCOUNT = {
  cash: '1010',
  bank: '1020',
  bank_transfer: '1020',
  cheque: '1020',
  card: '1020',
  esewa: '1020',
  khalti: '1020',
  qr: '1020',
  fonepay: '1020',
  online: '1020',
  credit: '1300',
  due: '2010',
  // Restaurant bill charged to an in-house hotel stay (lib/hotel/room-charges.js).
  room: '1320',
  // Part of a room-charged bill covered by the guest's meal-plan allowance
  // (lib/hotel/packages.js): settles the deferred package value, not cash.
  package: '2160',
};

/**
 * Resolve a payment method to its account code. Unknown methods THROW — they
 * must never silently post to Cash. Map a new method in PAYMENT_ACCOUNT first.
 * `none` (no cash movement, e.g. wastage) is handled by callers, not here.
 */
export function paymentAccountCode(method) {
  const key = String(method || '').toLowerCase().trim();
  const code = PAYMENT_ACCOUNT[key];
  if (!code) {
    throw Object.assign(new Error(`Unknown payment method "${method}". Map it to an account before posting.`), { status: 400 });
  }
  return code;
}

/* --------------------------------------------------------------------- schema */

const schemaReady = new WeakMap();

export async function ensureAccountingSchema(db) {
  if (schemaReady.has(db)) return schemaReady.get(db);
  const ready = initializeAccountingSchema(db).catch((error) => {
    schemaReady.delete(db);
    throw error;
  });
  schemaReady.set(db, ready);
  return ready;
}

async function initializeAccountingSchema(db) {
  const pk = serialPkSql(db);
  // SQLite fallback only — Postgres gets these from migration 015.
  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS accounts (
    ${pk}, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, type TEXT NOT NULL, subtype TEXT,
    parent_id INTEGER, is_active INTEGER DEFAULT 1, is_system INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS cash_drawers (
    ${pk}, name TEXT NOT NULL, is_active INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS bank_accounts (
    ${pk}, name TEXT NOT NULL, account_number TEXT, account_id INTEGER, opening_balance REAL DEFAULT 0,
    is_active INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS journal_entries (
    ${pk}, entry_date DATE NOT NULL DEFAULT CURRENT_DATE, memo TEXT, source_type TEXT, source_id INTEGER,
    external_ref TEXT, created_by INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await ensureColumn(db, 'journal_entries', 'external_ref', 'TEXT');
  await ensureColumn(db, 'journal_entries', 'business_day_id', 'INTEGER');
  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS journal_lines (
    ${pk}, journal_id INTEGER NOT NULL, account_id INTEGER NOT NULL, debit REAL NOT NULL DEFAULT 0,
    credit REAL NOT NULL DEFAULT 0, memo TEXT, drawer_id INTEGER, bank_account_id INTEGER, supplier_id INTEGER,
    reconciled INTEGER DEFAULT 0, reconciled_at DATETIME)`);
  await ensureColumn(db, 'journal_lines', 'supplier_id', 'INTEGER');
  await ensureColumn(db, 'journal_lines', 'customer_id', 'INTEGER');
  await ensureColumn(db, 'journal_lines', 'reconciled', 'INTEGER DEFAULT 0');
  await ensureColumn(db, 'journal_lines', 'reconciled_at', 'DATETIME');
  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS bank_reconciliations (
    ${pk}, bank_account_id INTEGER, statement_date DATE NOT NULL, statement_balance REAL NOT NULL,
    book_balance REAL NOT NULL, difference REAL NOT NULL, note TEXT, created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS drawer_sessions (
    ${pk}, drawer_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open', opening_amount REAL NOT NULL DEFAULT 0,
    opened_by INTEGER, opened_at DATETIME DEFAULT CURRENT_TIMESTAMP, expected_amount REAL, counted_amount REAL,
    difference REAL, note TEXT, closed_by INTEGER, closed_at DATETIME)`);
  await ensureColumn(db, 'drawer_sessions', 'business_day_id', 'INTEGER');
  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS payment_settlements (
    ${pk}, method TEXT NOT NULL, gross_amount REAL NOT NULL, fee_amount REAL DEFAULT 0, net_amount REAL NOT NULL,
    bank_account_id INTEGER, reference TEXT, note TEXT, settled_by INTEGER,
    settled_at DATETIME DEFAULT CURRENT_TIMESTAMP, journal_id INTEGER)`);
  await ensureColumn(db, 'payment_settlements', 'business_day_id', 'INTEGER');

  await seedAccounts(db);

  // A single default drawer and bank so day-one posting has somewhere to land.
  const drawer = await db.get(`SELECT id FROM cash_drawers WHERE is_active = 1 ORDER BY id LIMIT 1`);
  if (!drawer) await db.run(`INSERT INTO cash_drawers (name) VALUES (?)`, ['Main Drawer']);
  const bank = await db.get(`SELECT id FROM bank_accounts WHERE is_active = 1 ORDER BY id LIMIT 1`);
  if (!bank) {
    const acc = await db.get(`SELECT id FROM accounts WHERE code = ?`, ['1020']);
    await db.run(`INSERT INTO bank_accounts (name, account_id) VALUES (?, ?)`, ['Primary Bank', acc?.id || null]);
  }
  await consolidateOnlineToPrimaryBank(db);
}

/**
 * One-bank migration. Repointing the historical journal lines preserves every
 * journal's debits/credits and does not create income; it only says that the
 * old QR/card/wallet clearing asset is the same Primary Bank asset.
 */
async function consolidateOnlineToPrimaryBank(db) {
  const primary = await db.get(
    `SELECT id, account_id FROM bank_accounts WHERE is_active = 1
     ORDER BY CASE WHEN lower(name) = 'primary bank' THEN 0 ELSE 1 END, id LIMIT 1`
  );
  const bankAccountId = primary?.id;
  const bankLedgerId = primary?.account_id || (await db.get(`SELECT id FROM accounts WHERE code='1020'`))?.id;
  if (!bankAccountId || !bankLedgerId) return;

  const clearing = await db.all(`SELECT id FROM accounts WHERE code IN ('1100','1110','1120','1130','1140')`);
  const clearingIds = clearing.map((row) => row.id);
  if (clearingIds.length) {
    await db.run(
      `UPDATE journal_lines SET account_id = ?, bank_account_id = ?
       WHERE account_id IN (${clearingIds.map(() => '?').join(',')})`,
      [bankLedgerId, bankAccountId, ...clearingIds]
    );
  }
  await db.run(`UPDATE journal_lines SET bank_account_id = ? WHERE account_id = ?`, [bankAccountId, bankLedgerId]);
  await db.run(`UPDATE accounts SET is_active = 0 WHERE code IN ('1100','1110','1120','1130','1140')`);
  await db.run(`UPDATE bank_accounts SET is_active = CASE WHEN id = ? THEN 1 ELSE 0 END`, [bankAccountId]);
}

async function seedAccounts(db) {
  for (const [code, name, type, subtype] of SEED_ACCOUNTS) {
    const exists = await db.get(`SELECT id FROM accounts WHERE code = ?`, [code]);
    if (!exists) {
      try {
        await db.run(`INSERT INTO accounts (code, name, type, subtype, is_system) VALUES (?, ?, ?, ?, 1)`, [code, name, type, subtype]);
      } catch (e) {
        // Concurrent seeder won the race on the UNIQUE(code) — that's fine.
        if (!/unique|duplicate/i.test(String(e?.message || e?.code || ''))) throw e;
      }
    } else if (code === '5010' && exists) {
      // Purchases-as-expense model: keep the ledger label honest (not perpetual COGS).
      await db.run(`UPDATE accounts SET name=?, subtype=? WHERE code='5010' AND (name<>? OR COALESCE(subtype,'')<>?)`, [
        name, subtype, name, subtype,
      ]);
    }
  }
  // Link parents in a second pass (ids now exist).
  for (const [code, , , , parentCode] of SEED_ACCOUNTS) {
    if (!parentCode) continue;
    await db.run(
      `UPDATE accounts SET parent_id = (SELECT id FROM accounts WHERE code = ?) WHERE code = ? AND parent_id IS NULL`,
      [parentCode, code]
    );
  }
}

/* ------------------------------------------------------------ account helpers */

export async function accountIdByCode(db, code) {
  const row = await db.get(`SELECT id FROM accounts WHERE code = ?`, [code]);
  if (!row) throw new Error(`Accounting: no account with code ${code} (schema not seeded?)`);
  return row.id;
}

export async function primaryBankAccountId(db) {
  const row = await db.get(
    `SELECT id FROM bank_accounts WHERE is_active = 1
     ORDER BY CASE WHEN lower(name) = 'primary bank' THEN 0 ELSE 1 END, id LIMIT 1`
  );
  return row?.id || null;
}

async function resolveLineAccounts(db, lines) {
  const out = [];
  for (const l of lines) {
    const account_id = l.account_id ?? (await accountIdByCode(db, l.code));
    out.push({ ...l, account_id });
  }
  return out;
}

/** Driver-independent journal removal (legacy SQLite tables may lack CASCADE). */
export async function deleteJournalBySource(db, sourceType, sourceId) {
  const rows = await db.all(`SELECT id FROM journal_entries WHERE source_type=? AND source_id=?`, [sourceType, sourceId]);
  for (const row of rows) {
    await db.run(`DELETE FROM journal_lines WHERE journal_id=?`, [row.id]);
    await db.run(`DELETE FROM journal_entries WHERE id=?`, [row.id]);
  }
}

/* ----------------------------------------------------------------- posting */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Post one balanced journal. Pass a tx-scoped db to stay inside the caller's
 * transaction. With a source_type+source_id, any existing journal for that
 * event is replaced (idempotent). `lines` = [{ code|account_id, debit, credit,
 * memo?, drawer_id?, bank_account_id? }]. Returns the journal id.
 */
export async function postJournal(db, { entry_date, memo, source_type = null, source_id = null, external_ref = null, created_by = null, business_day_id = null, lines }) {
  // external_ref is the idempotency key for manual, source-less operations
  // (deposits, settlements, exchanges). A repeat with the same key is a no-op.
  if (external_ref) {
    const dup = await db.get(`SELECT id FROM journal_entries WHERE external_ref = ?`, [external_ref]);
    if (dup) return dup.id;
  }

  const resolved = await resolveLineAccounts(db, lines.filter((l) => round2(l.debit) > 0 || round2(l.credit) > 0));
  if (resolved.length < 2) throw new Error('Accounting: a journal needs at least two lines.');

  const debits = round2(resolved.reduce((s, l) => s + (Number(l.debit) || 0), 0));
  const credits = round2(resolved.reduce((s, l) => s + (Number(l.credit) || 0), 0));
  if (Math.abs(debits - credits) > 0.01) {
    throw new Error(`Accounting: unbalanced journal (debit ${debits} vs credit ${credits}).`);
  }

  if (source_type && source_id != null) {
    await deleteJournalBySource(db, source_type, source_id);
  }

  let resolvedBusinessDayId = business_day_id || null;
  if (!resolvedBusinessDayId) {
    try {
      resolvedBusinessDayId = (await db.get(`SELECT id FROM business_days WHERE status='open' ORDER BY id DESC LIMIT 1`))?.id || null;
    } catch {
      // Migration compatibility: historical installations can still read before 032 is applied.
    }
  }
  // entry_date must default to the Nepal calendar day, not SQL CURRENT_DATE
  // (UTC) — Nepal is UTC+5:45, so anything posted between ~18:15 and 23:59
  // UTC is already tomorrow in Kathmandu. Every report/business-day boundary
  // elsewhere in the app is NPT-shifted; the ledger has to match or it silently
  // drops that whole overnight window from date-range reports (e.g. Summary
  // Report on the day itself, since it filters by this column directly).
  const res = await db.run(
    `INSERT INTO journal_entries (entry_date, memo, source_type, source_id, external_ref, created_by, business_day_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [entry_date || nepalDateString(), memo || null, source_type, source_id, external_ref, created_by, resolvedBusinessDayId]
  );
  const journalId =
    res?.lastInsertRowid ??
    (await db.get(
      `SELECT id FROM journal_entries WHERE ${external_ref ? 'external_ref = ?' : source_type ? 'source_type = ? AND source_id = ?' : 'id = (SELECT MAX(id) FROM journal_entries)'}`,
      external_ref ? [external_ref] : source_type ? [source_type, source_id] : []
    ))?.id;

  for (const l of resolved) {
    await db.run(
      `INSERT INTO journal_lines (journal_id, account_id, debit, credit, memo, drawer_id, bank_account_id, supplier_id, customer_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [journalId, l.account_id, round2(l.debit), round2(l.credit), l.memo || null, l.drawer_id || null, l.bank_account_id || null, l.supplier_id || null, l.customer_id || null]
    );
  }
  return journalId;
}

/** Open drawer for the default (or given) drawer, so cash lines get tagged. */
export async function currentDrawerId(db, drawerId = null) {
  if (drawerId) return drawerId;
  const open = await db.get(`SELECT id FROM drawer_sessions WHERE status = 'open' ORDER BY id DESC LIMIT 1`).catch(() => null);
  if (open) {
    const s = await db.get(`SELECT drawer_id FROM drawer_sessions WHERE id = ?`, [open.id]);
    return s?.drawer_id || null;
  }
  const d = await db.get(`SELECT id FROM cash_drawers WHERE is_active = 1 ORDER BY id LIMIT 1`).catch(() => null);
  return d?.id || null;
}

/**
 * Signed balance (debit - credit) of an account, optionally for one drawer or
 * bank account. Positive = asset on hand / clearing pending. Used by the
 * negative-balance guards on withdrawals, settlements and exchanges.
 */
export async function accountBalance(db, code, { drawerId = null, bankAccountId = null, supplierId = null } = {}) {
  const id = await accountIdByCode(db, code);
  const params = [id];
  let where = '';
  if (drawerId) { where += ' AND drawer_id = ?'; params.push(drawerId); }
  if (bankAccountId) { where += ' AND bank_account_id = ?'; params.push(bankAccountId); }
  if (supplierId) { where += ' AND supplier_id = ?'; params.push(supplierId); }
  const row = await db.get(`SELECT COALESCE(SUM(debit - credit), 0) AS bal FROM journal_lines WHERE account_id = ?${where}`, params);
  return Number(row?.bal || 0);
}

/** Signed account balance at the end of a given business date. */
export async function accountBalanceAsOf(db, code, asOf, { drawerId = null, bankAccountId = null, supplierId = null } = {}) {
  const id = await accountIdByCode(db, code);
  const params = [id, asOf];
  let where = '';
  if (drawerId) { where += ' AND jl.drawer_id = ?'; params.push(drawerId); }
  if (bankAccountId) { where += ' AND jl.bank_account_id = ?'; params.push(bankAccountId); }
  if (supplierId) { where += ' AND jl.supplier_id = ?'; params.push(supplierId); }
  const row = await db.get(
    `SELECT COALESCE(SUM(jl.debit-jl.credit),0) AS bal
     FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_id
     WHERE jl.account_id=? AND je.entry_date<=?${where}`,
    params
  );
  return Number(row?.bal || 0);
}

/* ------------------------------------------------ auto-posting: sales & expenses */

/**
 * Sale settlement. `parts` = [{ method, amount }] (a split), or derive from a
 * single method + total. Dr each payment account, Cr Sales Revenue for the sum.
 */
export async function postSaleJournal(db, { bill_id, bill_number, entry_date, parts, tax_amount = 0, created_by, business_day_id = null }) {
  const clean = (parts || []).map((p) => ({
    method: p.method,
    amount: round2(p.amount),
    customer_id: p.customer_id || null,
  })).filter((p) => p.amount > 0);
  if (!clean.length) return null;
  const drawerId = await currentDrawerId(db);
  const bankAccountId = await primaryBankAccountId(db);
  const lines = clean.map((p) => {
    const code = paymentAccountCode(p.method);
    return {
      code,
      debit: p.amount,
      credit: 0,
      drawer_id: code === '1010' ? drawerId : null,
      bank_account_id: code === '1020' ? bankAccountId : null,
      customer_id: code === '1300' ? p.customer_id || null : null,
      memo: `${p.method} payment`,
    };
  });
  const total = round2(clean.reduce((s, p) => s + p.amount, 0));
  const tax = Math.min(total, Math.max(0, round2(tax_amount)));
  lines.push({ code: '4010', debit: 0, credit: round2(total - tax), memo: 'Sales revenue' });
  if (tax > 0) lines.push({ code: '2020', debit: 0, credit: tax, memo: 'VAT / tax payable' });
  const originatingDay = !entry_date && business_day_id
    ? await db.get('SELECT business_date FROM business_days WHERE id = ?', [business_day_id])
    : null;
  return postJournal(db, {
    entry_date: entry_date || originatingDay?.business_date,
    memo: `Sale — bill ${bill_number || bill_id}`,
    source_type: 'bill',
    source_id: bill_id,
    created_by,
    business_day_id,
    lines,
  });
}

const EXPENSE_ACCOUNT_BY_SOURCE = { purchase: '5010', wastage: '5040', payroll: '5030' };

/**
 * Expense row -> journal. Dr the expense account; Cr the account the money came
 * from. Non-cash losses (wastage, or an explicit payment_method of 'none') are
 * a stock write-down, so they credit Inventory and NEVER touch Cash.
 */
// A purchase left unpaid is a payable, not cash out.
const CREDIT_TO_AP = new Set(['credit', 'due', 'unpaid', 'on_credit', 'payable']);

export async function postExpenseJournal(db, expense) {
  const amount = round2(expense.amount);
  if (!(amount > 0)) return null;
  const debitCode = EXPENSE_ACCOUNT_BY_SOURCE[expense.source_type] || '5020';
  const method = String(expense.payment_method || 'cash').toLowerCase();

  let creditCode;
  let supplierTag = null;
  if (expense.source_type === 'wastage' || method === 'none') {
    creditCode = '1200'; // Inventory — non-cash stock write-down
  } else if (expense.source_type === 'purchase' && CREDIT_TO_AP.has(method)) {
    creditCode = '2010'; // Accounts Payable, tagged to the supplier sub-ledger
    supplierTag = expense.supplier_id || null;
  } else if (method === 'owner_pocket') {
    // The owner paid personally; no money entered the drawer or business bank.
    creditCode = '3010';
  } else if (method === 'business_funding') {
    // Spend the separately recorded Business Funding balance directly.
    creditCode = '1050';
  } else {
    creditCode = paymentAccountCode(method); // cash/bank/clearing — throws on unknown
  }
  const historicalDrawer = creditCode === '1010' && expense.business_day_id
    ? await db.get(
        `SELECT drawer_id FROM drawer_sessions WHERE business_day_id=? ORDER BY opened_at,id LIMIT 1`,
        [expense.business_day_id]
      ).catch(() => null)
    : null;
  const drawerId = creditCode === '1010' ? (historicalDrawer?.drawer_id || await currentDrawerId(db)) : null;
  const bankAccountId = creditCode === '1020' ? await primaryBankAccountId(db) : null;

  // Drop the prior expense journal before checking its replacement. Otherwise
  // an edit would count the old payment against the historical balance twice.
  await deleteJournalBySource(db, 'expense', expense.id);
  const { prepareExpenseFunding, BUSINESS_FUNDING_CODE } = await import('@/lib/business-funding.js');
  const funding = await prepareExpenseFunding(db, expense, creditCode);
  const shortfall = round2(funding.amount || 0);

  if (creditCode === '1050') {
    // Current funding pool — staff may spend available Business Funding on a
    // previous-day purchase without requiring the fund to pre-exist on that date.
    const available = round2(await accountBalance(db, '1050'));
    if (available + 0.001 < amount) {
      throw Object.assign(
        new Error(`Business Funding has Rs ${available.toFixed(2)} available, but Rs ${amount.toFixed(2)} is required.`),
        { status: 409, code: 'business_funding_insufficient', available, shortfall: round2(amount - available) }
      );
    }
  }

  // Cash/bank pays only what that medium can cover; Business Funding covers the
  // shortfall on the same expense date so past-day Cash Position is not overdrawn.
  const lines = [{ code: debitCode, debit: amount, credit: 0, memo: expense.category || null }];
  if (['1010', '1020'].includes(creditCode) && shortfall > 0.001) {
    const fromMedium = round2(amount - shortfall);
    if (fromMedium > 0.001) {
      lines.push({
        code: creditCode,
        debit: 0,
        credit: fromMedium,
        drawer_id: drawerId,
        bank_account_id: bankAccountId,
        supplier_id: supplierTag,
        memo: 'Paid from cash/bank',
      });
    }
    lines.push({
      code: BUSINESS_FUNDING_CODE,
      debit: 0,
      credit: shortfall,
      memo: 'Business Funding shortfall',
    });
  } else {
    lines.push({
      code: creditCode,
      debit: 0,
      credit: amount,
      drawer_id: drawerId,
      bank_account_id: bankAccountId,
      supplier_id: supplierTag,
    });
  }

  const journalId = await postJournal(db, {
    entry_date: expense.expense_date || expense.date,
    memo: expense.description || 'Expense',
    source_type: 'expense',
    source_id: expense.id,
    created_by: expense.logged_by || null,
    business_day_id: expense.business_day_id || null,
    lines,
  });
  return { journalId, businessFundingAmount: shortfall };
}

/* --------------------------------------------------------------- derived reads */

const signedBalance = "CASE WHEN a.type IN ('asset','expense') THEN COALESCE(SUM(jl.debit - jl.credit),0) ELSE COALESCE(SUM(jl.credit - jl.debit),0) END";

/** Chart of accounts with a derived balance per account. */
export async function listAccountsWithBalances(db) {
  return db.all(
    `SELECT a.*, p.code AS parent_code, p.name AS parent_name,
       ${signedBalance} AS balance
     FROM accounts a
     LEFT JOIN accounts p ON a.parent_id = p.id
     LEFT JOIN journal_lines jl ON jl.account_id = a.id
     GROUP BY a.id, p.code, p.name
     ORDER BY a.code`
  );
}

function dateWhere(alias, from, to, params) {
  let sql = '';
  if (from) { sql += ` AND ${alias}.entry_date >= ?`; params.push(from); }
  if (to) { sql += ` AND ${alias}.entry_date <= ?`; params.push(to); }
  return sql;
}

/** Ledger lines for one account, oldest first (running balance computed by caller). */
export async function generalLedger(db, { accountId, from, to }) {
  const params = [accountId];
  const where = dateWhere('je', from, to, params);
  return db.all(
    `SELECT je.id AS journal_id,je.entry_date,je.memo,je.source_type,je.source_id,je.created_at,
            u.full_name AS created_by_name,jl.debit,jl.credit,jl.memo AS line_memo
     FROM journal_lines jl JOIN journal_entries je ON jl.journal_id = je.id
     LEFT JOIN users u ON u.id=je.created_by
     WHERE jl.account_id = ? ${where}
     ORDER BY je.entry_date, je.id, jl.id`,
    params
  );
}

/** Cash Book — movements on Cash on Hand, optionally one drawer. */
export async function cashBook(db, { drawerId, from, to }) {
  const cashId = await accountIdByCode(db, '1010');
  const params = [cashId];
  let where = dateWhere('je', from, to, params);
  if (drawerId) { where += ' AND jl.drawer_id = ?'; params.push(drawerId); }
  return db.all(
    `SELECT je.id AS journal_id,je.entry_date,je.memo,je.source_type,je.source_id,je.created_at,
            u.full_name AS created_by_name,jl.debit,jl.credit,jl.drawer_id
     FROM journal_lines jl JOIN journal_entries je ON jl.journal_id = je.id
     LEFT JOIN users u ON u.id=je.created_by
     WHERE jl.account_id = ? ${where}
     ORDER BY je.entry_date, je.id, jl.id`,
    params
  );
}

/** Bank Book — movements on Bank, optionally one bank account. */
export async function bankBook(db, { bankAccountId, from, to }) {
  const bankId = await accountIdByCode(db, '1020');
  const params = [bankId];
  let where = dateWhere('je', from, to, params);
  if (bankAccountId) { where += ' AND jl.bank_account_id = ?'; params.push(bankAccountId); }
  return db.all(
    `SELECT je.id AS journal_id,je.entry_date,je.memo,je.source_type,je.source_id,je.created_at,
            u.full_name AS created_by_name,jl.debit,jl.credit,jl.bank_account_id
     FROM journal_lines jl JOIN journal_entries je ON jl.journal_id = je.id
     LEFT JOIN users u ON u.id=je.created_by
     WHERE jl.account_id = ? ${where}
     ORDER BY je.entry_date, je.id, jl.id`,
    params
  );
}

/** Journal list (headers with their lines) for the journal viewer. */
export async function journalList(db, { from, to, source_type, limit = 100 }) {
  const params = [];
  let where = '1=1';
  if (from) { where += ' AND je.entry_date >= ?'; params.push(from); }
  if (to) { where += ' AND je.entry_date <= ?'; params.push(to); }
  if (source_type && source_type !== 'all') { where += ' AND je.source_type = ?'; params.push(source_type); }
  const entries = await db.all(
    `SELECT je.*, u.full_name AS created_by_name FROM journal_entries je
     LEFT JOIN users u ON je.created_by = u.id
     WHERE ${where} ORDER BY je.entry_date DESC, je.id DESC LIMIT ${Number(limit) || 100}`,
    params
  );
  if (!entries.length) return [];
  const ids = entries.map((e) => e.id);
  const lines = await db.all(
    `SELECT jl.*, a.code AS account_code, a.name AS account_name, a.type AS account_type
     FROM journal_lines jl JOIN accounts a ON jl.account_id = a.id
     WHERE jl.journal_id IN (${ids.map(() => '?').join(',')}) ORDER BY jl.id`,
    ids
  );
  const byJournal = new Map();
  for (const l of lines) {
    if (!byJournal.has(l.journal_id)) byJournal.set(l.journal_id, []);
    byJournal.get(l.journal_id).push(l);
  }
  return entries.map((e) => ({ ...e, lines: byJournal.get(e.id) || [] }));
}

/** Pending settlement balances per clearing account (asset clearing = money not yet in bank). */
export async function pendingSettlements(db) {
  return db.all(
    `SELECT a.code, a.name, COALESCE(SUM(jl.debit - jl.credit),0) AS pending
     FROM accounts a LEFT JOIN journal_lines jl ON jl.account_id = a.id
     WHERE a.subtype = 'clearing'
     GROUP BY a.id ORDER BY a.code`
  );
}

/* --------------------------------------------------------------- CoA CRUD */

export async function createAccount(db, data) {
  const code = String(data.code || '').trim();
  const name = String(data.name || '').trim();
  if (!code || !name) throw Object.assign(new Error('Code and name are required.'), { status: 400 });
  if (!['asset', 'liability', 'equity', 'income', 'expense'].includes(data.type))
    throw Object.assign(new Error('Pick a valid account type.'), { status: 400 });
  if (await db.get(`SELECT id FROM accounts WHERE code = ?`, [code]))
    throw Object.assign(new Error('That account code already exists.'), { status: 409 });
  await db.run(
    `INSERT INTO accounts (code, name, type, subtype, parent_id, is_active, is_system) VALUES (?, ?, ?, ?, ?, 1, 0)`,
    [code, name, data.type, data.subtype || null, data.parent_id || null]
  );
  return db.get(`SELECT * FROM accounts WHERE code = ?`, [code]);
}

export async function updateAccount(db, id, data) {
  const before = await db.get(`SELECT * FROM accounts WHERE id = ?`, [id]);
  if (!before) throw Object.assign(new Error('Account not found.'), { status: 404 });
  const name = String(data.name ?? before.name).trim();
  // System accounts: name / active can change, code / type cannot (the engine keys off them).
  const code = before.is_system ? before.code : String(data.code ?? before.code).trim();
  const type = before.is_system ? before.type : (data.type || before.type);
  if (code !== before.code && (await db.get(`SELECT id FROM accounts WHERE code = ? AND id <> ?`, [code, id])))
    throw Object.assign(new Error('That account code already exists.'), { status: 409 });
  await db.run(
    `UPDATE accounts SET code = ?, name = ?, type = ?, subtype = ?, parent_id = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [code, name, type, data.subtype ?? before.subtype, data.parent_id ?? before.parent_id, data.is_active === false ? 0 : 1, id]
  );
  return db.get(`SELECT * FROM accounts WHERE id = ?`, [id]);
}

export async function deleteAccount(db, id) {
  const acc = await db.get(`SELECT * FROM accounts WHERE id = ?`, [id]);
  if (!acc) return;
  if (acc.is_system) throw Object.assign(new Error('System accounts cannot be deleted.'), { status: 409 });
  const used = await db.get(`SELECT COUNT(*) AS n FROM journal_lines WHERE account_id = ?`, [id]);
  if (Number(used?.n || 0) > 0)
    throw Object.assign(new Error('This account has journal entries and cannot be deleted. Deactivate it instead.'), { status: 409 });
  await db.run(`DELETE FROM accounts WHERE id = ?`, [id]);
}
