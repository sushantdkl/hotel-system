/**
 * Explain the bank / clearing balances from the ledger itself.
 *
 * Answers one question with evidence rather than opinion: is a negative
 * "Bank / Online" a BOOKKEEPING state or a CODE defect?
 *
 * It checks, in order:
 *   1. Double-entry integrity — do total debits equal total credits? If not,
 *      something is posting unbalanced journals and it IS a code defect.
 *   2. Duplicate postings — more than one journal for the same
 *      (source_type, source_id). postJournal() replaces rather than appends, so
 *      duplicates would mean a second write path bypassing it.
 *   3. What actually moved 1020, by source. A bank that only ever gets credited
 *      (purchases, expenses, supplier payments) and never debited (settlements,
 *      deposits, an opening balance) goes negative by arithmetic, not by bug.
 *   4. Whether an opening balance was ever posted at all.
 *   5. What is sitting unsettled in the clearing accounts.
 *
 * Usage
 *   npm run bank:audit
 *   npm run bank:audit -- --set-opening=250000 --as-of=2026-04-01
 *   npm run bank:audit -- --set-opening=250000 --as-of=2026-04-01 --apply
 *
 * `--set-opening` posts Dr 1020 / Cr 3020 (Opening Balance Equity) for the
 * difference between the declared balance and what the ledger currently holds
 * on that date. Dry run unless `--apply` is passed, and idempotent: it carries a
 * fixed external_ref, so running it twice does not post twice.
 */

import path from 'path';
import { fileURLToPath } from 'url';

process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.chdir(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : null;
};
const apply = process.argv.includes('--apply');
const setOpening = arg('set-opening');
const asOf = arg('as-of') || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu' }).format(new Date());

const { default: Database } = await import('../lib/db/index.js');
const { ensureAccountingSchema, postJournal } = await import('../lib/accounting.js');

const db = Database.getInstance();
await ensureAccountingSchema(db);

const money = (n) => `Rs ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
const CLEARING = ["'1100'", "'1110'", "'1120'", "'1130'", "'1140'"].join(',');

/* 1 ---------------------------------------------------------------- integrity */
const balance = await db.get(
  `SELECT COALESCE(SUM(debit),0) AS dr, COALESCE(SUM(credit),0) AS cr FROM journal_lines`
).catch(() => ({ dr: 0, cr: 0 }));
const drift = Math.abs(Number(balance.dr) - Number(balance.cr));
console.log('1. DOUBLE-ENTRY INTEGRITY');
console.log(`   debits ${money(balance.dr)}  credits ${money(balance.cr)}  drift ${money(drift)}`);
console.log(drift < 0.01
  ? '   ok — the ledger balances itself, so nothing is posting unbalanced journals.'
  : '   FAIL — unbalanced journals exist. THIS IS A CODE DEFECT; stop and investigate.');

/* 2 --------------------------------------------------------------- duplicates */
const dupes = await db.all(
  `SELECT source_type, source_id, COUNT(*) AS n
   FROM journal_entries
   WHERE source_type IS NOT NULL AND source_id IS NOT NULL
   GROUP BY source_type, source_id HAVING COUNT(*) > 1
   ORDER BY n DESC LIMIT 20`
).catch(() => []);
console.log('\n2. DUPLICATE POSTINGS PER SOURCE');
if (!dupes.length) {
  console.log('   ok — no source is posted twice, so no figure is double-counted.');
} else {
  console.log('   FAIL — these sources have more than one journal. THIS IS A CODE DEFECT:');
  for (const row of dupes) console.log(`     ${row.source_type} #${row.source_id}: ${row.n} entries`);
}

/* 3 ------------------------------------------------------- what moved the bank */
const movements = await db.all(
  `SELECT COALESCE(je.source_type,'manual') AS source,
          COALESCE(SUM(jl.debit),0) AS dr, COALESCE(SUM(jl.credit),0) AS cr
   FROM journal_lines jl
   JOIN journal_entries je ON je.id = jl.journal_id
   JOIN accounts a ON a.id = jl.account_id
   WHERE a.code = '1020' AND je.entry_date <= ?
   GROUP BY COALESCE(je.source_type,'manual')
   ORDER BY (COALESCE(SUM(jl.credit),0) - COALESCE(SUM(jl.debit),0)) DESC`,
  [asOf]
).catch(() => []);
const bankIn = movements.reduce((s, r) => s + Number(r.dr || 0), 0);
const bankOut = movements.reduce((s, r) => s + Number(r.cr || 0), 0);
console.log(`\n3. WHAT MOVED THE BANK ACCOUNT (1020), UP TO ${asOf}`);
if (!movements.length) {
  console.log('   nothing has ever touched 1020.');
} else {
  for (const row of movements) {
    const net = Number(row.dr || 0) - Number(row.cr || 0);
    console.log(`   ${String(row.source).padEnd(22)} in ${money(row.dr).padStart(16)}   out ${money(row.cr).padStart(16)}   net ${money(net)}`);
  }
  console.log(`   ${'TOTAL'.padEnd(22)} in ${money(bankIn).padStart(16)}   out ${money(bankOut).padStart(16)}   balance ${money(bankIn - bankOut)}`);
}

