/**
 * Cash & bank operations that each post a journal through the engine:
 * drawer open/close (with reconciliation), bank accounts, deposits /
 * withdrawals / transfers, payment settlement, and cash exchange.
 *
 * Nothing here stores a balance. "Expected cash" at close is derived from the
 * opening float plus the cash journal lines tagged to that drawer during the
 * session; the count difference is posted to Cash Over/Short so the ledger
 * always agrees with the physical drawer.
 */

import { postJournal, paymentAccountCode, accountBalance, primaryBankAccountId } from '@/lib/accounting.js';
import { makePagination } from '@/lib/paginate.js';
import { nepalOperationalRangeBounds } from '@/lib/report-dates.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const bad = (m) => Object.assign(new Error(m), { status: 400 });
const conflict = (m) => Object.assign(new Error(m), { status: 409 });

/* --------------------------------------------------------------- drawers */

export async function listDrawers(db) {
  return db.all(`SELECT * FROM cash_drawers WHERE is_active = 1 ORDER BY id`);
}

export async function createDrawer(db, name) {
  const clean = String(name || '').trim();
  if (!clean) throw bad('Drawer name is required.');
  await db.run(`INSERT INTO cash_drawers (name) VALUES (?)`, [clean]);
  return db.get(`SELECT * FROM cash_drawers WHERE id = (SELECT MAX(id) FROM cash_drawers)`);
}

export async function listSessions(db, {
  drawerId, page = 1, pageSize = 25, search = '', from = '', to = '', status = '', paged = false,
} = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeSize = Math.min(200, Math.max(1, Number(pageSize) || 25));
  const params = [];
  let where = '1=1';
  if (drawerId) { where += ' AND s.drawer_id = ?'; params.push(drawerId); }
  if (status === 'open' || status === 'closed') { where += ' AND s.status = ?'; params.push(status); }
  if (from) {
    const { start } = nepalOperationalRangeBounds(db.driver, from, from);
    where += ' AND s.opened_at >= ?'; params.push(start);
  }
  if (to) {
    const { endExclusive } = nepalOperationalRangeBounds(db.driver, to, to);
    where += ' AND s.opened_at < ?'; params.push(endExclusive);
  }
  if (String(search).trim()) {
    const needle = `%${String(search).trim().toLowerCase()}%`;
    where += ` AND (lower(CAST(COALESCE(d.name, '') AS TEXT)) LIKE ?
      OR lower(CAST(COALESCE(ou.full_name, '') AS TEXT)) LIKE ?
      OR lower(CAST(COALESCE(cu.full_name, '') AS TEXT)) LIKE ?
      OR lower(CAST(COALESCE(s.note, '') AS TEXT)) LIKE ?)`;
    params.push(needle, needle, needle, needle);
  }
  const fromSql = `drawer_sessions s
     JOIN cash_drawers d ON s.drawer_id = d.id
     LEFT JOIN users ou ON s.opened_by = ou.id
     LEFT JOIN users cu ON s.closed_by = cu.id`;
  const count = await db.get(`SELECT COUNT(*) AS total FROM ${fromSql} WHERE ${where}`, params);
  const rows = await db.all(
    `SELECT s.*, d.name AS drawer_name, ou.full_name AS opened_by_name, cu.full_name AS closed_by_name
     FROM ${fromSql}
     WHERE ${where} ORDER BY s.id DESC LIMIT ? OFFSET ?`,
    [...params, safeSize, (safePage - 1) * safeSize]
  );
  const result = { rows, pagination: makePagination({ page: safePage, pageSize: safeSize, total: Number(count?.total || 0) }) };
  return paged ? result : rows;
}

