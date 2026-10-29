import { ensureAccountingSchema } from '@/lib/accounting.js';
import { ensureSavingsSchema } from '@/lib/savings.js';
import { ensureLedgerSchema } from '@/lib/inventory-ledger.js';
import { ensurePayrollSchema } from '@/lib/payroll.js';
import { getItemCostMap, COST_RATIO, dateKey } from '@/lib/reports.js';
import { billTaxSql, countedBillSql, JOURNAL_BASIS_NOTE } from '@/lib/report-scope.js';
import { recordedCashMovements, summarizeBillComposition } from '@/lib/summary-account.js';
import { ensureColumn } from '@/lib/db/schema-helpers.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (row, key) => Number(row?.[key] || 0);
const BANK_CODES = "'1020','1100','1110','1120','1130','1140'";

function combineMedia(...rows) {
  const out = { cash: 0, bank: 0, credit: 0, total: 0 };
  for (const row of rows) {
    out.cash += num(row, 'cash');
    out.bank += num(row, 'bank');
    out.credit += num(row, 'credit');
  }
  out.cash = round2(out.cash); out.bank = round2(out.bank); out.credit = round2(out.credit);
  out.total = round2(out.cash + out.bank + out.credit);
  return out;
}

async function journalMedia(db, from, to, sources) {
  const placeholders = sources.map(() => '?').join(',');
  const rows = await db.all(`SELECT a.code,COALESCE(SUM(jl.debit-jl.credit),0) AS amount
    FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_id JOIN accounts a ON a.id=jl.account_id
    WHERE je.entry_date BETWEEN ? AND ? AND je.source_type IN (${placeholders})
      AND a.code IN ('1010','1020','1100','1110','1120','1130','1140','1300') GROUP BY a.code`, [from, to, ...sources]);
  const out = { cash: 0, bank: 0, credit: 0 };
  for (const r of rows) {
    const value = round2(r.amount);
    if (r.code === '1010') out.cash += value;
    else if (r.code === '1300') out.credit += value;
    else out.bank += value;
  }
  out.cash = round2(out.cash); out.bank = round2(out.bank); out.credit = round2(out.credit);
  out.total = round2(out.cash + out.bank + out.credit);
  return out;
}

async function spending(db, from, to, condition) {
  // Split by how the expense journal was credited (cash/bank vs 1050 funding),
  // not only payment_method — a cash purchase funded in part from Business Funding
  // must not report the full amount as Business Cash.
  const rows = await db.all(
    `SELECT a.code,
            COALESCE(SUM(CASE WHEN je.source_type='reversal' THEN -jl.debit ELSE jl.credit END),0) AS amount
     FROM expenses e
     JOIN journal_entries je ON je.source_type='expense' AND je.source_id=e.id
     JOIN journal_lines jl ON jl.journal_id=je.id
     JOIN accounts a ON a.id=jl.account_id
     WHERE COALESCE(e.purchase_date,CAST(e.expense_date AS TEXT)) BETWEEN ? AND ?
       AND ${condition}
       AND LOWER(COALESCE(e.status,'active'))<>'voided'
       AND (jl.credit > 0 OR (je.source_type='reversal' AND jl.debit > 0))
       AND a.code IN ('1010','1020','1100','1110','1120','1130','1140','2010','3010','1050')
     GROUP BY a.code`,
    [from, to]
  );

  const out = { cash: 0, bank: 0, credit: 0, funding: 0, records: 0 };
  for (const r of rows || []) {
    const amount = round2(r.amount);
    if (r.code === '1010') out.cash += amount;
    else if (r.code === '2010') out.credit += amount;
    else if (r.code === '3010' || r.code === '1050') out.funding += amount;
    else out.bank += amount;
  }

  // Fallback for expenses that never got a journal (should be rare).
  const orphan = await db.get(
    `SELECT COALESCE(SUM(e.amount),0) AS amount, COUNT(*) AS records
     FROM expenses e
     WHERE COALESCE(e.purchase_date,CAST(e.expense_date AS TEXT)) BETWEEN ? AND ?
       AND ${condition}
       AND LOWER(COALESCE(e.status,'active'))<>'voided'
       AND NOT EXISTS (
         SELECT 1 FROM journal_entries je
         WHERE je.source_type='expense' AND je.source_id=e.id
       )`,
    [from, to]
  ).catch(() => ({ amount: 0, records: 0 }));
  if (Number(orphan?.amount || 0) > 0) {
    const methodRows = await db.all(
      `SELECT LOWER(COALESCE(payment_method,'cash')) AS method, COALESCE(SUM(amount),0) AS amount
       FROM expenses e
       WHERE COALESCE(e.purchase_date,CAST(e.expense_date AS TEXT)) BETWEEN ? AND ?
         AND ${condition}
         AND LOWER(COALESCE(e.status,'active'))<>'voided'
         AND NOT EXISTS (
           SELECT 1 FROM journal_entries je
           WHERE je.source_type='expense' AND je.source_id=e.id
         )
       GROUP BY LOWER(COALESCE(payment_method,'cash'))`,
      [from, to]
    ).catch(() => []);
    for (const r of methodRows || []) {
      if (r.method === 'cash') out.cash += num(r, 'amount');
      else if (['credit', 'due', 'unpaid', 'on_credit', 'payable'].includes(r.method)) out.credit += num(r, 'amount');
      else if (['owner_pocket', 'business_funding'].includes(r.method)) out.funding += num(r, 'amount');
      else out.bank += num(r, 'amount');
    }
  }

  const counted = await db.get(
    `SELECT COUNT(*) AS records FROM expenses e
     WHERE COALESCE(e.purchase_date,CAST(e.expense_date AS TEXT)) BETWEEN ? AND ?
       AND ${condition}
       AND LOWER(COALESCE(e.status,'active'))<>'voided'`,
    [from, to]
  ).catch(() => ({ records: 0 }));
  out.records = Number(counted?.records || 0);
  out.cash = round2(out.cash);
  out.bank = round2(out.bank);
  out.credit = round2(out.credit);
  out.funding = round2(out.funding);
  out.total = round2(out.cash + out.bank + out.credit + out.funding);
  return out;
}