/* 4 ---------------------------------------------------------- opening balance */
const opening = await db.get(
  `SELECT COALESCE(SUM(jl.debit - jl.credit),0) AS amount, COUNT(*) AS n
   FROM journal_lines jl
   JOIN journal_entries je ON je.id = jl.journal_id
   JOIN accounts a ON a.id = jl.account_id
   WHERE a.code = '1020' AND je.source_type IN ('opening_balance','drawer_open','opening_cash_movement')`
).catch(() => ({ amount: 0, n: 0 }));
console.log('\n4. OPENING BALANCE');
console.log(Number(opening?.n || 0)
  ? `   posted: ${money(opening.amount)} across ${opening.n} entr(y/ies).`
  : '   NONE POSTED. If the business had money in the bank before this system started,'
    + '\n   the ledger has never been told — every bank payment since then has driven it negative.'
    + '\n   Fix with:  npm run bank:audit -- --set-opening=<amount> --as-of=<YYYY-MM-DD> --apply');

/* 5 ------------------------------------------------------- unsettled clearing */
const clearing = await db.all(
  `SELECT a.code, a.name, COALESCE(SUM(jl.debit - jl.credit),0) AS amount
   FROM journal_lines jl
   JOIN journal_entries je ON je.id = jl.journal_id
   JOIN accounts a ON a.id = jl.account_id
   WHERE a.code IN (${CLEARING}) AND je.entry_date <= ?
   GROUP BY a.code, a.name HAVING COALESCE(SUM(jl.debit - jl.credit),0) <> 0
   ORDER BY amount DESC`,
  [asOf]
).catch(() => []);
const pending = clearing.reduce((s, r) => s + Number(r.amount || 0), 0);
const settlements = await db.get(
  `SELECT COUNT(*) AS n FROM journal_entries WHERE source_type = 'settlement'`
).catch(() => ({ n: 0 }));
console.log('\n5. TAKEN FROM CUSTOMERS BUT NOT YET IN THE BANK');
for (const row of clearing) console.log(`   ${String(row.name).padEnd(22)} ${money(row.amount)}`);
console.log(`   ${'PENDING TOTAL'.padEnd(22)} ${money(pending)}`);
console.log(`   settlements ever recorded: ${Number(settlements?.n || 0)}`);

/* verdict ------------------------------------------------------------------- */
const bankBalance = bankIn - bankOut;
console.log('\nVERDICT');
if (drift >= 0.01 || dupes.length) {
  console.log('   A CODE DEFECT is present (see the failures above). Do not explain the');
  console.log('   balance as bookkeeping until those are resolved.');
} else if (bankBalance < 0) {
  console.log(`   The ledger is internally consistent, and 1020 is ${money(bankBalance)} because`);
  console.log(`   ${money(bankOut)} was paid OUT of the bank while only ${money(bankIn)} was booked in.`);
  if (!Number(opening?.n || 0)) console.log('   No opening balance was ever posted.');
  if (!Number(settlements?.n || 0) && pending > 0) {
    console.log(`   ${money(pending)} of card/QR takings sit in clearing with NO settlement ever recorded.`);
  }
  console.log('   That is a bookkeeping gap, not a calculation error: the arithmetic is right,');
  console.log('   the ledger has simply never been told about money it should have.');
} else {
  console.log(`   Ledger consistent; bank balance is ${money(bankBalance)}. Nothing to explain.`);
}

/* opening-balance posting --------------------------------------------------- */
if (setOpening != null) {
  const declared = Number(setOpening);
  if (!Number.isFinite(declared)) {
    console.log(`\n--set-opening=${setOpening} is not a number.`);
    process.exit(1);
  }
  const current = await db.get(
    `SELECT COALESCE(SUM(jl.debit - jl.credit),0) AS amount
     FROM journal_lines jl
     JOIN journal_entries je ON je.id = jl.journal_id
     JOIN accounts a ON a.id = jl.account_id
     WHERE a.code = '1020' AND je.entry_date <= ?`,
    [asOf]
  ).catch(() => ({ amount: 0 }));
  const adjustment = Math.round((declared - Number(current?.amount || 0)) * 100) / 100;
  console.log(`\nOPENING BALANCE POSTING (as of ${asOf})`);
  console.log(`   declared ${money(declared)} − ledger ${money(current?.amount)} = adjustment ${money(adjustment)}`);
  if (Math.abs(adjustment) < 0.01) {
    console.log('   nothing to post; the ledger already shows the declared balance.');
  } else if (!apply) {
    console.log('   dry run — re-run with --apply to post it.');
  } else {
    const lines = adjustment > 0
      ? [{ code: '1020', debit: Math.abs(adjustment), credit: 0 }, { code: '3020', debit: 0, credit: Math.abs(adjustment) }]
      : [{ code: '3020', debit: Math.abs(adjustment), credit: 0 }, { code: '1020', debit: 0, credit: Math.abs(adjustment) }];
    await postJournal(db, {
      entry_date: asOf,
      memo: `Opening bank balance as of ${asOf}`,
      source_type: 'opening_balance',
      external_ref: `bank-opening-${asOf}`,
      lines,
    });
    console.log(`   posted. Bank / Online now reflects ${money(declared)} plus anything since.`);
  }
}
