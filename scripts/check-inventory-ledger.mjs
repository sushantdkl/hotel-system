/**
 * Core inventory-ledger invariants, asserted against a live database.
 *
 *   DATABASE_URL=postgresql://user:pass@host:5432/db node scripts/check-inventory-ledger.mjs
 *
 * Creates its own throwaway item/supplier, exercises the real code paths, then
 * deletes everything it made. Plain asserts — no test framework.
 */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// The lib/ modules import via the '@/...' alias that Next.js resolves; map it
// to the repo root for a bare `node` run.
const root = new URL('..', import.meta.url);
register(
  `data:text/javascript,
   export function resolve(spec, ctx, next) {
     if (spec.startsWith('@/')) return next(new URL(spec.slice(2), ${JSON.stringify(root.href)}).href, ctx);
     return next(spec, ctx);
   }`,
  import.meta.url
);

const { default: Database } = await import(new URL('../lib/db/index.js', import.meta.url).href);
const { applyStockChange, ensureLedgerSchema } = await import(
  new URL('../lib/inventory-ledger.js', import.meta.url).href
);
const { createPurchase, voidPurchase, deletePurchase } = await import(
  new URL('../lib/purchases.js', import.meta.url).href
);
const { logWastage, ensureRecipeTables } = await import(new URL('../lib/recipes.js', import.meta.url).href);

const db = Database.getInstance();
const NAME = `__ledger_check_${Date.now()}`;
let itemId = null;
const madePurchases = [];
let wastageId = null;

const log = (...a) => console.log(' ', ...a);

