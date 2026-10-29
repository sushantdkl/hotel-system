import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { PosDatabase } from '../../lib/db/index.js';
import { openBusinessDay } from '../../lib/business-days.js';
import { nepalDateString } from '../../lib/report-dates.js';
import { ensureRecipeTables } from '../../lib/recipes.js';
import { ensureLedgerSchema } from '../../lib/inventory-ledger.js';
import { ensureStockMovementsTable } from '../../lib/stock-movements.js';
import { reverseCorrectionByJournal } from '../../lib/bill-corrections.js';
import { paySupplier, supplierPayables } from '../../lib/accounting-suppliers.js';
import { createPurchase, getPurchase, listPurchases, mergeSuppliers } from '../../lib/purchases.js';
import { buildReport } from '../../lib/reports.js';

test('credit purchase paid later through Accounts Payable leaves Credit and lands in the paying method', async () => {
  const file = path.join(os.tmpdir(), `purchase-credit-settlement-${process.pid}-${Date.now()}.db`);
  const db = new PosDatabase(file);
  try {
    const actor = { id: 1, full_name: 'Admin', role: 'admin' };
    const today = nepalDateString();
    await openBusinessDay(db, { business_date: today, opening_cash: 5000 }, actor);
    await ensureStockMovementsTable(db);
    await ensureRecipeTables(db);
    await ensureLedgerSchema(db);
    const item = await db.run(
      `INSERT INTO inventory_items (item_name,name,quantity,unit,cost_per_unit,is_archived)
       VALUES ('Settle Flour','Settle Flour',0,'kg',0,0)`
    );
    const buy = (invoice, cost) => createPurchase(db, {
      supplier: 'Settle Supplier', invoice_number: invoice, invoice_date: today,
      payment_method: 'credit', received_by: actor.id,
      items: [{ inventory_item_id: item.lastInsertRowid, quantity: 1, unit_cost: cost }],
    });
    const older = await buy('SETTLE-1', 1000);
    const newer = await buy('SETTLE-2', 500);
    const supplierId = older.supplier_id;

    const split = async () => (await listPurchases(db, { from: today, to: today })).summary.paymentTotals;
    const due = async (id) => (await listPurchases(db, { from: today, to: today })).rows.find((r) => r.id === id).credit_due;

    assert.deepEqual(await split(), { cash: 0, digital: 0, credit: 1500, funding: 0 });

    // FIFO: cash 600 goes to the older invoice first.
    const cashPayment = await paySupplier(db, { supplier_id: supplierId, amount: 600, method: 'cash', created_by: actor.id });
    assert.deepEqual(await split(), { cash: 600, digital: 0, credit: 900, funding: 0 });
    assert.equal(await due(older.id), 400);
    assert.equal(await due(newer.id), 500);

    await paySupplier(db, { supplier_id: supplierId, amount: 900, method: 'bank', created_by: actor.id });
    assert.deepEqual(await split(), { cash: 600, digital: 900, credit: 0, funding: 0 });
    assert.equal(await due(older.id), 0);
    assert.equal((await getPurchase(db, newer.id)).credit_due, 0);

    const report = await buildReport(db, 'purchases', { start: today, end: today }, {});
    const table = report.tables.find((t) => t.id === 'purchases');
    assert.deepEqual(table.paymentTotals, { cash: 600, digital: 900, credit: 0, funding: 0 });
    assert.equal(table.rows.find((r) => r._record_id === older.id).payment_method, 'Credit · Paid');

    // Reversing a payment puts that amount back under Credit.
    await reverseCorrectionByJournal(db, { journal_id: cashPayment, reason: 'Cash payment entered twice', created_by: actor.id });
    assert.deepEqual(await split(), { cash: 0, digital: 900, credit: 600, funding: 0 });
    assert.equal(await due(older.id), 100);
    assert.equal(await due(newer.id), 500);

    // Merging a duplicate supplier carries its payable along instead of orphaning it.
    const dup = await createPurchase(db, {
      supplier: 'Settle Supplier Dup', invoice_number: 'SETTLE-DUP', invoice_date: today,
      payment_method: 'credit', received_by: actor.id,
      items: [{ inventory_item_id: item.lastInsertRowid, quantity: 1, unit_cost: 250 }],
    });
    await mergeSuppliers(db, supplierId, [dup.supplier_id]);
    const owed = (await supplierPayables(db)).find((s) => s.id === supplierId).outstanding;
    assert.equal(owed, 600 + 250);
  } finally {
    try { db.close(); } catch { /* already closed */ }
    for (const suffix of ['', '-shm', '-wal']) {
      try { fs.unlinkSync(`${file}${suffix}`); } catch { /* already gone */ }
    }
  }
});
