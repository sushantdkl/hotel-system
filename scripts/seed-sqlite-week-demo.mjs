/**
 * Seed ~7 days of local SQLite ops data so Business Funding / Opening cash
 * moves / bank shortfall behaviour is visible in the UI.
 *
 * Safe to re-run: keyed by external_ref / memo markers starting with
 * `sqlite-week-demo:`.
 *
 * Usage (from repo root, SQLite only — do NOT set DATABASE_URL):
 *   node --import ./tests/unit/loader-register.mjs scripts/seed-sqlite-week-demo.mjs
 */
import path from 'path';
import { fileURLToPath } from 'url';

process.env.NODE_ENV = process.env.NODE_ENV || 'development';
delete process.env.DATABASE_URL;
process.chdir(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

const { default: Database } = await import('../lib/db/index.js');
const {
  ensureAccountingSchema,
  postJournal,
  postSaleJournal,
  postExpenseJournal,
  accountBalance,
  primaryBankAccountId,
} = await import('../lib/accounting.js');
const { ensureBusinessDaySchema } = await import('../lib/business-days.js');
const { nepalDateString } = await import('../lib/report-dates.js');
const { ensureExpenseVoidSchema } = await import('../lib/expense-links.js');
const { ensureLedgerSchema } = await import('../lib/inventory-ledger.js');

const MARK = 'sqlite-week-demo';
const db = Database.getInstance();
const admin = await db.get(`SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1`);
const adminId = admin?.id || 1;
const drawer = await (async () => {
  await ensureAccountingSchema(db);
  await ensureBusinessDaySchema(db);
  await ensureExpenseVoidSchema(db);
  await ensureLedgerSchema(db);
  return db.get(`SELECT id FROM cash_drawers WHERE is_active=1 ORDER BY id LIMIT 1`);
})();
const drawerId = drawer?.id || 1;
const bankAccountId = await primaryBankAccountId(db);

function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00+05:45`);
  d.setDate(d.getDate() + n);
  return nepalDateString(d);
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function ensureInventoryAndSupplier() {
  let supplier = await db.get(`SELECT id, name FROM suppliers ORDER BY id LIMIT 1`).catch(() => null);
  if (!supplier) {
    const r = await db.run(
      `INSERT INTO suppliers (name, normalized_name, phone) VALUES (?, ?, ?)`,
      ['Himalayan Fresh Foods', 'himalayan fresh foods', '9800000001']
    );
    supplier = { id: r.lastInsertRowid, name: 'Himalayan Fresh Foods' };
  }

  let item = await db.get(
    `SELECT id FROM inventory_items WHERE item_name = ? LIMIT 1`,
    [`${MARK} Veg Oil 5L`]
  ).catch(() => null);
  if (!item) {
    const r = await db.run(
      `INSERT INTO inventory_items (item_name, name, unit, quantity, cost_per_unit, supplier_id)
       VALUES (?, ?, 'pcs', 40, 850, ?)`,
      [`${MARK} Veg Oil 5L`, `${MARK} Veg Oil 5L`, supplier.id]
    );
    item = { id: r.lastInsertRowid };
  }
  return { supplier, item };
}

async function ensureDay(businessDate, { openingCash, countedCash, status }) {
  let day = await db.get(`SELECT * FROM business_days WHERE business_date = ?`, [businessDate]);
  if (!day) {
    const r = await db.run(
      `INSERT INTO business_days
         (business_date, status, opened_by, opening_cash, counted_cash, expected_cash, cash_difference, closed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        businessDate,
        status,
        adminId,
        openingCash,
        status === 'closed' ? countedCash : null,
        status === 'closed' ? countedCash : null,
        0,
        status === 'closed' ? `${businessDate} 22:00:00` : null,
      ]
    );
    day = await db.get(`SELECT * FROM business_days WHERE id = ?`, [r.lastInsertRowid]);
  } else if (status === 'closed' && day.status === 'closed') {
    await db.run(
      `UPDATE business_days SET opening_cash=?, counted_cash=?, expected_cash=?, cash_difference=0 WHERE id=?`,
      [openingCash, countedCash, countedCash, day.id]
    );
    day = await db.get(`SELECT * FROM business_days WHERE id = ?`, [day.id]);
  }

  let session = await db.get(
    `SELECT * FROM business_day_sessions WHERE business_day_id=? ORDER BY session_number DESC LIMIT 1`,
    [day.id]
  );
  if (!session) {
    const r = await db.run(
      `INSERT INTO business_day_sessions
         (business_day_id, session_number, status, opened_by, opening_cash, counted_cash, expected_cash, cash_difference, closed_at, closed_by)
       VALUES (?, 1, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [
        day.id,
        status,
        adminId,
        openingCash,
        status === 'closed' ? countedCash : null,
        status === 'closed' ? countedCash : null,
        status === 'closed' ? `${businessDate} 22:00:00` : null,
        status === 'closed' ? adminId : null,
      ]
    );
    session = await db.get(`SELECT * FROM business_day_sessions WHERE id=?`, [r.lastInsertRowid]);
  }

  let drawerSession = await db.get(
    `SELECT * FROM drawer_sessions WHERE business_day_id=? ORDER BY id LIMIT 1`,
    [day.id]
  );
  if (!drawerSession) {
    const r = await db.run(
      `INSERT INTO drawer_sessions
         (drawer_id, status, opening_amount, opened_by, opened_at, expected_amount, counted_amount, difference, note, closed_by, closed_at, business_day_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      [
        drawerId,
        status === 'open' ? 'open' : 'closed',
        openingCash,
        adminId,
        `${businessDate} 08:00:00`,
        status === 'closed' ? countedCash : null,
        status === 'closed' ? countedCash : null,
        `Business day ${businessDate} session 1`,
        status === 'closed' ? adminId : null,
        status === 'closed' ? `${businessDate} 22:00:00` : null,
        day.id,
      ]
    );
    drawerSession = await db.get(`SELECT * FROM drawer_sessions WHERE id=?`, [r.lastInsertRowid]);
  }

  return { day, session, drawerSession };
}