export async function openSession(db, { drawer_id, opening_amount = 0, opened_by = null, note = null, business_day_id = null }, { withinTransaction = false } = {}) {
  const drawerId = drawer_id || (await db.get(`SELECT id FROM cash_drawers WHERE is_active = 1 ORDER BY id LIMIT 1`))?.id;
  if (!drawerId) throw bad('No drawer to open.');
  const opening = round2(opening_amount);

  const perform = async (tx) => {
    // The partial unique index (one open session per drawer) is the real guard;
    // this check just returns a friendly error before hitting it.
    const open = await tx.get(`SELECT id FROM drawer_sessions WHERE drawer_id = ? AND status = 'open'`, [drawerId]);
    if (open) throw conflict('This drawer already has an open session. Close it first.');

    let session;
    try {
      await tx.run(
        `INSERT INTO drawer_sessions (drawer_id, status, opening_amount, opened_by, note, business_day_id) VALUES (?, 'open', ?, ?, ?, ?)`,
        [drawerId, opening, opened_by, note, business_day_id]
      );
      session = await tx.get(`SELECT * FROM drawer_sessions WHERE id = (SELECT MAX(id) FROM drawer_sessions WHERE drawer_id = ?)`, [drawerId]);
    } catch (e) {
      if (/unique|duplicate|idx_drawer_one_open/i.test(String(e?.message || e?.code || ''))) {
        throw conflict('This drawer already has an open session. Close it first.');
      }
      throw e;
    }

    // Bring the ledger's cash for this drawer to the declared opening float.
    // Posting only the DIFFERENCE means carried-over cash is never duplicated,
    // while first-time/top-up floats show up in the GL, Cash Book and reconciliation.
    const currentCash = await accountBalance(tx, '1010', { drawerId });
    const adjustment = round2(opening - currentCash);
    if (Math.abs(adjustment) >= 0.01) {
      const cashLine = adjustment > 0
        ? { code: '1010', debit: Math.abs(adjustment), credit: 0, drawer_id: drawerId }
        : { code: '1010', debit: 0, credit: Math.abs(adjustment), drawer_id: drawerId };
      const equityLine = adjustment > 0
        ? { code: '3020', debit: 0, credit: Math.abs(adjustment) }
        : { code: '3020', debit: Math.abs(adjustment), credit: 0 };
      await postJournal(tx, {
        memo: `Opening float — drawer ${drawerId}`,
        source_type: 'drawer_open',
        source_id: session.id,
        created_by: opened_by,
        business_day_id,
        lines: [cashLine, equityLine],
      });
    }
    return session;
  };
  return withinTransaction ? perform(db) : db.transaction(perform);
}

export async function closeSession(db, { session_id, counted_amount, closed_by = null, note = null }) {
  const session = await db.get(`SELECT * FROM drawer_sessions WHERE id = ?`, [session_id]);
  if (!session) throw bad('Session not found.');
  if (session.status === 'closed') throw conflict('This session is already closed.');

  // Opening float was posted at open, so the GL cash for this drawer already
  // equals opening + every movement since. Expected IS that ledger balance.
  const expected = round2(await accountBalance(db, '1010', { drawerId: session.drawer_id }));
  const counted = round2(counted_amount);
  const difference = round2(counted - expected); // + over, - short

  return db.transaction(async (tx) => {
    await tx.run(
      `UPDATE drawer_sessions SET status = 'closed', expected_amount = ?, counted_amount = ?, difference = ?,
         closed_by = ?, closed_at = CURRENT_TIMESTAMP, note = COALESCE(?, note) WHERE id = ?`,
      [expected, counted, difference, closed_by, note, session_id]
    );
    // Post the count difference so the ledger matches the physical drawer.
    if (Math.abs(difference) >= 0.01) {
      const cashLine =
        difference > 0
          ? { code: '1010', debit: Math.abs(difference), credit: 0, drawer_id: session.drawer_id }
          : { code: '1010', debit: 0, credit: Math.abs(difference), drawer_id: session.drawer_id };
      const varianceLine =
        difference > 0
          ? { code: '5060', debit: 0, credit: Math.abs(difference) } // over -> reduces expense
          : { code: '5060', debit: Math.abs(difference), credit: 0 }; // short -> expense
      await postJournal(tx, {
        memo: `Drawer close ${session.drawer_id} — ${difference > 0 ? 'over' : 'short'}`,
        source_type: 'drawer',
        source_id: session_id,
        created_by: closed_by,
        lines: [cashLine, varianceLine],
      });
    }
    return tx.get(`SELECT * FROM drawer_sessions WHERE id = ?`, [session_id]);
  });
}

/* ------------------------------------------------------------ bank accounts */

export async function listBankAccounts(db) {
  return db.all(`SELECT b.*,
    COALESCE((SELECT SUM(jl.debit-jl.credit) FROM journal_lines jl WHERE jl.bank_account_id=b.id),0) AS balance
    FROM bank_accounts b WHERE b.is_active = 1 ORDER BY b.id`);
}