/**
 * Group a window's lines by source. A reversal of an entry inside the same
 * window is attributed to the source and side it undoes, so a same-day void
 * cancels the sale or purchase instead of inventing a second movement.
 * A reversal of an entry from an EARLIER window is real movement in this one
 * and keeps its own `voided_<source>` row: netting it hid today's Rs 500 cash
 * purchase behind a void of an older Rs 600 one and showed "Purchases +Rs 100".
 */
function foldMovements(rows) {
  const out = {};
  for (const r of rows || []) {
    const reversal = r.kind === 'reversal' && r.original_source;
    const folded = reversal && Number(r.same_window) === 1;
    const source = folded ? r.original_source : reversal ? `voided_${r.original_source}` : (r.kind || 'manual');
    const m = out[source] || (out[source] = { debit: 0, credit: 0 });
    m.debit += folded ? -num(r, 'credit') : num(r, 'debit');
    m.credit += folded ? -num(r, 'debit') : num(r, 'credit');
  }
  for (const m of Object.values(out)) {
    m.debit = round2(m.debit); m.credit = round2(m.credit); m.net = round2(m.debit - m.credit);
  }
  return out;
}

const netOf = (movements) => round2(Object.values(movements).reduce((s, m) => s + m.net, 0));

async function accountWindow(db, codeSql, from, to) {
  const opening = await db.get(`SELECT COALESCE(SUM(jl.debit-jl.credit),0) AS value FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_id JOIN accounts a ON a.id=jl.account_id WHERE a.code IN (${codeSql}) AND je.entry_date < ?`, [from]);
  const rows = await db.all(`SELECT je.source_type AS kind, original.source_type AS original_source,
    CASE WHEN original.entry_date BETWEEN ? AND ? THEN 1 ELSE 0 END AS same_window,
    COALESCE(SUM(jl.debit),0) AS debit, COALESCE(SUM(jl.credit),0) AS credit
    FROM journal_lines jl
    JOIN journal_entries je ON je.id=jl.journal_id
    LEFT JOIN journal_entries original ON je.source_type='reversal' AND original.id=je.source_id
    JOIN accounts a ON a.id=jl.account_id
    WHERE a.code IN (${codeSql}) AND je.entry_date BETWEEN ? AND ?
    GROUP BY je.source_type, original.source_type, 3`, [from, to, from, to]);
  const movements = foldMovements(rows);
  const open = round2(opening.value);
  return { opening: open, movements, closing: round2(open + netOf(movements)) };
}

/**
 * Journals that only bridge yesterday's counted cash into today's declared
 * opening float. Those amounts are already represented by business_days.opening_cash
 * — counting them again as a day movement double-subtracts (opening 0 + movement
 * -6965 looks like -6965 when the drawer simply started empty).
 *
 * Mid-day store_session_reopened movements stay in the window: day.opening_cash
 * is still the morning float, so later remove/add must affect closing.
 */
const DAY_OPEN_BRIDGE_SQL = `
  NOT (
    je.source_type IN ('opening_cash_movement', 'opening_cash_alignment')
    AND (
      COALESCE(je.external_ref,'') LIKE '%:store_session_opened:%'
      OR COALESCE(je.external_ref,'') LIKE 'opening-cash-align:%:store_session_opened:%'
    )
  )
`;

/**
 * A one-day owner summary should reconcile to the restaurant's recorded
 * business day, not silently switch to midnight-to-midnight ledger scope.
 * Day-open bridge journals are already represented by the declared physical
 * opening and are therefore excluded from the movement window.
 */
async function cashWindowForRange(db, from, to) {
  if (from !== to) return accountWindow(db, "'1010'", from, to);
  const day = await db.get(
    `SELECT bd.id, bd.opening_cash
     FROM business_days bd
     WHERE bd.business_date = ? LIMIT 1`,
    [from]
  ).catch(() => null);
  if (!day) return accountWindow(db, "'1010'", from, to);

  const rows = await db.all(
    `SELECT je.source_type AS kind, original.source_type AS original_source,
            CASE WHEN original.business_day_id = ? THEN 1 ELSE 0 END AS same_window,
            COALESCE(SUM(jl.debit),0) AS debit, COALESCE(SUM(jl.credit),0) AS credit
     FROM journal_lines jl
     JOIN journal_entries je ON je.id=jl.journal_id
     LEFT JOIN journal_entries original ON je.source_type='reversal' AND original.id=je.source_id
     JOIN accounts a ON a.id=jl.account_id
     WHERE a.code='1010' AND je.business_day_id=?
       AND COALESCE(je.source_type,'') NOT IN ('drawer_open','drawer')
       AND ${DAY_OPEN_BRIDGE_SQL}
     GROUP BY je.source_type, original.source_type, 3`,
    [day.id, day.id]
  );
  const movements = foldMovements(rows);
  // This is a whole-business-day report, so start from the day's first opening
  // and include cash moved between same-day store sessions. Using the latest
  // session opening with all-day sales double-counted activity from earlier
  // sessions and hid the corresponding opening_cash_movement.
  const opening = round2(day.opening_cash);
  return { opening, movements, closing: round2(opening + netOf(movements)), basis: 'business_day', business_day_id: Number(day.id) };
}

