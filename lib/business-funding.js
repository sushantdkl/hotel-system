import { ensureSqliteTable } from '@/lib/db/ensure-sqlite-table.js';
import { serialPkSql } from '@/lib/db/schema-helpers.js';
import {
  accountBalance,
  accountBalanceAsOf,
  currentDrawerId,
  deleteJournalBySource,
  ensureAccountingSchema,
  postJournal,
} from '@/lib/accounting.js';
import { nepalDateString } from '@/lib/report-dates.js';

export const BUSINESS_FUNDING_CODE = '1050';
const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

export async function ensureBusinessFundingSchema(db) {
  await ensureAccountingSchema(db);
  const pk = serialPkSql(db);
  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS business_funding_transactions (
    ${pk}, transaction_date DATE NOT NULL, transaction_type TEXT NOT NULL DEFAULT 'investment',
    amount REAL NOT NULL, note TEXT, created_by INTEGER, journal_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
}

export async function addBusinessInvestment(db, { amount, date, note, createdBy }) {
  const value = round2(amount);
  if (!(value > 0)) throw Object.assign(new Error('Investment amount must be greater than zero.'), { status: 400 });
  const transactionDate = date || nepalDateString();
  await ensureBusinessFundingSchema(db);

  return db.transaction(async (tx) => {
    const result = await tx.run(
      `INSERT INTO business_funding_transactions
         (transaction_date, transaction_type, amount, note, created_by)
       VALUES (?, 'investment', ?, ?, ?)`,
      [transactionDate, value, String(note || '').trim() || null, createdBy || null]
    );
    const id = result.lastInsertRowid;
    const journalId = await postJournal(tx, {
      entry_date: transactionDate,
      memo: `Owner investment${note ? ` — ${String(note).trim()}` : ''}`,
      source_type: 'business_funding_investment',
      source_id: id,
      created_by: createdBy || null,
      lines: [
        { code: BUSINESS_FUNDING_CODE, debit: value, credit: 0, memo: 'Funds available' },
        { code: '3010', debit: 0, credit: value, memo: 'Owner capital invested' },
      ],
    });
    await tx.run(`UPDATE business_funding_transactions SET journal_id=? WHERE id=?`, [journalId, id]);
    return tx.get(`SELECT * FROM business_funding_transactions WHERE id=?`, [id]);
  });
}

async function firstFundingDeficit(db) {
  return db.get(
    `SELECT entry_date, running_balance FROM (
       SELECT x.entry_date,
              SUM(SUM(CASE WHEN a.type IN ('asset','expense')
                           THEN jl.debit-jl.credit ELSE jl.credit-jl.debit END))
                OVER (ORDER BY x.entry_date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_balance
       FROM journal_entries x
       JOIN journal_lines jl ON jl.journal_id=x.id
       JOIN accounts a ON a.id=jl.account_id
       WHERE a.code=?
       GROUP BY x.entry_date
     ) dated_balances
     WHERE running_balance < -0.005
     ORDER BY entry_date LIMIT 1`,
    [BUSINESS_FUNDING_CODE]
  );
}

/** Correct when an existing investment became available without adding it twice. */
export async function updateBusinessInvestment(db, { id, date, note }) {
  const investmentId = Number(id);
  if (!Number.isInteger(investmentId) || investmentId <= 0) {
    throw Object.assign(new Error('Choose a valid Business Funding investment.'), { status: 400 });
  }
  await ensureBusinessFundingSchema(db);

  return db.transaction(async (tx) => {
    const existing = await tx.get(
      `SELECT * FROM business_funding_transactions WHERE id=? AND transaction_type='investment'`,
      [investmentId]
    );
    if (!existing) throw Object.assign(new Error('Business Funding investment not found.'), { status: 404 });

    const transactionDate = String(date || existing.transaction_date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(transactionDate)) {
      throw Object.assign(new Error('Enter a valid investment date.'), { status: 400, code: 'validation' });
    }
    const cleanNote = String(note || '').trim() || null;
    await deleteJournalBySource(tx, 'business_funding_investment', investmentId);
    await tx.run(
      `UPDATE business_funding_transactions SET transaction_date=?, note=?, journal_id=NULL WHERE id=?`,
      [transactionDate, cleanNote, investmentId]
    );
    const journalId = await postJournal(tx, {
      entry_date: transactionDate,
      memo: `Owner investment${cleanNote ? ` — ${cleanNote}` : ''}`,
      source_type: 'business_funding_investment',
      source_id: investmentId,
      created_by: existing.created_by || null,
      lines: [
        { code: BUSINESS_FUNDING_CODE, debit: existing.amount, credit: 0, memo: 'Funds available' },
        { code: '3010', debit: 0, credit: existing.amount, memo: 'Owner capital invested' },
      ],
    });
    await tx.run(`UPDATE business_funding_transactions SET journal_id=? WHERE id=?`, [journalId, investmentId]);

    const deficit = await firstFundingDeficit(tx);
    if (deficit) {
      const shortfall = round2(Math.abs(deficit.running_balance));
      throw Object.assign(
        new Error(`This date would leave Business Funding short by Rs ${shortfall.toFixed(2)} on ${String(deficit.entry_date).slice(0, 10)}.`),
        { status: 409, code: 'business_funding_history_conflict', shortfall, transaction_date: String(deficit.entry_date).slice(0, 10) }
      );
    }
    return tx.get(`SELECT * FROM business_funding_transactions WHERE id=?`, [investmentId]);
  });
}

export async function businessFundingProfile(db, { limit = 100 } = {}) {
  await ensureBusinessFundingSchema(db);
  const totals = await db.get(
    `SELECT COALESCE(SUM(amount),0) AS total_invested, COUNT(*) AS investment_count
     FROM business_funding_transactions WHERE transaction_type='investment'`
  );
  const available = await accountBalance(db, BUSINESS_FUNDING_CODE);
  // Ledger inflows (owner investments + reserve transfers + any seed deposits)
  // and shortfall outflows — so "Used" never goes negative when money entered
  // 1050 outside business_funding_transactions.
  const flow = await db.get(
    `SELECT
        COALESCE(SUM(CASE WHEN jl.debit > 0 THEN jl.debit ELSE 0 END),0) AS inflow,
        COALESCE(SUM(CASE WHEN jl.credit > 0 THEN jl.credit ELSE 0 END),0) AS outflow
     FROM journal_lines jl
     JOIN accounts a ON a.id = jl.account_id
     WHERE a.code = ?`,
    [BUSINESS_FUNDING_CODE]
  );
  const ledgerIn = round2(flow?.inflow);
  const ledgerOut = round2(flow?.outflow);
  const tableInvested = round2(totals?.total_invested);
  const totalInvested = round2(Math.max(tableInvested, ledgerIn));
  const history = await db.all(
    `SELECT x.id, x.entry_date, x.memo, x.source_type, x.source_id, x.created_at,
            u.full_name AS created_by_name,
            COALESCE(SUM(CASE WHEN a.code=? THEN jl.debit-jl.credit ELSE 0 END),0) AS amount
     FROM journal_entries x
     JOIN journal_lines jl ON jl.journal_id=x.id
     JOIN accounts a ON a.id=jl.account_id
     LEFT JOIN users u ON u.id=x.created_by
     WHERE x.source_type IN ('business_funding_investment','business_funding_use','opening_reserve_to_funding','business_funding_deposit')
        OR (x.source_type IN ('expense','supplier_payment') AND EXISTS (
          SELECT 1 FROM journal_lines used JOIN accounts used_account ON used_account.id=used.account_id
          WHERE used.journal_id=x.id AND used_account.code=? AND used.credit>0
        ))
        OR (x.source_type='reversal' AND EXISTS (
          SELECT 1 FROM journal_entries original
          WHERE original.id=x.source_id AND (
            original.source_type='business_funding_use'
            OR original.source_type='opening_reserve_to_funding'
            OR (original.source_type IN ('expense','supplier_payment') AND EXISTS (
              SELECT 1 FROM journal_lines original_line JOIN accounts original_account ON original_account.id=original_line.account_id
              WHERE original_line.journal_id=original.id AND original_account.code=? AND original_line.credit>0
            ))
          )
        ))
     GROUP BY x.id, x.entry_date, x.memo, x.source_type, x.source_id, x.created_at, u.full_name
     ORDER BY x.entry_date DESC, x.id DESC LIMIT ?`,
    [BUSINESS_FUNDING_CODE, BUSINESS_FUNDING_CODE, BUSINESS_FUNDING_CODE, Number(limit) || 100]
  );
  return {
    totalInvested,
    investmentCount: Number(totals?.investment_count || 0),
    totalUsed: ledgerOut,
    availableBalance: round2(available),
    history: history.map((row) => ({ ...row, amount: round2(row.amount) })),
  };
}

/**
 * Ensure the selected cash/bank account can pay a dated expense. If it cannot,
 * require explicit consent and return the shortfall so the expense journal can
 * credit Business Funding (1050) for that portion on the expense date — Cash/Bank
 * is only credited for what that medium can cover. Legacy `business_funding_use`
 * cash top-up journals (Dr cash / Cr 1050 on today) are removed so edits stay
 * idempotent and past-day cash is not overdrawn.
 *
 * Funding availability uses the *current* Business Funding pool.
 */
export async function prepareExpenseFunding(db, expense, paymentCode) {
  await ensureBusinessFundingSchema(db);
  // Drop legacy today-dated cash top-ups; funded shortfall now lives on the expense journal.
  await deleteJournalBySource(db, 'business_funding_use', expense.id);
  if (!['1010', '1020'].includes(paymentCode)) return { amount: 0 };

  const date = expense.expense_date || expense.date || nepalDateString();
  const today = nepalDateString();
  const historicalDrawer = paymentCode === '1010' && expense.business_day_id
    ? await db.get(
        `SELECT drawer_id FROM drawer_sessions WHERE business_day_id=? ORDER BY opened_at,id LIMIT 1`,
        [expense.business_day_id]
      ).catch(() => null)
    : null;
  const drawerId = paymentCode === '1010' ? (historicalDrawer?.drawer_id || await currentDrawerId(db)) : null;

  // Bank/online uses the *current* ledger balance so later QR/bank sales can
  // fund a backdated purchase. Cash on a business day uses declared opening +
  // operating movements only — the day-open bridge (prior counted → today's
  // opening) is already baked into opening_cash and must not reduce available
  // cash again (same rule as the Summary Report / expected drawer cash).
  let balance;
  if (paymentCode === '1020') {
    balance = round2(await accountBalance(db, '1020'));
  } else if (expense.business_day_id) {
    const day = await db.get(
      `SELECT status,opening_cash FROM business_days WHERE id=?`,
      [expense.business_day_id]
    ).catch(() => null);
    if (day) {
      const movement = await db.get(
        `SELECT COALESCE(SUM(jl.debit-jl.credit),0) AS amount
         FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_id
         JOIN accounts a ON a.id=jl.account_id
         WHERE je.business_day_id=? AND a.code='1010'
           AND COALESCE(je.source_type,'') NOT IN ('drawer_open','drawer','opening_cash_movement','opening_cash_alignment','business_day_close')`,
        [expense.business_day_id]
      );
      balance = round2(Number(day.opening_cash || 0) + Number(movement?.amount || 0));
    } else {
      balance = round2(await accountBalanceAsOf(db, paymentCode, date, { drawerId }));
    }
  } else {
    balance = round2(await accountBalanceAsOf(db, paymentCode, date, { drawerId }));
  }
  const shortfall = round2(Math.max(0, Number(expense.amount || 0) - Math.max(0, balance)));
  if (!(shortfall > 0)) return { amount: 0, balance };

  const available = round2(await accountBalance(db, BUSINESS_FUNDING_CODE));
  if (!expense.use_business_funding) {
    const medium = paymentCode === '1010' ? 'Cash' : 'Bank';
    const when = paymentCode === '1020'
      ? `Bank has Rs ${balance.toFixed(2)} available now`
      : `${medium} would be short by Rs ${shortfall.toFixed(2)} on ${date}`;
    throw Object.assign(
      new Error(
        paymentCode === '1020'
          ? `${when}, but this purchase needs Rs ${Number(expense.amount || 0).toFixed(2)} (short Rs ${shortfall.toFixed(2)}). Use Business Funding?`
          : `${when}. Use Business Funding?`
      ),
      { status: 409, code: 'business_funding_required', shortfall, available, payment_balance: balance, transaction_date: paymentCode === '1020' ? today : date }
    );
  }
  if (available + 0.001 < shortfall) {
    throw Object.assign(
      new Error(`Business Funding has Rs ${available.toFixed(2)} available, but Rs ${shortfall.toFixed(2)} is required.`),
      { status: 409, code: 'business_funding_insufficient', shortfall, available, transaction_date: today }
    );
  }

  return { amount: shortfall, balance, available };
}

/**
 * Re-post expenses that still have the legacy shape: full Cash/Bank credit on
 * the expense journal plus a separate business_funding_use cash top-up.
 * New shape credits Cash/Bank only for the covered portion and 1050 for the shortfall.
 */
export async function repairFundedExpenseCashSplit(db) {
  await ensureBusinessFundingSchema(db);
  const rows = await db.all(
    `SELECT e.id, e.amount, e.description, e.category, e.payment_method,
            COALESCE(e.purchase_date, CAST(e.expense_date AS TEXT)) AS expense_date,
            e.logged_by, e.source_type, e.business_day_id, e.supplier
     FROM expenses e
     WHERE LOWER(COALESCE(e.status,'active'))<>'voided'
       AND EXISTS (
         SELECT 1 FROM journal_entries je
         WHERE je.source_type='business_funding_use' AND je.source_id=e.id
       )
     ORDER BY COALESCE(e.purchase_date, CAST(e.expense_date AS TEXT)), e.id`
  ).catch(() => []);

  let fixed = 0;
  const { postExpenseJournal } = await import('@/lib/accounting.js');
  for (const row of rows || []) {
    const method = String(row.payment_method || 'cash').toLowerCase();
    // Only cash/bank shortfall funding used the legacy top-up journal.
    if (!['cash', 'bank', 'bank_transfer', 'cheque', 'card', 'esewa', 'khalti', 'qr', 'fonepay', 'online'].includes(method)) {
      await deleteJournalBySource(db, 'business_funding_use', row.id);
      continue;
    }
    await postExpenseJournal(db, {
      id: row.id,
      amount: row.amount,
      description: row.description,
      category: row.category,
      payment_method: row.payment_method || 'cash',
      expense_date: String(row.expense_date || '').slice(0, 10),
      logged_by: row.logged_by || null,
      source_type: row.source_type || null,
      business_day_id: row.business_day_id || null,
      use_business_funding: true,
    });
    fixed += 1;
  }
  return fixed;
}

const OPENING_REASON_LABELS = {
  cash_reserve: 'Cash Reserve / Safe',
  bank_deposit: 'Bank Deposit',
  bank_withdrawal: 'Bank Withdrawal',
  owner_withdrawal: 'Owner Withdrawal',
  owner_contribution: 'Owner Contribution',
  other: 'Other',
};

const DEST_BY_REASON = {
  cash_reserve: { code: '1030', name: 'Cash Reserve / Safe' },
  bank_deposit: { code: '1020', name: 'Bank' },
  bank_withdrawal: { code: '1020', name: 'Bank' },
  owner_withdrawal: { code: '3010', name: "Owner's Equity" },
  owner_contribution: { code: '3010', name: "Owner's Equity" },
  other: { code: '3020', name: 'Opening Balance Equity' },
};

function parseOpeningCashRef(externalRef) {
  const raw = String(externalRef || '');
  // opening-cash:{businessDayId}:{action}:{priorCash}:{openingCash}:{reason}
  const match = raw.match(/^opening-cash:(\d+):([^:]+):([^:]+):([^:]+):(.+)$/);
  if (!match) return null;
  return {
    business_day_id: Number(match[1]),
    action: match[2],
    prior_cash: round2(match[3]),
    opening_cash: round2(match[4]),
    reason: String(match[5] || '').trim(),
  };
}

/** Infer reason when external_ref is missing/legacy (demo seed, older rows). */
function inferOpeningReason({ parsedReason, contraCode, drawerDelta, memo }) {
  if (parsedReason && OPENING_REASON_LABELS[parsedReason]) return parsedReason;
  const memoText = String(memo || '').toLowerCase();
  if (memoText.includes('cash reserve')) return 'cash_reserve';
  if (memoText.includes('bank deposit')) return 'bank_deposit';
  if (memoText.includes('bank withdrawal')) return 'bank_withdrawal';
  if (memoText.includes('owner withdrawal')) return 'owner_withdrawal';
  if (memoText.includes('owner contribution')) return 'owner_contribution';
  if (memoText.includes('other')) return 'other';
  const code = String(contraCode || '');
  if (code === '1030') return 'cash_reserve';
  if (code === '1020') return drawerDelta < 0 ? 'bank_deposit' : 'bank_withdrawal';
  if (code === '3010') return drawerDelta < 0 ? 'owner_withdrawal' : 'owner_contribution';
  if (code === '3020') return 'other';
  return null;
}

/**
 * Opening-cash movements recorded when a day/session opens with a different
 * drawer amount than the prior counted close.
 */
export async function listOpeningCashMovements(db, {
  from = null, to = null, reason = null, direction = null, q = null, limit = 500,
} = {}) {
  await ensureAccountingSchema(db);
  const capped = Math.max(1, Math.min(Number(limit) || 500, 2000));
  const conditions = [`je.source_type = 'opening_cash_movement'`];
  const params = [];
  if (from) { conditions.push('je.entry_date >= ?'); params.push(from); }
  if (to) { conditions.push('je.entry_date <= ?'); params.push(to); }
  if (q) {
    conditions.push('(LOWER(COALESCE(je.memo,\'\')) LIKE ? OR LOWER(COALESCE(je.external_ref,\'\')) LIKE ?)');
    const like = `%${String(q).toLowerCase()}%`;
    params.push(like, like);
  }

  const rows = await db.all(
    `SELECT je.id, je.entry_date, je.memo, je.external_ref, je.created_at, je.created_by,
            je.business_day_id, u.full_name AS created_by_name,
            bd.business_date,
            COALESCE(SUM(CASE WHEN a.code='1010' THEN jl.debit - jl.credit ELSE 0 END),0) AS drawer_delta,
            COALESCE(SUM(jl.debit),0) AS total_debit,
            MAX(CASE WHEN a.code <> '1010' THEN a.code END) AS contra_code
       FROM journal_entries je
       JOIN journal_lines jl ON jl.journal_id = je.id
       JOIN accounts a ON a.id = jl.account_id
       LEFT JOIN users u ON u.id = je.created_by
       LEFT JOIN business_days bd ON bd.id = je.business_day_id
      WHERE ${conditions.join(' AND ')}
      GROUP BY je.id, je.entry_date, je.memo, je.external_ref, je.created_at, je.created_by,
               je.business_day_id, u.full_name, bd.business_date
      ORDER BY je.entry_date DESC, je.id DESC
      LIMIT ${capped}`,
    params
  );

  const transferred = rows.length
    ? await db.all(
        `SELECT source_id FROM journal_entries
          WHERE source_type='opening_reserve_to_funding'
            AND source_id IN (${rows.map(() => '?').join(',')})`,
        rows.map((row) => row.id)
      )
    : [];
  const transferredSet = new Set(transferred.map((row) => Number(row.source_id)));

  const movements = [];
  for (const row of rows) {
    const parsed = parseOpeningCashRef(row.external_ref);
    const drawerDelta = round2(row.drawer_delta);
    // Positive drawer_delta = cash added to drawer; negative = removed.
    const dir = drawerDelta > 0.005 ? 'in' : drawerDelta < -0.005 ? 'out' : 'flat';
    const reasonKey = inferOpeningReason({
      parsedReason: parsed?.reason || null,
      contraCode: row.contra_code,
      drawerDelta,
      memo: row.memo,
    });
    if (reason && reasonKey !== reason) continue;
    if (direction && direction !== dir) continue;
    const amount = round2(Math.abs(drawerDelta) || Number(row.total_debit) || 0);
    const dest = DEST_BY_REASON[reasonKey] || { code: null, name: 'Unknown' };
    const transferable = dir === 'out' && reasonKey === 'cash_reserve' && !transferredSet.has(Number(row.id));
    movements.push({
      id: Number(row.id),
      entry_date: row.entry_date,
      business_day_id: row.business_day_id || parsed?.business_day_id || null,
      business_date: row.business_date || null,
      memo: row.memo,
      external_ref: row.external_ref,
      created_at: row.created_at,
      created_by_name: row.created_by_name || 'System',
      reason: reasonKey,
      reason_label: OPENING_REASON_LABELS[reasonKey] || reasonKey || 'Unknown',
      direction: dir,
      amount,
      prior_cash: parsed?.prior_cash ?? null,
      opening_cash: parsed?.opening_cash ?? null,
      destination_code: dest.code,
      destination_name: dest.name,
      transferred: transferredSet.has(Number(row.id)),
      transferable,
    });
  }

  const totals = movements.reduce((acc, row) => {
    if (row.direction === 'out') acc.removed = round2(acc.removed + row.amount);
    if (row.direction === 'in') acc.added = round2(acc.added + row.amount);
    if (row.transferable) acc.transferable = round2(acc.transferable + row.amount);
    return acc;
  }, { removed: 0, added: 0, transferable: 0 });

  return {
    movements,
    totals,
    reserve_balance: round2(await accountBalance(db, '1030')),
    funding_available: round2(await accountBalance(db, BUSINESS_FUNDING_CODE)),
  };
}

export async function getOpeningCashMovementDetail(db, journalId) {
  const id = Number(journalId);
  if (!Number.isInteger(id) || id <= 0) {
    throw Object.assign(new Error('Choose a valid opening cash movement.'), { status: 400 });
  }
  await ensureAccountingSchema(db);
  const listed = await listOpeningCashMovements(db, { limit: 2000 });
  const movement = listed.movements.find((row) => row.id === id);
  if (!movement) throw Object.assign(new Error('Opening cash movement not found.'), { status: 404 });
  const lines = await db.all(
    `SELECT a.code, a.name, jl.debit, jl.credit, jl.memo, jl.drawer_id, jl.bank_account_id
       FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
      WHERE jl.journal_id = ? ORDER BY jl.id`,
    [id]
  );
  return { ...movement, lines: lines.map((line) => ({
    ...line,
    debit: round2(line.debit),
    credit: round2(line.credit),
  })) };
}

/**
 * Move Cash Reserve (1030) money that came from an opening-cash removal into
 * Business Funding (1050). Idempotent per source journal.
 */
export async function transferOpeningReserveToFunding(db, {
  journalIds = [], createdBy = null,
} = {}) {
  await ensureBusinessFundingSchema(db);
  const ids = [...new Set((journalIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) {
    throw Object.assign(new Error('Select at least one Cash Reserve removal to transfer.'), { status: 400 });
  }

  return db.transaction(async (tx) => {
    const listed = await listOpeningCashMovements(tx, { limit: 2000 });
    const byId = new Map(listed.movements.map((row) => [row.id, row]));
    const transferred = [];
    let total = 0;
    const today = nepalDateString();
    let businessDayId = null;
    try {
      businessDayId = (await tx.get(
        `SELECT id FROM business_days WHERE status='open' ORDER BY id DESC LIMIT 1`
      ))?.id || null;
    } catch { /* optional */ }

    for (const id of ids) {
      const movement = byId.get(id);
      if (!movement) {
        throw Object.assign(new Error(`Opening cash movement #${id} was not found.`), { status: 404 });
      }
      if (!movement.transferable) {
        if (movement.transferred) continue;
        throw Object.assign(
          new Error(`Only Cash Reserve removals can transfer to Business Funding (journal #${id}).`),
          { status: 409, code: 'not_transferable' }
        );
      }
      const amount = round2(movement.amount);
      if (!(amount > 0)) continue;
      const reserveNow = round2(await accountBalance(tx, '1030'));
      if (amount > reserveNow + 0.001) {
        throw Object.assign(
          new Error(`Cash Reserve only has Rs ${reserveNow.toFixed(2)}; cannot transfer Rs ${amount.toFixed(2)}.`),
          { status: 409, code: 'reserve_insufficient', available: reserveNow }
        );
      }
      const journalId = await postJournal(tx, {
        entry_date: today,
        memo: `Cash Reserve moved to Business Funding (from opening #${id})`,
        source_type: 'opening_reserve_to_funding',
        source_id: id,
        external_ref: `opening-reserve-to-funding:${id}`,
        created_by: createdBy,
        business_day_id: businessDayId,
        lines: [
          { code: BUSINESS_FUNDING_CODE, debit: amount, credit: 0, memo: 'From cash reserve' },
          { code: '1030', debit: 0, credit: amount, memo: 'Transferred to funding' },
        ],
      });
      transferred.push({ opening_journal_id: id, funding_journal_id: journalId, amount });
      total = round2(total + amount);
    }

    return {
      transferred,
      total,
      reserve_balance: round2(await accountBalance(tx, '1030')),
      funding_available: round2(await accountBalance(tx, BUSINESS_FUNDING_CODE)),
    };
  });
}

