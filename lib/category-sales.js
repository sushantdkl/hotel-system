/**
 * Category sales & stock check: pick any menu categories (liquor, cigarettes,
 * soft drinks…) and see what sold, to whom, and whether the stock agrees.
 *
 * Sales use the report engine's own scope (paid bills, live lines, bill
 * discount spread over the lines) so totals match Reports → Menu / Category.
 * Stock comes from the stock_movements ledger the POS already writes on every
 * sale, purchase, void and wastage.
 */

import { billScope, LINE_REVENUE } from '@/lib/reports.js';
import { liveItemSql } from '@/lib/report-scope.js';
import { normalizedOrderTypeSql } from '@/lib/order-types.js';
import { RECEIPT_CHANGE_TYPES } from '@/lib/inventory-ledger.js';

const num = (v) => Number(v) || 0;
const round2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
const marks = (list) => list.map(() => '?').join(',');

/** Who bought it: the saved customer's name, else how they came in. */
export function customerLabel({ customer_name, order_type }) {
  const name = String(customer_name || '').trim();
  if (name && !/^walk-?\s?in(\s+customer)?$/i.test(name)) return name;
  return { delivery: 'Delivery', takeaway: 'Takeaway' }[order_type] || 'Walk-in';
}

/** Sold lines → totals by item, by customer and by category. Pure, so it is testable without a database. */
export function summarizeSales(lines) {
  const items = new Map();
  const customers = new Map();
  const categories = new Map();
  const bills = new Set();
  const add = (map, key, base, line) => {
    const row = map.get(key) || { ...base, quantity: 0, amount: 0, bills: new Set() };
    row.quantity += num(line.quantity);
    row.amount += num(line.revenue);
    row.bills.add(line.bill_id);
    map.set(key, row);
  };
  for (const line of lines) {
    bills.add(line.bill_id);
    add(items, `${line.name}|${line.variant_name || ''}`, { name: line.name, variant: line.variant_name || null, category: line.category_name }, line);
    const who = customerLabel(line);
    add(customers, who, { name: who }, line);
    add(categories, line.category_name, { name: line.category_name }, line);
  }
  const done = (map) => [...map.values()]
    .map(({ bills: set, ...row }) => ({ ...row, amount: round2(row.amount), bills: set.size }))
    .sort((a, b) => b.amount - a.amount || b.quantity - a.quantity);
  const itemRows = done(items);
  return {
    items: itemRows,
    customers: done(customers),
    categories: done(categories),
    totals: {
      quantity: itemRows.reduce((s, r) => s + r.quantity, 0),
      amount: round2(itemRows.reduce((s, r) => s + r.amount, 0)),
      bills: bills.size,
    },
  };
}

export async function categorySales(db, range, filters, categoryIds) {
  const scope = billScope(db, range, filters);
  const lines = await db.all(
    `SELECT b.id AS bill_id, COALESCE(oi.item_name, mi.name, 'Item') AS name, oi.variant_name,
            COALESCE(mc.name, 'Uncategorised') AS category_name, oi.quantity,
            ${LINE_REVENUE} AS revenue,
            COALESCE(c.name, o.customer_name) AS customer_name,
            ${normalizedOrderTypeSql('o')} AS order_type
     FROM bills b JOIN orders o ON b.order_id = o.id
     JOIN order_items oi ON oi.order_id = o.id
     JOIN menu_items mi ON COALESCE(oi.menu_item_id, oi.item_id) = mi.id
     LEFT JOIN menu_categories mc ON mi.category_id = mc.id
     LEFT JOIN customers c ON c.id = COALESCE(b.customer_id, o.customer_id)
     ${scope.sql} AND ${liveItemSql('oi')} AND mi.category_id IN (${marks(categoryIds)})`,
    [...scope.params, ...categoryIds]
  );
  return summarizeSales(lines || []);
}

/**
 * One inventory row's period, from its current on-hand and the ledger:
 * closing = on hand now − everything after the period; opening = closing − the period.
 */