async function postOpeningReserve(day, priorCash, openingCash) {
  const delta = round2(openingCash - priorCash);
  if (Math.abs(delta) < 0.01) return null;
  const abs = Math.abs(delta);
  const ref = `opening-cash:${day.id}:store_session_opened:${priorCash}:${openingCash}:cash_reserve`;
  if (await db.get(`SELECT id FROM journal_entries WHERE external_ref=?`, [ref])) return null;

  if (delta < 0) {
    // Prior drawer cash removed → Cash Reserve
    return postJournal(db, {
      entry_date: day.business_date,
      memo: `Opening cash movement - Cash Reserve / Safe (${MARK})`,
      source_type: 'opening_cash_movement',
      external_ref: ref,
      created_by: adminId,
      business_day_id: day.id,
      lines: [
        { code: '1030', debit: abs, credit: 0, memo: 'Cash Reserve / Safe' },
        { code: '1010', debit: 0, credit: abs, drawer_id: drawerId, memo: 'Removed from drawer' },
      ],
    });
  }
  return postJournal(db, {
    entry_date: day.business_date,
    memo: `Opening cash movement - Cash Reserve / Safe (${MARK})`,
    source_type: 'opening_cash_movement',
    external_ref: ref,
    created_by: adminId,
    business_day_id: day.id,
    lines: [
      { code: '1010', debit: abs, credit: 0, drawer_id: drawerId, memo: 'Added to drawer' },
      { code: '1030', debit: 0, credit: abs, memo: 'Cash Reserve / Safe' },
    ],
  });
}

