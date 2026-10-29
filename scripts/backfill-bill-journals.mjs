/**
 * Post ledger journals for settled bills that never got one.
 *
 * Why this exists
 * ---------------
 * The Summary Report is built from the accounting ledger, while Reports and
 * Analytics are built from the bills table (see JOURNAL_BASIS_NOTE and
 * BILL_BASIS_NOTE in lib/report-scope.js). Every settlement taken through the
 * POS posts a journal as it happens, so the two normally agree. Bills that
 * entered the database another way — demo/seed data, a direct SQL import, a
 * settlement written while accounting was unavailable — have no journal, and
 * the Summary Report shows Rs 0.00 for money that Reports can see.
 *
 * This walks those bills and posts the entry the settlement would have posted,
 * through the same postSaleJournal() the POS uses: Dr each payment account,
 * Cr Sales Revenue (and VAT Payable for the tax portion). An unpaid remainder
 * is posted to Accounts Receivable, exactly as a credit sale would be.
 *
 * Usage
 * -----
 *   node scripts/backfill-bill-journals.mjs            # dry run, changes nothing
 *   node scripts/backfill-bill-journals.mjs --apply    # write the journals
 *   DB_NAME=rich.db node scripts/backfill-bill-journals.mjs --apply
 *
 * Safe to re-run: postJournal() replaces an existing entry for the same
 * (source_type, source_id), and bills that already have one are skipped here.
 */

import path from 'path';
import { fileURLToPath } from 'url';

process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.chdir(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

const apply = process.argv.includes('--apply');

const { default: Database } = await import('../lib/db/index.js');
const { ensureAccountingSchema, postSaleJournal } = await import('../lib/accounting.js');
const { countedBillSql, paymentsUnionSql, billTaxSql } = await import('../lib/report-scope.js');
const { nepalDateString } = await import('../lib/report-dates.js');

const db = Database.getInstance();
await ensureAccountingSchema(db);

const money = (n) => `Rs ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
/** Stored timestamps are UTC; a bill belongs to the Nepal date it was raised. */
const nepalDate = (stamp) => {
  const text = String(stamp || '').trim();
  if (!text) return nepalDateString(new Date());
  const parsed = new Date(text.includes('T') ? text : `${text.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? text.slice(0, 10) : nepalDateString(parsed);
};

const bills = await db.all(
  `SELECT b.id, b.bill_number, b.created_at, b.grand_total, b.customer_id,
          COALESCE(b.outstanding_amount, 0) AS outstanding,
          ${billTaxSql('b')} AS tax
   FROM bills b
   WHERE ${countedBillSql('b')}
     AND NOT EXISTS (
       SELECT 1 FROM journal_entries je
       WHERE je.source_type = 'bill' AND je.source_id = b.id
     )
   ORDER BY b.created_at`
);

if (!bills.length) {
  console.log('Every settled bill already has a journal entry. Nothing to do.');
  process.exit(0);
}

console.log(`${bills.length} settled bill(s) have no ledger entry.${apply ? '' : '  (dry run — pass --apply to post)'}\n`);

let posted = 0;
let skipped = 0;
let value = 0;

for (const bill of bills) {
  // Payments are stored two ways; paymentsUnionSql() reads both and de-dupes.
  const payments = await db.all(
    `SELECT pay.method, COALESCE(SUM(pay.amount), 0) AS amount
     FROM (${paymentsUnionSql()}) pay
     WHERE pay.bill_id = ?
     GROUP BY pay.method`,
    [bill.id]
  );
  const parts = payments
    .map((row) => ({ method: row.method, amount: Number(row.amount || 0) }))
    .filter((p) => p.amount > 0);

  // An unpaid balance is a receivable, not missing money — post it as credit
  // so the bill's revenue is complete and the debt is on the books.
  const outstanding = Number(bill.outstanding || 0);
  if (outstanding > 0.005) {
    parts.push({ method: 'credit', amount: outstanding, customer_id: bill.customer_id || null });
  }

  const total = parts.reduce((s, p) => s + p.amount, 0);
  if (!parts.length) {
    console.log(`skip  bill ${bill.bill_number || bill.id} — no settled payment rows and nothing outstanding`);
    skipped += 1;
    continue;
  }

  const label = parts.map((p) => `${p.method} ${money(p.amount)}`).join(' + ');
  if (!apply) {
    console.log(`would post  ${nepalDate(bill.created_at)}  bill ${bill.bill_number || bill.id}  ${label}`);
    posted += 1;
    value += total;
    continue;
  }

  try {
    await postSaleJournal(db, {
      bill_id: bill.id,
      bill_number: bill.bill_number,
      entry_date: nepalDate(bill.created_at),
      parts,
      tax_amount: Number(bill.tax || 0),
    });
    console.log(`posted  ${nepalDate(bill.created_at)}  bill ${bill.bill_number || bill.id}  ${label}`);
    posted += 1;
    value += total;
  } catch (error) {
    console.log(`FAILED  bill ${bill.bill_number || bill.id} — ${error.message}`);
    skipped += 1;
  }
}

console.log(
  `\n${apply ? 'Posted' : 'Would post'} ${posted} journal(s) worth ${money(value)}`
  + (skipped ? `; ${skipped} skipped.` : '.')
);
if (!apply) console.log('Re-run with --apply to write them.');