export function stockLine(item, movements) {
  const t = { purchased: 0, sold: 0, returned: 0, wastage: 0, adjusted: 0, oversold: 0, period: 0, after: 0 };
  for (const m of movements) {
    const q = num(m.in_period);
    t.period += q;
    t.after += num(m.after_period);
    t.oversold += num(m.variance);
    if (RECEIPT_CHANGE_TYPES.includes(m.change_type)) t.purchased += q;
    else if (m.change_type === 'order_deduction') t.sold -= q;
    else if (m.change_type === 'order_void') t.returned += q;
    else if (m.change_type === 'wastage') t.wastage -= q;
    else t.adjusted += q;
  }
  const closing = num(item.quantity) - t.after;
  const factor = num(item.conversion_factor) > 1 ? num(item.conversion_factor) : 1;
  return {
    id: item.id,
    name: item.name,
    unit: item.consumption_unit || item.unit || '',
    purchase_unit: factor > 1 ? (item.purchase_unit || null) : null,
    factor,
    cost_per_unit: num(item.cost_per_unit),
    opening: closing - t.period,
    purchased: t.purchased,
    sold: t.sold,
    returned: t.returned,
    wastage: t.wastage,
    adjusted: t.adjusted,
    oversold: Math.abs(t.oversold),
    closing,
  };
}

/** Stock check for every inventory row the chosen categories sell from (variant link, direct link or recipe). */
export async function categoryStockCheck(db, bounds, categoryIds) {
  const ids = marks(categoryIds);
  const items = await db.all(
    `SELECT ii.id, COALESCE(ii.item_name, ii.name) AS name, ii.quantity, ii.unit, ii.consumption_unit,
            ii.purchase_unit, ii.conversion_factor, ii.cost_per_unit
     FROM inventory_items ii
     WHERE ii.id IN (
       SELECT v.inventory_item_id FROM menu_item_variants v JOIN menu_items mi ON mi.id = v.menu_item_id
         WHERE mi.category_id IN (${ids}) AND v.inventory_item_id IS NOT NULL
       UNION SELECT x.id FROM inventory_items x JOIN menu_items mi ON mi.id = x.menu_item_id
         WHERE mi.category_id IN (${ids})
       UNION SELECT ri.raw_material_id FROM recipe_items ri JOIN recipes r ON r.id = ri.recipe_id
         JOIN menu_items mi ON mi.id = r.menu_item_id
         WHERE mi.category_id IN (${ids}) AND ri.raw_material_id IS NOT NULL
     )
     ORDER BY COALESCE(ii.item_name, ii.name)`,
    [...categoryIds, ...categoryIds, ...categoryIds]
  );
  // Menu items with no stock link at all: the owner needs to know these are not being checked.
  const unlinked = await db.all(
    `SELECT mi.name FROM menu_items mi
     WHERE mi.category_id IN (${ids})
       AND NOT EXISTS (SELECT 1 FROM menu_item_variants v WHERE v.menu_item_id = mi.id AND v.inventory_item_id IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM inventory_items x WHERE x.menu_item_id = mi.id)
       AND NOT EXISTS (SELECT 1 FROM recipes r JOIN recipe_items ri ON ri.recipe_id = r.id WHERE r.menu_item_id = mi.id)
     ORDER BY mi.name`,
    categoryIds
  ).catch(() => []);
  if (!items?.length) return { items: [], unlinked: (unlinked || []).map((r) => r.name) };

  const movements = await db.all(
    `SELECT inventory_item_id, change_type,
            SUM(CASE WHEN created_at < ? THEN quantity_changed ELSE 0 END) AS in_period,
            SUM(CASE WHEN created_at >= ? THEN quantity_changed ELSE 0 END) AS after_period,
            SUM(CASE WHEN created_at < ? THEN COALESCE(variance, 0) ELSE 0 END) AS variance
     FROM stock_movements
     WHERE inventory_item_id IN (${marks(items)}) AND created_at >= ?
     GROUP BY inventory_item_id, change_type`,
    [bounds.end, bounds.end, bounds.end, ...items.map((i) => i.id), bounds.start]
  );
  const byItem = new Map();
  for (const m of movements || []) {
    if (!byItem.has(m.inventory_item_id)) byItem.set(m.inventory_item_id, []);
    byItem.get(m.inventory_item_id).push(m);
  }
  return {
    items: items.map((item) => stockLine(item, byItem.get(item.id) || [])),
    unlinked: (unlinked || []).map((r) => r.name),
  };
}