async function seedSale({ day, billSuffix, subtotal, method, hour }) {
  const stamp = `${day.business_date} ${String(hour).padStart(2, '0')}:15:00`;
  const vat = round2(subtotal * 0.13);
  const grand = round2(subtotal + vat);
  const billNumber = `${MARK.toUpperCase()}-BILL-${billSuffix}`;
  let bill = await db.get(`SELECT id FROM bills WHERE bill_number=?`, [billNumber]);
  if (!bill) {
    // Minimal completed order so bill FK / reports don't break.
    const orderNum = `${MARK.toUpperCase()}-ORD-${billSuffix}`;
    let order = await db.get(`SELECT id FROM orders WHERE order_number=?`, [orderNum]);
    if (!order) {
      const table = await db.get(`SELECT id, table_number FROM tables ORDER BY id LIMIT 1`);
      const or = await db.run(
        `INSERT INTO orders
           (order_number, table_id, table_number, waiter_id, order_type, status, created_at, updated_at, business_day_id)
         VALUES (?, ?, ?, ?, 'dine_in', 'completed', ?, ?, ?)`,
        [orderNum, table?.id || null, table?.table_number || 'T-01', adminId, stamp, stamp, day.id]
      );
      order = { id: or.lastInsertRowid };
    }
    const br = await db.run(
      `INSERT INTO bills
         (bill_number, order_id, subtotal, tax, vat_amount, service_charge, grand_total, status,
          cashier_id, tax_percent, service_charge_percent, created_at, paid_at, business_day_id)
       VALUES (?, ?, ?, ?, ?, 0, ?, 'paid', ?, 13, 0, ?, ?, ?)`,
      [billNumber, order.id, subtotal, vat, vat, grand, adminId, stamp, stamp, day.id]
    );
    bill = { id: br.lastInsertRowid };
    await db.run(
      `INSERT INTO bill_payments (bill_id, amount, payment_method, created_at, business_day_id)
       VALUES (?, ?, ?, ?, ?)`,
      [bill.id, grand, method, stamp, day.id]
    );
  }

  await postSaleJournal(db, {
    bill_id: bill.id,
    bill_number: billNumber,
    entry_date: day.business_date,
    parts: [{ method, amount: grand }],
    tax_amount: vat,
    created_by: adminId,
    business_day_id: day.id,
  });
  return grand;
}