/** All settled-bank activity, including correction rows, with its full journal. */
export async function listBankMovements(db, {
  page = 1, pageSize = 25, search = '', from = '', to = '', direction = '', bankId = null, paged = false,
} = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeSize = Math.min(200, Math.max(1, Number(pageSize) || 25));
  const params = [];
  const conditions = ["a.code='1020'"];
  if (bankId) { conditions.push('jl.bank_account_id = ?'); params.push(bankId); }
  if (from) {
    const { start } = nepalOperationalRangeBounds(db.driver, from, from);
    conditions.push('je.created_at >= ?'); params.push(start);
  }
  if (to) {
    const { endExclusive } = nepalOperationalRangeBounds(db.driver, to, to);
    conditions.push('je.created_at < ?'); params.push(endExclusive);
  }
  if (direction === 'in') conditions.push('jl.debit > jl.credit');
  if (direction === 'out') conditions.push('jl.credit > jl.debit');
  if (String(search).trim()) {
    const needle = `%${String(search).trim().toLowerCase()}%`;
    conditions.push(`(lower(CAST(COALESCE(je.memo, '') AS TEXT)) LIKE ?
      OR lower(CAST(COALESCE(b.name, '') AS TEXT)) LIKE ?
      OR lower(CAST(COALESCE(u.full_name, '') AS TEXT)) LIKE ?
      OR lower(CAST(je.id AS TEXT)) LIKE ?)`);
    params.push(needle, needle, needle, needle);
  }
  const fromSql = `journal_entries je
       JOIN journal_lines jl ON jl.journal_id=je.id
       JOIN accounts a ON a.id=jl.account_id
       LEFT JOIN bank_accounts b ON b.id=jl.bank_account_id
       LEFT JOIN users u ON u.id=je.created_by
       LEFT JOIN journal_entries original ON je.source_type='reversal' AND original.id=je.source_id`;
  const where = conditions.join(' AND ');
  const count = await db.get(
    `SELECT COUNT(*) AS total FROM (
       SELECT je.id, b.id AS bank_account_id FROM ${fromSql}
       WHERE ${where} GROUP BY je.id, b.id
     ) bank_rows`,
    params
  );
  const rows = await db.all(
    `SELECT je.id AS journal_id,je.entry_date,je.memo,je.source_type,je.source_id,je.created_at,
            u.full_name AS created_by_name,b.id AS bank_account_id,b.name AS bank_name,
            COALESCE(SUM(jl.debit-jl.credit),0) AS bank_delta,
            original.id AS reversed_journal_id,original.memo AS original_memo
       FROM journal_entries je
       JOIN journal_lines jl ON jl.journal_id=je.id
       JOIN accounts a ON a.id=jl.account_id
       LEFT JOIN bank_accounts b ON b.id=jl.bank_account_id
       LEFT JOIN users u ON u.id=je.created_by
       LEFT JOIN journal_entries original ON je.source_type='reversal' AND original.id=je.source_id
      WHERE ${where}
      GROUP BY je.id,je.entry_date,je.memo,je.source_type,je.source_id,je.created_at,u.full_name,b.id,b.name,original.id,original.memo
      ORDER BY je.id DESC LIMIT ? OFFSET ?`,
    [...params, safeSize, (safePage - 1) * safeSize]
  );
  const pagination = makePagination({ page: safePage, pageSize: safeSize, total: Number(count?.total || 0) });
  if (!rows.length) return paged ? { rows: [], pagination } : [];
  const ids = [...new Set(rows.map((row) => Number(row.journal_id)))];
  const lines = await db.all(
    `SELECT jl.journal_id,a.code,a.name,a.type,jl.debit,jl.credit,ba.name AS bank_name
       FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id
       LEFT JOIN bank_accounts ba ON ba.id=jl.bank_account_id
      WHERE jl.journal_id IN (${ids.map(() => '?').join(',')}) ORDER BY jl.id`, ids
  );
  const byJournal = new Map();
  for (const line of lines) {
    if (!byJournal.has(Number(line.journal_id))) byJournal.set(Number(line.journal_id), []);
    byJournal.get(Number(line.journal_id)).push(line);
  }
  const result = {
    rows: rows.map((row) => ({ ...row, bank_delta: round2(row.bank_delta), lines: byJournal.get(Number(row.journal_id)) || [] })),
    pagination,
  };
  return paged ? result : result.rows;
}

export async function createBankAccount(db, { name, account_number }) {
  const clean = String(name || '').trim();
  if (!clean) throw bad('Bank name is required.');
  const acc = await db.get(`SELECT id FROM accounts WHERE code = '1020'`);
  await db.run(`INSERT INTO bank_accounts (name, account_number, account_id) VALUES (?, ?, ?)`, [
    clean,
    account_number || null,
    acc?.id || null,
  ]);
  return db.get(`SELECT * FROM bank_accounts WHERE id = (SELECT MAX(id) FROM bank_accounts)`);
}

/* --------------------------------------------- deposits / withdrawals / transfers */

