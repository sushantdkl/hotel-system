/**
 * Clear operational POS data (orders, KOTs, bills, payments) so the restaurant
 * can start fresh. Keeps menu, tables, users, settings, inventory masters.
 *
 * Usage: node scripts/clear-ops-data.mjs
 */

import Database from '../lib/db/index.js';

const TABLES_IN_ORDER = [
  'bill_payment_allocations',
  'bill_payments',
  'bill_revisions',
  'bill_audit',
  'bill_corrections',
  'bills',
  'kot_items',
  'kots',
  'order_items',
  'pos_audit_log',
  'customer_ledger',
  'orders',
];

async function main() {
  const db = Database.getInstance();
  console.log(`Clearing ops data (${db.driver})…`);

  for (const table of TABLES_IN_ORDER) {
    try {
      const r = await db.run(`DELETE FROM ${table}`);
      console.log(`  ${table}: cleared (${r?.changes ?? '?'} rows)`);
    } catch (e) {
      console.log(`  ${table}: skip (${e.message})`);
    }
  }

  // Free all tables back to available.
  try {
    await db.run(`
      UPDATE tables
      SET status = 'available',
          current_order_id = NULL,
          waiter_id = NULL,
          updated_at = CURRENT_TIMESTAMP
    `);
    console.log('  tables: reset to available');
  } catch (e) {
    console.log(`  tables reset: skip (${e.message})`);
  }

  // Optional: clear journal entries tied to bills (accounting history of sales).
  for (const sql of [
    `DELETE FROM journal_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE source_type IN ('bill','payment','sale','void','refund'))`,
    `DELETE FROM journal_entries WHERE source_type IN ('bill','payment','sale','void','refund')`,
  ]) {
    try {
      await db.run(sql);
      console.log(`  accounting cleanup ok`);
    } catch (e) {
      console.log(`  accounting: skip (${e.message})`);
    }
  }

  console.log('Done. Menu, tables, users, and settings were kept.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