async function seedExpense({ day, desc, category, amount, method, tag }) {
  const refMemo = `${MARK}:${tag}:${day.business_date}`;
  const existing = await db.get(
    `SELECT id FROM expenses WHERE description=? AND expense_date=? LIMIT 1`,
    [desc, day.business_date]
  );
  let expenseId = existing?.id;
  if (!expenseId) {
    const r = await db.run(
      `INSERT INTO expenses
         (description, category, amount, expense_date, purchase_date, supplier, notes,
          payment_method, logged_by, business_day_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [
        desc,
        category,
        amount,
        day.business_date,
        day.business_date,
        method === 'online' || method === 'bank' ? 'Himalayan Fresh Foods' : null,
        refMemo,
        method,
        adminId,
        day.id,
      ]
    );
    expenseId = r.lastInsertRowid;
  }
  await postExpenseJournal(db, {
    id: expenseId,
    amount,
    category,
    description: desc,
    payment_method: method,
    expense_date: day.business_date,
    logged_by: adminId,
    source_type: category === 'Purchases' ? 'purchase' : null,
    business_day_id: day.id,
    use_business_funding: false,
  });
  return expenseId;
}

async function seedPurchaseRow({ day, supplier, item, total, method, invoiceNo }) {
  let purchase = await db.get(`SELECT id FROM purchases WHERE invoice_number=?`, [invoiceNo]);
  if (!purchase) {
    const r = await db.run(
      `INSERT INTO purchases
         (supplier_id, supplier, invoice_number, invoice_date, received_by, subtotal, tax, discount, shipping, total, notes, status)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, 'received')`,
      [
        supplier.id,
        supplier.name,
        invoiceNo,
        day.business_date,
        adminId,
        total,
        total,
        `${MARK} weekly demo purchase`,
      ]
    );
    purchase = { id: r.lastInsertRowid };
    await db.run(
      `INSERT INTO purchase_items
         (purchase_id, inventory_item_id, quantity_ordered, quantity_received, unit_cost, line_total)
       VALUES (?, ?, 1, 1, ?, ?)`,
      [purchase.id, item.id, total, total]
    );
  }

  // Linked expense + journal (purchases-as-expense policy).
  const desc = `Purchase ${invoiceNo} — Veg Oil`;
  const existing = await db.get(
    `SELECT id FROM expenses WHERE source_type='purchase' AND source_id=?`,
    [purchase.id]
  );
  let expenseId = existing?.id;
  if (!expenseId) {
    const er = await db.run(
      `INSERT INTO expenses
         (description, category, amount, expense_date, purchase_date, supplier, notes,
          payment_method, logged_by, source_type, source_id, business_day_id, status)
       VALUES (?, 'Purchases', ?, ?, ?, ?, ?, ?, ?, 'purchase', ?, ?, 'active')`,
      [
        desc,
        total,
        day.business_date,
        day.business_date,
        supplier.name,
        `${MARK}:purchase:${invoiceNo}`,
        method,
        adminId,
        purchase.id,
        day.id,
      ]
    );
    expenseId = er.lastInsertRowid;
  }
  await postExpenseJournal(db, {
    id: expenseId,
    amount: total,
    category: 'Purchases',
    description: desc,
    payment_method: method,
    expense_date: day.business_date,
    logged_by: adminId,
    supplier_id: supplier.id,
    source_type: 'purchase',
    business_day_id: day.id,
    use_business_funding: false,
  });
}

async function seedFundingPool() {
  const existingJe = await db.get(
    `SELECT id FROM journal_entries
      WHERE external_ref IN (?, ?)
         OR (source_type IN ('business_funding_investment','business_funding_deposit')
             AND memo LIKE ?)
      LIMIT 1`,
    [`${MARK}:funding-seed`, `opening-cash-funding-seed`, `%${MARK}%`]
  );
  if (existingJe) return;

  const { addBusinessInvestment } = await import('../lib/business-funding.js');
  await addBusinessInvestment(db, {
    amount: 15000,
    date: addDays(nepalDateString(), -7),
    note: `${MARK} seed`,
    createdBy: adminId,
  });
}

const today = nepalDateString();
console.log(`Seeding SQLite week demo ending ${today}…`);

const { supplier, item } = await ensureInventoryAndSupplier();
await seedFundingPool();

// Build 7 calendar days ending yesterday so today's open day stays untouched for status.
const daysPlan = [];
for (let i = 7; i >= 1; i -= 1) {
  const date = addDays(today, -i);
  // Alternate: most days open with 0 opening cash so prior counted → Cash Reserve.
  const openingCash = i === 7 ? 2000 : 0;
  const cashSales = 4500 + i * 350;
  const bankSales = 3200 + i * 280;
  const cashExpense = 400 + i * 40;
  const bankExpense = 600 + i * 50;
  const purchaseOnline = i % 2 === 0 ? 1800 + i * 100 : 0;
  // counted ≈ opening + cash sales - cash expense (ignore float noise)
  const countedCash = round2(openingCash + cashSales - cashExpense + (i === 7 ? 0 : 0));
  daysPlan.push({
    date,
    openingCash,
    countedCash: Math.max(500, countedCash),
    cashSales,
    bankSales,
    cashExpense,
    bankExpense,
    purchaseOnline,
    status: 'closed',
  });
}

let priorCounted = 0;
let salesN = 0;
let expenseN = 0;
let purchaseN = 0;
let openingMoves = 0;

for (const plan of daysPlan) {
  // Never overwrite today's open day if it somehow landed in the plan.
  const existing = await db.get(`SELECT status FROM business_days WHERE business_date=?`, [plan.date]);
  if (existing?.status === 'open') {
    console.log(`skip open day ${plan.date}`);
    continue;
  }

  const { day } = await ensureDay(plan.date, {
    openingCash: plan.openingCash,
    countedCash: plan.countedCash,
    status: 'closed',
  });

  if (priorCounted > 0 || plan.openingCash !== priorCounted) {
    const id = await postOpeningReserve(day, priorCounted, plan.openingCash);
    if (id) openingMoves += 1;
  }

  // First day: seed opening cash from equity so drawer starts with float.
  if (plan.openingCash > 0) {
    const ref = `${MARK}:open-float:${plan.date}`;
    if (!(await db.get(`SELECT id FROM journal_entries WHERE external_ref=?`, [ref]))) {
      await postJournal(db, {
        entry_date: plan.date,
        memo: `Opening float (${MARK})`,
        source_type: 'drawer_open',
        external_ref: ref,
        created_by: adminId,
        business_day_id: day.id,
        lines: [
          { code: '1010', debit: plan.openingCash, credit: 0, drawer_id: drawerId, memo: 'Opening cash' },
          { code: '3020', debit: 0, credit: plan.openingCash, memo: 'Opening balance equity' },
        ],
      });
    }
  }

  const suffixBase = plan.date.replace(/-/g, '');
  await seedSale({ day, billSuffix: `${suffixBase}-C`, subtotal: plan.cashSales, method: 'cash', hour: 12 });
  await seedSale({ day, billSuffix: `${suffixBase}-B`, subtotal: plan.bankSales, method: 'online', hour: 14 });
  salesN += 2;

  await seedExpense({
    day,
    desc: `Kitchen supplies ${plan.date}`,
    category: 'Operating',
    amount: plan.cashExpense,
    method: 'cash',
    tag: 'op-cash',
  });
  await seedExpense({
    day,
    desc: `Utilities / gas ${plan.date}`,
    category: 'Operating',
    amount: plan.bankExpense,
    method: 'online',
    tag: 'op-bank',
  });
  expenseN += 2;

  if (plan.purchaseOnline > 0) {
    await seedPurchaseRow({
      day,
      supplier,
      item,
      total: plan.purchaseOnline,
      method: 'online',
      invoiceNo: `${MARK.toUpperCase()}-INV-${suffixBase}`,
    });
    purchaseN += 1;
  }

  priorCounted = plan.countedCash;
}

// Light activity on today's open day (sales only — leave day open).
{
  const openDay = await db.get(`SELECT * FROM business_days WHERE status='open' ORDER BY id DESC LIMIT 1`);
  if (openDay) {
    await seedSale({
      day: openDay,
      billSuffix: `${openDay.business_date.replace(/-/g, '')}-TODAY-C`,
      subtotal: 2800,
      method: 'cash',
      hour: 10,
    });
    await seedSale({
      day: openDay,
      billSuffix: `${openDay.business_date.replace(/-/g, '')}-TODAY-B`,
      subtotal: 4100,
      method: 'online',
      hour: 11,
    });
    salesN += 2;
  }
}

const balances = {
  cash: round2(await accountBalance(db, '1010')),
  bank: round2(await accountBalance(db, '1020')),
  reserve: round2(await accountBalance(db, '1030')),
  funding: round2(await accountBalance(db, '1050')),
};
const openingRows = await db.get(
  `SELECT COUNT(*) AS c FROM journal_entries WHERE source_type='opening_cash_movement'`
);

console.log(JSON.stringify({
  ok: true,
  sales_posted: salesN,
  expenses_posted: expenseN,
  purchases_posted: purchaseN,
  opening_moves_posted: openingMoves,
  opening_cash_movement_journals: Number(openingRows?.c || 0),
  balances,
  tip: 'Open Admin → Business Funding → Opening cash moves. Transfer Cash Reserve → Funding.',
}, null, 2));

process.exit(0);
