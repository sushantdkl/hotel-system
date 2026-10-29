/**
 * Stock movement audit log — one row per quantity change on a raw material,
 * so the Inventory Command Center can show a history and estimate burn rate.
 */

import { ensureSqliteTable } from '@/lib/db/ensure-sqlite-table.js';
import { ensureColumn } from '@/lib/db/schema-helpers.js';
import { buildSearch, paginateQuery, resolveOrderBy } from '@/lib/paginate.js';

export async function ensureStockMovementsTable(db) {
  await ensureSqliteTable(
    db,
    `
    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inventory_item_id INTEGER REFERENCES inventory_items(id),
      change_type TEXT NOT NULL,
      quantity_changed REAL NOT NULL,
      performed_by INTEGER REFERENCES users(id),
      reason TEXT,
      reference_id TEXT,
      business_day_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `
  );
  await ensureColumn(db, 'stock_movements', 'business_day_id', 'INTEGER');
  await ensureSqliteTable(db, `CREATE INDEX IF NOT EXISTS idx_stock_movements_business_day ON stock_movements (business_day_id, change_type)`);
}

/** quantity_changed is signed: negative for deductions/wastage, positive for restocks/restores. */
export async function logStockMovement(db, { inventory_item_id, change_type, quantity_changed, performed_by, reason, reference_id, business_day_id = null }) {
  if (!inventory_item_id || !change_type || !Number.isFinite(Number(quantity_changed))) return;
  await db.run(
    `INSERT INTO stock_movements (inventory_item_id, change_type, quantity_changed, performed_by, reason, reference_id, business_day_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [inventory_item_id, change_type, Number(quantity_changed), performed_by || null, reason || null, reference_id ? String(reference_id) : null, business_day_id || null]
  );
}

const MOVEMENT_SORTS = {
  created_at: 'm.created_at',
  item_name: 'im.item_name',
  change_type: 'm.change_type',
  quantity_changed: 'm.quantity_changed',
  balance_after: 'm.balance_after',
  unit_cost: 'm.unit_cost',
};

const MOVEMENT_SEARCH_COLUMNS = ['im.item_name', 'm.change_type', 'm.reason', 'm.reference_id', 'u.full_name'];

/**
 * Paginated movement history. This table grows several rows per order, so it is
 * the one that would have fallen over first — it is never fetched unbounded.
 *
 * @returns {{ rows: any[], pagination: object }}
 */
export async function listStockMovements(
  db,
  {
    inventoryItemId,
    changeType,
    adjustmentsOnly,
    varianceOnly,
    pricedOnly,
    from,
    to,
    dateBasis = 'recorded',
    page = 1,
    pageSize = 50,
    exportAll = false,
    sort = '',
    dir = 'DESC',
    search = '',
  } = {}
) {
  const conditions = ['1=1'];
  const params = [];

  if (inventoryItemId) {
    conditions.push('m.inventory_item_id = ?');
    params.push(inventoryItemId);
  }
  // Filtering these server-side means a caller that wants "the last 20 counts
  // that disagreed" gets exactly those, rather than the last 1000 movements in
  // the hope that 20 of them had a variance.
  if (varianceOnly) conditions.push('COALESCE(m.variance, 0) <> 0');
  if (pricedOnly) conditions.push('m.unit_cost IS NOT NULL');
  if (changeType && changeType !== 'all') {
    conditions.push('m.change_type = ?');
    params.push(changeType);
  }
  if (adjustmentsOnly) {
    conditions.push("m.change_type IN ('manual_adjustment','adjustment','stock_count','correction')");
  }
  const reportDate = "COALESCE(date(p.invoice_date), date(bd.business_date), date(m.created_at, '+5 hours', '+45 minutes'))";
  const dateColumn = dateBasis === 'business' ? reportDate : "date(m.created_at, '+5 hours', '+45 minutes')";
  if (from) {
    conditions.push(`${dateColumn} >= date(?)`);
    params.push(from);
  }
  if (to) {
    conditions.push(`${dateColumn} <= date(?)`);
    params.push(to);
  }

  const searchClause = buildSearch(search, MOVEMENT_SEARCH_COLUMNS);
  if (searchClause.clause) {
    conditions.push(searchClause.clause);
    params.push(...searchClause.params);
  }

  return paginateQuery(db, {
    columns: `m.*, im.item_name, im.unit, u.full_name as performed_by_name,
      m.balance_after - m.quantity_changed AS balance_before, ${reportDate} AS report_date,
      bd.business_date AS business_date, p.invoice_number`,
    from: `stock_movements m
      LEFT JOIN inventory_items im ON m.inventory_item_id = im.id
      LEFT JOIN users u ON m.performed_by = u.id
      LEFT JOIN business_days bd ON bd.id = m.business_day_id
      LEFT JOIN purchases p ON m.change_type IN ('purchase_receipt','manual_restock') AND CAST(p.id AS TEXT) = m.reference_id`,
    where: conditions.join(' AND '),
    params,
    orderBy: resolveOrderBy(sort, dir, MOVEMENT_SORTS, 'created_at', 'm.id'),
    page,
    pageSize,
    exportAll,
  });
}

/**
 * Rough daily burn rate per item from order_deduction movements in the last
 * `days`, so the low-stock table can estimate "days remaining". Returns a
 * Map<inventory_item_id, avgDailyQty>; items with no deduction history are
 * simply absent (caller shows "—").
 */
export async function getDailyBurnRates(db, { days = 7 } = {}) {
  const cutoffSql =
    db.driver === 'postgres'
      ? `CURRENT_TIMESTAMP - INTERVAL '${Number(days)} days'`
      : `datetime('now', '-${Number(days)} days')`;
  const rows = await db.all(
    `SELECT inventory_item_id, SUM(-quantity_changed) as total
     FROM stock_movements
     WHERE change_type = 'order_deduction'
       AND quantity_changed < 0
       AND created_at >= ${cutoffSql}
     GROUP BY inventory_item_id`
  );

  const map = new Map();
  for (const row of rows || []) {
    map.set(row.inventory_item_id, Number(row.total) / days);
  }
  return map;
}
