/**
 * Cancel empty open orders (no line items) left by idle POS auto-create.
 * Usage: node scripts/cancel-empty-drafts.mjs
 */
import Database from '../lib/db/index.js';

async function main() {
  const db = Database.getInstance();
  const rows = await db.all(`
    SELECT o.id, o.order_number, o.order_type, o.status,
      (SELECT COUNT(*) FROM order_items oi
        WHERE oi.order_id = o.id AND COALESCE(oi.status,'') NOT IN ('voided','cancelled')) AS items
    FROM orders o
    WHERE o.status NOT IN ('completed','cancelled')
      AND NOT EXISTS (SELECT 1 FROM bills b WHERE b.order_id = o.id)
  `);
  const empty = (rows || []).filter((r) => Number(r.items) === 0);
  console.log(`Found ${empty.length} empty draft(s) of ${(rows || []).length} open order(s).`);
  for (const r of empty) {
    await db.run(
      `UPDATE orders SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [r.id]
    );
    console.log(`  cancelled ${r.order_number} (#${r.id}) [${r.order_type}]`);
  }
  console.log('Done.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