/**
 * Digital media (QR, card, wallet, bank) split by WHY the money arrived.
 *
 * The same eSewa or Fonepay account receives two completely different things:
 *
 *   restaurant sale   a guest paid for food. This is revenue.
 *   money exchange    a customer sent digital money and took cash out of the
 *                     drawer. Not revenue — the shop only earns the charge,
 *                     and the drawer is lighter by the payout.
 *
 * Read as one lump they overstate trade and hide why the drawer is empty, so
 * they are reported side by side here. The split is the journal's source_type,
 * which is set at posting time and never guessed.
 *
 * Amounts are signed debit-credit on the asset account: money in is positive,
 * money paid back out (a refund, a void reversal) is negative.
 */
// Clearing accounts only. 1020 is the bank account itself: it also carries
// every bank-paid purchase and expense, so listing it as a "received" medium
// made a supplier payment read as negative QR sales.
const DIGITAL_ACCOUNTS = [['1020', 'Online']];

export async function digitalReceipts(db, from, to) {
  const codes = DIGITAL_ACCOUNTS.map(([code]) => `'${code}'`).join(',');
  const rows = await db.all(
    `SELECT a.code AS code,
            CASE
              WHEN je.source_type = 'exchange' OR original.source_type = 'exchange' THEN 'exchange'
              WHEN je.source_type IN ('bill','bill_supplement') THEN 'sales'
              WHEN je.source_type = 'credit_collection' THEN 'collections'
              WHEN je.source_type = 'hotel_payment' THEN 'hotel_collections'
              WHEN je.source_type = 'refund' THEN 'reversals'
              WHEN je.source_type = 'reversal' AND original.source_type IN ('bill','bill_supplement','credit_collection','refund') THEN 'reversals'
              WHEN je.source_type = 'settlement' THEN 'settlements'
              ELSE 'other'
            END AS bucket,
            COALESCE(SUM(jl.debit - jl.credit), 0) AS amount
     FROM journal_lines jl
     JOIN journal_entries je ON je.id = jl.journal_id
     LEFT JOIN journal_entries original ON je.source_type='reversal' AND original.id=je.source_id
     JOIN accounts a ON a.id = jl.account_id
     WHERE a.code IN (${codes}) AND je.entry_date BETWEEN ? AND ?
     GROUP BY a.code, 2`,
    [from, to]
  ).catch(() => []);

  const byCode = new Map(DIGITAL_ACCOUNTS.map(([code, label]) => [code, {
    code, label, sales: 0, collections: 0, hotel_collections: 0, reversals: 0, exchange: 0, settlements: 0, other: 0, total: 0,
  }]));
  for (const r of rows || []) {
    const row = byCode.get(String(r.code));
    if (!row) continue;
    row[r.bucket] = round2(num(row, r.bucket) + num(r, 'amount'));
  }

  const media = [];
  const totals = { sales: 0, collections: 0, hotel_collections: 0, reversals: 0, exchange: 0, settlements: 0, other: 0, total: 0 };
  for (const row of byCode.values()) {
    // `total` is money RECEIVED. A settlement is the same money leaving the
    // clearing account for the bank, so counting it here would cancel out the
    // takings it is paying over; it stays on the row for anyone who wants it.
    row.total = round2(row.sales + row.collections + row.hotel_collections + row.reversals + row.exchange);
    for (const key of Object.keys(totals)) totals[key] = round2(totals[key] + row[key]);
    media.push(row);
  }
  // Media that never moved are dropped: a ladder of zero rows buries the two
  // lines that did.
  return { media: media.filter((r) => r.total !== 0 || r.sales !== 0 || r.exchange !== 0), totals };
}

/**
 * Where the drawer's cash came from and where it went, by source.
 *
 * Built from the 1010 movements the period already reads (accountWindow), so
 * it cannot drift from Cash in Hand: opening + in - out = closing, exactly.
 * `in` is the debit side, `out` the credit side — a source that did both
 * (money exchange takes digital in and pays cash out, so it only ever credits
 * cash; a manual adjustment can do either) shows on both sides honestly.
 */
const CASH_SOURCE_LABELS = {
  bill: 'Sales settled in cash',
  bill_supplement: 'Supplementary bills',
  credit_collection: 'Credit collected',
  hotel_payment: 'Hotel guest payments',
  refund: 'Refunds paid out',
  reversal: 'Void reversals',
  purchase: 'Purchases',
  // Purchases post through their linked expense, so this source carries both.
  expense: 'Purchases & expenses',
  payroll: 'Salary paid',
  savings_deposit: 'Moved to savings',
  exchange: 'Money exchange payouts',
  drawer_open: 'Drawer opening',
  opening_cash_movement: 'Opening adjustment',
  opening_cash_alignment: 'Opening count alignment',
  business_day_close: 'Cash over / short at close',
  business_funding_use: 'Business Funding',
  cash_movement: 'Recorded cash movement',
  supplier_payment: 'Supplier payments',
  salary_advance: 'Salary advances',
  savings_deposit_void: 'Reversed savings deposits',
  settlement: 'Bank settlement',
  manual: 'Manual adjustment',
};