try {
  await ensureRecipeTables(db);
  await ensureLedgerSchema(db);

  // An item bought by the kg, consumed by the gram.
  const created = await db.run(
    `INSERT INTO inventory_items
       (item_name, quantity, unit, cost_per_unit, min_stock_level, purchase_unit,
        consumption_unit, conversion_factor, is_archived)
     VALUES (?, 0, 'grams', 0, 100, 'kg', 'grams', 1000, 0)`,
    [NAME]
  );
  itemId = created.lastInsertRowid;
  log(`item #${itemId} "${NAME}" — kg -> grams, factor 1000`);

  /* 1. A purchase converts units, creates exactly one linked expense. */
  const p1 = await createPurchase(db, {
    supplier: `${NAME} Supplies`,
    invoice_number: `${NAME}-INV1`,
    items: [{ inventory_item_id: itemId, quantity: 5, unit_cost: 200 }], // 5 kg @ Rs 200/kg
  });
  madePurchases.push(p1.id);

  let item = await db.get(`SELECT * FROM inventory_items WHERE id = ?`, [itemId]);
  assert.equal(Number(item.quantity), 5000, 'CONVERSION: 5 kg must become 5000 grams');
  assert.ok(
    Math.abs(Number(item.cost_per_unit) - 0.2) < 1e-9,
    'CONVERSION: Rs 200/kg must become Rs 0.20/gram'
  );
  log('conversion applied: 5 kg -> 5000 g @ 0.20/g');

  const expenses = await db.all(
    `SELECT * FROM expenses WHERE source_type = 'purchase' AND source_id = ?`,
    [p1.id]
  );
  assert.equal(expenses.length, 1, 'EXPENSE: a purchase must create exactly one linked expense');
  assert.equal(Number(expenses[0].amount), 1000, 'EXPENSE: 5 kg @ 200 = Rs 1000');
  log(`expense linked: #${expenses[0].id} Rs ${expenses[0].amount} (source purchase #${p1.id})`);

  const receipt = await db.get(
    `SELECT * FROM stock_movements WHERE reference_id = ? AND change_type = 'purchase_receipt'
     ORDER BY id DESC LIMIT 1`,
    [String(p1.id)]
  );
  assert.equal(Number(receipt.balance_after), 5000, 'MOVEMENT: balance_after must be recorded');
  assert.ok(Math.abs(Number(receipt.unit_cost) - 0.2) < 1e-9, 'MOVEMENT: unit_cost must be recorded');

  /* 2. Moving-average cost, not blind overwrite. */
  const p2 = await createPurchase(db, {
    supplier: `${NAME} Supplies`,
    invoice_number: `${NAME}-INV2`,
    items: [{ inventory_item_id: itemId, quantity: 5, unit_cost: 400 }], // 5 kg @ Rs 400/kg
  });
  madePurchases.push(p2.id);
  item = await db.get(`SELECT * FROM inventory_items WHERE id = ?`, [itemId]);
  assert.equal(Number(item.quantity), 10000, 'second receipt must add 5000 g');
  assert.ok(
    Math.abs(Number(item.cost_per_unit) - 0.3) < 1e-9,
    'MOVING AVERAGE: (5000*0.2 + 5000*0.4) / 10000 = 0.30'
  );
  log('moving average: 0.20 + 0.40 -> 0.30/g');

  /* 3. Voiding reverses stock and removes the linked expense. */
  await voidPurchase(db, p2.id, { reason: 'ledger self-check' });
  item = await db.get(`SELECT * FROM inventory_items WHERE id = ?`, [itemId]);
  assert.equal(Number(item.quantity), 5000, 'VOID: stock must go back to 5000 g');
  const afterVoid = await db.all(
    `SELECT * FROM expenses WHERE source_type = 'purchase' AND source_id = ?`,
    [p2.id]
  );
  assert.equal(afterVoid.length, 0, 'VOID: the linked expense must be removed');
  log('void reversed stock and dropped its expense');

  /* 4. Wastage deducts and posts an inventory_loss expense at cost. */
  const waste = await logWastage(db, {
    raw_material_id: itemId,
    quantity: 1000,
    unit: 'grams',
    reason: 'expired',
    notes: 'ledger self-check',
  });
  wastageId = waste.id;
  item = await db.get(`SELECT * FROM inventory_items WHERE id = ?`, [itemId]);
  assert.equal(Number(item.quantity), 4000, 'WASTAGE: 1000 g must be deducted');
  const lossExpense = await db.get(
    `SELECT * FROM expenses WHERE source_type = 'wastage' AND source_id = ?`,
    [wastageId]
  );
  assert.ok(lossExpense, 'WASTAGE: an inventory_loss expense must exist');
  assert.equal(lossExpense.category, 'inventory_loss', 'WASTAGE: category must be inventory_loss');
  assert.ok(Math.abs(Number(lossExpense.amount) - 300) < 1e-6, 'WASTAGE: 1000 g @ 0.30 = Rs 300');
  log(`wastage deducted 1000 g and posted Rs ${Number(lossExpense.amount).toFixed(2)} inventory_loss`);

  /* 5. Overselling records the variance instead of silently flooring. */
  const oversell = await applyStockChange(db, {
    inventory_item_id: itemId,
    quantity: -10000, // only 4000 g on hand
    change_type: 'order_deduction',
    reason: 'ledger self-check oversell',
  });
  assert.equal(oversell.to, 0, 'NEGATIVE: stored quantity must floor at 0');
  assert.equal(oversell.applied, -4000, 'NEGATIVE: only what existed can be applied');
  assert.equal(oversell.requested, -10000, 'NEGATIVE: the request must be preserved');
  assert.equal(oversell.shortfall, -6000, 'NEGATIVE: the 6000 g shortfall must be recorded');
  assert.ok(oversell.warning, 'NEGATIVE: the caller must get a warning naming the item');

  const varianceRow = await db.get(`SELECT * FROM stock_movements WHERE id = ?`, [oversell.movement_id]);
  assert.equal(Number(varianceRow.variance), -6000, 'NEGATIVE: variance must be on the movement row');
  assert.equal(Number(varianceRow.quantity_requested), -10000, 'NEGATIVE: quantity_requested must be stored');
  assert.equal(Number(varianceRow.balance_after), 0, 'NEGATIVE: balance_after must be stored');
  log('oversell floored at 0 with variance -6000 recorded on the movement');

  /* 6. A manual adjustment without a reason is refused. */
  await assert.rejects(
    () =>
      applyStockChange(db, {
        inventory_item_id: itemId,
        quantity: 10,
        change_type: 'manual_adjustment',
      }),
    /reason is required/i,
    'ADJUSTMENT: a manual adjustment must demand a reason'
  );
  log('manual adjustment without a reason refused');

  console.log('\n✓ inventory ledger invariants hold');
} finally {
  // Teardown — leave the database exactly as it was found.
  if (wastageId) {
    await db.run(`DELETE FROM expenses WHERE source_type = 'wastage' AND source_id = ?`, [wastageId]);
    await db.run(`DELETE FROM wastage_log WHERE id = ?`, [wastageId]);
  }
  for (const id of madePurchases) {
    await db.run(`DELETE FROM expenses WHERE source_type = 'purchase' AND source_id = ?`, [id]);
    await db.run(`UPDATE purchases SET status = 'voided' WHERE id = ?`, [id]);
    await deletePurchase(db, id).catch(() => {});
  }
  if (itemId) {
    await db.run(`DELETE FROM stock_movements WHERE inventory_item_id = ?`, [itemId]);
    await db.run(`DELETE FROM inventory_items WHERE id = ?`, [itemId]);
  }
  await db.run(`DELETE FROM suppliers WHERE name = ?`, [`${NAME} Supplies`]).catch(() => {});
  await Database.close();
}
