/**
 * Self-check for the double-entry engine. No real DB — a tiny in-memory fake
 * exercises the invariants that matter:
 *   - journals must balance
 *   - a repost of the same source replaces (not duplicates) its journal
 *   - external_ref makes manual ops idempotent
 *   - unknown payment methods throw (never silently post to cash)
 *   - wastage credits Inventory, never Cash
 *   node scripts/check-accounting.mjs
 */
import assert from 'node:assert/strict';
import { postJournal, postExpenseJournal, paymentAccountCode } from '../lib/accounting.js';
import { reverseJournal } from '../lib/accounting-corrections.js';
import { trialBalance, profitAndLoss, balanceSheet } from '../lib/accounting-reports.js';

function makeDb() {
  const accounts = new Map([
    ['1010', 1], ['4010', 2], ['1100', 3], ['5020', 4], ['1200', 5], ['5040', 6], ['5010', 7], ['2010', 8],
  ]);
  const idAccount = new Map([...accounts].map(([code, id]) => [id, code]));
  const entries = [];
  const lines = [];
  let jid = 0;
  return {
    _entries: entries, _lines: lines, _code: (id) => idAccount.get(id),
    async transaction(fn) { return fn(this); },
    async all(sql, p) {
      if (/FROM journal_lines WHERE journal_id = \?/.test(sql)) return lines.filter((l) => l.journal_id === p[0]);
      return [];
    },
    async get(sql, p) {
      if (/FROM accounts WHERE code/.test(sql)) return accounts.has(p[0]) ? { id: accounts.get(p[0]) } : null;
      if (/WHERE external_ref = \?/.test(sql)) { const e = entries.find((x) => x.external_ref === p[0]); return e ? { id: e.id } : undefined; }
      if (/source_type = 'reversal' AND source_id = \?/.test(sql)) { const e = entries.find((x) => x.source_type === 'reversal' && x.source_id === p[0]); return e ? { id: e.id } : undefined; }
      if (/FROM journal_entries WHERE id = \?/.test(sql)) return entries.find((x) => x.id === p[0]);
      if (/source_type = \? AND source_id = \?/.test(sql)) { const e = entries.find((x) => x.source_type === p[0] && x.source_id === p[1]); return e ? { id: e.id } : undefined; }
      if (/drawer_sessions|cash_drawers/.test(sql)) return undefined;
      if (/MAX\(id\) FROM journal_entries/.test(sql)) return { id: jid };
      return undefined;
    },
    async run(sql, p) {
      if (/DELETE FROM journal_entries WHERE id/.test(sql)) {
        const id = p[0];
        for (let i = entries.length - 1; i >= 0; i--) if (entries[i].id === id) entries.splice(i, 1);
        for (let i = lines.length - 1; i >= 0; i--) if (lines[i].journal_id === id) lines.splice(i, 1);
        return {};
      }
      if (/INSERT INTO journal_entries/.test(sql)) { jid += 1; entries.push({ id: jid, source_type: p[2], source_id: p[3], external_ref: p[4] }); return { lastInsertRowid: jid }; }
      if (/INSERT INTO journal_lines/.test(sql)) { lines.push({ journal_id: p[0], account_id: p[1], debit: p[2], credit: p[3], supplier_id: p[7] }); return {}; }
      return {};
    },
  };
}

// payment mapping + strictness
assert.equal(paymentAccountCode('cash'), '1010');
assert.equal(paymentAccountCode('bank_transfer'), '1020');
assert.throws(() => paymentAccountCode('mystery'), /Unknown payment method/, 'unknown method must throw, never default to cash');
assert.throws(() => paymentAccountCode('none'), /Unknown payment method/);

// balanced journal posts
const db = makeDb();
await postJournal(db, { source_type: 'bill', source_id: 1, lines: [{ code: '1010', debit: 100, credit: 0 }, { code: '4010', debit: 0, credit: 100 }] });
assert.equal(db._entries.length, 1);
assert.equal(db._lines.reduce((s, l) => s + l.debit, 0), db._lines.reduce((s, l) => s + l.credit, 0));

// repost of same source replaces
await postJournal(db, { source_type: 'bill', source_id: 1, lines: [{ code: '1010', debit: 250, credit: 0 }, { code: '4010', debit: 0, credit: 250 }] });
assert.equal(db._entries.length, 1, 'repost must replace');
assert.equal(db._lines.reduce((s, l) => s + l.debit, 0), 250);