const sourceLabel = (key) => String(key).startsWith('voided_')
  ? `Earlier ${sourceLabel(key.slice(7)).toLowerCase()} voided`
  : CASH_SOURCE_LABELS[key] || String(key || 'other').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export function cashFlowFromAccount(account) {
  const inflow = [];
  const outflow = [];
  for (const [source, move] of Object.entries(account?.movements || {})) {
    const debit = round2(move.debit);
    const credit = round2(move.credit);
    if (debit > 0) inflow.push({ source, label: sourceLabel(source), amount: debit });
    if (debit < 0) outflow.push({ source: `${source}_in_reversal`, label: `Reversed ${sourceLabel(source)} in`, amount: Math.abs(debit) });
    if (credit > 0) outflow.push({ source, label: sourceLabel(source), amount: credit });
    if (credit < 0) inflow.push({ source: `${source}_out_reversal`, label: `Reversed ${sourceLabel(source)} out`, amount: Math.abs(credit) });
  }
  inflow.sort((a, b) => b.amount - a.amount);
  outflow.sort((a, b) => b.amount - a.amount);
  const totalIn = round2(inflow.reduce((s, r) => s + r.amount, 0));
  const totalOut = round2(outflow.reduce((s, r) => s + r.amount, 0));
  return {
    opening: round2(account?.opening),
    inflow,
    outflow,
    total_in: totalIn,
    total_out: totalOut,
    net: round2(totalIn - totalOut),
    closing: round2(account?.closing),
  };
}

/**
 * Balances as they stand on a date, split the way an owner holds the money.
 *
 * A digital payment does NOT land in the bank when the guest pays it. It sits
 * in a clearing account (QR, eSewa, Khalti, card, online) until someone records
 * the settlement that moves it to 1020 — see settlePayments() in
 * lib/accounting-cash.js. So there are two honest answers to "what is in the
 * bank", and reporting one of them as the other is what made two screens
 * disagree:
 *
 *   settled   1020 alone — what the ledger says is in the bank account today.
 *   pending   the clearing accounts — taken from customers, not yet paid over
 *             by the provider (or not yet recorded as settled).
 *   expected  settled + pending — what should be in the bank once every
 *             pending payout lands. This is the number to check a statement
 *             against.
 *
 * A deeply negative `settled` with a large `pending` is the signature of
 * settlements never being recorded: bank-paid purchases and expenses keep
 * crediting 1020 while the digital takings pile up in clearing and never
 * arrive. Opening a set of books without posting the bank's opening balance
 * does the same thing.
 */
export async function bankPosition(db, asOf) {
  const rows = await db.all(
    `SELECT a.code AS code, COALESCE(SUM(jl.debit - jl.credit), 0) AS amount
     FROM journal_lines jl
     JOIN journal_entries je ON je.id = jl.journal_id
     JOIN accounts a ON a.id = jl.account_id
     WHERE a.code IN (${BANK_CODES}) AND je.entry_date <= ?
     GROUP BY a.code`,
    [asOf]
  ).catch(() => []);

  let settled = 0;
  const pendingByCode = [];
  let pending = 0;
  for (const r of rows || []) {
    const amount = round2(r.amount);
    if (String(r.code) === '1020') { settled = round2(settled + amount); continue; }
    pending = round2(pending + amount);
    if (amount !== 0) {
      const label = (DIGITAL_ACCOUNTS.find(([code]) => code === String(r.code)) || [])[1] || String(r.code);
      pendingByCode.push({ code: String(r.code), label, amount });
    }
  }
  pendingByCode.sort((a, b) => b.amount - a.amount);
  return { as_of: asOf, settled, pending, pending_by_medium: pendingByCode, expected: round2(settled + pending) };
}

/**
 * One place that answers "where is the money" — the cash drawer's in and out,
 * the QR/digital takings split into trade and money exchange, and what should
 * be sitting in the bank today.
 *
 * Every figure is reused from the builders the individual cards already use, so
 * this card can never disagree with the cards beside it.
 */
export async function moneyPosition(db, from, to) {
  const [flow, digital, bank] = await Promise.all([
    cashFlow(db, from, to),
    digitalReceipts(db, from, to),
    bankPosition(db, to),
  ]);
  const t = digital.totals;
  // Trade only: bills, credit collected, less refunds/void reversals booked back
  // to the medium. Settlements and stray movements are not sales.
  const restaurant = round2(num(t, 'sales') + num(t, 'collections') + num(t, 'reversals'));
  return {
    range: { start: from, end: to },
    cash: {
      opening: flow.opening, in: flow.total_in, out: flow.total_out,
      net: flow.net, closing: flow.closing,
    },
    qr: { restaurant, exchange: round2(num(t, 'exchange')), total: round2(restaurant + num(t, 'exchange')) },
    bank,
  };
}

/** Cash in/out for a period, for callers that do not already hold the account. */
export async function cashFlow(db, from, to) {
  return cashFlowFromAccount(await accountWindow(db, "'1010'", from, to));
}