/**
 * kind: 'deposit' (cash -> bank), 'withdrawal' (bank -> cash),
 *       'transfer' (bank -> bank), 'online_in', or 'online_out'.
 * All post a balanced journal.
 */
export async function recordBankMovement(db, { kind, amount, bank_account_id, to_bank_account_id, drawer_id, note, movement_type, created_by, external_ref = null, allow_negative = false, business_day_id = null }) {
  const amt = round2(amount);
  if (!(amt > 0)) throw bad('Amount must be greater than zero.');
  const cleanNote = String(note || '').trim();
  const drawerId = drawer_id || (await db.get(`SELECT id FROM cash_drawers WHERE is_active = 1 ORDER BY id LIMIT 1`))?.id;

  let lines;
  let memo;
  if (kind === 'deposit') {
    if (!bank_account_id) throw bad('Choose the bank account to deposit into.');
    if (!allow_negative) {
      const cash = await accountBalance(db, '1010', { drawerId });
      if (amt > round2(cash) + 0.001) throw bad(`Not enough cash in the drawer (have ${round2(cash)}).`);
    }
    memo = 'Cash deposit to bank';
    lines = [
      { code: '1020', debit: amt, credit: 0, bank_account_id },
      { code: '1010', debit: 0, credit: amt, drawer_id: drawerId },
    ];
  } else if (kind === 'withdrawal') {
    if (!bank_account_id) throw bad('Choose the bank account to withdraw from.');
    if (!allow_negative) {
      const bal = await accountBalance(db, '1020', { bankAccountId: bank_account_id });
      if (amt > round2(bal) + 0.001) throw bad(`Not enough in this bank account (have ${round2(bal)}).`);
    }
    memo = 'Bank withdrawal to cash';
    lines = [
      { code: '1010', debit: amt, credit: 0, drawer_id: drawerId },
      { code: '1020', debit: 0, credit: amt, bank_account_id },
    ];
  } else if (kind === 'transfer') {
    if (!bank_account_id || !to_bank_account_id || bank_account_id === to_bank_account_id)
      throw bad('Choose two different bank accounts.');
    if (!allow_negative) {
      const bal = await accountBalance(db, '1020', { bankAccountId: bank_account_id });
      if (amt > round2(bal) + 0.001) throw bad(`Not enough in the source bank account (have ${round2(bal)}).`);
    }
    memo = 'Bank to bank transfer';
    lines = [
      { code: '1020', debit: amt, credit: 0, bank_account_id: to_bank_account_id },
      { code: '1020', debit: 0, credit: amt, bank_account_id },
    ];
  } else if (kind === 'online_in') {
    if (!bank_account_id) throw bad('Choose the bank account receiving the money.');
    if (cleanNote.length < 3) throw bad('Reason / note is required (at least 3 characters).');
    const counterCode = movement_type === 'business_funding' ? '1050'
      : movement_type === 'other' ? '1090' : movement_type === 'owner_contribution' ? '3010' : null;
    if (!counterCode) throw bad('Choose where the online money came from.');
    if (counterCode === '1050' && !allow_negative) {
      const bal = await accountBalance(db, '1050');
      if (amt > round2(bal) + 0.001) throw bad(`Business Funding only has ${round2(bal)} available.`);
    }
    memo = `Online In: ${movement_type === 'business_funding' ? 'Business Funding' : movement_type === 'owner_contribution' ? 'Owner Contribution' : 'Other'} — ${cleanNote}`;
    lines = [
      { code: '1020', debit: amt, credit: 0, bank_account_id },
      { code: counterCode, debit: 0, credit: amt },
    ];
  } else if (kind === 'online_out') {
    if (!bank_account_id) throw bad('Choose the bank account paying the money.');
    if (cleanNote.length < 3) throw bad('Reason / note is required (at least 3 characters).');
    const counterCode = movement_type === 'return_to_funding' ? '1050'
      : movement_type === 'other' ? '1090' : movement_type === 'owner_withdrawal' ? '3010' : null;
    if (!counterCode) throw bad('Choose where the online money went.');
    if (!allow_negative) {
      const bal = await accountBalance(db, '1020', { bankAccountId: bank_account_id });
      if (amt > round2(bal) + 0.001) throw bad(`Not enough in this bank account (have ${round2(bal)}).`);
    }
    memo = `Online Out: ${movement_type === 'return_to_funding' ? 'Return to Business Funding' : movement_type === 'owner_withdrawal' ? 'Owner Withdrawal' : 'Other'} — ${cleanNote}`;
    lines = [
      { code: counterCode, debit: amt, credit: 0 },
      { code: '1020', debit: 0, credit: amt, bank_account_id },
    ];
  } else {
    throw bad('Unknown movement type.');
  }

  return db.transaction(async (tx) => {
    const journalId = await postJournal(tx, {
      memo: cleanNote && !['online_in', 'online_out'].includes(kind) ? cleanNote : memo,
      source_type: 'bank_movement', external_ref, created_by, business_day_id, lines,
    });
    return { journalId };
  });
}