// external_ref idempotency: second call with same key is a no-op
const db2 = makeDb();
const ref = 'op-123';
const a = await postJournal(db2, { external_ref: ref, lines: [{ code: '1010', debit: 10, credit: 0 }, { code: '4010', debit: 0, credit: 10 }] });
const b = await postJournal(db2, { external_ref: ref, lines: [{ code: '1010', debit: 10, credit: 0 }, { code: '4010', debit: 0, credit: 10 }] });
assert.equal(a, b, 'same external_ref returns same journal');
assert.equal(db2._entries.length, 1, 'external_ref must not duplicate');

// unbalanced rejected
await assert.rejects(postJournal(db, { lines: [{ code: '1010', debit: 100, credit: 0 }, { code: '4010', debit: 0, credit: 90 }] }), /unbalanced/);

// wastage credits Inventory (1200), never Cash (1010)
const db3 = makeDb();
await postExpenseJournal(db3, { id: 7, amount: 50, category: 'spoilage', description: 'W', payment_method: 'none', source_type: 'wastage' });
const credits = db3._lines.filter((l) => l.credit > 0).map((l) => db3._code(l.account_id));
const debits = db3._lines.filter((l) => l.debit > 0).map((l) => db3._code(l.account_id));
assert.deepEqual(credits, ['1200'], 'wastage must credit Inventory');
assert.deepEqual(debits, ['5040'], 'wastage must debit Wastage expense');
assert.ok(!credits.includes('1010') && !debits.includes('1010'), 'wastage must never touch Cash');

// reversal mirrors the original and can only happen once
const db4 = makeDb();
await postJournal(db4, { source_type: 'bill', source_id: 5, lines: [{ code: '1010', debit: 100, credit: 0 }, { code: '4010', debit: 0, credit: 100 }] });
const origId = db4._entries.find((e) => e.source_type === 'bill').id;
const revId = await reverseJournal(db4, { journal_id: origId, reason: 'test' });
const revLines = db4._lines.filter((l) => l.journal_id === revId);
const cashLine = revLines.find((l) => l.account_id === 1);   // 1010
const salesLine = revLines.find((l) => l.account_id === 2);  // 4010
assert.equal(cashLine.credit, 100); assert.equal(cashLine.debit, 0, 'reversal flips cash debit->credit');
assert.equal(salesLine.debit, 100); assert.equal(salesLine.credit, 0, 'reversal flips sales credit->debit');
await assert.rejects(reverseJournal(db4, { journal_id: origId }), /already been reversed/, 'cannot reverse twice');

// financial statements derive correctly and satisfy their identities
function reportDb(rows) { return { async all(sql) { return /FROM accounts a/.test(sql) ? rows : []; } }; }
const rows = [
  { id: 1, code: '1010', name: 'Cash', type: 'asset', subtype: 'cash', parent_id: 10, debit: 100, credit: 30 },
  { id: 2, code: '4010', name: 'Sales', type: 'income', subtype: 'sales', parent_id: 20, debit: 0, credit: 100 },
  { id: 3, code: '5020', name: 'Op', type: 'expense', subtype: 'op', parent_id: 30, debit: 30, credit: 0 },
];
const tb = await trialBalance(reportDb(rows), {});
assert.ok(tb.balanced && tb.totalDebit === tb.totalCredit, 'trial balance must balance');
const pnl = await profitAndLoss(reportDb(rows), {});
assert.equal(pnl.totalIncome, 100); assert.equal(pnl.totalExpense, 30); assert.equal(pnl.netProfit, 70);
const bs = await balanceSheet(reportDb(rows), {});
assert.ok(bs.balanced, 'balance sheet must balance (A = L + E + earnings)');
assert.equal(bs.totalAssets, 70);

// a purchase on credit posts to Accounts Payable tagged to the supplier, not Cash
const db5 = makeDb();
await postExpenseJournal(db5, { id: 11, amount: 500, category: 'stock', description: 'P', payment_method: 'credit', source_type: 'purchase', supplier_id: 9 });
const apCredit = db5._lines.find((l) => l.credit > 0);
const cogsDebit = db5._lines.find((l) => l.debit > 0);
assert.equal(db5._code(apCredit.account_id), '2010', 'credit purchase must credit Accounts Payable');
assert.equal(apCredit.supplier_id, 9, 'AP line must be tagged to the supplier');
assert.equal(db5._code(cogsDebit.account_id), '5010', 'credit purchase must debit Purchases/COGS');
assert.notEqual(db5._code(apCredit.account_id), '1010', 'credit purchase must not touch Cash');

console.log('✓ accounting engine + reports + corrections + AP checks pass');