async function reversalMediaFor(db, from, to, originalSource) {
  const rows = await db.all(`SELECT a.code,COALESCE(SUM(jl.debit-jl.credit),0) AS amount
    FROM journal_entries reversal
    JOIN journal_entries original ON original.id=reversal.source_id
    JOIN journal_lines jl ON jl.journal_id=reversal.id
    JOIN accounts a ON a.id=jl.account_id
    WHERE reversal.entry_date BETWEEN ? AND ? AND reversal.source_type='reversal'
      AND original.source_type=? AND a.code IN ('1010','1020','1100','1110','1120','1130','1140','1300')
    GROUP BY a.code`, [from, to, originalSource]);
  const out = { cash: 0, bank: 0, credit: 0 };
  for (const row of rows) {
    const value = round2(row.amount);
    if (row.code === '1010') out.cash += value;
    else if (row.code === '1300') out.credit += value;
    else out.bank += value;
  }
  out.cash=round2(out.cash); out.bank=round2(out.bank); out.credit=round2(out.credit);
  out.total=round2(out.cash+out.bank+out.credit);
  return out;
}

/** Individual operator-entered drawer movements, including their audit memo. */
export async function cashMovementDetails(db, from, to) {
  const rows = await db.all(
    `SELECT je.id, je.entry_date, je.memo, je.source_type,
            original.id AS reversed_journal_id, original.memo AS original_memo,
            COALESCE(SUM(jl.debit),0) AS cash_in,
            COALESCE(SUM(jl.credit),0) AS cash_out
     FROM journal_entries je
     LEFT JOIN journal_entries original ON je.source_type='reversal' AND original.id=je.source_id
     JOIN journal_lines jl ON jl.journal_id=je.id
     JOIN accounts a ON a.id=jl.account_id
     WHERE a.code='1010'
       AND (COALESCE(je.source_type,'manual') IN ('cash_movement','manual')
         OR (je.source_type='reversal' AND COALESCE(original.source_type,'') IN ('cash_movement','manual')))
       AND je.entry_date BETWEEN ? AND ?
     GROUP BY je.id,je.entry_date,je.memo,je.source_type,original.id,original.memo
     ORDER BY je.entry_date,je.id`,
    [from, to]
  ).catch(() => []);
  return (rows || []).map((row) => ({
    id: row.id,
    entry_date: dateKey(row.entry_date),
    memo: row.memo || 'Recorded cash movement',
    is_reversal: row.source_type === 'reversal',
    reversed_journal_id: row.reversed_journal_id || null,
    original_memo: row.original_memo || null,
    cash_in: round2(row.cash_in),
    cash_out: round2(row.cash_out),
  }));
}

/**
 * Closed-day cash reconciliation for the period — expected/counted/difference
 * plus the note-count breakdown, summed across every business day the range
 * covers. Note counts are optional at close time (see business-days.js), so
 * days_recorded can be less than days_total.
 */
export async function closingReconciliation(db, from, to) {
  const rows = await db.all(
    `SELECT bd.business_date, bd.status,
            COALESCE(s.expected_cash,bd.expected_cash) AS expected_cash,
            COALESCE(s.counted_cash,bd.counted_cash) AS counted_cash,
            COALESCE(s.cash_difference,bd.cash_difference) AS cash_difference,
            COALESCE(s.closing_note,bd.closing_note) AS closing_note,
            COALESCE(s.closing_snapshot,bd.closing_snapshot) AS closing_snapshot,
            COALESCE(s.force_closed,bd.force_closed,0) AS force_closed
     FROM business_days bd
     LEFT JOIN business_day_sessions s ON s.business_day_id=bd.id
       AND s.status='closed'
       AND s.session_number=(SELECT MAX(s2.session_number) FROM business_day_sessions s2
                             WHERE s2.business_day_id=bd.id AND s2.status='closed')
     WHERE bd.business_date BETWEEN ? AND ? ORDER BY bd.business_date`,
    [from, to]
  ).catch(() => []);
  const postClose = await db.get(
    `SELECT COUNT(DISTINCT r.id) AS entries,
            COALESCE(SUM(jl.debit-jl.credit),0) AS cash_delta
     FROM journal_entries r
     LEFT JOIN journal_entries original ON original.id=r.source_id
     JOIN business_days bd ON bd.id=COALESCE(original.business_day_id,r.business_day_id)
     LEFT JOIN business_day_sessions s ON s.business_day_id=bd.id AND s.status='closed'
       AND s.session_number=(SELECT MAX(s2.session_number) FROM business_day_sessions s2
                             WHERE s2.business_day_id=bd.id AND s2.status='closed')
     JOIN journal_lines jl ON jl.journal_id=r.id
     JOIN accounts a ON a.id=jl.account_id
     WHERE r.source_type IN ('reversal','expense','expense_payment_method_correction','expense_edit_correction')
       AND a.code='1010' AND bd.business_date BETWEEN ? AND ?
       AND (COALESCE(r.business_day_id,0)<>bd.id OR r.created_at>COALESCE(s.closed_at,bd.closed_at))`,
    [from, to]
  ).catch(() => ({ entries: 0, cash_delta: 0 }));

  // A store session can be physically counted while its business day remains
  // current (it can still be reopened). Include that latest saved count rather
  // than waiting for the next day to finalize the business-day container.
  const closed = (rows || []).filter((r) => r.counted_cash != null);
  const denominations = {};
  let daysRecorded = 0;
  const notes = [];
  for (const r of closed) {
    if (r.closing_note) notes.push({ business_date: dateKey(r.business_date), note: r.closing_note, force_closed: !!r.force_closed });
    let snapshot = null;
    try { snapshot = r.closing_snapshot ? JSON.parse(r.closing_snapshot) : null; } catch { snapshot = null; }
    const counts = snapshot?.reconciliation?.cash_denominations;
    if (counts != null && typeof counts === 'object') {
      daysRecorded += 1;
      for (const [denom, qty] of Object.entries(counts)) {
        denominations[denom] = (denominations[denom] || 0) + Number(qty || 0);
      }
    }
  }

  const expectedCash = round2(closed.reduce((s, r) => s + num(r, 'expected_cash'), 0));
  const countedCash = round2(closed.reduce((s, r) => s + num(r, 'counted_cash'), 0));
  const cashDelta = round2(postClose?.cash_delta);
  return {
    expected_cash: expectedCash,
    adjusted_expected_cash: round2(expectedCash + cashDelta),
    post_close_adjustments: { entries: Number(postClose?.entries || 0), cash_delta: cashDelta },
    counted_cash: countedCash,
    difference: round2(closed.reduce((s, r) => s + num(r, 'cash_difference'), 0)),
    adjusted_difference: round2(countedCash - expectedCash - cashDelta),
    cash_denominations: denominations,
    notes,
    days_total: rows.length,
    days_closed: closed.length,
    days_recorded: daysRecorded,
  };
}

