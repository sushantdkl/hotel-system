/**
 * Bank reconciliation. A bank line (journal_lines on account 1020) is flagged
 * `reconciled` once it clears on the bank statement. Cleared / uncleared totals
 * stay derived from journal_lines; a reconciliation row just snapshots the
 * statement balance vs the cleared book balance so the difference is auditable.
 */

import { accountIdByCode, accountBalance } from './accounting.js';
import { nepalDateString } from './report-dates.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const bad = (m) => Object.assign(new Error(m), { status: 400 });

/** Book lines for one bank account with their reconciled flag, plus balances. */
export async function reconciliationView(db, bankAccountId) {
  if (!bankAccountId) throw bad('Choose a bank account.');
  const bankId = await accountIdByCode(db, '1020');
  const lines = await db.all(
    `SELECT jl.id, je.entry_date, je.memo, je.source_type, jl.debit, jl.credit, jl.reconciled
     FROM journal_lines jl JOIN journal_entries je ON jl.journal_id = je.id
     WHERE jl.account_id = ? AND jl.bank_account_id = ?
     ORDER BY je.entry_date, je.id, jl.id`,
    [bankId, bankAccountId]
  );
  const bookBalance = round2(await accountBalance(db, '1020', { bankAccountId }));
  const cleared = round2(
    (await db.get(
      `SELECT COALESCE(SUM(debit - credit), 0) AS c FROM journal_lines
       WHERE account_id = ? AND bank_account_id = ? AND reconciled = 1`,
      [bankId, bankAccountId]
    ))?.c || 0
  );
  const last = await db.get(
    `SELECT * FROM bank_reconciliations WHERE bank_account_id = ? ORDER BY statement_date DESC, id DESC LIMIT 1`,
    [bankAccountId]
  );
  return {
    lines: lines.map((l) => ({ ...l, debit: Number(l.debit), credit: Number(l.credit), reconciled: Number(l.reconciled) === 1 })),
    bookBalance,
    clearedBalance: cleared,
    unclearedBalance: round2(bookBalance - cleared),
    lastReconciliation: last || null,
  };
}

/** Toggle one bank line's cleared flag. Only lines on the Bank account qualify. */
export async function toggleReconciled(db, lineId, reconciled) {
  const bankId = await accountIdByCode(db, '1020');
  const line = await db.get(`SELECT id, account_id FROM journal_lines WHERE id = ?`, [lineId]);
  if (!line) throw bad('Line not found.');
  if (Number(line.account_id) !== Number(bankId)) throw bad('Only bank lines can be reconciled.');
  await db.run(
    `UPDATE journal_lines SET reconciled = ?, reconciled_at = ${reconciled ? 'CURRENT_TIMESTAMP' : 'NULL'} WHERE id = ?`,
    [reconciled ? 1 : 0, lineId]
  );
  return { id: lineId, reconciled: !!reconciled };
}

/** Snapshot the reconciliation: cleared book balance vs the entered statement balance. */
export async function finalizeReconciliation(db, { bank_account_id, statement_date, statement_balance, note, created_by = null }) {
  if (!bank_account_id) throw bad('Choose a bank account.');
  if (statement_balance === undefined || statement_balance === null || statement_balance === '') throw bad('Enter the statement balance.');
  const bankId = await accountIdByCode(db, '1020');
  const cleared = round2(
    (await db.get(
      `SELECT COALESCE(SUM(debit - credit), 0) AS c FROM journal_lines
       WHERE account_id = ? AND bank_account_id = ? AND reconciled = 1`,
      [bankId, bank_account_id]
    ))?.c || 0
  );
  const stmt = round2(statement_balance);
  const difference = round2(stmt - cleared);
  await db.run(
    `INSERT INTO bank_reconciliations (bank_account_id, statement_date, statement_balance, book_balance, difference, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [bank_account_id, statement_date || nepalDateString(), stmt, cleared, difference, note || null, created_by]
  );
  return { cleared, statement_balance: stmt, difference };
}

/** Per-bank reconciliation health for the dashboard. */
export async function reconciliationDashboard(db) {
  const bankId = await accountIdByCode(db, '1020');
  const banks = await db.all(`SELECT id, name FROM bank_accounts WHERE is_active = 1 ORDER BY id`);
  const out = [];
  for (const b of banks) {
    const bookBalance = round2(await accountBalance(db, '1020', { bankAccountId: b.id }));
    const cleared = round2(
      (await db.get(
        `SELECT COALESCE(SUM(debit - credit), 0) AS c FROM journal_lines
         WHERE account_id = ? AND bank_account_id = ? AND reconciled = 1`,
        [bankId, b.id]
      ))?.c || 0
    );
    const un = await db.get(
      `SELECT COUNT(*) AS n, COALESCE(SUM(debit - credit), 0) AS amt FROM journal_lines
       WHERE account_id = ? AND bank_account_id = ? AND COALESCE(reconciled, 0) = 0`,
      [bankId, b.id]
    );
    const last = await db.get(
      `SELECT statement_date, difference FROM bank_reconciliations WHERE bank_account_id = ? ORDER BY statement_date DESC, id DESC LIMIT 1`,
      [b.id]
    );
    out.push({
      id: b.id,
      name: b.name,
      bookBalance,
      clearedBalance: cleared,
      unreconciledCount: Number(un?.n || 0),
      unreconciledAmount: round2(un?.amt || 0),
      lastReconciledDate: last?.statement_date || null,
      lastDifference: last ? round2(last.difference) : null,
    });
  }
  return out;
}