/* ----------------------------------------------------------- settlement */

/** Settle a batch of a non-cash method into a bank account, net of fee. */
export async function settlePayments(db, { method, gross_amount, fee_amount = 0, bank_account_id, reference, note, settled_by, external_ref = null, allow_over = false }) {
  const gross = round2(gross_amount);
  const fee = round2(fee_amount);
  const net = round2(gross - fee);
  if (!(gross > 0)) throw bad('Settlement amount must be greater than zero.');
  if (net < 0) throw bad('Fee cannot exceed the settled amount.');
  if (!bank_account_id) throw bad('Choose the bank account the money landed in.');
  const clearingCode = paymentAccountCode(method);
  if (clearingCode === '1010' || clearingCode === '1020') throw bad('Cash and bank do not need settlement.');

  // Idempotency: a repeat with the same key returns the existing settlement.
  if (external_ref) {
    const dup = await db.get(`SELECT id FROM journal_entries WHERE external_ref = ?`, [external_ref]);
    if (dup) return db.get(`SELECT * FROM payment_settlements WHERE journal_id = ?`, [dup.id]);
  }
  // Cannot settle more than is actually pending in that clearing account.
  if (!allow_over) {
    const pending = await accountBalance(db, clearingCode);
    if (gross > round2(pending) + 0.001) throw bad(`Only ${round2(pending)} is pending for ${method}.`);
  }

  return db.transaction(async (tx) => {
    let businessDayId = null;
    try { businessDayId = (await tx.get(`SELECT id FROM business_days WHERE status='open' ORDER BY id DESC LIMIT 1`))?.id || null; } catch { /* migration compatibility */ }
    const lines = [
      { code: '1020', debit: net, credit: 0, bank_account_id, memo: `${method} settled` },
      { code: clearingCode, debit: 0, credit: gross, memo: `${method} clearing` },
    ];
    if (fee > 0) lines.push({ code: '5050', debit: fee, credit: 0, memo: `${method} fee` });
    const journalId = await postJournal(tx, {
      memo: note || `Settle ${method}`,
      source_type: 'settlement',
      source_id: null,
      external_ref,
      created_by: settled_by,
      business_day_id: businessDayId,
      lines,
    });
    await tx.run(
      `INSERT INTO payment_settlements (method, gross_amount, fee_amount, net_amount, bank_account_id, reference, note, settled_by, journal_id, business_day_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [method, gross, fee, net, bank_account_id, reference || null, note || null, settled_by, journalId, businessDayId]
    );
    return tx.get(`SELECT * FROM payment_settlements WHERE id = (SELECT MAX(id) FROM payment_settlements)`);
  });
}

export async function listSettlements(db, {
  page = 1, pageSize = 25, search = '', from = '', to = '', method = '', paged = false,
} = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeSize = Math.min(200, Math.max(1, Number(pageSize) || 25));
  const params = [];
  let where = '1=1';
  if (method) { where += ' AND s.method = ?'; params.push(method); }
  if (from) {
    const { start } = nepalOperationalRangeBounds(db.driver, from, from);
    where += ' AND s.settled_at >= ?'; params.push(start);
  }
  if (to) {
    const { endExclusive } = nepalOperationalRangeBounds(db.driver, to, to);
    where += ' AND s.settled_at < ?'; params.push(endExclusive);
  }
  if (String(search).trim()) {
    const needle = `%${String(search).trim().toLowerCase()}%`;
    where += ` AND (lower(CAST(COALESCE(s.reference, '') AS TEXT)) LIKE ?
      OR lower(CAST(COALESCE(s.note, '') AS TEXT)) LIKE ?
      OR lower(CAST(COALESCE(b.name, '') AS TEXT)) LIKE ?
      OR lower(CAST(COALESCE(u.full_name, '') AS TEXT)) LIKE ?)`;
    params.push(needle, needle, needle, needle);
  }
  const fromSql = `payment_settlements s
     LEFT JOIN bank_accounts b ON s.bank_account_id = b.id
     LEFT JOIN users u ON s.settled_by = u.id`;
  const count = await db.get(`SELECT COUNT(*) AS total FROM ${fromSql} WHERE ${where}`, params);
  const rows = await db.all(
    `SELECT s.*, b.name AS bank_name, u.full_name AS settled_by_name
     FROM ${fromSql}
     WHERE ${where} ORDER BY s.id DESC LIMIT ? OFFSET ?`,
    [...params, safeSize, (safePage - 1) * safeSize]
  );
  const result = { rows, pagination: makePagination({ page: safePage, pageSize: safeSize, total: Number(count?.total || 0) }) };
  return paged ? result : rows;
}

/* ------------------------------------------------------- cash in / cash out */

/** Physical cash into the till — never booked as sales revenue. */
export const CASH_IN_TYPES = {
  owner_contribution: { label: 'Owner Contribution', creditCode: '3010' },
  transfer_from_safe: { label: 'Transfer from Safe', creditCode: '1030' },
  bank_withdrawal: { label: 'Bank Withdrawal', creditCode: '1020', needsBank: true },
  change_float_added: { label: 'Change/Float Added', creditCode: '3020' },
  other: { label: 'Other', creditCode: '1090' },
};

/** Physical cash leaving the till. */
export const CASH_OUT_TYPES = {
  transfer_to_safe: { label: 'Transfer to Safe', debitCode: '1030' },
  bank_deposit: { label: 'Bank Deposit', debitCode: '1020', needsBank: true },
  expense_purchase: { label: 'Expense/Purchase', debitCode: '5020' },
  owner_withdrawal: { label: 'Owner Withdrawal', debitCode: '3010' },
  other: { label: 'Other', debitCode: '1090' },
};

/**
 * Add or remove physical cash in the drawer. Posts a balanced journal tagged to
 * Cash on Hand (1010) so expected drawer cash and business-day close stay correct.
 * Never posts to Sales Revenue.
 */
export async function recordCashMovement(db, {
  direction,
  movement_type,
  amount,
  reason,
  created_by,
  drawer_id = null,
  bank_account_id = null,
  external_ref = null,
  allow_negative = false,
  business_day_id = null,
}) {
  const amt = round2(amount);
  if (!(amt > 0)) throw bad('Amount must be greater than zero.');
  const note = String(reason || '').trim();
  if (note.length < 3) throw bad('Reason / note is required (at least 3 characters).');

  const isIn = direction === 'in' || direction === 'cash_in';
  const isOut = direction === 'out' || direction === 'cash_out';
  if (!isIn && !isOut) throw bad('Direction must be cash in or cash out.');

  const catalog = isIn ? CASH_IN_TYPES : CASH_OUT_TYPES;
  const meta = catalog[movement_type];
  if (!meta) throw bad('Invalid cash movement type.');

  const counterCode = isIn ? meta.creditCode : meta.debitCode;
  const needsBank = Boolean(meta.needsBank);
  if (needsBank && !bank_account_id) throw bad('Select a bank account.');

  const drawerId = drawer_id || (await db.get(`SELECT id FROM cash_drawers WHERE is_active = 1 ORDER BY id LIMIT 1`))?.id;
  if (!drawerId) throw bad('No active cash drawer.');

  if (!isIn && !allow_negative) {
    const bal = await accountBalance(db, '1010', { drawerId });
    if (amt > round2(bal) + 0.001) throw bad(`Not enough cash in drawer (have ${round2(bal)}).`);
  }

  if (needsBank && isIn && !allow_negative) {
    const bankBal = await accountBalance(db, '1020', { bankAccountId: bank_account_id });
    if (amt > round2(bankBal) + 0.001) throw bad(`Not enough in this bank account (have ${round2(bankBal)}).`);
  }

  if (!needsBank && isIn && counterCode === '1030' && !allow_negative) {
    const safeBal = await accountBalance(db, '1030');
    if (amt > round2(safeBal) + 0.001) throw bad(`Not enough in safe / reserve (have ${round2(safeBal)}).`);
  }

  const label = meta.label;
  const memo = `Cash ${isIn ? 'In' : 'Out'}: ${label} — ${note}`;

  const cashLine = {
    code: '1010',
    debit: isIn ? amt : 0,
    credit: isIn ? 0 : amt,
    drawer_id: drawerId,
    memo: label,
  };
  const counterLine = {
    code: counterCode,
    debit: isIn ? 0 : amt,
    credit: isIn ? amt : 0,
    bank_account_id: needsBank ? bank_account_id : null,
    memo: note,
  };

  return db.transaction(async (tx) => {
    const journalId = await postJournal(tx, {
      memo,
      source_type: 'cash_movement',
      source_id: null,
      external_ref,
      created_by,
      business_day_id,
      lines: [cashLine, counterLine],
    });
    return {
      journalId,
      direction: isIn ? 'in' : 'out',
      movement_type,
      amount: amt,
      drawer_id: drawerId,
      label,
    };
  });
}

export async function listCashMovements(db, {
  page = 1, pageSize = 25, drawerId = null, search = '', from = '', to = '', direction = '', paged = false,
} = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeSize = Math.min(200, Math.max(1, Number(pageSize) || 25));
  const params = [];
  const filters = [];
  if (drawerId) {
    filters.push(`EXISTS (
      SELECT 1 FROM journal_lines jl2
      WHERE jl2.journal_id = je.id AND jl2.drawer_id = ?
    )`);
    params.push(drawerId);
  }
  if (from) {
    const { start } = nepalOperationalRangeBounds(db.driver, from, from);
    filters.push('je.created_at >= ?'); params.push(start);
  }
  if (to) {
    const { endExclusive } = nepalOperationalRangeBounds(db.driver, to, to);
    filters.push('je.created_at < ?'); params.push(endExclusive);
  }
  if (direction === 'in' || direction === 'out') {
    filters.push(`EXISTS (SELECT 1 FROM journal_lines jl3 JOIN accounts a3 ON a3.id=jl3.account_id
      WHERE jl3.journal_id=je.id AND a3.code='1010' AND ${direction === 'in' ? 'jl3.debit > jl3.credit' : 'jl3.credit > jl3.debit'})`);
  }
  if (String(search).trim()) {
    const needle = `%${String(search).trim().toLowerCase()}%`;
    filters.push(`(lower(CAST(COALESCE(je.memo, '') AS TEXT)) LIKE ?
      OR lower(CAST(COALESCE(je.external_ref, '') AS TEXT)) LIKE ?
      OR lower(CAST(COALESCE(u.full_name, '') AS TEXT)) LIKE ?
      OR lower(CAST(je.id AS TEXT)) LIKE ?)`);
    params.push(needle, needle, needle, needle);
  }
  const where = `(je.source_type = 'cash_movement'
       OR (je.source_type='reversal' AND original.source_type='cash_movement'))
       ${filters.length ? `AND ${filters.join(' AND ')}` : ''}`;
  const fromSql = `journal_entries je
     LEFT JOIN journal_entries original ON je.source_type='reversal' AND original.id=je.source_id
     LEFT JOIN journal_entries reversal ON reversal.source_type='reversal' AND reversal.source_id=je.id
     LEFT JOIN users u ON u.id = je.created_by
     JOIN journal_lines jl ON jl.journal_id = je.id
     JOIN accounts a ON a.id = jl.account_id`;
  const count = await db.get(`SELECT COUNT(DISTINCT je.id) AS total FROM ${fromSql} WHERE ${where}`, params);
  const rows = await db.all(
    `SELECT je.id, je.entry_date, je.memo, je.external_ref, je.created_at, je.created_by,
            u.full_name AS by_name,
            CASE WHEN je.source_type='reversal' THEN 1 ELSE 0 END AS is_reversal,
            original.id AS reversed_journal_id, original.memo AS original_memo,
            reversal.id AS reversal_id,
            COALESCE(SUM(CASE WHEN a.code = '1010' THEN jl.debit - jl.credit ELSE 0 END), 0) AS cash_delta
     FROM journal_entries je
     LEFT JOIN journal_entries original ON je.source_type='reversal' AND original.id=je.source_id
     LEFT JOIN journal_entries reversal ON reversal.source_type='reversal' AND reversal.source_id=je.id
     LEFT JOIN users u ON u.id = je.created_by
     JOIN journal_lines jl ON jl.journal_id = je.id
     JOIN accounts a ON a.id = jl.account_id
     WHERE ${where}
     GROUP BY je.id, je.entry_date, je.memo, je.external_ref, je.created_at, je.created_by,
       u.full_name, original.id, original.memo, reversal.id
     ORDER BY je.id DESC
     LIMIT ? OFFSET ?`,
    [...params, safeSize, (safePage - 1) * safeSize]
  );
  const result = { rows, pagination: makePagination({ page: safePage, pageSize: safeSize, total: Number(count?.total || 0) }) };
  return paged ? result : rows;
}

/** Exchange audit history, including compensating reversals and their media. */
export async function listCashExchanges(db, { limit = 50 } = {}) {
  return db.all(
    `SELECT je.id,je.entry_date,je.memo,je.created_at,u.full_name AS by_name,
       CASE WHEN je.source_type='reversal' THEN 1 ELSE 0 END AS is_reversal,
       original.id AS reversed_journal_id,original.memo AS original_memo,reversal.id AS reversal_id,
       COALESCE(SUM(CASE WHEN a.code='1010' THEN jl.debit ELSE 0 END),0) AS cash_in,
       COALESCE(SUM(CASE WHEN a.code='1010' THEN jl.credit ELSE 0 END),0) AS cash_out,
       COALESCE(SUM(CASE WHEN a.code IN ('1020','1100','1110','1120','1130','1140') THEN jl.debit ELSE 0 END),0) AS online_in,
       COALESCE(SUM(CASE WHEN a.code IN ('1020','1100','1110','1120','1130','1140') THEN jl.credit ELSE 0 END),0) AS online_out,
       COALESCE(SUM(CASE WHEN a.code='4020' THEN jl.credit-jl.debit ELSE 0 END),0) AS charge
     FROM journal_entries je
     LEFT JOIN journal_entries original ON je.source_type='reversal' AND original.id=je.source_id
     LEFT JOIN journal_entries reversal ON reversal.source_type='reversal' AND reversal.source_id=je.id
     LEFT JOIN users u ON u.id=je.created_by
     JOIN journal_lines jl ON jl.journal_id=je.id
     JOIN accounts a ON a.id=jl.account_id
     WHERE je.source_type='exchange' OR (je.source_type='reversal' AND original.source_type='exchange')
     GROUP BY je.id,je.entry_date,je.memo,je.created_at,u.full_name,original.id,original.memo,reversal.id
     ORDER BY je.id DESC LIMIT ${Number(limit) || 50}`
  );
}

/* ------------------------------------------------------------- cash exchange */

/**
 * Swap money between two payment media — e.g. a guest pays online but wants cash
 * back. Customer gives via `from_method` (that account receives), and is paid
 * out via `to_method` (that account decreases). An optional `charge` is booked
 * as Other Income.
 */
export async function recordCashExchange(db, { from_method, to_method, amount, charge = 0, note, created_by, drawer_id, external_ref = null, allow_negative = false, business_day_id = null }) {
  const amt = round2(amount);
  const chg = round2(charge);
  if (!(amt > 0)) throw bad('Amount must be greater than zero.');
  if (chg < 0 || chg > amt) throw bad('Charge must be between zero and the amount.');
  if (!from_method || !to_method || from_method === to_method) throw bad('Pick two different methods.');
  if (![from_method, to_method].every((method) => ['cash', 'online'].includes(String(method).toLowerCase()))) {
    throw bad('Money exchange currently supports Cash and Online only.');
  }
  const fromCode = paymentAccountCode(from_method);
  const toCode = paymentAccountCode(to_method);
  const drawerId = drawer_id || (await db.get(`SELECT id FROM cash_drawers WHERE is_active = 1 ORDER BY id LIMIT 1`))?.id;
  const bankAccountId = await primaryBankAccountId(db);
  const payout = round2(amt - chg);

  // The medium you pay out of must actually hold the funds (cash from the
  // drawer, bank from the bank pool). Clearing/receivable payouts are unusual
  // but allowed since they represent an obligation, not held cash.
  if (!allow_negative && (toCode === '1010' || toCode === '1020')) {
    const bal = await accountBalance(db, toCode, toCode === '1010' ? { drawerId } : { bankAccountId });
    if (payout > round2(bal) + 0.001) throw bad(`Not enough ${to_method} to pay out (have ${round2(bal)}).`);
  }

  const lines = [
    { code: fromCode, debit: amt, credit: 0, drawer_id: fromCode === '1010' ? drawerId : null, bank_account_id: fromCode === '1020' ? bankAccountId : null, memo: `received ${from_method}` },
    { code: toCode, debit: 0, credit: payout, drawer_id: toCode === '1010' ? drawerId : null, bank_account_id: toCode === '1020' ? bankAccountId : null, memo: `paid out ${to_method}` },
  ];
  if (chg > 0) lines.push({ code: '4020', debit: 0, credit: chg, memo: 'Exchange charge' });

  return db.transaction(async (tx) => {
    const journalId = await postJournal(tx, {
      memo: note || `Cash exchange ${from_method} → ${to_method}`,
      source_type: 'exchange',
      source_id: null,
      external_ref,
      created_by,
      business_day_id,
      lines,
    });
    return { journalId };
  });
}