export async function buildSummaryReport(db, { start, end }) {
  await ensureColumn(db, 'expenses', 'status', "TEXT DEFAULT 'active'").catch(() => {});
  await Promise.all([ensureAccountingSchema(db), ensureSavingsSchema(db), ensureLedgerSchema(db), ensurePayrollSchema(db)]);
  const { repairExpenseBusinessDayAlignment } = await import('@/lib/expense-links.js');
  const { repairFundedExpenseCashSplit } = await import('@/lib/business-funding.js');
  await repairExpenseBusinessDayAlignment(db).catch(() => 0);
  await repairFundedExpenseCashSplit(db).catch(() => 0);
  const [revenue, refundMedia, refundReversalMedia, billVoidMedia, supplementVoidMedia, corrections, collectionMedia, collectionReversalMedia, purchases, expenses, salaryRows, cashAccount, bankAccount, savings, saleCategories, purchaseCategories, quantities, settings, costMap, billComposition, closing, digital, position, cashMovementRows] = await Promise.all([
    journalMedia(db,start,end,['bill','bill_supplement']),
    journalMedia(db,start,end,['refund']),
    reversalMediaFor(db,start,end,'refund'),
    reversalMediaFor(db,start,end,'bill'),
    reversalMediaFor(db,start,end,'bill_supplement'),
    db.get(`SELECT
      COALESCE(SUM(CASE WHEN type='refund' THEN amount WHEN type='refund_reversal' THEN -amount ELSE 0 END),0) AS refunds,
      COALESCE(SUM(CASE WHEN type='void' THEN amount ELSE 0 END),0) AS voids,
      SUM(CASE WHEN type='refund' THEN 1 WHEN type='refund_reversal' THEN -1 ELSE 0 END) AS refund_count,
      SUM(CASE WHEN type='void' THEN 1 ELSE 0 END) AS void_count
      FROM bill_corrections WHERE date(created_at,'+5 hours','+45 minutes') BETWEEN ? AND ?`,[start,end]).catch(()=>({refunds:0,voids:0,refund_count:0,void_count:0})),
    journalMedia(db,start,end,['credit_collection']),
    reversalMediaFor(db,start,end,'credit_collection'),
    spending(db,start,end,`COALESCE(e.source_type,'')='purchase'`),
    spending(db,start,end,`COALESCE(e.source_type,'')<>'purchase'`),
    db.all(`SELECT LOWER(COALESCE(method,'cash')) AS method,
                   COALESCE(SUM(amount),0) AS amount,
                   COALESCE(SUM(COALESCE(gross_amount,amount)),0) AS gross_amount,
                   COALESCE(SUM(advance_deduction),0) AS advance_deduction,
                   COUNT(*) AS records
            FROM salary_payments WHERE paid_on BETWEEN ? AND ?
            GROUP BY LOWER(COALESCE(method,'cash'))`,[start,end]),
    cashWindowForRange(db,start,end), accountWindow(db,BANK_CODES,start,end),
    db.get(`SELECT COALESCE(SUM(CASE WHEN source_account='cash' THEN amount ELSE 0 END),0) AS cash,COALESCE(SUM(CASE WHEN source_account='online' THEN amount ELSE 0 END),0) AS online,COUNT(*) AS records FROM savings_deposits WHERE status='active' AND deposit_date BETWEEN ? AND ?`,[start,end]),
    db.all(`SELECT COALESCE(mc.name,'Uncategorised') AS category,SUM(oi.quantity) AS quantity,SUM(COALESCE(oi.subtotal,oi.quantity*oi.price)) AS amount FROM bills b JOIN orders o ON o.id=b.order_id JOIN order_items oi ON oi.order_id=o.id LEFT JOIN menu_items mi ON mi.id=COALESCE(oi.menu_item_id,oi.item_id) LEFT JOIN menu_categories mc ON mc.id=mi.category_id WHERE ${countedBillSql('b')} AND date(b.created_at,'+5 hours','+45 minutes') BETWEEN ? AND ? AND COALESCE(oi.status,'') NOT IN ('voided','cancelled') GROUP BY COALESCE(mc.name,'Uncategorised') ORDER BY amount DESC`,[start,end]),
    db.all(`SELECT COALESCE(ic.name,'Uncategorised') AS category,SUM(pi.quantity_received) AS quantity,SUM(pi.line_total) AS amount FROM purchases p JOIN purchase_items pi ON pi.purchase_id=p.id LEFT JOIN inventory_items ii ON ii.id=pi.inventory_item_id LEFT JOIN inventory_categories ic ON ic.id=ii.category_id WHERE COALESCE(p.status,'received')<>'voided' AND COALESCE(p.invoice_date,CAST(p.created_at AS TEXT)) BETWEEN ? AND ? GROUP BY COALESCE(ic.name,'Uncategorised') ORDER BY amount DESC`,[start,end]).catch(()=>[]),
    Promise.all([
      db.get(`SELECT COALESCE(SUM(oi.quantity),0) AS n FROM bills b JOIN order_items oi ON oi.order_id=b.order_id WHERE ${countedBillSql('b')} AND date(b.created_at,'+5 hours','+45 minutes') BETWEEN ? AND ? AND COALESCE(oi.status,'') NOT IN ('voided','cancelled')`,[start,end]),
      db.get(`SELECT COALESCE(SUM(pi.quantity_received),0) AS n FROM purchases p JOIN purchase_items pi ON pi.purchase_id=p.id WHERE COALESCE(p.status,'received')<>'voided' AND COALESCE(p.invoice_date,CAST(p.created_at AS TEXT)) BETWEEN ? AND ?`,[start,end]),
      db.get(`SELECT COUNT(*) AS n FROM bills WHERE ${countedBillSql('bills')} AND date(created_at,'+5 hours','+45 minutes') BETWEEN ? AND ?`,[start,end]),
      db.get(`SELECT COUNT(*) AS n FROM orders WHERE date(created_at,'+5 hours','+45 minutes') BETWEEN ? AND ?`,[start,end]),
      db.get(`SELECT COUNT(*) AS n FROM kots WHERE date(printed_at,'+5 hours','+45 minutes') BETWEEN ? AND ?`,[start,end]),
    ]),
    db.get(`SELECT MAX(CASE WHEN setting_key='restaurant_name' THEN setting_value END) AS restaurant_name FROM system_settings`).catch(()=>({restaurant_name:'Restaurant'})),
    getItemCostMap(db),
    /* Bill-side composition explains how pre-discount category value becomes
     * the finalized total. The ledger remains authoritative for accounting;
     * any difference between the two sources is returned explicitly. */
    db.get(`SELECT COALESCE(SUM(subtotal),0) AS subtotal,
                   COALESCE(SUM(discount_amount),0) AS discounts,
                   COALESCE(SUM(${billTaxSql('bills')}),0) AS tax,
                   COALESCE(SUM(service_charge),0) AS service_charge,
                   COALESCE(SUM(grand_total),0) AS finalized_total
            FROM bills
            WHERE ${countedBillSql('bills')} AND date(created_at,'+5 hours','+45 minutes') BETWEEN ? AND ?`,
      [start, end]).catch(() => ({ subtotal: 0, discounts: 0, tax: 0, service_charge: 0, finalized_total: 0 })),
    closingReconciliation(db, start, end),
    digitalReceipts(db, start, end),
    moneyPosition(db, start, end),
    cashMovementDetails(db, start, end),
  ]);
  const salary={cash:0,bank:0,advance_deductions:0,gross:0,records:0}; for(const r of salaryRows){if(r.method==='cash')salary.cash+=num(r,'amount');else salary.bank+=num(r,'amount');salary.advance_deductions+=num(r,'advance_deduction');salary.gross+=num(r,'gross_amount');salary.records+=num(r,'records');} salary.cash=round2(salary.cash);salary.bank=round2(salary.bank);salary.advance_deductions=round2(salary.advance_deductions);salary.gross=round2(salary.gross);
  /*
   * Salary enters operating cost at GROSS, while salary.cash / salary.bank show
   * what actually left the accounts (gross minus advances already paid out in an
   * earlier period). That is deliberate — the wage cost belongs to the period the
   * work was done in, not the period the advance happened to be handed over.
   * The two figures therefore differ by advance_deductions, by design.
   */
  salary.total=salary.gross;
  salary.net_paid=round2(salary.cash+salary.bank);
  const voidMedia = combineMedia(billVoidMedia, supplementVoidMedia);
  const ledger = combineMedia(collectionMedia, collectionReversalMedia);
  const refunded=round2(corrections?.refunds); const voided=round2(corrections?.voids);
  const grossRevenue=round2(revenue.total); const netRevenue=round2(grossRevenue-refunded-voided);
  const received={
    gross_cash:round2(revenue.cash+ledger.cash), gross_bank:round2(revenue.bank+ledger.bank),
    refund_cash:round2(Math.max(0,-refundMedia.cash-refundReversalMedia.cash)), refund_bank:round2(Math.max(0,-refundMedia.bank-refundReversalMedia.bank)),
    void_cash:round2(Math.max(0,-voidMedia.cash)), void_bank:round2(Math.max(0,-voidMedia.bank)),
  };
  received.cash=round2(received.gross_cash-received.refund_cash-received.void_cash);
  received.bank=round2(received.gross_bank-received.refund_bank-received.void_bank);
  received.gross_total=round2(received.gross_cash+received.gross_bank);
  received.total=round2(received.cash+received.bank);
  const estimatedFoodCost=round2((await db.all(`SELECT COALESCE(oi.menu_item_id,oi.item_id) AS item_id,SUM(oi.quantity) AS qty,SUM(COALESCE(oi.subtotal,oi.quantity*oi.price)) AS amount FROM bills b JOIN order_items oi ON oi.order_id=b.order_id WHERE ${countedBillSql('b')} AND date(b.created_at,'+5 hours','+45 minutes') BETWEEN ? AND ? AND COALESCE(oi.status,'') NOT IN ('voided','cancelled') GROUP BY COALESCE(oi.menu_item_id,oi.item_id)`,[start,end])).reduce((sum,r)=>{
    // `cost * qty || amount * 0.6` fell through to the estimate whenever the
    // product was 0 — i.e. for any genuinely zero-cost line (complimentary
    // item, un-costed recipe) it invented a 60% food cost. Test for a known
    // cost explicitly instead.
    const entry=costMap.get(r.item_id);
    return sum+(entry&&Number.isFinite(entry.cost)?entry.cost*num(r,'qty'):num(r,'amount')*COST_RATIO);
  },0));
  const gross=round2(netRevenue-estimatedFoodCost); const operating=round2(expenses.total+salary.total); const net=round2(gross-operating);
  const billTotals = summarizeBillComposition(billComposition, grossRevenue);
  const exchangeTotals = async (codes) => db.get(`SELECT
    COALESCE(SUM(CASE WHEN je.source_type='reversal' THEN -jl.credit ELSE jl.debit END),0) AS incoming,
    COALESCE(SUM(CASE WHEN je.source_type='reversal' THEN -jl.debit ELSE jl.credit END),0) AS outgoing
    FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_id
    LEFT JOIN journal_entries original ON je.source_type='reversal' AND original.id=je.source_id
    JOIN accounts a ON a.id=jl.account_id
    WHERE (je.source_type='exchange' OR original.source_type='exchange')
      AND a.code IN (${codes}) AND je.entry_date BETWEEN ? AND ?`,[start,end]);
  const [exchangeCash, exchangeBank] = await Promise.all([exchangeTotals("'1010'"), exchangeTotals(BANK_CODES)]);
  const exchangeFee=await db.get(`SELECT COALESCE(SUM(jl.credit-jl.debit),0) AS amount FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_id LEFT JOIN journal_entries original ON je.source_type='reversal' AND original.id=je.source_id JOIN accounts a ON a.id=jl.account_id WHERE (je.source_type='exchange' OR original.source_type='exchange') AND a.code='4020' AND je.entry_date BETWEEN ? AND ?`,[start,end]);
  return { range:{start,end}, generated_at:new Date().toISOString(), basis:JOURNAL_BASIS_NOTE,
    notes:[
      'Salary is charged to the period at gross pay. Cash and bank show what physically left the accounts, which is lower by any advance already paid out earlier — the two are meant to differ.',
      'Purchases and operating expenses are reported separately: purchases are stock, expenses are running costs.',
    ], restaurant_name:settings?.restaurant_name||'Restaurant', revenue:{...revenue,...billTotals,gross:grossRevenue,refunds:refunded,voids:voided,net:netRevenue,refund_count:num(corrections,'refund_count'),void_count:num(corrections,'void_count')}, ledger, received, purchases, expenses, salary,
    savings:{cash:round2(savings.cash),online:round2(savings.online),total:round2(num(savings,'cash')+num(savings,'online')),records:num(savings,'records')},
    profit:{revenue:netRevenue,food_cost:estimatedFoodCost,gross,operating,net}, accounts:{cash:cashAccount,bank:bankAccount},
    cash_register:recordedCashMovements(cashAccount),
    sale_categories:saleCategories.map(r=>({category:r.category,quantity:num(r,'quantity'),amount:round2(r.amount)})), purchase_categories:purchaseCategories.map(r=>({category:r.category,quantity:num(r,'quantity'),amount:round2(r.amount)})),
    exchange:{cash:{in:round2(exchangeCash.incoming),out:round2(exchangeCash.outgoing)},bank:{in:round2(exchangeBank.incoming),out:round2(exchangeBank.outgoing)},net:round2(exchangeFee.amount)},
    // Restaurant QR/card/wallet takings kept apart from money-exchange traffic
    // through the same accounts, and the drawer's in/out by source.
    digital, cash_flow:{...cashFlowFromAccount(cashAccount),details:cashMovementRows},
    money_position:{...position,cash:{in:round2(cashFlowFromAccount(cashAccount).total_in),out:round2(cashFlowFromAccount(cashAccount).total_out),closing:round2(cashAccount.closing)}},
    quantities:{sold:num(quantities[0],'n'),purchased:num(quantities[1],'n'),bills:num(quantities[2],'n'),orders:num(quantities[3],'n'),kots:num(quantities[4],'n'),expenses:expenses.records,salary:salary.records,savings:num(savings,'records')},
    closing };
}
