/**
 * Seed realistic order/bill/kitchen-ticket demo data so the dashboard and
 * reports pages have something to show. Spans the last 14 days, weighted
 * toward today, using real menu_items and tables already in the DB.
 * Usage: DATABASE_URL=postgresql://... node scripts/seed-orders.mjs
 */
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url || !/^postgres(ql)?:\/\//i.test(url)) {
  console.error('Set DATABASE_URL=postgresql://user:pass@host:5432/dbname');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, ssl: false });

const PAYMENT_METHODS = ['cash', 'card', 'upi', 'wallet'];
const WAITER_IDS = [3, 4]; // waiter1, waiter2
const CASHIER_ID = 2; // cashier1

function rand(n) {
  return Math.floor(Math.random() * n);
}
function pick(arr) {
  return arr[rand(arr.length)];
}
function money(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Demo beverage inventory. This used to be created at REQUEST time by
 * ensureBeverageInventory() in lib/stock.js, which meant a live database's
 * inventory could be entirely fabricated — invented opening balances inflating
 * stock valuation and food cost. It is demo data, so it lives in the demo seed.
 *
 * The menu link is written by EXACT name only. Never match on substrings here:
 * the rule that was removed linked menu "Steam Rice" to "Tea Leaves" because
 * "steam" contains "tea".
 */
async function seedDemoBeverageInventory() {
  const beverages = [
    { menuName: 'Coke', invName: 'Coke Cans', qty: 48, unit: 'pcs', cost: 40 },
    { menuName: 'Masala Tea', invName: 'Masala Tea Cups', qty: 100, unit: 'pcs', cost: 15 },
    { menuName: 'Coffee', invName: 'Coffee Cups', qty: 80, unit: 'pcs', cost: 25 },
    { menuName: 'Cold Coffee', invName: 'Cold Coffee Cups', qty: 60, unit: 'pcs', cost: 35 },
    { menuName: 'Sweet Lassi', invName: 'Lassi Glasses', qty: 40, unit: 'pcs', cost: 30 },
    { menuName: 'Fresh Lemonade', invName: 'Lemonade Glasses', qty: 50, unit: 'pcs', cost: 20 },
  ];

  let created = 0;
  for (const b of beverages) {
    const existing = await pool.query(
      `SELECT id FROM inventory_items WHERE lower(trim(item_name)) = lower(trim($1)) LIMIT 1`,
      [b.invName]
    );
    if (existing.rows.length) continue;

    // Exact menu name, and only if that menu item is not already linked.
    const menu = await pool.query(
      `SELECT m.id FROM menu_items m
        WHERE lower(trim(m.name)) = lower(trim($1))
          AND NOT EXISTS (
            SELECT 1 FROM inventory_items i
             WHERE i.menu_item_id = m.id AND COALESCE(i.is_archived, 0) = 0
          )
        LIMIT 1`,
      [b.menuName]
    );

    // Created at zero, then stocked through the ledger's own movement row so
    // the opening balance has a real cost basis like every other change.
    const inserted = await pool.query(
      `INSERT INTO inventory_items
         (item_name, quantity, unit, cost_per_unit, min_stock_level, supplier, notes, menu_item_id)
       VALUES ($1, 0, $2, $3, $4, 'Beverage Co', 'Demo beverage stock (seed-orders.mjs)', $5)
       RETURNING id`,
      [b.invName, b.unit, b.cost, Math.max(6, Math.floor(b.qty / 4)), menu.rows[0]?.id || null]
    );
    const id = inserted.rows[0].id;

    await pool.query(
      `UPDATE inventory_items SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [b.qty, id]
    );
    await pool.query(
      `INSERT INTO stock_movements
         (inventory_item_id, change_type, quantity_changed, reason, unit_cost, balance_after,
          quantity_requested, variance)
       VALUES ($1, 'opening_balance', $2, 'Demo beverage stock (seed-orders.mjs)', $3, $2, $2, 0)`,
      [id, b.qty, b.cost]
    );
    created++;
  }
  if (created) console.log(`Seeded ${created} demo beverage inventory items.`);
}

async function main() {
  const menuItems = (
    await pool.query(
      `SELECT id, base_price FROM menu_items WHERE COALESCE(is_available, 1) = 1`
    )
  ).rows;
  const tables = (await pool.query(`SELECT id, table_number FROM tables`)).rows;

  if (!menuItems.length || !tables.length) {
    console.error('No menu_items or tables found — run db:pg:init first.');
    process.exit(1);
  }

  await seedDemoBeverageInventory();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let orderCount = 0;
  let billCount = 0;

  for (let dayOffset = 13; dayOffset >= 0; dayOffset--) {
    const dayStart = new Date(today);
    dayStart.setDate(dayStart.getDate() - dayOffset);

    // More orders on recent days, fewer further back, so trend charts read naturally.
    const baseVolume = 8 + rand(10);
    const recencyBoost = dayOffset === 0 ? 10 : dayOffset <= 2 ? 5 : 0;
    const ordersToday = baseVolume + recencyBoost;

    for (let i = 0; i < ordersToday; i++) {
      const now = new Date();
      const isToday = dayOffset === 0;
      // Service hours 11:00-20:59; for "today" never later than right now, and
      // if it's not even 11am yet locally, seed a light morning-prep window instead.
      const minHour = isToday ? Math.min(11, now.getHours()) : 11;
      const maxHour = isToday ? Math.max(minHour, now.getHours()) : 20;
      const hour = minHour + rand(Math.max(1, maxHour - minHour + 1));
      const minute = isToday && hour === now.getHours() ? rand(now.getMinutes() + 1) : rand(60);
      const createdAt = new Date(dayStart);
      createdAt.setHours(hour, minute, rand(60));
      if (createdAt > now) continue;

      const table = pick(tables);
      const waiterId = pick(WAITER_IDS);
      const orderNumber = `ORD-${createdAt.getTime()}-${i}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

      const isVeryRecent = dayOffset === 0 && rand(10) < 3; // ~30% of today's orders still in flight
      const orderStatus = isVeryRecent ? pick(['pending', 'preparing', 'ready']) : 'completed';

      const orderRes = await pool.query(
        `INSERT INTO orders (order_number, table_id, table_number, order_type, status, waiter_id, created_at, updated_at)
         VALUES ($1, $2, $3, 'dine_in', $4, $5, $6, $6) RETURNING id`,
        [orderNumber, table.id, table.table_number, orderStatus, waiterId, createdAt]
      );
      const orderId = orderRes.rows[0].id;
      orderCount++;

      const itemLines = 1 + rand(4);
      let subtotal = 0;
      const chosenItems = [];
      for (let li = 0; li < itemLines; li++) {
        const mi = pick(menuItems);
        const qty = 1 + rand(3);
        const price = Number(mi.base_price);
        const lineSubtotal = money(price * qty);
        subtotal += lineSubtotal;
        chosenItems.push({ id: mi.id, qty, price });
        await pool.query(
          `INSERT INTO order_items (order_id, menu_item_id, quantity, price, subtotal, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [orderId, mi.id, qty, price, lineSubtotal, orderStatus === 'completed' ? 'served' : 'pending', createdAt]
        );
      }

      // Kitchen ticket — completed shortly after order for finished orders,
      // still pending/preparing for the in-flight ones (feeds "Needs Attention").
      const kotStatus = orderStatus === 'completed' ? 'completed' : orderStatus === 'ready' ? 'ready' : pick(['pending', 'preparing']);
      const completedAt = kotStatus === 'completed' || kotStatus === 'ready'
        ? new Date(createdAt.getTime() + (5 + rand(15)) * 60000)
        : null;
      await pool.query(
        `INSERT INTO kots (kot_number, order_id, station, status, printed_at, started_at, completed_at)
         VALUES ($1, $2, 'main', $3, $4, $5, $6)`,
        [`KOT-${orderId}`, orderId, kotStatus, createdAt, createdAt, completedAt]
      );

      if (orderStatus !== 'completed') continue; // don't bill in-flight orders

      const taxPercent = 13;
      const tax = money(subtotal * (taxPercent / 100));
      const grandTotal = money(subtotal + tax);
      const billStatus = dayOffset === 0 && rand(10) < 2 ? 'unpaid' : 'paid'; // a couple of today's bills stay unpaid
      const paidAt = billStatus === 'paid' ? new Date(createdAt.getTime() + (10 + rand(20)) * 60000) : null;

      const billRes = await pool.query(
        `INSERT INTO bills (bill_number, order_id, subtotal, tax, tax_percent, grand_total, cashier_id, status, created_at, paid_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [`BILL-${orderId}`, orderId, subtotal, tax, taxPercent, grandTotal, CASHIER_ID, billStatus, createdAt, paidAt]
      );
      billCount++;

      if (billStatus === 'paid') {
        await pool.query(
          `INSERT INTO bill_payments (bill_id, amount, payment_method, created_at)
           VALUES ($1, $2, $3, $4)`,
          [billRes.rows[0].id, grandTotal, pick(PAYMENT_METHODS), paidAt]
        );
      }
    }
  }

  // Leave a few tables genuinely "occupied" right now for the live dashboard KPI.
  const occupiedPicks = tables.slice(0, Math.min(3, tables.length));
  for (const t of occupiedPicks) {
    await pool.query(`UPDATE tables SET status = 'occupied' WHERE id = $1`, [t.id]);
  }

  console.log(`Seeded ${orderCount} orders, ${billCount} bills across 14 days.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
