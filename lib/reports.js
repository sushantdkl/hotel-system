/**
 * Analytics engine behind /admin/reports.
 *
 * One builder per tab. Every number returned here comes from a real query —
 * where this schema has no underlying data for a metric the owner asked for
 * (tips, attendance, supplier ledgers, refunds) the metric is left out rather
 * than faked, and the tab carries a `notes` line saying so.
 *
 * SQL is written SQLite-first; lib/db/sql.js#adaptSqlForPostgres translates it.
 * Never write `x::text` / `x::date` here — use CAST(x AS TEXT) and date(x).
 */

import { nepalDateString, nepalOperationalRangeBounds } from '@/lib/report-dates.js';
import { FOOD_GROUPS, foodGroupLabel, foodGroupSql, normalizeFoodGroup } from '@/lib/food-groups.js';
import { normalizedOrderTypeSql, orderTypeLabel } from '@/lib/order-types.js';
import { logger } from '@/lib/logger.js';
import {
  BILL_BASIS_NOTE, billTaxSql, countedBillSql, liveItemSql,
  normalizePaymentFilterBucket, paymentBucket, paymentBucketSql,
  paymentColumnMatchesBucketSql, paymentsUnionSql,
  PAYMENT_FILTER_OPTIONS, settledPaymentSql, voidedBillSql,
} from '@/lib/report-scope.js';
import { ensureColumn } from '@/lib/db/schema-helpers.js';
import { DEFAULT_FOOD_GROUP } from '@/lib/food-groups.js';
import { ensureRecipeTables } from '@/lib/recipes.js';
import { ensureStockMovementsTable } from '@/lib/stock-movements.js';
import { ensureSplitPaymentSchema } from '@/lib/split-payments.js';
import { ensureBillCorrectionsSchema } from '@/lib/bill-corrections.js';
import { ensureBusinessDaySchema } from '@/lib/business-days.js';
import { makePagination } from '@/lib/paginate.js';
import { adToBsParts } from '@/lib/calendar-system.js';
import { normalizeUnitOrKeep } from '@/lib/units.js';
import { applyCreditSettlements, creditPurchaseSettlements } from '@/lib/accounting-suppliers.js';
import { isAdminLike } from './roles.js';

/**
 * Master-category ("food group") of a menu line, SQL fragment.
 * Items with no category are bucketed as 'uncategorised' rather than being
 * silently folded into Food, so the breakdown stays honest.
 * Synonyms (Food/food, beverages/beverage) collapse to one canonical id.
 */
const FOOD_GROUP_EXPR = foodGroupSql('mc');
const ORDER_TYPE_EXPR = normalizedOrderTypeSql('o');

// ponytail: flat food-cost ratio for menu items without a recipe/BOM — same
// heuristic the dashboard already uses. Real cost comes from recipes when present.
export const COST_RATIO = 0.6;

function paymentMethodLabel(method) {
  const raw = String(method || '').trim().toLowerCase();
  if (!raw) return 'Not recorded';
  if (raw === 'owner_pocket') return 'Owner Pocket';
  if (raw === 'business_funding') return 'Business Funding';
  const bucket = normalizePaymentFilterBucket(raw);
  if (bucket === 'cash') return 'Cash';
  if (bucket === 'credit') return 'Credit';
  if (bucket === 'funding') return 'Owner / Business Funding';
  return 'Online';
}

/*
 * Which bills count, and how an item line qualifies. Both come from
 * lib/report-scope.js so this engine, the analytics page, the summary report
 * and the dashboard cannot drift apart again. See that file for the rules.
 */
const PAID = countedBillSql('b');
const LIVE_ITEM = liveItemSql('oi');

/** Postgres lowercases unquoted aliases; read a numeric field either way. */
export function num(row, ...keys) {
  if (!row) return 0;
  for (const key of keys) {
    const v = row[key] ?? row[key.toLowerCase()];
    if (v != null && v !== '') {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}

/** Rounded rupees with thousand separators, for insight and chip copy. */
const money = (n) => `Rs ${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

const isPg = (db) => db?.driver === 'postgres';

/* ---- resilience -------------------------------------------------- */
/*
 * Half this schema is created lazily: recipes and wastage on first recipe,
 * stock_movements on first stock edit, bill_payment_allocations and
 * customer_ledger on first split settlement, bill_corrections on first
 * refund/void, the journal on first accounting page view. A shop that has
 * never used a feature has never created its tables.
 *
 * Reading one of those from the report layer used to throw, and because the
 * builders fan out through Promise.all a single missing table 500'd the entire
 * page. On a brand-new install built from the shipped base schema, 69 of 115
 * report/period combinations failed this way.
 *
 * lib/analytics.js already wrapped its queries in exactly this helper. Same
 * approach here: a report about a feature you have never used shows nothing,
 * which is the truth, instead of an error page.
 */
async function safe(promise, fallback) {
  try {
    return await promise;
  } catch (error) {
    if (process.env.DEBUG_SQL === '1') logger.warn('report_query_skipped', { message: error.message });
    return fallback;
  }
}

const safeAll = (db, sql, params = []) => safe(db.all(sql, params), []);
const safeGet = (db, sql, params = []) => safe(db.get(sql, params), {});

/**
 * Prepare every optional table and column the report engine reads.
 *
 * This lives beside the queries rather than in the route on purpose: the route
 * is not the only caller. Tests, the probe script and any future job call
 * buildReport() directly, and they used to skip the prep the route was doing —
 * which is how the probe hit "no such column: o.party_label" on queries the
 * live page renders fine.
 *
 * Safe to call repeatedly; every step is CREATE/ADD IF NOT EXISTS. Failures are
 * swallowed because `safe()` above means a report still renders without them.
 */
export async function ensureReportSchema(db) {
  const steps = [
    () => ensureColumn(db, 'menu_categories', 'food_group', `TEXT DEFAULT '${DEFAULT_FOOD_GROUP}'`),
    () => ensureColumn(db, 'orders', 'party_label', 'TEXT'),
    () => ensureColumn(db, 'orders', 'cancel_reason', 'TEXT'),
    () => ensureColumn(db, 'orders', 'cancelled_at', isPg(db) ? 'TIMESTAMP' : 'DATETIME'),
    () => ensureColumn(db, 'orders', 'business_day_id', 'INTEGER'),
    () => ensureColumn(db, 'bills', 'void_reason', 'TEXT'),
    () => ensureColumn(db, 'bills', 'voided_at', isPg(db) ? 'TIMESTAMP' : 'DATETIME'),
    () => ensureColumn(db, 'bills', 'outstanding_amount', isPg(db) ? 'NUMERIC(14,2) DEFAULT 0' : 'REAL DEFAULT 0'),
    () => ensureColumn(db, 'bills', 'business_day_id', 'INTEGER'),
    () => ensureColumn(db, 'bills', 'customer_id', 'INTEGER'),
    () => ensureColumn(db, 'kots', 'void_reason', 'TEXT'),
    () => ensureColumn(db, 'kots', 'voided_at', isPg(db) ? 'TIMESTAMP' : 'DATETIME'),
    () => ensureColumn(db, 'kots', 'cancel_reason', 'TEXT'),
    () => ensureColumn(db, 'kots', 'cancelled_at', isPg(db) ? 'TIMESTAMP' : 'DATETIME'),
    () => ensureColumn(db, 'kots', 'cancelled_by', 'INTEGER'),
    () => ensureColumn(db, 'kots', 'previous_status', 'TEXT'),
    () => ensureColumn(db, 'kots', 'business_day_id', 'INTEGER'),
    () => ensureColumn(db, 'expenses', 'payment_method', "TEXT DEFAULT 'cash'"),
    () => ensureColumn(db, 'expenses', 'logged_by', 'INTEGER'),
    () => ensureColumn(db, 'expenses', 'source_type', 'TEXT'),
    () => ensureColumn(db, 'expenses', 'source_id', 'INTEGER'),
    () => ensureColumn(db, 'expenses', 'supplier', 'TEXT'),
    () => ensureColumn(db, 'expenses', 'purchase_date', 'TEXT'),
    () => ensureColumn(db, 'expenses', 'business_day_id', 'INTEGER'),
    () => ensureColumn(db, 'expenses', 'status', "TEXT DEFAULT 'active'"),
    () => ensureColumn(db, 'inventory_items', 'category', 'TEXT'),
    () => ensureColumn(db, 'inventory_items', 'supplier', 'TEXT'),
    () => ensureColumn(db, 'inventory_items', 'cost_per_unit', 'REAL DEFAULT 0'),
    () => ensureColumn(db, 'inventory_items', 'min_stock_level', 'REAL DEFAULT 0'),
    () => ensureColumn(db, 'customers', 'current_credit', 'REAL DEFAULT 0'),
    () => ensureColumn(db, 'tables', 'section', 'TEXT'),
  ];
  for (const step of steps) await safe(step(), null);

  // Lazily-created tables, each owned by the module that writes to them.
  for (const ensure of [
    ensureRecipeTables,
    ensureStockMovementsTable,
    ensureSplitPaymentSchema,
    ensureBillCorrectionsSchema,
    ensureBusinessDaySchema,
  ]) {
    await safe(ensure(db), null);
  }
}

/* ---- detail-table pagination ------------------------------------- */
/*
 * Detail tables page in SQL so the browser never receives an unbounded row set.
 * Whole-period KPIs still come from aggregate queries — paging only affects the
 * line-item tables. `exportAll` lifts the page limit so CSV downloads stay
 * complete.
 */
export const DETAIL_PAGE_SIZE = 50;
const MAX_DETAIL_PAGE_SIZE = 200;

/** @param {object} f filters  @param {string} tableId */
function readTablePaging(f, tableId) {
  if (f?.exportAll) return { exportAll: true, page: 1, pageSize: null };
  const pages = f?.tablePages && typeof f.tablePages === 'object' ? f.tablePages : {};
  const sizes = f?.tablePageSizes && typeof f.tablePageSizes === 'object' ? f.tablePageSizes : {};
  const page = Math.max(1, Number(pages[tableId]) || Number(f?.page) || 1);
  const pageSize = Math.min(
    MAX_DETAIL_PAGE_SIZE,
    Math.max(1, Number(sizes[tableId]) || Number(f?.pageSize) || Number(f?.detailLimit) || DETAIL_PAGE_SIZE)
  );
  return { exportAll: false, page, pageSize };
}

function pageClause(paging) {
  if (paging.exportAll || paging.pageSize == null) return '';
  const offset = (paging.page - 1) * paging.pageSize;
  return `LIMIT ${paging.pageSize} OFFSET ${offset}`;
}

function totalsFromRow(countRow, sumKeys = []) {
  return Object.fromEntries(sumKeys.map((key) => [key, num(countRow, key)]));
}

/** Page a SELECT and return its count/totals in the same database read. */
async function queryPaged(db, sql, params, paging, sumKeys = []) {
  if (paging.exportAll) {
    const rows = await safeAll(db, sql, params);
    const columnTotals = Object.fromEntries(sumKeys.map((key) => [
      key,
      rows.reduce((sum, row) => sum + (Number(row[key]) || 0), 0),
    ]));
    return {
      rows,
      pagination: makePagination({ page: 1, pageSize: Math.max(rows.length, 1), total: rows.length, exported: true }),
      columnTotals,
    };
  }

  const totalAliases = sumKeys.map((key) => `COALESCE(SUM(${key}) OVER (), 0) AS _page_total_${key}`);
  const metadata = ['COUNT(*) OVER () AS _page_total', ...totalAliases].join(', ');
  const rawRows = await safeAll(
    db,
    `SELECT _detail_page.*, ${metadata} FROM (${sql}) AS _detail_page ${pageClause(paging)}`,
    params
  );
  const summary = rawRows[0] || {};
  const total = Number(summary._page_total ?? summary._PAGE_TOTAL ?? 0);
  const columnTotals = Object.fromEntries(sumKeys.map((key) => [
    key,
    Number(summary[`_page_total_${key}`] ?? summary[`_PAGE_TOTAL_${key.toUpperCase()}`] ?? 0),
  ]));
  const rows = rawRows.map((row) => Object.fromEntries(
    Object.entries(row).filter(([key]) => !key.toLowerCase().startsWith('_page_total'))
  ));
  return {
    rows,
    pagination: makePagination({ page: paging.page, pageSize: paging.pageSize, total }),
    columnTotals,
  };
}

/** Page an in-memory list (changes tab, etc.). */
function paginateList(list, paging, sumKeys = []) {
  const items = list || [];
  const total = items.length;
  const columnTotals = totalsFromRow(
    Object.fromEntries(sumKeys.map((key) => [
      key,
      items.reduce((sum, row) => sum + (Number(row[key]) || 0), 0),
    ])),
    sumKeys
  );
  if (paging.exportAll) {
    return {
      rows: items,
      pagination: makePagination({ page: 1, pageSize: Math.max(total, 1), total, exported: true }),
      columnTotals,
    };
  }
  const offset = (paging.page - 1) * paging.pageSize;
  return {
    rows: items.slice(offset, offset + paging.pageSize),
    pagination: makePagination({ page: paging.page, pageSize: paging.pageSize, total }),
    columnTotals,
  };
}

function withPagination(table, paged) {
  return {
    ...table,
    pagination: paged.pagination,
    totals: paged.columnTotals || {},
    paymentTotals: paged.paymentTotals || table.paymentTotals || null,
    total: paged.pagination?.total ?? table.rows?.length ?? 0,
    shown: table.rows?.length ?? 0,
  };
}

/** Parse `table_pages` / `table_page_sizes` from the reports API query string. */
export function parseReportTablePaging(searchParams) {
  const readJson = (key) => {
    const raw = searchParams.get(key);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  };
  return {
    tablePages: readJson('table_pages'),
    tablePageSizes: readJson('table_page_sizes'),
  };
}

/* ---- dialect helpers the SQL adapter does not cover ---- */
/*
 * Timestamps are stored in UTC. Nepal is UTC+05:45, so bucketing a raw UTC
 * column by hour or weekday is wrong twice over: every "busiest hour" was
 * shifted 5h45m earlier than the clock on the wall, and any bill rung up
 * between midnight and 05:45 NPT was attributed to the previous weekday.
 * Shift into Nepal local time first — the same rule lib/analytics.js already
 * applies, so the two pages now agree.
 */
const nepalLocal = (db, col) =>
  isPg(db)
    ? `(${col})`
    : `datetime(${col}, '+5 hours', '+45 minutes')`;
const hourOf = (db, col) =>
  isPg(db)
    ? `CAST(EXTRACT(HOUR FROM ${nepalLocal(db, col)}) AS INTEGER)`
    : `CAST(strftime('%H', ${nepalLocal(db, col)}) AS INTEGER)`;
const dowOf = (db, col) =>
  isPg(db)
    ? `CAST(EXTRACT(DOW FROM ${nepalLocal(db, col)}) AS INTEGER)`
    : `CAST(strftime('%w', ${nepalLocal(db, col)}) AS INTEGER)`;
const monthOf = (db, col) =>
  isPg(db) ? `to_char(${nepalLocal(db, col)}, 'YYYY-MM')` : `strftime('%Y-%m', ${nepalLocal(db, col)})`;
/** Whole minutes between two timestamp columns. */
const minutesBetween = (a, b) => `((julianday(${b}) - julianday(${a})) * 1440.0)`;

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/**
 * Normalise a grouped `date(col)` value to YYYY-MM-DD.
 * node-postgres hands back a JS Date for the `date` type, so String(v).slice(0,10)
 * gives "Wed Jul 01" and every by-day chart silently flatlines. SQLite returns a
 * plain string. Handle both.
 */
export const dateKey = (v) => {
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return String(v ?? '').slice(0, 10);
};

/** Every date in the range, ascending, as { date, day } — used to pad chart series. */
export function eachDay(range) {
  const out = [];
  const cursor = new Date(`${range.start}T12:00:00+05:45`);
  const last = new Date(`${range.end}T12:00:00+05:45`);
  let guard = 0;
  while (cursor <= last && guard++ < 400) {
    out.push({
      date: nepalDateString(cursor),
      day: cursor.toLocaleDateString('en-US', { timeZone: 'Asia/Kathmandu', weekday: 'short' }),
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

/** The equal-length window immediately before `range`, for "vs previous" maths. */
export function previousRange(range) {
  const start = new Date(`${range.start}T12:00:00+05:45`);
  const end = new Date(`${range.end}T12:00:00+05:45`);
  const span = Math.max(1, Math.round((end - start) / 86400000) + 1);
  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - (span - 1));
  return { start: nepalDateString(prevStart), end: nepalDateString(prevEnd), spanDays: span };
}

function pctChange(current, previous) {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * Filter fragment shared by every bill-scoped query.
 * Assumes the query aliases bills as `b` and orders as `o`.
 * Uses Nepal calendar day bounds in UTC so overnight hours aren't dropped.
 */
export function billScope(db, range, f = {}) {
  let sql;
  let params;
  if (f.businessDayId) {
    sql = ` WHERE b.business_day_id = ? AND ${PAID}`;
    params = [f.businessDayId];
  } else {
    const { start, endExclusive } = nepalOperationalRangeBounds(db.driver, range.start, range.end);
    sql = ` WHERE b.created_at >= ? AND b.created_at < ? AND ${PAID}`;
    params = [start, endExclusive];
  }

  if (f.employeeId) {
    sql += ` AND (o.waiter_id = ? OR b.cashier_id = ?)`;
    params.push(f.employeeId, f.employeeId);
  }
  if (f.orderType) {
    sql += ` AND ${ORDER_TYPE_EXPR} = ?`;
    params.push(f.orderType);
  }
  if (f.paymentMethod) {
    const bucket = normalizePaymentFilterBucket(f.paymentMethod);
    if (bucket) {
      sql += ` AND (EXISTS (SELECT 1 FROM bill_payments bpf WHERE bpf.bill_id = b.id AND ${paymentColumnMatchesBucketSql('bpf.payment_method', bucket)} AND ${settledPaymentSql('bpf')})
                    OR EXISTS (SELECT 1 FROM bill_payment_allocations baf WHERE baf.bill_id = b.id AND ${paymentColumnMatchesBucketSql('baf.method', bucket)} AND ${settledPaymentSql('baf')}))`;
    }
  }
  if (f.search) {
    sql += ` AND (LOWER(COALESCE(b.bill_number, '')) LIKE ?
                OR LOWER(COALESCE(o.order_number, '')) LIKE ?
                OR LOWER(COALESCE(o.table_number, '')) LIKE ?
                OR LOWER(COALESCE(o.customer_name, '')) LIKE ?)`;
    const like = `%${String(f.search).toLowerCase()}%`;
    params.push(like, like, like, like);
  }
  return { sql, params };
}

const BILL_FROM = `FROM bills b JOIN orders o ON b.order_id = o.id`;

function rangeDateWhere(alias, column) {
  return `date(${alias}.${column}, '+5 hours', '+45 minutes') BETWEEN ? AND ?`;
}

function searchClauseForOrderAlias(f, alias = 'o') {
  if (!f.search) return { sql: '', params: [] };
  const like = `%${String(f.search).toLowerCase()}%`;
  return {
    sql: ` AND (LOWER(COALESCE(${alias}.order_number, '')) LIKE ? OR LOWER(COALESCE(${alias}.table_number, '')) LIKE ?)`,
    params: [like, like],
  };
}

/* ------------------------------------------------------------------ */
/* Shared building blocks                                             */
/* ------------------------------------------------------------------ */

/**
 * menu_item_id -> unit food cost. Recipe/BOM cost when a recipe exists,
 * otherwise base_price * COST_RATIO. `estimated` flags the fallback.
 */
export async function getItemCostMap(db) {
  const items = await safeAll(db, `SELECT id, base_price FROM menu_items`);
  const itemPrice = new Map((items || []).map((item) => [item.id, num(item, 'base_price')]));
  const map = new Map();
  for (const item of items || []) {
    map.set(item.id, { cost: num(item, 'base_price') * COST_RATIO, estimated: true });
  }

  // Fetch recipe lines instead of multiplying inside SQL. Some older databases
  // stored a purchase-unit rate (for example Rs/kg) in cost_per_unit even though
  // recipe quantities were already in consumption units (for example grams).
  // New records store the canonical per-consumption-unit rate. Keeping both
  // calculations lets us repair only unmistakable legacy scale errors without
  // dividing correctly stored costs a second time.
  const rows = await safeAll(db, `
    SELECT r.menu_item_id AS menu_item_id,
           COALESCE(r.yield_quantity, 1) AS yield_quantity,
           ri.quantity, ri.unit AS recipe_unit, ri.component_recipe_id, ri.raw_material_id,
           im.cost_per_unit, COALESCE(im.conversion_factor, 1) AS conversion_factor,
           im.purchase_unit, COALESCE(im.consumption_unit, im.unit) AS consumption_unit,
           (SELECT pi.unit_cost FROM purchase_items pi
             JOIN purchases p ON p.id = pi.purchase_id
             WHERE pi.inventory_item_id = im.id AND COALESCE(pi.unit_cost, 0) > 0
               AND COALESCE(p.status, 'received') NOT IN ('draft', 'voided')
             ORDER BY COALESCE(p.invoice_date, CAST(p.created_at AS TEXT)) DESC, pi.id DESC LIMIT 1) AS latest_purchase_unit_cost
    FROM recipes r
    JOIN recipe_items ri ON ri.recipe_id = r.id
    LEFT JOIN inventory_items im ON ri.raw_material_id = im.id
    WHERE r.menu_item_id IS NOT NULL
  `);
  const recipeCosts = new Map();
  for (const row of rows || []) {
    const current = recipeCosts.get(row.menu_item_id) || {
      direct: 0, normalized: 0, yieldQty: num(row, 'yield_quantity') || 1,
      canNormalize: false, estimated: false,
    };
    if (row.component_recipe_id != null || row.raw_material_id == null) {
      current.estimated = true;
      recipeCosts.set(row.menu_item_id, current);
      continue;
    }

    const factor = Math.max(1, num(row, 'conversion_factor') || 1);
    const purchaseUnit = normalizeUnitOrKeep(row.purchase_unit);
    const consumptionUnit = normalizeUnitOrKeep(row.consumption_unit);
    const recipeUnit = normalizeUnitOrKeep(row.recipe_unit);
    const hasDualUnits = factor > 1 && purchaseUnit && consumptionUnit && purchaseUnit !== consumptionUnit;
    // Recipe lines are normally saved in consumption units. Honour legacy
    // lines explicitly entered in the purchase unit as well.
    const quantity = num(row, 'quantity') * (hasDualUnits && recipeUnit === purchaseUnit ? factor : 1);
    const storedCost = num(row, 'cost_per_unit');
    const latestPurchaseCost = row.latest_purchase_unit_cost == null ? null : Number(row.latest_purchase_unit_cost);
    const hasPurchaseCost = Number.isFinite(latestPurchaseCost) && latestPurchaseCost > 0;
    const purchaseDerivedCost = hasPurchaseCost && hasDualUnits ? latestPurchaseCost / factor : null;
    const directUnitCost = purchaseDerivedCost ?? storedCost;
    const normalizedUnitCost = purchaseDerivedCost ?? (hasDualUnits ? storedCost / factor : storedCost);

    current.direct += quantity * directUnitCost;
    current.normalized += quantity * normalizedUnitCost;
    current.canNormalize = current.canNormalize || (hasDualUnits && purchaseDerivedCost == null);
    current.estimated = current.estimated || directUnitCost <= 0;
    recipeCosts.set(row.menu_item_id, current);
  }
  for (const [menuItemId, recipe] of recipeCosts) {
    const direct = recipe.direct / recipe.yieldQty;
    const normalized = recipe.normalized / recipe.yieldQty;
    const sellingPrice = itemPrice.get(menuItemId) || 0;
    const obviousLegacyScaleError = recipe.canNormalize && sellingPrice > 0
      && direct > sellingPrice * 3
      && normalized < direct
      && normalized <= sellingPrice * 3;
    const cost = obviousLegacyScaleError ? normalized : direct;
    if (cost > 0) map.set(menuItemId, { cost, estimated: recipe.estimated, normalizedLegacyUnits: obviousLegacyScaleError });
  }

  // A combo consumes the component recipes/variant inventory, not an invented
  // percentage of the combo selling price. Keep margin reports aligned with
  // the same component expansion used by stock and KOT.
  const comboRows = await safeAll(db, `
    SELECT c.menu_item_id AS combo_menu_item_id, ci.component_menu_item_id, ci.quantity,
           ci.variant_name, v.stock_quantity, im.cost_per_unit
      FROM menu_combos c
      JOIN menu_combo_items ci ON ci.combo_id = c.id
      LEFT JOIN menu_item_variants v ON v.menu_item_id = ci.component_menu_item_id AND v.variant_name = ci.variant_name
      LEFT JOIN inventory_items im ON im.id = v.inventory_item_id
     ORDER BY c.id, ci.display_order, ci.id
  `);
  const comboCosts = new Map();
  for (const row of comboRows || []) {
    const component = map.get(row.component_menu_item_id);
    const variantCost = row.cost_per_unit != null && row.stock_quantity != null
      ? num(row, 'cost_per_unit') * num(row, 'stock_quantity')
      : null;
    const unitCost = variantCost != null ? variantCost : Number(component?.cost || 0);
    const current = comboCosts.get(row.combo_menu_item_id) || { cost: 0, estimated: false };
    current.cost += unitCost * num(row, 'quantity');
    current.estimated = current.estimated || (variantCost == null && (!component || component.estimated));
    comboCosts.set(row.combo_menu_item_id, current);
  }
  for (const [menuItemId, entry] of comboCosts) map.set(menuItemId, entry);
  return map;
}

/** Per-menu-item sales aggregate for the selected range. */
/** A sold line's share of revenue after the bill-level discount (spread pro rata over its lines). */
export const LINE_REVENUE = `COALESCE(oi.subtotal, oi.quantity * COALESCE(oi.price, 0)) *
             CASE WHEN COALESCE(b.subtotal,0) > 0
               THEN CASE WHEN COALESCE(b.discount_amount,0) >= b.subtotal THEN 0
                         ELSE (b.subtotal-COALESCE(b.discount_amount,0))/b.subtotal END
               ELSE 1 END`;

async function itemSales(db, range, f) {
  const scope = billScope(db, range, f);
  return safeAll(db, 
    `
    SELECT COALESCE(oi.menu_item_id, oi.item_id) AS menu_item_id,
           COALESCE(oi.item_name, mi.name, 'Item') AS name,
           mi.image_url AS image_url,
           mi.base_price AS base_price,
           mc.name AS category_name,
           mc.id AS category_id,
           SUM(oi.quantity) AS quantity,
           SUM(${LINE_REVENUE}) AS revenue
    ${BILL_FROM}
    JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN menu_items mi ON COALESCE(oi.menu_item_id, oi.item_id) = mi.id
    LEFT JOIN menu_categories mc ON mi.category_id = mc.id
    ${scope.sql} AND ${LIVE_ITEM}
    GROUP BY COALESCE(oi.menu_item_id, oi.item_id), COALESCE(oi.item_name, mi.name, 'Item'),
             mi.image_url, mi.base_price, mc.name, mc.id
    ORDER BY revenue DESC
  `,
    scope.params
  );
}

/** Daily revenue/orders/cost series padded across the whole range. */
async function dailySeries(db, range, f, costMap) {
  const scope = billScope(db, range, f);
  const rows = await safeAll(db, 
    `SELECT date(b.created_at, '+5 hours', '+45 minutes') AS d, COUNT(DISTINCT b.id) AS orders,
            COALESCE(SUM(b.grand_total), 0) AS revenue
     ${BILL_FROM}${scope.sql}
     GROUP BY date(b.created_at, '+5 hours', '+45 minutes')`,
    scope.params
  );
  const byDate = new Map((rows || []).map((r) => [dateKey(r.d), r]));

  // Food cost per day, so the profit trend is not a flat multiple of revenue.
  const costRows = await safeAll(db, 
    `SELECT date(b.created_at, '+5 hours', '+45 minutes') AS d, COALESCE(oi.menu_item_id, oi.item_id) AS menu_item_id,
            SUM(oi.quantity) AS quantity,
            SUM(COALESCE(oi.subtotal, oi.quantity * COALESCE(oi.price, 0))) AS revenue
     ${BILL_FROM}
     JOIN order_items oi ON oi.order_id = o.id
     ${scope.sql} AND ${LIVE_ITEM}
     GROUP BY date(b.created_at, '+5 hours', '+45 minutes'), COALESCE(oi.menu_item_id, oi.item_id)`,
    scope.params
  );
  const costByDate = new Map();
  for (const row of costRows || []) {
    const key = dateKey(row.d);
    const entry = costMap?.get(row.menu_item_id);
    const cost = entry ? entry.cost * num(row, 'quantity') : num(row, 'revenue') * COST_RATIO;
    costByDate.set(key, (costByDate.get(key) || 0) + cost);
  }

  if (f?.businessDayId) {
    const revenue = (rows || []).reduce((sum, row) => sum + num(row, 'revenue'), 0);
    const orders = (rows || []).reduce((sum, row) => sum + num(row, 'orders'), 0);
    const cost = Array.from(costByDate.values()).reduce((sum, value) => sum + value, 0);
    return [{ date: range.start, day: 'Business Day', revenue, orders, cost, profit: revenue - cost }];
  }
  return eachDay(range).map(({ date, day }) => {
    const row = byDate.get(date);
    const revenue = num(row, 'revenue');
    const cost = costByDate.get(date) || 0;
    return { date, day, revenue, orders: num(row, 'orders'), cost, profit: revenue - cost };
  });
}

/*
 * Operating expenses are `expenses` rows that did NOT come from a stock
 * purchase. Purchase-sourced rows (source_type = 'purchase') mirror a
 * `purchases` invoice and are stock, not P&L spend — counting them here would
 * double-book them against the food cost the same goods already carry.
 *
 * This scope is shared by the KPI, the daily series and the ledger table so
 * the three can never disagree: before, only the KPI applied the exclusion,
 * so the Expense Ledger listed rows the Expenses headline had never counted
 * and the per-day Profit Summary did not add up to the headline profit.
 */
function operatingExpenseScope(range, f = {}, alias = '') {
  const col = (name) => (alias ? `${alias}.${name}` : name);
  const period = f.businessDayId
    ? { sql: `${col('business_day_id')} = ?`, params: [f.businessDayId] }
    : {
        sql: `COALESCE(${col('purchase_date')}, CAST(${col('expense_date')} AS TEXT)) BETWEEN ? AND ?`,
        params: [range.start, range.end],
      };
  let sql = `${period.sql} AND LOWER(COALESCE(${col('status')},'active'))<>'voided'
      AND (${col('source_type')} IS NULL OR ${col('source_type')} <> 'purchase')`;
  const params = [...period.params];
  const bucket = normalizePaymentFilterBucket(f.paymentMethod);
  if (bucket) {
    sql += ` AND ${paymentColumnMatchesBucketSql(`COALESCE(${col('payment_method')}, 'cash')`, bucket)}`;
  }
  return {
    sql,
    params,
    spentOn: `COALESCE(${col('purchase_date')}, CAST(${col('expense_date')} AS TEXT))`,
  };
}

async function expenseTotals(db, range, f = {}) {
  const where = operatingExpenseScope(range, f);
  const rows = await safeAll(db, 
    `SELECT COALESCE(category, 'other') AS category, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount
     FROM expenses
     WHERE ${where.sql}
     GROUP BY COALESCE(category, 'other')
     ORDER BY amount DESC`,
    where.params
  );
  const total = (rows || []).reduce((s, r) => s + num(r, 'amount'), 0);
  return { rows: rows || [], total };
}

/* ------------------------------------------------------------------ */
/* Tab builders                                                        */
/* ------------------------------------------------------------------ */

// Retained temporarily for compatibility with older report snapshots.
async function legacyOverviewTab(db, range, f) {
  const costMap = await getItemCostMap(db);
  const prev = previousRange(range);
  const scope = billScope(db, range, f);

  const [summary, prevSummary, series, items, expenses] = await Promise.all([
    safeGet(db, 
      `SELECT COALESCE(SUM(b.grand_total), 0) AS revenue, COUNT(DISTINCT b.id) AS orders
       ${BILL_FROM}${scope.sql}`,
      scope.params
    ),
    (async () => {
      const p = billScope(db, prev, { ...f, businessDayId: null });
      return safeGet(db, 
        `SELECT COALESCE(SUM(b.grand_total), 0) AS revenue, COUNT(DISTINCT b.id) AS orders
         ${BILL_FROM}${p.sql}`,
        p.params
      );
    })(),
    dailySeries(db, range, f, costMap),
    itemSales(db, range, f),
    expenseTotals(db, range, f),
  ]);

  const revenue = num(summary, 'revenue');
  const orders = num(summary, 'orders');
  const cost = series.reduce((s, d) => s + d.cost, 0);
  const profit = revenue - cost;
  const prevRevenue = num(prevSummary, 'revenue');

  const alerts = await safeAll(db, 
    `SELECT id, COALESCE(item_name, name) AS item_name, quantity, unit,
            COALESCE(min_stock_level, min_stock, 0) AS min_level
     FROM inventory_items
     WHERE COALESCE(quantity, 0) <= COALESCE(min_stock_level, min_stock, 0)
     ORDER BY quantity ASC
     LIMIT 8`
  );

  const activity = await safeAll(db, 
    `SELECT b.bill_number, b.grand_total, b.created_at, o.order_number, o.table_number,
            u.full_name AS waiter_name
     ${BILL_FROM}
     LEFT JOIN users u ON o.waiter_id = u.id
     ${scope.sql}
     ORDER BY b.created_at DESC
     LIMIT 12`,
    scope.params
  );

  const busiestHour = await topHour(db, range, f);
  const chips = [];
  const revChange = pctChange(revenue, prevRevenue);
  if (revChange != null) {
    chips.push({ icon: revChange >= 0 ? 'up' : 'down', text: `Revenue ${revChange >= 0 ? 'up' : 'down'} ${Math.abs(revChange)}% vs the previous ${prev.spanDays} day(s)` });
  } else if (revenue > 0) {
    chips.push({ icon: 'up', text: `${money(revenue)} earned — nothing was billed in the previous period` });
  }
  if (items?.[0]) {
    chips.push({ icon: 'star', text: `${items[0].name} generated the most revenue (${money(num(items[0], 'revenue'))})` });
  }
  if (busiestHour) {
    chips.push({ icon: 'clock', text: `${busiestHour.label} accounted for ${busiestHour.share}% of sales` });
  }

  const insights = [];
  if (revenue > 0) {
    insights.push({
      title: 'Margin health',
      body: `Estimated gross margin is ${((profit / revenue) * 100).toFixed(1)}% after food cost of ${money(cost)}.`,
      tone: profit / revenue > 0.3 ? 'positive' : 'warning',
    });
  }
  if (expenses.total > 0) {
    insights.push({
      title: 'Operating expenses',
      body: `${money(expenses.total)} of expenses were logged, led by ${expenses.rows[0]?.category?.replace(/_/g, ' ')} (${money(num(expenses.rows[0], 'amount'))}).`,
      tone: 'neutral',
    });
  }
  if (orders > 0) {
    const best = [...series].sort((a, b) => b.revenue - a.revenue)[0];
    if (best && best.revenue > 0) {
      insights.push({ title: 'Strongest day', body: `${best.day} ${best.date} brought in ${money(best.revenue)} across ${best.orders} order(s).`, tone: 'positive' });
    }
  }
  if ((alerts || []).length) {
    insights.push({ title: 'Stock needs attention', body: `${alerts.length} raw material(s) are at or below their reorder level.`, tone: 'warning' });
  }

  return {
    chips,
    kpis: [
      { key: 'revenue', label: 'Billed Revenue (incl. tax)', value: revenue, format: 'currency', change: revChange, highlight: true, hint: 'Sum of bill grand totals for the period, tax included.' },
      { key: 'profit', label: 'Profit after Food Cost (est.)', value: profit, format: 'currency', hint: 'Billed Revenue minus the estimated cost of ingredients. Rent, wages and other running costs are NOT deducted — the Finance tab deducts those instead.' },
      { key: 'orders', label: 'Bills Settled', value: orders, format: 'number', change: pctChange(orders, num(prevSummary, 'orders')), hint: 'Count of paid or partially paid bills in the period.' },
      { key: 'aov', label: 'Average Bill', value: orders ? revenue / orders : 0, format: 'currency', hint: 'Billed Revenue divided by bills settled.' },
    ],
    charts: {
      revenueTrend: series.map((d) => ({ label: d.day, sub: d.date, value: d.revenue })),
      profitTrend: series.map((d) => ({ label: d.day, sub: d.date, value: d.profit })),
      topItems: (items || []).slice(0, 8).map((i) => ({ label: i.name, value: num(i, 'revenue'), meta: `${num(i, 'quantity')} sold` })),
    },
    insights,
    alerts: (alerts || []).map((a) => ({
      name: a.item_name,
      quantity: num(a, 'quantity'),
      unit: a.unit || '',
      status: num(a, 'quantity') <= 0 ? 'out' : 'low',
    })),
    notes: [
      BILL_BASIS_NOTE,
      'Profit after Food Cost deducts ingredients only. For profit after rent, wages and other running costs, see the Finance tab.',
    ],
    tables: [{
      id: 'transactions',
      title: 'Recent Activity',
      columns: [
        { key: 'created_at', label: 'Time', type: 'datetime' },
        { key: 'bill_number', label: 'Bill' },
        { key: 'order_number', label: 'Order' },
        { key: 'table_number', label: 'Table' },
        { key: 'waiter_name', label: 'Waiter' },
        { key: 'grand_total', label: 'Amount', type: 'currency', align: 'right' },
      ],
      rows: (activity || []).map((r) => ({
        created_at: r.created_at,
        bill_number: r.bill_number,
        order_number: r.order_number,
        table_number: r.table_number || '—',
        waiter_name: r.waiter_name || 'Unassigned',
        grand_total: num(r, 'grand_total'),
      })),
      empty: 'No bills were settled in the selected period.',
    }],
  };
}

/** Busiest sales hour in the range, as { label, share } — used for a quick chip. */
async function overviewTab(db, range, f) {
  const costMap = await getItemCostMap(db);
  const scope = billScope(db, range, f);
  const expenseScope = operatingExpenseScope(range, f);
  const purchasePeriod = f.businessDayId
    ? { sql: 'business_day_id = ?', params: [f.businessDayId] }
    : { sql: "COALESCE(purchase_date, CAST(expense_date AS TEXT)) BETWEEN ? AND ?", params: [range.start, range.end] };
  const correctionPeriod = f.businessDayId
    ? { sql: 'business_day_id = ?', params: [f.businessDayId] }
    : { sql: "date(created_at, '+5 hours', '+45 minutes') BETWEEN ? AND ?", params: [range.start, range.end] };

  /* One records-first row per trading date. Payments are allocations on these
   * bills, not another sales total. Stock purchases stay separate from food
   * cost so the overview never silently deducts the same stock twice. */
  const [billDays, series, expenseDays, purchaseDays, refundDays] = await Promise.all([
    safeAll(db,
      `SELECT date(b.created_at, '+5 hours', '+45 minutes') AS d,
              COUNT(DISTINCT b.id) AS orders,
              COALESCE(SUM(b.subtotal), 0) AS item_sales,
              COALESCE(SUM(b.discount_amount), 0) AS discounts,
              COALESCE(SUM(b.service_charge), 0) AS service_charges,
              COALESCE(SUM(CASE WHEN COALESCE(b.vat_amount, 0) <> 0 THEN b.vat_amount ELSE COALESCE(b.tax, 0) END), 0) AS tax,
              COALESCE(SUM(b.grand_total), 0) AS revenue,
              COALESCE(SUM((SELECT SUM(pay.amount) FROM (${paymentsUnionSql()}) pay WHERE pay.bill_id = b.id AND ${paymentBucketSql('pay.method')} = 'cash')), 0) AS cash,
              COALESCE(SUM((SELECT SUM(pay.amount) FROM (${paymentsUnionSql()}) pay WHERE pay.bill_id = b.id AND ${paymentBucketSql('pay.method')} = 'digital')), 0) AS digital,
              COALESCE(SUM((SELECT SUM(pay.amount) FROM (${paymentsUnionSql()}) pay WHERE pay.bill_id = b.id AND ${paymentBucketSql('pay.method')} = 'credit')), 0) AS credit
       ${BILL_FROM}${scope.sql}
       GROUP BY date(b.created_at, '+5 hours', '+45 minutes')
       ORDER BY d DESC`,
      scope.params
    ),
    dailySeries(db, range, f, costMap),
    safeAll(db,
      `SELECT ${expenseScope.spentOn} AS d, COALESCE(SUM(amount), 0) AS amount
       FROM expenses WHERE ${expenseScope.sql}
       GROUP BY ${expenseScope.spentOn}`,
      expenseScope.params
    ),
    safeAll(db,
      `SELECT COALESCE(purchase_date, CAST(expense_date AS TEXT)) AS d,
              COUNT(*) AS records, COALESCE(SUM(amount), 0) AS amount
       FROM expenses
       WHERE ${purchasePeriod.sql} AND source_type = 'purchase'
         AND LOWER(COALESCE(status,'active'))<>'voided'
       GROUP BY COALESCE(purchase_date, CAST(expense_date AS TEXT))`,
      purchasePeriod.params
    ),
    safeAll(db,
      `SELECT date(created_at, '+5 hours', '+45 minutes') AS d,
              COALESCE(SUM(CASE WHEN type='refund' THEN amount WHEN type='refund_reversal' THEN -amount ELSE 0 END), 0) AS amount
       FROM bill_corrections
       WHERE ${correctionPeriod.sql} AND type IN ('refund','refund_reversal')
       GROUP BY date(created_at, '+5 hours', '+45 minutes')`,
      correctionPeriod.params
    ),
  ]);

  const billsByDay = new Map((billDays || []).map((row) => [dateKey(row.d), row]));
  const costByDay = new Map(series.map((row) => [row.date, row.cost]));
  const expensesByDay = new Map((expenseDays || []).map((row) => [dateKey(row.d), num(row, 'amount')]));
  const purchasesByDay = new Map((purchaseDays || []).map((row) => [dateKey(row.d), row]));
  const refundsByDay = new Map((refundDays || []).map((row) => [dateKey(row.d), num(row, 'amount')]));
  const dates = f.businessDayId ? [range.start] : eachDay(range).map((day) => day.date).reverse();
  let rows = dates.map((date) => {
    const bill = billsByDay.get(date) || {};
    const revenue = num(bill, 'revenue');
    const foodCost = costByDay.get(date) || 0;
    const expenses = expensesByDay.get(date) || 0;
    const purchase = purchasesByDay.get(date) || {};
    const refunds = refundsByDay.get(date) || 0;
    const cash = num(bill, 'cash');
    const digital = num(bill, 'digital');
    const credit = num(bill, 'credit');
    return {
      date,
      orders: num(bill, 'orders'),
      item_sales: num(bill, 'item_sales'),
      discounts: num(bill, 'discounts'),
      service_charges: num(bill, 'service_charges'),
      tax: num(bill, 'tax'),
      revenue,
      refunds,
      net_revenue: revenue - refunds,
      cash,
      digital,
      credit,
      settlement_difference: revenue - cash - digital - credit,
      food_cost: foodCost,
      purchase_records: num(purchase, 'records'),
      purchases: num(purchase, 'amount'),
      expenses,
      profit: revenue - refunds - foodCost - expenses,
    };
  });
  rows = rows.filter((row) => dates.length === 1 || Object.entries(row).some(([key, value]) => key !== 'date' && Number(value) !== 0));
  const totals = rows.reduce((sum, row) => ({
    orders: sum.orders + row.orders,
    revenue: sum.revenue + row.revenue,
    foodCost: sum.foodCost + row.food_cost,
    expenses: sum.expenses + row.expenses,
    profit: sum.profit + row.profit,
  }), { orders: 0, revenue: 0, foodCost: 0, expenses: 0, profit: 0 });

  return {
    // Kept in the API contract for existing consumers; the redesigned Reports
    // page intentionally presents the comprehensive table instead of KPI cards.
    kpis: [
      { key: 'orders', label: 'Orders', value: totals.orders, format: 'number' },
      { key: 'revenue', label: 'Billed Revenue', value: totals.revenue, format: 'currency' },
      { key: 'profit', label: 'Profit after Cost & Expenses', value: totals.profit, format: 'currency' },
    ],
    notes: [
      BILL_BASIS_NOTE,
      'Profit after Cost & Expenses deducts estimated food cost and operating expenses. The Finance tab keeps its narrower profit-after-expenses definition for ledger reporting.',
    ],
    tables: [{
      id: 'business-overview',
      title: 'Complete Business Overview',
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'orders', label: 'Orders', type: 'number', align: 'right' },
        { key: 'item_sales', label: 'Item Sales', type: 'currency', align: 'right' },
        { key: 'discounts', label: 'Discounts', type: 'currency', align: 'right' },
        { key: 'service_charges', label: 'Service / Extras', type: 'currency', align: 'right' },
        { key: 'tax', label: 'Tax', type: 'currency', align: 'right' },
        { key: 'revenue', label: 'Billed Revenue', type: 'currency', align: 'right' },
        { key: 'refunds', label: 'Refunds', type: 'currency', align: 'right' },
        { key: 'net_revenue', label: 'Net Revenue', type: 'currency', align: 'right' },
        { key: 'cash', label: 'Cash Allocated', type: 'currency', align: 'right' },
        { key: 'digital', label: 'Online Allocated', type: 'currency', align: 'right' },
        { key: 'credit', label: 'Credit Sale', type: 'currency', align: 'right' },
        { key: 'settlement_difference', label: 'Settlement Difference', type: 'currency', align: 'right' },
        { key: 'food_cost', label: 'Food Cost (est.)', type: 'currency', align: 'right' },
        { key: 'purchase_records', label: 'Purchase Records', type: 'number', align: 'right' },
        { key: 'purchases', label: 'Stock Purchases', type: 'currency', align: 'right' },
        { key: 'expenses', label: 'Operating Expenses', type: 'currency', align: 'right' },
        { key: 'profit', label: 'Profit after Cost & Expenses', type: 'currency', align: 'right' },
      ],
      rows,
      empty: 'No sales, payment, purchase or expense records match this period.',
    }],
  };
}

async function topHour(db, range, f) {
  const scope = billScope(db, range, f);
  const rows = await safeAll(db, 
    `SELECT ${hourOf(db, 'b.created_at')} AS hour, COALESCE(SUM(b.grand_total), 0) AS revenue
     ${BILL_FROM}${scope.sql}
     GROUP BY ${hourOf(db, 'b.created_at')}
     ORDER BY revenue DESC`,
    scope.params
  );
  if (!rows?.length) return null;
  const total = rows.reduce((s, r) => s + num(r, 'revenue'), 0);
  if (!total) return null;
  const top = rows[0];
  const h = num(top, 'hour');
  const fmt = (n) => `${((n + 11) % 12) + 1}${n < 12 ? 'AM' : 'PM'}`;
  return { label: `${fmt(h)}–${fmt((h + 1) % 24)}`, share: Math.round((num(top, 'revenue') / total) * 100) };
}

async function salesTab(db, range, f) {
  const txPaging = readTablePaging(f, 'transactions');
  const costMap = await getItemCostMap(db);
  const scope = billScope(db, range, f);
  const { channelMix } = await import('./channel-mix.js');
  const drawer = f.drawerCards
    ? await (async () => {
      const { closingReconciliation, digitalReceipts, cashFlow, moneyPosition } = await import('./summary-report.js');
      const [cashCount, digital, drawerFlow, position] = await Promise.all([
        closingReconciliation(db, range.start, range.end).catch(() => null),
        digitalReceipts(db, range.start, range.end).catch(() => null),
        cashFlow(db, range.start, range.end).catch(() => null),
        moneyPosition(db, range.start, range.end).catch(() => null),
      ]);
      return { cashReconciliation: cashCount, digitalReceipts: digital, cashFlow: drawerFlow, moneyPosition: position };
    })()
    : null;
  /*
   * The reconciliation block (cash/QR received, credit sold and collected,
   * refunds, cancelled orders) reads tables that are not joined to `bills`, so
   * it cannot reuse `scope`. It used to fall back to the raw calendar range,
   * which meant picking a Business Day left every one of those figures showing
   * the calendar period instead — cash received would not tie to the day being
   * closed. Each now scopes to business_day_id when one is selected.
   */
  const dayScope = (column, businessDayColumn) =>
    f.businessDayId
      ? { sql: `${businessDayColumn} = ?`, params: [f.businessDayId] }
      : { sql: `date(${column}, '+5 hours', '+45 minutes') BETWEEN ? AND ?`, params: [range.start, range.end] };
  const cancelledScope = dayScope('o.created_at', 'o.business_day_id');
  const paymentScope = dayScope('pay.created_at', 'pay.business_day_id');
  const ledgerScope = dayScope('created_at', 'business_day_id');
  const correctionScope = dayScope('created_at', 'business_day_id');

  const [totals, series, byHour, byDow, byCategory, byGroup, byPayment, byWaiter, byType, cancelled] =
    await Promise.all([
      safeGet(db, 
        `SELECT COALESCE(SUM(b.subtotal), 0) AS gross,
                COALESCE(SUM(b.grand_total), 0) AS net,
                COALESCE(SUM(CASE WHEN COALESCE(b.vat_amount, 0) <> 0 THEN b.vat_amount ELSE COALESCE(b.tax, 0) END), 0) AS tax,
                COALESCE(SUM(b.discount_amount), 0) AS discounts,
                COALESCE(SUM(b.service_charge), 0) AS service_charge,
                COUNT(DISTINCT b.id) AS orders
         ${BILL_FROM}${scope.sql}`,
        scope.params
      ),
      dailySeries(db, range, f, costMap),
      safeAll(db, 
        `SELECT ${hourOf(db, 'b.created_at')} AS hour, COALESCE(SUM(b.grand_total), 0) AS revenue, COUNT(DISTINCT b.id) AS orders
         ${BILL_FROM}${scope.sql} GROUP BY ${hourOf(db, 'b.created_at')} ORDER BY hour ASC`,
        scope.params
      ),
      safeAll(db, 
        `SELECT ${dowOf(db, 'b.created_at')} AS dow, COALESCE(SUM(b.grand_total), 0) AS revenue
         ${BILL_FROM}${scope.sql} GROUP BY ${dowOf(db, 'b.created_at')} ORDER BY dow ASC`,
        scope.params
      ),
      safeAll(db, 
        `SELECT COALESCE(mc.name, 'Uncategorised') AS category,
                SUM(COALESCE(oi.subtotal, oi.quantity * COALESCE(oi.price, 0)) *
                  CASE WHEN COALESCE(b.subtotal,0) > 0
                    THEN CASE WHEN COALESCE(b.discount_amount,0) >= b.subtotal THEN 0
                              ELSE (b.subtotal-COALESCE(b.discount_amount,0))/b.subtotal END
                    ELSE 1 END) AS revenue,
                SUM(oi.quantity) AS quantity
         ${BILL_FROM}
         JOIN order_items oi ON oi.order_id = o.id
         LEFT JOIN menu_items mi ON COALESCE(oi.menu_item_id, oi.item_id) = mi.id
         LEFT JOIN menu_categories mc ON mi.category_id = mc.id
         ${scope.sql} AND ${LIVE_ITEM}
         GROUP BY COALESCE(mc.name, 'Uncategorised')
         ORDER BY revenue DESC`,
        scope.params
      ),
      safeAll(db, 
        `SELECT ${FOOD_GROUP_EXPR} AS food_group,
                SUM(COALESCE(oi.subtotal, oi.quantity * COALESCE(oi.price, 0)) *
                  CASE WHEN COALESCE(b.subtotal,0) > 0
                    THEN CASE WHEN COALESCE(b.discount_amount,0) >= b.subtotal THEN 0
                              ELSE (b.subtotal-COALESCE(b.discount_amount,0))/b.subtotal END
                    ELSE 1 END) AS revenue,
                SUM(oi.quantity) AS quantity
         ${BILL_FROM}
         JOIN order_items oi ON oi.order_id = o.id
         LEFT JOIN menu_items mi ON COALESCE(oi.menu_item_id, oi.item_id) = mi.id
         LEFT JOIN menu_categories mc ON mi.category_id = mc.id
         ${scope.sql} AND ${LIVE_ITEM}
         GROUP BY ${FOOD_GROUP_EXPR}
         ORDER BY revenue DESC`,
        scope.params
      ),
      safeAll(db,
        `SELECT pay.method, COUNT(*) AS count, COALESCE(SUM(pay.amount), 0) AS amount
         ${BILL_FROM}
         JOIN (${paymentsUnionSql()}) pay ON pay.bill_id = b.id
         ${scope.sql}
         GROUP BY pay.method
         ORDER BY amount DESC`,
        scope.params
      ),
      safeAll(db, 
        `SELECT COALESCE(u.full_name, 'Unassigned') AS waiter, COALESCE(SUM(b.grand_total), 0) AS revenue, COUNT(DISTINCT b.id) AS orders
         ${BILL_FROM}
         LEFT JOIN users u ON o.waiter_id = u.id
         ${scope.sql}
         GROUP BY COALESCE(u.full_name, 'Unassigned')
         ORDER BY revenue DESC`,
        scope.params
      ),
      safeAll(db, 
        `SELECT ${ORDER_TYPE_EXPR} AS order_type, COALESCE(SUM(b.grand_total), 0) AS revenue, COUNT(DISTINCT b.id) AS orders
         ${BILL_FROM}${scope.sql}
         GROUP BY ${ORDER_TYPE_EXPR}
         ORDER BY revenue DESC`,
        scope.params
      ),
      safeGet(db,
        `SELECT COUNT(DISTINCT o.id) AS orders,
                COALESCE(SUM(COALESCE(oi.subtotal, oi.quantity * COALESCE(oi.price, 0))), 0) AS value
         FROM orders o
         LEFT JOIN order_items oi ON oi.order_id = o.id
         WHERE ${cancelledScope.sql} AND o.status = 'cancelled'`,
        cancelledScope.params
      ),
    ]);

  const invoicesPaged = await queryPaged(db,
    `SELECT b.id AS bill_id, b.bill_number, b.subtotal, b.discount_amount, b.grand_total, b.created_at,
            o.id AS order_id, o.order_number, o.table_number, o.order_type, o.customer_name,
            COALESCE(cu.full_name, '—') AS cashier,
            COALESCE((SELECT GROUP_CONCAT(pay.method, ', ') FROM (${paymentsUnionSql()}) pay WHERE pay.bill_id = b.id), 'Not recorded') AS payment,
            COALESCE((SELECT SUM(pay.amount) FROM (${paymentsUnionSql()}) pay
                      WHERE pay.bill_id = b.id AND ${paymentBucketSql('pay.method')} = 'cash'), 0) AS cash_amount,
            COALESCE((SELECT SUM(pay.amount) FROM (${paymentsUnionSql()}) pay
                      WHERE pay.bill_id = b.id AND ${paymentBucketSql('pay.method')} = 'digital'), 0) AS digital_amount,
            COALESCE((SELECT SUM(pay.amount) FROM (${paymentsUnionSql()}) pay
                      WHERE pay.bill_id = b.id AND ${paymentBucketSql('pay.method')} = 'credit'), 0) AS credit_amount,
            COALESCE((SELECT GROUP_CONCAT(pay.provider, ' / ') FROM (${paymentsUnionSql()}) pay
                      WHERE pay.bill_id = b.id AND ${paymentBucketSql('pay.method')} = 'digital'
                        AND COALESCE(pay.provider, '') <> ''), 'Not recorded') AS digital_provider,
            COALESCE((SELECT SUM(amount) FROM (
              SELECT ${FOOD_GROUP_EXPR} AS food_group, COALESCE(oi.subtotal, oi.quantity * COALESCE(oi.price, 0)) AS amount
              FROM order_items oi
              LEFT JOIN menu_items mi ON COALESCE(oi.menu_item_id, oi.item_id) = mi.id
              LEFT JOIN menu_categories mc ON mi.category_id = mc.id
              WHERE oi.order_id = o.id AND ${LIVE_ITEM}
            ) g WHERE food_group = 'food'), 0) AS food_amount,
            COALESCE((SELECT SUM(amount) FROM (
              SELECT ${FOOD_GROUP_EXPR} AS food_group, COALESCE(oi.subtotal, oi.quantity * COALESCE(oi.price, 0)) AS amount
              FROM order_items oi
              LEFT JOIN menu_items mi ON COALESCE(oi.menu_item_id, oi.item_id) = mi.id
              LEFT JOIN menu_categories mc ON mi.category_id = mc.id
              WHERE oi.order_id = o.id AND ${LIVE_ITEM}
            ) g WHERE food_group = 'beverage'), 0) AS beverage_amount,
            COALESCE((SELECT SUM(amount) FROM (
              SELECT ${FOOD_GROUP_EXPR} AS food_group, COALESCE(oi.subtotal, oi.quantity * COALESCE(oi.price, 0)) AS amount
              FROM order_items oi
              LEFT JOIN menu_items mi ON COALESCE(oi.menu_item_id, oi.item_id) = mi.id
              LEFT JOIN menu_categories mc ON mi.category_id = mc.id
              WHERE oi.order_id = o.id AND ${LIVE_ITEM}
            ) g WHERE food_group = 'tobacco'), 0) AS tobacco_amount,
            COALESCE((SELECT SUM(amount) FROM (
              SELECT ${FOOD_GROUP_EXPR} AS food_group, COALESCE(oi.subtotal, oi.quantity * COALESCE(oi.price, 0)) AS amount
              FROM order_items oi
              LEFT JOIN menu_items mi ON COALESCE(oi.menu_item_id, oi.item_id) = mi.id
              LEFT JOIN menu_categories mc ON mi.category_id = mc.id
              WHERE oi.order_id = o.id AND ${LIVE_ITEM}
            ) g WHERE food_group = 'other'), 0) AS other_amount
     ${BILL_FROM}
     LEFT JOIN users cu ON b.cashier_id = cu.id
     ${scope.sql}
     ORDER BY b.created_at DESC`,
    scope.params,
    txPaging,
    ['subtotal', 'discount_amount', 'cash_amount', 'digital_amount', 'credit_amount', 'food_amount', 'beverage_amount', 'tobacco_amount', 'other_amount', 'grand_total']
  );
  invoicesPaged.paymentTotals = {
    cash: Number(invoicesPaged.columnTotals?.cash_amount) || 0,
    digital: Number(invoicesPaged.columnTotals?.digital_amount) || 0,
    credit: Number(invoicesPaged.columnTotals?.credit_amount) || 0,
  };

  // Channel split (dine-in / takeaway / delivery) with the numbering key. Not
  // narrowed by the tab's dimension filters on purpose: it is the period's mix.
  const channels = await channelMix(db, range, f.businessDayId || null).catch(() => null);
  const [receivedByBucket, creditCollections, outstandingReceivables, refunds] = await Promise.all([
    /*
     * Money received, read across BOTH storage paths and bucketed rather than
     * enumerated.
     *
     * This used to read bill_payment_allocations alone, filtered to
     * `method IN ('cash','qr')`. Two independent failures compounded: an
     * install that predates split settlement writes only to bill_payments, so
     * the figure was zero however much cash came in; and card / eSewa / Khalti
     * matched neither literal, so they were reported nowhere at all. The
     * probe caught it — the payment breakdown on the same screen totalled
     * Rs 4,833.90 while these KPIs summed to Rs 0.00.
     */
    safeAll(db,
      // Joined to bills, not read from the payment tables alone: a payment
      // taken against a bill that was later voided is not money the business
      // kept. The probe caught this as an exact Rs 700 gap between these KPIs
      // and the payment breakdown on the same screen — the voided bill's cash.
      `SELECT ${paymentBucketSql('pay.method')} AS bucket, COALESCE(SUM(pay.amount), 0) AS amount
       FROM (${paymentsUnionSql()}) pay
       JOIN bills b ON b.id = pay.bill_id
       WHERE ${paymentScope.sql} AND ${PAID}
       GROUP BY ${paymentBucketSql('pay.method')}`,
      paymentScope.params
    ),
    safeGet(db, 
      `SELECT COALESCE(SUM(cl.credit), 0) AS amount
       FROM customer_ledger cl
       JOIN bill_payments bp ON bp.id=cl.payment_id
       WHERE ${ledgerScope.sql.replace(/\b(created_at|business_day_id)\b/g, 'cl.$1')}
         AND cl.entry_type = 'credit_payment' AND ${settledPaymentSql('bp')}`,
      ledgerScope.params
    ),
    /*
     * Deliberately a live snapshot, not a period figure: what is owed to the
     * restaurant right now across every open bill, whatever period is selected.
     *
     * Split by whether a customer is attached, because two screens in this app
     * report "outstanding" from different tables and they answer different
     * questions:
     *
     *   bills.outstanding_amount    every unpaid balance, walk-ins included
     *   customers.current_credit    only what named credit customers owe
     *
     * They are not two sources for one number, so they are not reconciled to
     * each other — a walk-in who paid half a bill owes money but has no credit
     * account. Reporting only one of them hid the other half.
     */
    safeGet(db, `SELECT
        COALESCE(SUM(outstanding_amount), 0) AS amount,
        COALESCE(SUM(CASE WHEN customer_id IS NOT NULL THEN outstanding_amount ELSE 0 END), 0) AS customer_amount,
        COALESCE(SUM(CASE WHEN customer_id IS NULL THEN outstanding_amount ELSE 0 END), 0) AS walkin_amount,
        COUNT(*) AS bills
      FROM bills WHERE COALESCE(outstanding_amount, 0) > 0`),
    safeGet(db, 
      `SELECT COALESCE(SUM(CASE WHEN type='refund' THEN amount WHEN type='refund_reversal' THEN -amount ELSE 0 END), 0) AS amount FROM bill_corrections
       WHERE ${correctionScope.sql} AND type IN ('refund','refund_reversal')`,
      correctionScope.params
    ),
  ]);
  const bucketed = Object.fromEntries((receivedByBucket || []).map((row) => [row.bucket ?? row.BUCKET, num(row, 'amount')]));
  const reconciliation = {
    totalSales: num(totals, 'net') - num(totals, 'tax'),
    cashReceived: bucketed.cash || 0,
    // "Digital" not "QR": card, eSewa, Khalti, Fonepay and bank transfer all
    // land here. Naming the KPI after one provider hid the others.
    digitalReceived: bucketed.digital || 0,
    creditSales: bucketed.credit || 0,
    creditCollections: num(creditCollections, 'amount'),
    outstandingReceivables: num(outstandingReceivables, 'amount'),
    outstandingFromCustomers: num(outstandingReceivables, 'customer_amount'),
    outstandingFromWalkIns: num(outstandingReceivables, 'walkin_amount'),
    outstandingBills: num(outstandingReceivables, 'bills'),
    refunds: num(refunds, 'amount'),
    netSales: num(totals, 'net') - num(totals, 'tax') - num(refunds, 'amount'),
  };

  const gross = num(totals, 'gross');
  const net = num(totals, 'net');
  const tax = num(totals, 'tax');
  const discounts = num(totals, 'discounts');
  const netItemSales = gross - discounts;
  const orders = num(totals, 'orders');
  const paymentTotal = (byPayment || []).reduce((s, r) => s + num(r, 'amount'), 0) || 1;
  const busiestHour = await topHour(db, range, f);

  const groupRows = (() => {
    const merged = new Map();
    for (const r of byGroup || []) {
      const id = r.food_group === 'uncategorised' ? 'uncategorised' : normalizeFoodGroup(r.food_group);
      const prev = merged.get(id) || { revenue: 0, quantity: 0 };
      prev.revenue += num(r, 'revenue');
      prev.quantity += num(r, 'quantity');
      merged.set(id, prev);
    }
    return Array.from(merged.entries())
      .map(([id, v]) => ({
        label: foodGroupLabel(id),
        value: v.revenue,
        meta: `${v.quantity} sold`,
      }))
      .sort((a, b) => b.value - a.value);
  })();
  const groupTotal = groupRows.reduce((s, r) => s + r.value, 0) || 1;

  const chips = [];
  if (busiestHour) chips.push({ icon: 'clock', text: `${busiestHour.label} accounted for ${busiestHour.share}% of sales` });
  if (groupRows[0]) chips.push({ icon: 'star', text: `${groupRows[0].label} makes up ${Math.round((groupRows[0].value / groupTotal) * 100)}% of sales` });
  if (byCategory?.[0]) chips.push({ icon: 'star', text: `${byCategory[0].category} is the strongest category at ${money(num(byCategory[0], 'revenue'))}` });
  if (byPayment?.[0]) chips.push({ icon: 'card', text: `${byPayment[0].method} covers ${Math.round((num(byPayment[0], 'amount') / paymentTotal) * 100)}% of payment value` });

  const insights = [];
  if (byWaiter?.[0] && byWaiter[0].waiter !== 'Unassigned') {
    insights.push({ title: 'Top server', body: `${byWaiter[0].waiter} closed ${num(byWaiter[0], 'orders')} order(s) worth ${money(num(byWaiter[0], 'revenue'))}.`, tone: 'positive' });
  }
  if (tax > 0) {
    insights.push({ title: 'Tax collected', body: `${money(tax)} of tax sits inside ${money(net)} of billed value — ${((tax / net) * 100).toFixed(1)}% of the total.`, tone: 'neutral' });
  }
  if (num(totals, 'discounts') === 0 && orders > 0) {
    insights.push({ title: 'No discounting', body: 'Not a single bill in this period carried a discount, so headline sales equal realised sales.', tone: 'neutral' });
  }
  if (num(cancelled, 'orders') > 0) {
    insights.push({ title: 'Cancelled orders', body: `${num(cancelled, 'orders')} order(s) worth about ${money(num(cancelled, 'value'))} were cancelled before billing.`, tone: 'warning' });
  }
  const quietest = (byHour || []).slice().sort((a, b) => num(a, 'revenue') - num(b, 'revenue'))[0];
  if (quietest && (byHour || []).length > 2) {
    const h = num(quietest, 'hour');
    insights.push({ title: 'Quietest trading hour', body: `${((h + 11) % 12) + 1}${h < 12 ? 'AM' : 'PM'} is the slowest hour, taking just ${money(num(quietest, 'revenue'))}.`, tone: 'neutral' });
  }

  return {
    ...(drawer || {}),
    channelMix: channels,
    chips,
    /*
     * Fourteen money figures in one flat grid invited comparisons that make no
     * sense — an owner would read "Cash Received" next to "Item Sales" as if
     * they belonged in the same subtraction. Banded under the question each
     * group answers instead. `kpiGroups` is what the UI renders; `kpis` is kept
     * flat as well so exports and any other consumer are unchanged.
     */
    kpiGroups: [
      { id: 'sold', title: 'What we sold', caption: 'Menu value of everything billed, before and after discount.', keys: ['gross', 'discounts', 'net_item_sales'] },
      { id: 'billed', title: 'What we billed', caption: 'The face value of the invoices, and what is left once tax and refunds come out.', keys: ['net', 'billed_total', 'tax', 'service_charge', 'aov'] },
      { id: 'collected', title: 'What we collected', caption: 'How the money actually arrived. These are payments, not sales — a bill can be sold in one period and paid in another.', keys: ['cash_received', 'digital_received', 'credit_sales', 'credit_collections'] },
      { id: 'owed', title: 'What is still owed or reversed', caption: 'Money out and money not yet in.', keys: ['receivables', 'refunds', 'cancelled'] },
    ],
    kpis: [
      { key: 'gross', label: 'Item Sales (gross)', value: gross, format: 'currency', hint: 'Menu value of everything billed, before discount and before tax or service charge. Bill subtotals added up.' },
      { key: 'discounts', label: 'Less: Discounts', value: discounts, format: 'currency', hint: 'Total discount given away on those bills.' },
      { key: 'net_item_sales', label: 'Net Item Sales', value: netItemSales, format: 'currency', hint: 'Item Sales minus discounts. Still before tax, service charge and delivery.' },
      { key: 'net', label: 'Net Sales (excl. tax)', value: reconciliation.netSales, format: 'currency', highlight: true, hint: 'Billed value minus tax minus refunds. Includes service charge and delivery fee; excludes VAT/tax, which is collected on the government’s behalf.' },
      { key: 'billed_total', label: 'Billed Total (incl. tax)', value: net, format: 'currency', hint: 'Sum of bill grand totals — the face value of every invoice raised, tax included.' },
      { key: 'tax', label: 'Tax Collected', value: tax, format: 'currency', hint: 'VAT / tax charged on these bills. Not income — it is payable onward.' },
      { key: 'service_charge', label: 'Service & Extra Charges', value: num(totals, 'service_charge'), format: 'currency', hint: 'Service charge and any per-bill extra/custom charge added at checkout. Included in Billed Total, excluded from Item Sales.' },
      { key: 'cancelled', label: 'Cancelled Order Value', value: num(cancelled, 'value'), format: 'currency', hint: 'Menu value of orders cancelled before they were ever billed. Not included in any sales figure above.' },
      { key: 'aov', label: 'Average Bill (incl. tax)', value: orders ? net / orders : 0, format: 'currency', hint: 'Billed Total divided by the number of bills.' },
      { key: 'cash_received', label: 'Cash Received', value: reconciliation.cashReceived, format: 'currency', hint: 'Cash taken in this period. Money in the drawer, not sales.' },
      { key: 'digital_received', label: 'Online Received', value: reconciliation.digitalReceived, format: 'currency', hint: 'All non-cash payments received into the single Online balance.' },
      { key: 'credit_sales', label: 'Credit Sales', value: reconciliation.creditSales, format: 'currency', hint: 'Value billed to customer credit in this period — sold, not yet collected.' },
      { key: 'credit_collections', label: 'Credit Collections', value: reconciliation.creditCollections, format: 'currency', hint: 'Old credit paid off in this period. Reduces receivables; it is not new sales.' },
      {
        key: 'receivables',
        label: 'Still Owed to You (now)',
        value: reconciliation.outstandingReceivables,
        format: 'currency',
        sub: `${reconciliation.outstandingBills} bill(s) · Rs ${Math.round(reconciliation.outstandingFromCustomers).toLocaleString('en-IN')} on credit accounts`,
        hint: 'Live snapshot of every unpaid balance across all open bills, whatever period is selected. Includes walk-in bills that were only part-paid, which is why it can exceed what the Customer Ledger shows — that page tracks named credit accounts only.',
      },
      { key: 'refunds', label: 'Refunds', value: reconciliation.refunds, format: 'currency', hint: 'Refunds issued in this period, already deducted from Net Sales.' },
    ],
    charts: {
      revenueTrend: series.map((d) => ({ label: d.day, sub: d.date, value: d.revenue })),
      byHour: (byHour || []).map((r) => {
        const h = num(r, 'hour');
        return { label: `${String(h).padStart(2, '0')}:00`, value: num(r, 'revenue'), meta: `${num(r, 'orders')} orders` };
      }),
      byDay: (byDow || []).map((r) => ({ label: DAY_NAMES[num(r, 'dow')] || '—', value: num(r, 'revenue') })),
      byGroup: groupRows,
      byCategory: (byCategory || []).map((r) => ({ label: r.category, value: num(r, 'revenue'), meta: `${num(r, 'quantity')} sold` })),
      byPayment: (byPayment || []).map((r) => ({ label: r.method, value: num(r, 'amount'), meta: `${num(r, 'count')} txns` })),
      byWaiter: (byWaiter || []).map((r) => ({ label: r.waiter, value: num(r, 'revenue'), meta: `${num(r, 'orders')} orders` })),
      byOrderType: (byType || []).map((r) => ({ label: orderTypeLabel(r.order_type), value: num(r, 'revenue'), meta: `${num(r, 'orders')} orders` })),
    },
    insights,
    reconciliation,
    tables: [withPagination({
      id: 'transactions',
      title: 'Invoices',
      columns: [
        { key: 'created_at', label: 'Date', type: 'datetime' },
        { key: 'bill_number', label: 'Invoice' },
        { key: 'order_number', label: 'Order' },
        { key: 'table_number', label: 'Table' },
        { key: 'cashier', label: 'Cashier' },
        { key: 'customer_name', label: 'Customer' },
        { key: 'payment', label: 'Payment', type: 'badge' },
        { key: 'subtotal', label: 'Subtotal', type: 'currency', align: 'right' },
        { key: 'discount_amount', label: 'Discount', type: 'currency', align: 'right' },
        { key: 'cash_amount', label: 'Cash', type: 'currency', align: 'right' },
        { key: 'digital_amount', label: 'Digital', type: 'currency', align: 'right' },
        { key: 'credit_amount', label: 'Credit', type: 'currency', align: 'right' },
        { key: 'digital_provider', label: 'Digital Via' },
        { key: 'food_amount', label: 'Food', type: 'currency', align: 'right' },
        { key: 'beverage_amount', label: 'Beverage', type: 'currency', align: 'right' },
        { key: 'tobacco_amount', label: 'Tobacco', type: 'currency', align: 'right' },
        { key: 'other_amount', label: 'Other', type: 'currency', align: 'right' },
        { key: 'grand_total', label: 'Final Total', type: 'currency', align: 'right' },
      ],
      rows: invoicesPaged.rows.map((r) => ({
        _record_id: r.bill_id,
        _bill_id: r.bill_id,
        _links: { bill_number: { type: 'bill', id: r.bill_id }, order_number: { type: 'order', id: r.order_id } },
        created_at: r.created_at,
        bill_number: r.bill_number,
        order_number: r.order_number || '—',
        table_number: r.table_number || '—',
        cashier: r.cashier || '—',
        customer_name: r.customer_name || 'Walk-in',
        payment: r.payment || '—',
        subtotal: num(r, 'subtotal'),
        discount_amount: num(r, 'discount_amount'),
        cash_amount: num(r, 'cash_amount'),
        digital_amount: num(r, 'digital_amount'),
        credit_amount: num(r, 'credit_amount'),
        digital_provider: r.digital_provider || r.DIGITAL_PROVIDER || 'Not recorded',
        food_amount: num(r, 'food_amount'),
        beverage_amount: num(r, 'beverage_amount'),
        tobacco_amount: num(r, 'tobacco_amount'),
        other_amount: num(r, 'other_amount'),
        grand_total: num(r, 'grand_total'),
      })),
      empty: 'No invoices were raised in the selected period.',
    }, invoicesPaged),
      {
        id: 'payment-summary',
        title: 'Payment Method Summary',
        columns: [
          { key: 'method', label: 'Payment Method' },
          { key: 'transactions', label: 'Transactions', type: 'number', align: 'right' },
          { key: 'amount', label: 'Amount', type: 'currency', align: 'right' },
          { key: 'share', label: 'Share', type: 'percent', align: 'right' },
        ],
        rows: (byPayment || []).map((r) => ({
          method: String(r.method || 'other').replace(/_/g, ' '),
          transactions: num(r, 'count'),
          amount: num(r, 'amount'),
          share: paymentTotal ? (num(r, 'amount') / paymentTotal) * 100 : 0,
        })),
        empty: 'No payment rows were recorded in the selected period.',
      },
      {
        id: 'master-category-summary',
        title: 'Master Category Summary',
        columns: [
          { key: 'category', label: 'Master Category' },
          { key: 'quantity', label: 'Quantity', type: 'number', align: 'right' },
          { key: 'amount', label: 'Amount', type: 'currency', align: 'right' },
          { key: 'share', label: 'Share', type: 'percent', align: 'right' },
        ],
        rows: groupRows.map((r) => ({
          category: r.label,
          quantity: Number(String(r.meta || '').split(' ')[0]) || 0,
          amount: r.value,
          share: groupTotal ? (r.value / groupTotal) * 100 : 0,
        })),
        empty: 'No menu items were sold in the selected period.',
      },
      {
        id: 'daily-sales-summary',
        title: 'Daily Sales Summary',
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'orders', label: 'Orders', type: 'number', align: 'right' },
          { key: 'revenue', label: 'Revenue', type: 'currency', align: 'right' },
          { key: 'cost', label: 'Food Cost (est.)', type: 'currency', align: 'right' },
          { key: 'profit', label: 'Profit after Food Cost', type: 'currency', align: 'right' },
        ],
        rows: series.map((d) => ({
          date: d.date,
          orders: d.orders,
          revenue: d.revenue,
          cost: d.cost,
          profit: d.profit,
        })),
        empty: 'No daily sales activity exists for this period.',
      },
    ],
    notes: [
      BILL_BASIS_NOTE,
      'Credit collections reduce Accounts Receivable and are not counted as new sales revenue.',
      '"Profit" is not shown here. The Overview tab reports profit after food cost; the Finance tab reports profit after operating expenses. They deduct different things and will not match.',
    ],
  };
}

async function financeTab(db, range, f) {
  const ledgerPaging = readTablePaging(f, 'ledger');
  const vatPaging = readTablePaging(f, 'vat');
  const costMap = await getItemCostMap(db);
  const scope = billScope(db, range, f);
  // Same scope the Expenses KPI uses — aliased for the ledger's join, bare for
  // the daily rollup — so headline, trend and table are one number three ways.
  const ledgerScope = operatingExpenseScope(range, f, 'e');
  const expenseScope = operatingExpenseScope(range, f);

  // Imported lazily to keep reports.js <-> summary-report.js free of a cycle.
  const { closingReconciliation, digitalReceipts, cashFlow, moneyPosition } = await import('./summary-report.js');
  const [revenueRow, series, expenses, monthly, expenseDaily, taxDaily, cashCount, digital, drawerFlow, position] = await Promise.all([
    safeGet(db, `SELECT COALESCE(SUM(b.grand_total), 0) AS revenue ${BILL_FROM}${scope.sql}`, scope.params),
    dailySeries(db, range, f, costMap),
    expenseTotals(db, range, f),
    // Read daily buckets, then group them in the selected calendar below. SQL
    // cannot natively calculate Bikram Sambat month boundaries.
    safeAll(db, 
      `SELECT day, revenue, orders FROM (
         SELECT date(${nepalLocal(db, 'b.created_at')}) AS day, COALESCE(SUM(b.grand_total), 0) AS revenue, COUNT(DISTINCT b.id) AS orders
         FROM bills b JOIN orders o ON b.order_id = o.id
         WHERE ${PAID}
         GROUP BY date(${nepalLocal(db, 'b.created_at')})
         ORDER BY day DESC
         LIMIT 800
       ) recent
       ORDER BY day ASC`
    ),
    safeAll(db, 
      `SELECT ${expenseScope.spentOn} AS d, COALESCE(SUM(amount), 0) AS amount
       FROM expenses
       WHERE ${expenseScope.sql}
       GROUP BY ${expenseScope.spentOn}`,
      expenseScope.params
    ),
    safeAll(db, 
      `SELECT date(b.created_at, '+5 hours', '+45 minutes') AS d,
              COALESCE(SUM(b.subtotal), 0) AS subtotal,
              COALESCE(SUM(CASE WHEN COALESCE(b.vat_amount, 0) <> 0 THEN b.vat_amount ELSE COALESCE(b.tax, 0) END), 0) AS tax,
              COALESCE(SUM(b.service_charge), 0) AS service_charge,
              COALESCE(SUM(b.discount_amount), 0) AS discount
       ${BILL_FROM}${scope.sql}
       GROUP BY date(b.created_at, '+5 hours', '+45 minutes')
       ORDER BY d DESC`,
      scope.params
    ),
    closingReconciliation(db, range.start, range.end).catch(() => null),
    digitalReceipts(db, range.start, range.end).catch(() => null),
    cashFlow(db, range.start, range.end).catch(() => null),
    moneyPosition(db, range.start, range.end).catch(() => null),
  ]);

  const [ledgerPaged, vatPaged] = await Promise.all([
    queryPaged(db,
      `SELECT e.id, e.description, e.category, e.amount, e.supplier, e.payment_method,
              ${ledgerScope.spentOn} AS spent_on,
              u.full_name AS logged_by_name
       FROM expenses e
       LEFT JOIN users u ON e.logged_by = u.id
       WHERE ${ledgerScope.sql}
       ORDER BY ${ledgerScope.spentOn} DESC`,
      ledgerScope.params,
      ledgerPaging,
      ['amount']
    ),
    queryPaged(db,
      `SELECT b.id AS bill_id,b.bill_number, b.created_at, b.subtotal, b.vat_amount, b.tax_percent, b.grand_total
       ${BILL_FROM}${scope.sql} AND COALESCE(b.vat_amount, 0) > 0
       ORDER BY b.created_at DESC`,
      scope.params,
      vatPaging,
      ['subtotal', 'vat_amount', 'grand_total']
    ),
  ]);

  const ledgerPaySplit = await safeAll(db,
    `SELECT ${paymentBucketSql("COALESCE(e.payment_method,'cash')")} AS bucket,
            COALESCE(SUM(e.amount), 0) AS amount
       FROM expenses e
      WHERE ${ledgerScope.sql}
      GROUP BY ${paymentBucketSql("COALESCE(e.payment_method,'cash')")}`,
    ledgerScope.params
  );
  ledgerPaged.paymentTotals = { cash: 0, digital: 0, credit: 0, funding: 0 };
  for (const row of ledgerPaySplit || []) {
    const bucket = String(row.bucket || '');
    if (bucket in ledgerPaged.paymentTotals) ledgerPaged.paymentTotals[bucket] = num(row, 'amount');
  }

  const revenue = num(revenueRow, 'revenue');
  const monthlyMap = new Map();
  for (const row of monthly || []) {
    const day = dateKey(row.day);
    let key = day.slice(0, 7);
    if (f.calendarSystem === 'BS') {
      try {
        const bs = adToBsParts(day);
        key = `${bs.year}-${String(bs.month).padStart(2, '0')} BS`;
      } catch { /* unsupported conversion range: retain the AD bucket */ }
    }
    const bucket = monthlyMap.get(key) || { month: key, revenue: 0, orders: 0 };
    bucket.revenue += num(row, 'revenue');
    bucket.orders += num(row, 'orders');
    monthlyMap.set(key, bucket);
  }
  const calendarMonthly = [...monthlyMap.values()].slice(-24);
  const profit = revenue - expenses.total;
  const margin = revenue ? (profit / revenue) * 100 : 0;
  const expenseByDate = new Map((expenseDaily || []).map((r) => [dateKey(r.d), num(r, 'amount')]));
  const profitSeries = series.map((d) => ({
    ...d,
    expenses: expenseByDate.get(d.date) || 0,
    netProfit: d.revenue - (expenseByDate.get(d.date) || 0),
  }));

  const chips = [];
  chips.push({ icon: margin >= 0 ? 'up' : 'down', text: `Net margin is ${margin.toFixed(1)}% after ${money(expenses.total)} of expenses` });
  if (expenses.rows[0]) {
    chips.push({ icon: 'wallet', text: `${String(expenses.rows[0].category).replace(/_/g, ' ')} is the largest expense line (${money(num(expenses.rows[0], 'amount'))})` });
  }
  const bestProfitDay = [...profitSeries].sort((a, b) => b.netProfit - a.netProfit)[0];
  if (bestProfitDay) chips.push({ icon: 'star', text: `${bestProfitDay.day} ${bestProfitDay.date} was the most profitable day (${money(bestProfitDay.netProfit)})` });

  const insights = [];
  const foodCost = series.reduce((s, d) => s + d.cost, 0);
  if (revenue > 0) {
    insights.push({ title: 'Food cost share', body: `Estimated food cost is ${money(foodCost)}, or ${((foodCost / revenue) * 100).toFixed(1)}% of revenue.`, tone: foodCost / revenue > 0.4 ? 'warning' : 'positive' });
  }
  if (expenses.total > 0) {
    insights.push({ title: 'Expense concentration', body: `The top expense category makes up ${Math.round((num(expenses.rows[0], 'amount') / expenses.total) * 100)}% of everything spent this period.`, tone: 'neutral' });
  }
  const lossDays = profitSeries.filter((d) => d.netProfit < 0).length;
  if (lossDays > 0) insights.push({ title: 'Days in the red', body: `${lossDays} day(s) in this range spent more than they earned.`, tone: 'warning' });
  if (!vatPaged.pagination?.total) insights.push({ title: 'VAT not in use', body: 'No bill in this period carried a separate VAT amount — tax is booked through the single tax field.', tone: 'neutral' });

  return {
    // Physical drawer count for the period. Sourced from the latest CLOSED
    // STORE SESSION of each day, not from business_days.status — a day stays
    // 'open' until the next one is opened, so a status filter finds nothing
    // for today. See closingReconciliation() in lib/summary-report.js.
    cashReconciliation: cashCount || null,
    // Restaurant QR/card takings vs money-exchange traffic, and the drawer's
    // cash in/out by source. Same builders the Summary Report prints.
    digitalReceipts: digital || null,
    cashFlow: drawerFlow || null,
    moneyPosition: position || null,
    chips,
    kpis: [
      { key: 'revenue', label: 'Billed Revenue (incl. tax)', value: revenue, format: 'currency', hint: 'Sum of bill grand totals for the period. Tax is included here — see the Sales tab for the tax-excluded Net Sales figure.' },
      { key: 'expenses', label: 'Operating Expenses', value: expenses.total, format: 'currency', hint: 'Logged expenses excluding stock purchases, which are already carried as food cost.' },
      { key: 'profit', label: 'Profit after Expenses', value: profit, format: 'currency', highlight: true, hint: 'Billed Revenue minus operating expenses (rent, wages, utilities…). The cost of ingredients is NOT deducted here — the Overview tab deducts that instead.' },
      { key: 'margin', label: 'Margin after Expenses', value: margin, format: 'percent', hint: 'Profit after Expenses as a percentage of Billed Revenue.' },
    ],
    charts: {
      expenseBreakdown: expenses.rows.map((r) => ({ label: String(r.category).replace(/_/g, ' '), value: num(r, 'amount'), meta: `${num(r, 'count')} entries` })),
      profitTrend: profitSeries.map((d) => ({ label: d.day, sub: d.date, value: d.netProfit })),
      monthlyRevenue: calendarMonthly.map((r) => ({ label: r.month, value: r.revenue, meta: `${r.orders} orders` })),
      expenseTrend: profitSeries.map((d) => ({ label: d.day, sub: d.date, value: d.expenses })),
    },
    insights,
    tables: [
      withPagination({
        id: 'ledger',
        title: 'Expense Ledger',
        columns: [
          { key: 'spent_on', label: 'Date' },
          { key: 'description', label: 'Description' },
          { key: 'category', label: 'Category', type: 'badge' },
          { key: 'supplier', label: 'Supplier' },
          { key: 'payment_method', label: 'Paid by' },
          { key: 'logged_by_name', label: 'Logged by' },
          { key: 'amount', label: 'Amount', type: 'currency', align: 'right' },
        ],
        rows: ledgerPaged.rows.map((r) => ({
          _record_id: r.id,
          spent_on: r.spent_on,
          description: r.description || '—',
          category: String(r.category || 'other').replace(/_/g, ' '),
          supplier: r.supplier || '—',
          payment_method: paymentMethodLabel(r.payment_method),
          logged_by_name: r.logged_by_name || '—',
          amount: num(r, 'amount'),
        })),
        empty: 'No expenses were recorded in the selected period.',
      }, ledgerPaged),
      {
        id: 'profit-summary',
        title: 'Profit Summary',
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'revenue', label: 'Revenue', type: 'currency', align: 'right' },
          { key: 'expenses', label: 'Expenses', type: 'currency', align: 'right' },
          { key: 'netProfit', label: 'Profit after Expenses', type: 'currency', align: 'right' },
          { key: 'marginPct', label: 'Margin', type: 'percent', align: 'right' },
        ],
        rows: profitSeries.map((d) => ({
          date: d.date,
          revenue: d.revenue,
          expenses: d.expenses,
          netProfit: d.netProfit,
          marginPct: d.revenue ? (d.netProfit / d.revenue) * 100 : 0,
        })),
        empty: 'There is no trading history to summarise for this period.',
      },
      {
        id: 'tax-summary',
        title: 'Tax Summary',
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'subtotal', label: 'Taxable Base', type: 'currency', align: 'right' },
          { key: 'tax', label: 'Tax', type: 'currency', align: 'right' },
          { key: 'service_charge', label: 'Service Charge', type: 'currency', align: 'right' },
          { key: 'discount', label: 'Discounts', type: 'currency', align: 'right' },
        ],
        rows: (taxDaily || []).map((r) => ({
          date: dateKey(r.d),
          subtotal: num(r, 'subtotal'),
          tax: num(r, 'tax'),
          service_charge: num(r, 'service_charge'),
          discount: num(r, 'discount'),
        })),
        empty: 'No tax has been charged in the selected period.',
      },
      withPagination({
        id: 'vat',
        title: 'VAT Report',
        columns: [
          { key: 'created_at', label: 'Date', type: 'datetime' },
          { key: 'bill_number', label: 'Bill' },
          { key: 'subtotal', label: 'Net', type: 'currency', align: 'right' },
          { key: 'vat_amount', label: 'VAT', type: 'currency', align: 'right' },
          { key: 'grand_total', label: 'Gross', type: 'currency', align: 'right' },
        ],
        rows: vatPaged.rows.map((r) => ({
          _record_id: r.bill_id,
          _bill_id: r.bill_id,
          _links: { bill_number: { type: 'bill', id: r.bill_id } },
          created_at: r.created_at,
          bill_number: r.bill_number,
          subtotal: num(r, 'subtotal'),
          vat_amount: num(r, 'vat_amount'),
          grand_total: num(r, 'grand_total'),
        })),
        empty: 'No bill in this period carried a separate VAT amount.',
      }, vatPaged),
    ],
    notes: [
      BILL_BASIS_NOTE,
      'Profit after Expenses = Billed Revenue minus recorded operating expenses. Ingredients are NOT deducted here — the Overview tab shows Profit after Food Cost, which deducts ingredients but not expenses. Neither figure is "the" profit on its own.',
      'Stock purchases are excluded from operating expenses because those goods are already carried as food cost.',
      'The food-cost figure quoted in the insights is estimated from recipes where they exist and a 60% cost ratio elsewhere.',
    ],
  };
}

async function ordersTab(db, range, f) {
  const ordersPaging = readTablePaging(f, 'orders');
  const cancelledKotsPaging = readTablePaging(f, 'cancelled-kots');
  const voidedBillsPaging = readTablePaging(f, 'voided-bills');
  const orderScope = f.businessDayId
    ? ` WHERE o.business_day_id = ?`
    : ` WHERE date(o.created_at, '+5 hours', '+45 minutes') BETWEEN ? AND ?`;
  const orderParams = f.businessDayId ? [f.businessDayId] : [range.start, range.end];
  const extra = [];
  if (f.employeeId) { extra.push(` AND o.waiter_id = ?`); orderParams.push(f.employeeId); }
  if (f.orderType) { extra.push(` AND ${ORDER_TYPE_EXPR} = ?`); orderParams.push(f.orderType); }
  if (f.search) {
    extra.push(` AND (LOWER(COALESCE(o.order_number, '')) LIKE ? OR LOWER(COALESCE(o.table_number, '')) LIKE ?)`);
    const like = `%${String(f.search).toLowerCase()}%`;
    orderParams.push(like, like);
  }
  if (f.paymentMethod) {
    // An order matches if any bill raised against it was settled in this bucket
    // (cash / online-bank-qr / credit) — not a single literal method string.
    const bucket = normalizePaymentFilterBucket(f.paymentMethod);
    if (bucket) {
      extra.push(` AND EXISTS (
      SELECT 1 FROM bills bpf
      JOIN (${paymentsUnionSql()}) payf ON payf.bill_id = bpf.id
      WHERE bpf.order_id = o.id AND ${paymentColumnMatchesBucketSql('payf.method', bucket)}
    )`);
    }
  }
  const where = orderScope + extra.join('');

  const cancelSearch = searchClauseForOrderAlias(f, 'o');
  const [statusRows, byHour, prep, serve, byType] = await Promise.all([
    safeAll(db, `SELECT COALESCE(o.status, 'pending') AS status, COUNT(*) AS count FROM orders o${where} GROUP BY COALESCE(o.status, 'pending')`, orderParams),
    safeAll(db, 
      `SELECT ${hourOf(db, 'o.created_at')} AS hour, COUNT(*) AS count FROM orders o${where}
       GROUP BY ${hourOf(db, 'o.created_at')} ORDER BY hour ASC`,
      orderParams
    ),
    safeAll(db, 
      `SELECT o.id AS order_id, ${minutesBetween('k.started_at', 'k.completed_at')} AS minutes
       FROM orders o JOIN kots k ON k.order_id = o.id
       ${where} AND k.started_at IS NOT NULL AND k.completed_at IS NOT NULL`,
      orderParams
    ),
    safeAll(db, 
      `SELECT o.id AS order_id, ${minutesBetween('o.created_at', 'b.paid_at')} AS minutes
       FROM orders o JOIN bills b ON b.order_id = o.id
       ${where} AND ${PAID} AND b.paid_at IS NOT NULL`,
      orderParams
    ),
    safeAll(db, `SELECT ${ORDER_TYPE_EXPR} AS order_type, COUNT(*) AS count FROM orders o${where} GROUP BY ${ORDER_TYPE_EXPR}`, orderParams),
  ]);

  const kotParams = [
    ...(f.businessDayId ? [f.businessDayId] : [range.start, range.end]),
    ...(f.employeeId ? [f.employeeId] : []),
    ...(f.orderType ? [f.orderType] : []),
    ...cancelSearch.params,
  ];
  const voidParams = [
    ...(f.businessDayId ? [f.businessDayId] : [range.start, range.end]),
    ...(f.employeeId ? [f.employeeId, f.employeeId] : []),
    ...(f.orderType ? [f.orderType] : []),
    ...cancelSearch.params,
  ];

  const [ordersPaged, cancelledKotsPaged, voidedBillsPaged] = await Promise.all([
    queryPaged(db,
      `SELECT o.id, o.order_number, o.status, ${ORDER_TYPE_EXPR} AS order_type, o.table_number, o.created_at,
              u.full_name AS waiter_name,
              (SELECT MIN(${minutesBetween('k2.started_at', 'k2.completed_at')}) FROM kots k2 WHERE k2.order_id = o.id AND k2.started_at IS NOT NULL AND k2.completed_at IS NOT NULL) AS kitchen_minutes,
              (SELECT MAX(k3.completed_at) FROM kots k3 WHERE k3.order_id = o.id) AS kitchen_done_at,
              (SELECT MAX(b2.id) FROM bills b2 WHERE b2.order_id = o.id) AS bill_id,
              (SELECT MAX(b2.created_at) FROM bills b2 WHERE b2.order_id = o.id) AS completed_at,
              (SELECT MAX(b2.paid_at) FROM bills b2 WHERE b2.order_id = o.id) AS paid_at,
              (SELECT ${minutesBetween('o.created_at', 'COALESCE(b2.paid_at, b2.created_at)')} FROM bills b2 WHERE b2.id = (SELECT MAX(b3.id) FROM bills b3 WHERE b3.order_id = o.id)) AS sitting_minutes,
              (SELECT COALESCE(SUM(COALESCE(oi.subtotal, oi.quantity * COALESCE(oi.price, 0))), 0)
                 FROM order_items oi WHERE oi.order_id = o.id AND ${LIVE_ITEM}) AS order_value
       FROM orders o
       LEFT JOIN users u ON o.waiter_id = u.id
       ${where}
       ORDER BY o.created_at DESC`,
      orderParams,
      ordersPaging,
      ['order_value']
    ),
    queryPaged(db,
      `SELECT k.id AS kot_id, COALESCE(k.kot_number, 'KOT-' || k.id) AS kot_number,
              COALESCE(k.cancelled_at, k.voided_at, k.printed_at) AS printed_at,
              k.printed_at AS original_kot_time,
              k.table_number, k.order_notes,
              COALESCE(k.cancel_reason, k.void_reason) AS void_reason,
              COALESCE(cu.full_name, k.issued_by_name) AS issued_by_name,
              k.previous_status,
              o.id AS order_id, o.order_number,
              COUNT(ki.id) AS item_count,
              COALESCE(SUM(ki.quantity), 0) AS quantity,
              COALESCE(
                NULLIF(k.cancel_reason, ''),
                NULLIF(k.void_reason, ''),
                MAX(NULLIF(ki.special_instructions, '')),
                NULLIF(k.order_notes, '')
              ) AS reason
       FROM kots k
       JOIN orders o ON o.id = k.order_id
       LEFT JOIN kot_items ki ON ki.kot_id = k.id
       LEFT JOIN users cu ON cu.id = k.cancelled_by
       WHERE ${f.businessDayId ? 'k.business_day_id = ?' : "date(COALESCE(k.cancelled_at, k.voided_at, k.printed_at), '+5 hours', '+45 minutes') BETWEEN ? AND ?"}
         AND (
           COALESCE(k.voided, 0) = 1
           OR COALESCE(k.status, '') = 'cancelled'
           OR COALESCE(k.kot_type, '') = 'cancellation'
           OR COALESCE(ki.is_cancellation, 0) = 1
         )
         AND COALESCE(k.kot_type, '') <> 'cancellation'
         AND NOT (
           COALESCE(k.void_reason, '') = 'All items on this ticket were cancelled.'
           AND EXISTS (
             SELECT 1 FROM kots cancellation_notice
             WHERE cancellation_notice.amends_kot_id = k.id
               AND COALESCE(cancellation_notice.kot_type, '') = 'cancellation'
           )
         )
         ${f.employeeId ? 'AND k.issued_by = ?' : ''}
         ${f.orderType ? `AND ${ORDER_TYPE_EXPR} = ?` : ''}
         ${cancelSearch.sql}
       GROUP BY k.id, k.kot_number, k.cancelled_at, k.voided_at, k.printed_at, k.table_number, k.order_notes,
                k.cancel_reason, k.void_reason, k.issued_by_name, cu.full_name, k.previous_status, o.id, o.order_number
       ORDER BY COALESCE(k.cancelled_at, k.voided_at, k.printed_at) DESC`,
      kotParams,
      cancelledKotsPaging,
      ['quantity']
    ),
    queryPaged(db,
      `SELECT b.id AS bill_id, b.bill_number, b.grand_total, b.status,
              COALESCE(b.voided_at, b.created_at) AS voided_at,
              COALESCE((SELECT SUM(bp.amount) FROM bill_payments bp WHERE bp.bill_id = b.id), 0) AS paid_amount,
              (SELECT bp.payment_method FROM bill_payments bp WHERE bp.bill_id = b.id ORDER BY bp.id DESC LIMIT 1) AS payment_method,
              COALESCE(NULLIF(b.void_reason, ''), (
                SELECT ba.reason FROM bill_audit ba
                WHERE ba.bill_id = b.id AND ba.event = 'bill_voided'
                ORDER BY ba.id DESC LIMIT 1
              )) AS reason,
              o.id AS order_id, o.order_number, o.table_number,
              COALESCE(u.full_name, '—') AS cashier
       ${BILL_FROM}
       LEFT JOIN users u ON b.cashier_id = u.id
       WHERE ${f.businessDayId ? 'b.business_day_id = ?' : "date(COALESCE(b.voided_at, b.created_at), '+5 hours', '+45 minutes') BETWEEN ? AND ?"}
         AND LOWER(COALESCE(b.status, '')) IN ('void', 'voided', 'cancelled', 'canceled')
         ${f.employeeId ? 'AND (b.cashier_id = ? OR o.waiter_id = ?)' : ''}
         ${f.orderType ? `AND ${ORDER_TYPE_EXPR} = ?` : ''}
         ${cancelSearch.sql}
       ORDER BY COALESCE(b.voided_at, b.created_at) DESC`,
      voidParams,
      voidedBillsPaging,
      ['paid_amount', 'grand_total']
    ),
  ]);

  voidedBillsPaged.paymentTotals = { cash: 0, digital: 0, credit: 0, funding: 0 };
  for (const row of voidedBillsPaged.rows || []) {
    const bucket = paymentBucket(row.payment_method);
    voidedBillsPaged.paymentTotals[bucket] += Number(row.grand_total) || 0;
  }
  // Prefer full-period totals when the table is paged.
  if (voidedBillsPaging && !voidedBillsPaging.exportAll && Number(voidedBillsPaged.pagination?.total) > voidedBillsPaged.rows.length) {
    const voidPaySplit = await safeAll(db,
      `SELECT ${paymentBucketSql("COALESCE((SELECT bp.payment_method FROM bill_payments bp WHERE bp.bill_id = b.id ORDER BY bp.id DESC LIMIT 1), 'cash')")} AS bucket,
              COALESCE(SUM(b.grand_total), 0) AS amount
       ${BILL_FROM}
       WHERE ${f.businessDayId ? 'b.business_day_id = ?' : "date(COALESCE(b.voided_at, b.created_at), '+5 hours', '+45 minutes') BETWEEN ? AND ?"}
         AND LOWER(COALESCE(b.status, '')) IN ('void', 'voided', 'cancelled', 'canceled')
         ${f.employeeId ? 'AND (b.cashier_id = ? OR o.waiter_id = ?)' : ''}
         ${f.orderType ? `AND ${ORDER_TYPE_EXPR} = ?` : ''}
         ${cancelSearch.sql}
       GROUP BY 1`,
      voidParams
    ).catch(() => null);
    if (voidPaySplit) {
      voidedBillsPaged.paymentTotals = { cash: 0, digital: 0, credit: 0, funding: 0 };
      for (const row of voidPaySplit) {
        const bucket = String(row.bucket || '');
        if (bucket in voidedBillsPaged.paymentTotals) voidedBillsPaged.paymentTotals[bucket] = num(row, 'amount');
      }
    }
  }

  const rows = ordersPaged.rows;
  const cancelledKots = cancelledKotsPaged.rows;
  const voidedBills = voidedBillsPaged.rows;

  const counts = {};
  for (const r of statusRows || []) counts[r.status] = num(r, 'count');
  const totalOrders = Object.values(counts).reduce((s, n) => s + n, 0);
  const avg = (list) => (list.length ? list.reduce((s, n) => s + n, 0) / list.length : 0);
  const prepMinutes = (prep || []).map((r) => num(r, 'minutes')).filter((n) => n > 0 && n <= 240);
  const serveMinutes = (serve || []).map((r) => num(r, 'minutes')).filter((n) => n > 0 && n < 600);

  const chips = [];
  if (totalOrders) {
    const done = counts.completed || 0;
    chips.push({ icon: 'up', text: `${Math.round((done / totalOrders) * 100)}% of orders reached completion (${done} of ${totalOrders})` });
  }
  if (prepMinutes.length) chips.push({ icon: 'clock', text: `Kitchen turns a ticket around in ${avg(prepMinutes).toFixed(0)} minutes on average` });
  const peak = (byHour || []).slice().sort((a, b) => num(b, 'count') - num(a, 'count'))[0];
  if (peak) chips.push({ icon: 'clock', text: `${String(num(peak, 'hour')).padStart(2, '0')}:00 is the busiest hour with ${num(peak, 'count')} orders` });

  const insights = [];
  if (serveMinutes.length) insights.push({ title: 'Table to bill', body: `An order takes ${avg(serveMinutes).toFixed(0)} minutes on average from being placed to being billed.`, tone: 'neutral' });
  if (prepMinutes.length) {
    const slow = prepMinutes.filter((m) => m > 25).length;
    insights.push({ title: 'Slow tickets', body: `${slow} kitchen ticket(s) took longer than 25 minutes.`, tone: slow > 0 ? 'warning' : 'positive' });
  }
  const open = (counts.pending || 0) + (counts.preparing || 0) + (counts.ready || 0);
  if (open > 0) insights.push({ title: 'Still open', body: `${open} order(s) from this period have not been closed out yet.`, tone: 'warning' });
  if (counts.cancelled) insights.push({ title: 'Cancellations', body: `${counts.cancelled} order(s) were cancelled — ${Math.round((counts.cancelled / totalOrders) * 100)}% of the period.`, tone: 'warning' });
  if (cancelledKotsPaged.pagination?.total) insights.push({ title: 'Cancelled KOT items', body: `${cancelledKotsPaged.pagination.total} cancellation ticket(s) were cut with a required reason.`, tone: 'warning' });
  if (voidedBillsPaged.pagination?.total) insights.push({ title: 'Voided bills', body: `${voidedBillsPaged.pagination.total} bill(s) were voided or cancelled and kept in history.`, tone: 'warning' });

  // Prep-time distribution buckets, so the chart says something a raw list cannot.
  const buckets = [
    { label: '0–10 min', test: (m) => m <= 10 },
    { label: '11–20 min', test: (m) => m > 10 && m <= 20 },
    { label: '21–30 min', test: (m) => m > 20 && m <= 30 },
    { label: '31–45 min', test: (m) => m > 30 && m <= 45 },
    { label: '45+ min', test: (m) => m > 45 },
  ];

  return {
    chips,
    kpis: [
      { key: 'completed', label: 'Completed', value: counts.completed || 0, format: 'number', tone: 'positive', highlight: true },
      { key: 'preparing', label: 'Preparing', value: counts.preparing || 0, format: 'number', tone: 'warning' },
      { key: 'ready', label: 'Ready', value: counts.ready || 0, format: 'number', tone: 'info' },
      { key: 'pending', label: 'Pending', value: counts.pending || 0, format: 'number', tone: 'neutral' },
      { key: 'cancelled', label: 'Cancelled', value: counts.cancelled || 0, format: 'number', tone: 'negative' },
    ],
    charts: {
      perHour: (byHour || []).map((r) => ({ label: `${String(num(r, 'hour')).padStart(2, '0')}:00`, value: num(r, 'count') })),
      prepTime: buckets.map((b) => ({ label: b.label, value: prepMinutes.filter(b.test).length })),
      serveTime: buckets.map((b) => ({ label: b.label, value: serveMinutes.filter(b.test).length })),
      orderTypes: (byType || []).map((r) => ({ label: orderTypeLabel(r.order_type), value: num(r, 'count') })),
    },
    insights,
    tables: [
      withPagination({
        id: 'orders',
        title: 'Orders',
        columns: [
          { key: 'created_at', label: 'Placed', type: 'datetime' },
          { key: 'order_number', label: 'Order' },
          { key: 'status', label: 'Status', type: 'status' },
          { key: 'table_number', label: 'Table' },
          { key: 'waiter_name', label: 'Waiter' },
          { key: 'sitting_minutes', label: 'At table', type: 'minutes', align: 'right' },
          { key: 'kitchen_minutes', label: 'Kitchen (min)', type: 'number', align: 'right' },
          { key: 'completed_at', label: 'Completed', type: 'datetime' },
          { key: 'order_value', label: 'Value', type: 'currency', align: 'right' },
        ],
        rows: ordersPaged.rows.map((r) => ({
          _record_id: r.id,
          _bill_id: r.bill_id || null,
          _links: { order_number: { type: 'order', id: r.id } },
          created_at: r.created_at,
          order_number: r.order_number,
          status: r.status || 'pending',
          table_number: r.table_number || '—',
          waiter_name: r.waiter_name || 'Unassigned',
          sitting_minutes: r.table_number && r.sitting_minutes != null ? Math.round(num(r, 'sitting_minutes')) : null,
          kitchen_minutes: r.kitchen_minutes == null ? null : Math.round(num(r, 'kitchen_minutes')),
          completed_at: r.completed_at || null,
          order_value: num(r, 'order_value'),
        })),
        empty: 'No orders were placed in the selected period.',
      }, ordersPaged),
      withPagination({
        id: 'cancelled-kots',
        title: 'Cancelled KOT History',
        columns: [
          { key: 'original_kot_time', label: 'Original KOT', type: 'datetime' },
          { key: 'printed_at', label: 'Cancelled', type: 'datetime' },
          { key: 'kot_number', label: 'KOT' },
          { key: 'order_number', label: 'Order' },
          { key: 'table_number', label: 'Table' },
          { key: 'quantity', label: 'Qty', type: 'number', align: 'right' },
          { key: 'previous_status', label: 'Previous' },
          { key: 'issued_by_name', label: 'By' },
          { key: 'reason', label: 'Reason' },
        ],
        rows: cancelledKotsPaged.rows.map((r) => ({
          _record_id: r.kot_id,
          _links: { kot_number: { type: 'kot', id: r.kot_id, label: r.kot_number }, order_number: { type: 'order', id: r.order_id } },
          original_kot_time: r.original_kot_time || null,
          printed_at: r.printed_at,
          kot_number: r.kot_number,
          order_number: r.order_number || '—',
          table_number: r.table_number || '—',
          quantity: num(r, 'quantity'),
          previous_status: r.previous_status || '—',
          issued_by_name: r.issued_by_name || '—',
          reason: r.reason || '—',
        })),
        empty: 'No cancelled KOTs were recorded in the selected period.',
      }, cancelledKotsPaged),
      withPagination({
        id: 'voided-bills',
        title: 'Cancelled / Voided Bills',
        columns: [
          { key: 'voided_at', label: 'Time', type: 'datetime' },
          { key: 'bill_number', label: 'Bill' },
          { key: 'order_number', label: 'Order' },
          { key: 'table_number', label: 'Table' },
          { key: 'cashier', label: 'Cashier' },
          { key: 'status', label: 'Status', type: 'status' },
          { key: 'payment_method', label: 'Original Payment' },
          { key: 'paid_amount', label: 'Paid', type: 'currency', align: 'right' },
          { key: 'reason', label: 'Reason' },
          { key: 'grand_total', label: 'Amount', type: 'currency', align: 'right' },
        ],
        rows: voidedBillsPaged.rows.map((r) => ({
          _record_id: r.bill_id,
          _bill_id: r.bill_id,
          _links: { bill_number: { type: 'bill', id: r.bill_id }, order_number: { type: 'order', id: r.order_id } },
          voided_at: r.voided_at,
          bill_number: r.bill_number || `#${r.bill_id}`,
          order_number: r.order_number || '—',
          table_number: r.table_number || '—',
          cashier: r.cashier || '—',
          status: r.status || 'voided',
          payment_method: paymentMethodLabel(r.payment_method),
          paid_amount: num(r, 'paid_amount'),
          reason: r.reason || '—',
          grand_total: num(r, 'grand_total'),
        })),
        empty: 'No cancelled or voided bills were recorded in the selected period.',
      }, voidedBillsPaged),
    ],
  };
}

async function menuTab(db, range, f) {
  const costMap = await getItemCostMap(db);
  const sold = await itemSales(db, range, f);
  const soldById = new Map();
  for (const sale of sold || []) {
    const key = String(sale.menu_item_id);
    const current = soldById.get(key) || { ...sale, quantity: 0, revenue: 0 };
    current.quantity += num(sale, 'quantity');
    current.revenue += num(sale, 'revenue');
    soldById.set(key, current);
  }

  const allItems = await safeAll(db, 
    `SELECT mi.id, mi.name, mi.base_price, mi.image_url, mi.is_available,
            COALESCE(mc.name, 'Uncategorised') AS category_name,
            ${FOOD_GROUP_EXPR} AS food_group
     FROM menu_items mi
     LEFT JOIN menu_categories mc ON mi.category_id = mc.id
     ORDER BY mi.name ASC`
  );

  const rows = (allItems || []).map((item) => {
    const s = soldById.get(String(item.id));
    const quantity = num(s, 'quantity');
    const revenue = num(s, 'revenue');
    const entry = costMap.get(item.id);
    const unitCost = entry ? entry.cost : num(item, 'base_price') * COST_RATIO;
    const foodCost = unitCost * quantity;
    const profit = revenue - foodCost;
    return {
      id: item.id,
      name: item.name,
      category_name: item.category_name,
      food_group: item.food_group,
      master_category: foodGroupLabel(item.food_group),
      quantity,
      revenue,
      food_cost: foodCost,
      profit,
      margin: revenue ? (profit / revenue) * 100 : 0,
      avg_price: quantity ? revenue / quantity : num(item, 'base_price'),
      costed_from_recipe: !!(entry && !entry.estimated),
    };
  });

  const withSales = rows.filter((r) => r.quantity > 0);
  const best = withSales.slice().sort((a, b) => b.quantity - a.quantity)[0] || null;
  const worst = withSales.slice().sort((a, b) => a.quantity - b.quantity)[0] || null;
  const topProfit = withSales.slice().sort((a, b) => b.profit - a.profit)[0] || null;
  const lowProfit = withSales.slice().sort((a, b) => a.profit - b.profit)[0] || null;
  const neverSold = rows.filter((r) => r.quantity === 0).length;

  const byCategory = new Map();
  for (const r of withSales) {
    const prev = byCategory.get(r.category_name) || { revenue: 0, quantity: 0, profit: 0, items: 0 };
    prev.revenue += r.revenue;
    prev.quantity += r.quantity;
    prev.profit += r.profit;
    prev.items += 1;
    byCategory.set(r.category_name, prev);
  }
  const categoryRows = Array.from(byCategory.entries())
    .map(([name, v]) => ({ label: name, value: v.revenue, meta: `${v.quantity} sold`, ...v }))
    .sort((a, b) => b.value - a.value);

  const byGroup = new Map();
  for (const r of withSales) {
    const gid = r.food_group === 'uncategorised' ? 'uncategorised' : normalizeFoodGroup(r.food_group);
    const prev = byGroup.get(gid) || { revenue: 0, quantity: 0, profit: 0, items: 0 };
    prev.revenue += r.revenue;
    prev.quantity += r.quantity;
    prev.profit += r.profit;
    prev.items += 1;
    byGroup.set(gid, prev);
  }
  const groupRows = Array.from(byGroup.entries())
    .map(([id, v]) => ({ label: foodGroupLabel(id), value: v.revenue, meta: `${v.quantity} sold`, ...v }))
    .sort((a, b) => b.value - a.value);

  const chips = [];
  if (best) chips.push({ icon: 'star', text: `${best.name} is the best seller with ${best.quantity} sold` });
  if (topProfit) chips.push({ icon: 'up', text: `${topProfit.name} contributed the most profit (${money(topProfit.profit)})` });
  if (neverSold) chips.push({ icon: 'info', text: `${neverSold} of ${rows.length} menu items sold nothing in this period` });

  const insights = [];
  if (categoryRows[0]) {
    const total = categoryRows.reduce((s, c) => s + c.revenue, 0) || 1;
    insights.push({ title: 'Category concentration', body: `${categoryRows[0].label} alone produced ${Math.round((categoryRows[0].revenue / total) * 100)}% of menu revenue.`, tone: 'neutral' });
  }
  if (lowProfit && lowProfit.margin < 30) {
    insights.push({ title: 'Thin margin', body: `${lowProfit.name} runs at a ${lowProfit.margin.toFixed(1)}% margin — worth a price or portion review.`, tone: 'warning' });
  }
  if (neverSold > rows.length * 0.4) {
    insights.push({ title: 'Menu drag', body: `${neverSold} items had no sales at all. A shorter menu would cut prep waste and speed up service.`, tone: 'warning' });
  }
  const recipeCosted = rows.filter((r) => r.costed_from_recipe).length;
  insights.push({
    title: 'Cost accuracy',
    body: recipeCosted
      ? `${recipeCosted} item(s) are costed from a real recipe; the rest use the ${COST_RATIO * 100}% food-cost estimate.`
      : `No menu item has a complete recipe yet, so every food cost here is the ${COST_RATIO * 100}% estimate. Add recipes to make these margins exact.`,
    tone: recipeCosted ? 'neutral' : 'warning',
  });

  return {
    chips,
    kpis: [
      { key: 'best', label: 'Best Seller', value: best?.name || null, format: 'text', sub: best ? `${best.quantity} sold` : null, highlight: true },
      { key: 'worst', label: 'Worst Seller', value: worst?.name || null, format: 'text', sub: worst ? `${worst.quantity} sold` : null },
      { key: 'topProfit', label: 'Best Margin Earner', value: topProfit?.name || null, format: 'text', sub: topProfit ? `${money(topProfit.profit)}` : null },
      { key: 'lowProfit', label: 'Weakest Margin Earner', value: lowProfit?.name || null, format: 'text', sub: lowProfit ? `${money(lowProfit.profit)}` : null },
    ],
    charts: {
      topItems: withSales.slice().sort((a, b) => b.revenue - a.revenue).slice(0, 10)
        .map((r) => ({ label: r.name, value: r.revenue, meta: `${r.quantity} sold` })),
      categoryPerformance: categoryRows.map((c) => ({ label: c.label, value: c.value, meta: c.meta })),
      groupPerformance: groupRows.map((c) => ({ label: c.label, value: c.value, meta: c.meta })),
      avgPrice: categoryRows.map((c) => ({ label: c.label, value: c.quantity ? c.revenue / c.quantity : 0 })),
      matrix: withSales.map((r) => ({ label: r.name, x: r.quantity, y: r.margin, size: r.revenue })),
    },
    insights,
    table: {
      title: 'Menu Performance',
      columns: [
        { key: 'name', label: 'Item' },
        { key: 'category_name', label: 'Category', type: 'badge' },
        { key: 'master_category', label: 'Master', type: 'badge' },
        { key: 'quantity', label: 'Qty Sold', type: 'number', align: 'right' },
        { key: 'revenue', label: 'Revenue', type: 'currency', align: 'right' },
        { key: 'food_cost', label: 'Food Cost', type: 'currency', align: 'right' },
        { key: 'profit', label: 'Profit after Food Cost', type: 'currency', align: 'right' },
        { key: 'margin', label: 'Margin', type: 'percent', align: 'right' },
      ],
      rows: withSales,
      empty: 'No menu items were sold in the selected period.',
    },
  };
}

async function inventoryTab(db, range, f) {
  const movementsPaging = readTablePaging(f, 'movements');
  const purchasesPaging = readTablePaging(f, 'purchases');
  let movementWhere = f.businessDayId ? 'm.business_day_id = ?' : "date(m.created_at, '+5 hours', '+45 minutes') BETWEEN ? AND ?";
  const wastageWhere = f.businessDayId ? 'w.business_day_id = ?' : "date(w.created_at, '+5 hours', '+45 minutes') BETWEEN ? AND ?";
  const movementParams = f.businessDayId ? [f.businessDayId] : [range.start, range.end];
  const wastageParams = f.businessDayId ? [f.businessDayId] : [range.start, range.end];

  /*
   * Employee and search reach the movement history; the menu-category and
   * payment filters do not apply to raw stock at all and are declared as such
   * in FILTER_SUPPORT below, so the UI greys them out rather than leaving an
   * owner to wonder why the numbers never move.
   */
  let itemSearch = { sql: '', params: [] };
  if (f.employeeId) {
    movementWhere += ' AND m.performed_by = ?';
    movementParams.push(f.employeeId);
  }
  if (f.search) {
    const like = `%${String(f.search).toLowerCase()}%`;
    movementWhere += ` AND (LOWER(COALESCE(im.item_name, im.name, '')) LIKE ? OR LOWER(COALESCE(m.reason, '')) LIKE ?)`;
    movementParams.push(like, like);
    itemSearch = {
      sql: ` WHERE (LOWER(COALESCE(item_name, name, '')) LIKE ? OR LOWER(COALESCE(supplier, '')) LIKE ? OR LOWER(COALESCE(category, '')) LIKE ?)`,
      params: [like, like, like],
    };
  }
  const [items, movementDaily, wastageDaily, byType] = await Promise.all([
    safeAll(db, 
      `SELECT id, COALESCE(item_name, name) AS item_name, quantity, unit, cost_per_unit,
              COALESCE(min_stock_level, min_stock, 0) AS min_level, supplier, category
       FROM inventory_items${itemSearch.sql}
       ORDER BY COALESCE(item_name, name) ASC`,
      itemSearch.params
    ),
    safeAll(db,
      `SELECT date(m.created_at, '+5 hours', '+45 minutes') AS d,
              CASE WHEN m.change_type = 'manual_restock' THEN 'purchase_receipt' ELSE m.change_type END AS change_type,
              SUM(ABS(m.quantity_changed) * COALESCE(m.unit_cost, im.cost_per_unit, 0)) AS value
       FROM stock_movements m
       LEFT JOIN inventory_items im ON m.inventory_item_id = im.id
       WHERE ${movementWhere}
       GROUP BY date(m.created_at, '+5 hours', '+45 minutes'),
                CASE WHEN m.change_type = 'manual_restock' THEN 'purchase_receipt' ELSE m.change_type END`,
      movementParams
    ),
    safeAll(db, 
      `SELECT date(w.created_at, '+5 hours', '+45 minutes') AS d, SUM(w.quantity * COALESCE(im.cost_per_unit, 0)) AS value
       FROM wastage_log w
       LEFT JOIN inventory_items im ON w.raw_material_id = im.id
       WHERE ${wastageWhere}
       GROUP BY date(w.created_at, '+5 hours', '+45 minutes')`,
      wastageParams
    ),
    safeAll(db, 
      `SELECT m.change_type AS change_type, COUNT(*) AS count, SUM(ABS(m.quantity_changed)) AS quantity
       FROM stock_movements m
       LEFT JOIN inventory_items im ON m.inventory_item_id = im.id
       WHERE ${movementWhere}
       GROUP BY m.change_type`,
      movementParams
    ),
  ]);

  const [movementsPaged, purchasesPaged] = await Promise.all([
    queryPaged(db,
      `SELECT m.id,
              CASE WHEN m.change_type = 'manual_restock' THEN 'purchase_receipt' ELSE m.change_type END AS change_type,
              m.quantity_changed, m.reason, m.created_at,
              COALESCE(im.item_name, im.name) AS item_name, im.unit,
              COALESCE(m.unit_cost, im.cost_per_unit) AS cost_per_unit,
              u.full_name AS performed_by_name
       FROM stock_movements m
       LEFT JOIN inventory_items im ON m.inventory_item_id = im.id
       LEFT JOIN users u ON m.performed_by = u.id
       WHERE ${movementWhere}
       ORDER BY m.created_at DESC`,
      movementParams,
      movementsPaging,
      ['quantity_changed']
    ),
    queryPaged(db,
      `SELECT m.id, m.reference_id, m.quantity_changed, m.created_at,
              COALESCE(im.item_name, im.name) AS item_name,
              COALESCE(m.unit_cost, im.cost_per_unit) AS cost_per_unit,
              u.full_name AS performed_by_name
       FROM stock_movements m
       LEFT JOIN inventory_items im ON m.inventory_item_id = im.id
       LEFT JOIN users u ON m.performed_by = u.id
       WHERE ${movementWhere} AND m.change_type IN ('purchase_receipt', 'manual_restock')
       ORDER BY m.created_at DESC`,
      movementParams,
      purchasesPaging,
      ['quantity_changed']
    ),
  ]);

  const movements = movementsPaged.rows;
  const purchaseMovements = purchasesPaged.rows;

  const inventoryValue = (items || []).reduce((s, i) => s + num(i, 'quantity') * num(i, 'cost_per_unit'), 0);
  const outOfStock = (items || []).filter((i) => num(i, 'quantity') <= 0);
  const lowStock = (items || []).filter((i) => num(i, 'quantity') > 0 && num(i, 'quantity') <= num(i, 'min_level'));
  // Off the unbounded daily aggregate, not the capped detail rows — otherwise
  // this understates wastage the moment the detail table is truncated.
  const wastageCost = (wastageDaily || []).reduce((s, w) => s + num(w, 'value'), 0);

  const days = eachDay(range);
  const seriesFor = (rowsIn, filterType) => {
    const map = new Map();
    for (const r of rowsIn || []) {
      if (filterType && r.change_type !== filterType) continue;
      const k = dateKey(r.d);
      map.set(k, (map.get(k) || 0) + num(r, 'value'));
    }
    return days.map((d) => ({ label: d.day, sub: d.date, value: map.get(d.date) || 0 }));
  };

  const chips = [];
  chips.push({ icon: 'wallet', text: `${money(inventoryValue)} of stock is sitting on the shelves right now` });
  if (outOfStock.length || lowStock.length) {
    chips.push({ icon: 'warn', text: `${outOfStock.length} item(s) out of stock and ${lowStock.length} running low` });
  } else if (items?.length) {
    chips.push({ icon: 'up', text: 'Every tracked raw material is above its reorder level' });
  }
  const priciest = (items || []).slice().sort((a, b) => num(b, 'quantity') * num(b, 'cost_per_unit') - num(a, 'quantity') * num(a, 'cost_per_unit'))[0];
  if (priciest) chips.push({ icon: 'star', text: `${priciest.item_name} ties up the most capital (${money((num(priciest, 'quantity') * num(priciest, 'cost_per_unit')))})` });

  const insights = [];
  if (!movements?.length) {
    insights.push({ title: 'No movement history yet', body: 'Nothing has been received, deducted or adjusted in this period, so consumption and purchase trends have no data to draw from. Movement rows appear once deliveries are received or orders deduct stock.', tone: 'neutral' });
  }
  if (lowStock.length) {
    insights.push({ title: 'Reorder queue', body: `${lowStock.map((i) => i.item_name).slice(0, 3).join(', ')}${lowStock.length > 3 ? ` and ${lowStock.length - 3} more` : ''} need restocking.`, tone: 'warning' });
  }
  if (wastageCost > 0) {
    insights.push({ title: 'Wastage cost', body: `${money(wastageCost)} was written off in this period.`, tone: 'warning' });
  }
  const noSupplier = (items || []).filter((i) => !i.supplier).length;
  if (noSupplier) insights.push({ title: 'Missing supplier data', body: `${noSupplier} of ${items.length} raw materials have no supplier recorded, which limits purchase analysis.`, tone: 'neutral' });

  return {
    chips,
    kpis: [
      { key: 'value', label: 'Inventory Value', value: inventoryValue, format: 'currency', highlight: true },
      { key: 'low', label: 'Low Stock', value: lowStock.length, format: 'number', tone: 'warning' },
      { key: 'out', label: 'Out of Stock', value: outOfStock.length, format: 'number', tone: 'negative' },
      { key: 'wastage', label: 'Wastage Cost', value: wastageCost, format: 'currency' },
    ],
    charts: {
      consumption: seriesFor(movementDaily, 'order_deduction'),
      purchases: seriesFor(movementDaily, 'purchase_receipt'),
      wastage: (() => {
        const map = new Map((wastageDaily || []).map((r) => [dateKey(r.d), num(r, 'value')]));
        return days.map((d) => ({ label: d.day, sub: d.date, value: map.get(d.date) || 0 }));
      })(),
      movementTypes: (byType || []).map((r) => ({ label: String(r.change_type).replace(/_/g, ' '), value: num(r, 'quantity'), meta: `${num(r, 'count')} entries` })),
    },
    insights,
    tables: [
      {
        id: 'inventory',
        title: 'Inventory',
        columns: [
          { key: 'item_name', label: 'Item' },
          { key: 'supplier', label: 'Supplier' },
          { key: 'quantity', label: 'Current Stock', type: 'number', align: 'right' },
          { key: 'unit', label: 'Unit' },
          { key: 'min_level', label: 'Minimum Stock', type: 'number', align: 'right' },
          { key: 'value', label: 'Value', type: 'currency', align: 'right' },
          { key: 'stock_status', label: 'Status', type: 'status' },
        ],
        rows: (items || []).map((i) => ({
          item_name: i.item_name,
          supplier: i.supplier || '—',
          quantity: num(i, 'quantity'),
          unit: i.unit || '',
          min_level: num(i, 'min_level'),
          value: num(i, 'quantity') * num(i, 'cost_per_unit'),
          stock_status: num(i, 'quantity') <= 0 ? 'out of stock' : num(i, 'quantity') <= num(i, 'min_level') ? 'low' : 'ok',
        })),
        empty: 'No raw materials have been added to inventory yet.',
      },
      withPagination({
        id: 'movements',
        title: 'Movement History',
        columns: [
          { key: 'created_at', label: 'When', type: 'datetime' },
          { key: 'item_name', label: 'Item' },
          { key: 'change_type', label: 'Type', type: 'badge' },
          { key: 'quantity_changed', label: 'Change', type: 'number', align: 'right' },
          { key: 'reason', label: 'Reason' },
          { key: 'performed_by_name', label: 'By' },
        ],
        rows: movementsPaged.rows.map((m) => ({
          created_at: m.created_at,
          item_name: m.item_name || '—',
          change_type: String(m.change_type || '').replace(/_/g, ' '),
          quantity_changed: num(m, 'quantity_changed'),
          reason: m.reason || '—',
          performed_by_name: m.performed_by_name || 'System',
        })),
        empty: 'No inventory movement has been recorded in this period.',
      }, movementsPaged),
      withPagination({
        id: 'purchases',
        title: 'Purchase History',
        columns: [
          { key: 'created_at', label: 'Received', type: 'datetime' },
          { key: 'item_name', label: 'Item' },
          { key: 'quantity_changed', label: 'Quantity', type: 'number', align: 'right' },
          { key: 'value', label: 'Value', type: 'currency', align: 'right' },
          { key: 'performed_by_name', label: 'Received by' },
        ],
        rows: purchasesPaged.rows.map((m) => ({
          _purchase_id: Number(m.reference_id) || null,
          created_at: m.created_at,
          item_name: m.item_name || '—',
          quantity_changed: num(m, 'quantity_changed'),
          value: Math.abs(num(m, 'quantity_changed')) * num(m, 'cost_per_unit'),
          performed_by_name: m.performed_by_name || 'System',
        })),
        empty: 'No deliveries have been received in this period.',
      }, purchasesPaged),
      {
        id: 'low-stock',
        title: 'Low Stock Items',
        columns: [
          { key: 'item_name', label: 'Item' },
          { key: 'quantity', label: 'Remaining', type: 'number', align: 'right' },
          { key: 'min_level', label: 'Minimum', type: 'number', align: 'right' },
          { key: 'shortfall', label: 'Shortfall', type: 'number', align: 'right' },
          { key: 'supplier', label: 'Supplier' },
        ],
        rows: [...outOfStock, ...lowStock].map((i) => ({
          item_name: i.item_name,
          quantity: num(i, 'quantity'),
          min_level: num(i, 'min_level'),
          shortfall: Math.max(0, num(i, 'min_level') - num(i, 'quantity')),
          supplier: i.supplier || '—',
        })),
        empty: 'Every tracked raw material is above its reorder level.',
      },
    ],
  };
}

async function customersTab(db, range, f) {
  const scope = billScope(db, range, f);
  const [customers, linked, growth, walkIns] = await Promise.all([
    safeAll(db, `SELECT id, name, phone, total_visits, total_spent, is_vip, created_at FROM customers ORDER BY total_spent DESC`),
    safeAll(db, 
      `SELECT o.customer_id AS customer_id, COUNT(DISTINCT b.id) AS orders,
              COALESCE(SUM(b.grand_total), 0) AS spend, MAX(b.created_at) AS last_visit
       ${BILL_FROM}${scope.sql} AND o.customer_id IS NOT NULL
       GROUP BY o.customer_id`,
      scope.params
    ),
    safeAll(db, 
      `SELECT date(created_at, '+5 hours', '+45 minutes') AS d, COUNT(*) AS count FROM customers
       WHERE date(created_at, '+5 hours', '+45 minutes') BETWEEN ? AND ?
       GROUP BY date(created_at, '+5 hours', '+45 minutes')`,
      [range.start, range.end]
    ),
    safeGet(db, 
      `SELECT COUNT(DISTINCT b.id) AS orders, COALESCE(SUM(b.grand_total), 0) AS revenue
       ${BILL_FROM}${scope.sql} AND o.customer_id IS NULL`,
      scope.params
    ),
  ]);

  const linkedById = new Map((linked || []).map((r) => [r.customer_id, r]));
  const rows = (customers || []).map((c) => {
    const l = linkedById.get(c.id);
    return {
      _record_id: c.id,
      name: c.name,
      phone: c.phone || '—',
      is_vip: num(c, 'is_vip') ? 'VIP' : 'Regular',
      orders: num(c, 'total_visits'),
      spending: num(c, 'total_spent'),
      lifetime_value: num(c, 'total_spent'),
      avg_spend: num(c, 'total_visits') ? num(c, 'total_spent') / num(c, 'total_visits') : 0,
      last_visit: l?.last_visit || null,
      period_spend: num(l, 'spend'),
    };
  });

  const newInRange = (growth || []).reduce((s, r) => s + num(r, 'count'), 0);
  const returning = rows.filter((r) => r.orders > 1).length;
  const vip = rows.filter((r) => r.is_vip === 'VIP').length;
  const avgSpend = rows.length ? rows.reduce((s, r) => s + r.avg_spend, 0) / rows.length : 0;
  const unlinked = (linked || []).length === 0;

  const chips = [];
  chips.push({ icon: 'info', text: `${rows.length} customer profile(s) on file, ${returning} of them repeat visitors` });
  if (rows[0]) chips.push({ icon: 'star', text: `${rows[0].name} is the highest lifetime spender at ${money(rows[0].spending)}` });
  if (unlinked && num(walkIns, 'orders') > 0) {
    chips.push({ icon: 'warn', text: `All ${num(walkIns, 'orders')} billed orders this period were walk-ins with no customer attached` });
  }

  const insights = [];
  if (unlinked) {
    insights.push({
      title: 'Orders are not linked to customers',
      body: 'Every order in this period was taken as a walk-in, so per-customer revenue, visit frequency and last-visit dates cannot be derived from trading data. The figures below come from the customer profiles themselves.',
      tone: 'warning',
    });
  }
  if (vip) insights.push({ title: 'VIP base', body: `${vip} customer(s) are flagged VIP, worth ${money(rows.filter((r) => r.is_vip === 'VIP').reduce((s, r) => s + r.spending, 0))} in lifetime spend.`, tone: 'positive' });
  if (rows.length) {
    const top3 = rows.slice(0, 3).reduce((s, r) => s + r.spending, 0);
    const all = rows.reduce((s, r) => s + r.spending, 0) || 1;
    insights.push({ title: 'Spend concentration', body: `The top three customers account for ${Math.round((top3 / all) * 100)}% of all recorded customer spend.`, tone: 'neutral' });
  }
  if (newInRange === 0) insights.push({ title: 'No sign-ups', body: 'No new customer profile was created during the selected period.', tone: 'neutral' });

  const days = eachDay(range);
  const growthMap = new Map((growth || []).map((r) => [dateKey(r.d), num(r, 'count')]));

  const freqBuckets = [
    { label: '1 visit', test: (n) => n <= 1 },
    { label: '2–3 visits', test: (n) => n >= 2 && n <= 3 },
    { label: '4–6 visits', test: (n) => n >= 4 && n <= 6 },
    { label: '7+ visits', test: (n) => n >= 7 },
  ];

  return {
    chips,
    kpis: [
      { key: 'new', label: 'New Customers', value: newInRange, format: 'number', highlight: true },
      { key: 'returning', label: 'Returning Customers', value: returning, format: 'number' },
      { key: 'avg', label: 'Average Spend', value: avgSpend, format: 'currency' },
      { key: 'vip', label: 'VIP Customers', value: vip, format: 'number' },
    ],
    charts: {
      growth: days.map((d) => ({ label: d.day, sub: d.date, value: growthMap.get(d.date) || 0 })),
      frequency: freqBuckets.map((b) => ({ label: b.label, value: rows.filter((r) => b.test(r.orders)).length })),
      revenueByCustomer: rows.slice(0, 10).map((r) => ({ label: r.name, value: r.spending })),
      topCustomers: rows.slice(0, 5).map((r) => ({ label: r.name, value: r.orders, meta: `${money(r.spending)} lifetime` })),
    },
    insights,
    table: {
      title: 'Customer List',
      columns: [
        { key: 'name', label: 'Customer' },
        { key: 'phone', label: 'Phone' },
        { key: 'is_vip', label: 'Tier', type: 'badge' },
        { key: 'orders', label: 'Visits', type: 'number', align: 'right' },
        { key: 'spending', label: 'Spending', type: 'currency', align: 'right' },
        { key: 'avg_spend', label: 'Avg / Visit', type: 'currency', align: 'right' },
        { key: 'last_visit', label: 'Last Visit', type: 'datetime' },
        { key: 'lifetime_value', label: 'Lifetime Value', type: 'currency', align: 'right' },
      ],
      rows,
      empty: 'No customer profiles have been created yet.',
    },
    notes: unlinked
      ? ['orders.customer_id is null on every order in this range, so Last Visit is blank and spend comes from the customer profile totals rather than from bills.']
      : [],
  };
}

async function employeesTab(db, range, f) {
  const scope = billScope(db, range, f);
  const [waiters, cashiers, kitchen, staff] = await Promise.all([
    safeAll(db, 
      `SELECT u.id, u.full_name, COALESCE(SUM(b.grand_total), 0) AS revenue, COUNT(DISTINCT b.id) AS orders
       ${BILL_FROM}
       JOIN users u ON o.waiter_id = u.id
       ${scope.sql}
       GROUP BY u.id, u.full_name
       ORDER BY revenue DESC`,
      scope.params
    ),
    safeAll(db, 
      `SELECT u.id, u.full_name, COALESCE(SUM(b.grand_total), 0) AS revenue, COUNT(DISTINCT b.id) AS bills
       ${BILL_FROM}
       JOIN users u ON b.cashier_id = u.id
       ${scope.sql}
       GROUP BY u.id, u.full_name
       ORDER BY revenue DESC`,
      scope.params
    ),
    safeGet(db, 
      `SELECT AVG(${minutesBetween('k.printed_at', 'k.completed_at')}) AS avg_minutes, COUNT(*) AS tickets
       FROM kots k JOIN orders o ON k.order_id = o.id
       WHERE date(k.printed_at, '+5 hours', '+45 minutes') BETWEEN ? AND ? AND k.completed_at IS NOT NULL`,
      [range.start, range.end]
    ),
    safeAll(db, `SELECT id, full_name, username, role FROM users WHERE COALESCE(is_active, 1) = 1 ORDER BY full_name`),
  ]);

  const revenueByStaff = new Map();
  for (const w of waiters || []) revenueByStaff.set(w.id, { revenue: num(w, 'revenue'), orders: num(w, 'orders') });
  const cashierById = new Map((cashiers || []).map((c) => [c.id, c]));

  const rows = (staff || []).map((u) => {
    const w = revenueByStaff.get(u.id);
    const c = cashierById.get(u.id);
    const revenue = (w?.revenue || 0) + (c ? num(c, 'revenue') : 0);
    const orders = (w?.orders || 0) + (c ? num(c, 'bills') : 0);
    return {
      _record_id: u.id,
      name: u.full_name || u.username,
      role: u.role,
      served_orders: w?.orders || 0,
      served_revenue: w?.revenue || 0,
      billed_count: c ? num(c, 'bills') : 0,
      revenue,
      orders,
      avg_order: orders ? revenue / orders : 0,
    };
  });

  const topWaiter = (waiters || [])[0] || null;
  const topCashier = (cashiers || [])[0] || null;
  const topEarner = rows.slice().sort((a, b) => b.revenue - a.revenue)[0] || null;
  const avgPrep = num(kitchen, 'avg_minutes');

  const chips = [];
  if (topWaiter) chips.push({ icon: 'star', text: `${topWaiter.full_name} led the floor with ${money(num(topWaiter, 'revenue'))} served` });
  if (topCashier) chips.push({ icon: 'card', text: `${topCashier.full_name} settled ${num(topCashier, 'bills')} bill(s)` });
  if (avgPrep > 0) chips.push({ icon: 'clock', text: `Kitchen averaged ${avgPrep.toFixed(0)} minutes per ticket across ${num(kitchen, 'tickets')} tickets` });

  const insights = [];
  if ((waiters || []).length > 1) {
    const gap = num(waiters[0], 'revenue') - num(waiters[waiters.length - 1], 'revenue');
    insights.push({ title: 'Floor spread', body: `${money(gap)} separates the strongest and weakest server this period — worth checking section allocation.`, tone: 'neutral' });
  }
  if (topWaiter) {
    const total = (waiters || []).reduce((s, w) => s + num(w, 'revenue'), 0) || 1;
    insights.push({ title: 'Server concentration', body: `${topWaiter.full_name} handled ${Math.round((num(topWaiter, 'revenue') / total) * 100)}% of served revenue.`, tone: 'neutral' });
  }
  insights.push({
    title: 'Not tracked in this system',
    body: 'There is no attendance table and no tips field in this schema, so shift attendance and tip earnings cannot be reported. Kitchen tickets also carry no prepared_by user, so kitchen speed is measured per ticket rather than per cook.',
    tone: 'neutral',
  });

  const days = eachDay(range);
  const speedRows = await safeAll(db, 
    `SELECT date(k.printed_at, '+5 hours', '+45 minutes') AS d, AVG(${minutesBetween('k.printed_at', 'k.completed_at')}) AS avg_minutes
     FROM kots k
     WHERE date(k.printed_at, '+5 hours', '+45 minutes') BETWEEN ? AND ? AND k.completed_at IS NOT NULL
     GROUP BY date(k.printed_at, '+5 hours', '+45 minutes')`,
    [range.start, range.end]
  );
  const speedMap = new Map((speedRows || []).map((r) => [dateKey(r.d), num(r, 'avg_minutes')]));

  return {
    chips,
    kpis: [
      { key: 'topWaiter', label: 'Top Waiter', value: topWaiter?.full_name || null, format: 'text', sub: topWaiter ? `${money(num(topWaiter, 'revenue'))}` : null },
      { key: 'topCashier', label: 'Top Cashier', value: topCashier?.full_name || null, format: 'text', sub: topCashier ? `${num(topCashier, 'bills')} bills` : null },
      { key: 'prep', label: 'Average Kitchen Time', value: avgPrep, format: 'minutes' },
      { key: 'earner', label: 'Highest Revenue Generated', value: topEarner?.name || null, format: 'text', sub: topEarner ? `${money(topEarner.revenue)}` : null },
    ],
    charts: {
      salesByWaiter: (waiters || []).map((w) => ({ label: w.full_name, value: num(w, 'revenue'), meta: `${num(w, 'orders')} orders` })),
      kitchenSpeed: days.map((d) => ({ label: d.day, sub: d.date, value: speedMap.get(d.date) || 0 })),
      orderCount: (waiters || []).map((w) => ({ label: w.full_name, value: num(w, 'orders') })),
    },
    insights,
    table: {
      title: 'Employee Performance',
      columns: [
        { key: 'name', label: 'Employee' },
        { key: 'role', label: 'Role', type: 'badge' },
        { key: 'served_orders', label: 'Orders Served', type: 'number', align: 'right' },
        { key: 'served_revenue', label: 'Revenue Served', type: 'currency', align: 'right' },
        { key: 'billed_count', label: 'Bills Settled', type: 'number', align: 'right' },
        { key: 'avg_order', label: 'Avg Order', type: 'currency', align: 'right' },
      ],
      rows,
      empty: 'No active employees are on file.',
    },
    notes: [
      'No attendance or tips data exists in this schema, so those columns and the Attendance chart are intentionally absent.',
      'kots.prepared_by is never populated, so kitchen speed is reported per ticket instead of per kitchen staff member.',
    ],
  };
}

async function tablesTab(db, range, f) {
  const servedOrdersPaging = readTablePaging(f, 'served-orders');
  const scope = billScope(db, range, f);
  scope.sql += ' AND o.table_id IS NOT NULL';
  const [tables, perTable, durations, byHour] = await Promise.all([
    safeAll(db, `SELECT id, table_number, capacity, status, section FROM tables WHERE COALESCE(is_active, 1) = 1 ORDER BY table_number`),
    safeAll(db, 
      `SELECT o.table_id AS table_id, COALESCE(o.table_number, '—') AS table_number,
              COUNT(DISTINCT b.id) AS orders, COALESCE(SUM(b.grand_total), 0) AS revenue,
              AVG(${minutesBetween('o.created_at', 'b.paid_at')}) AS avg_minutes
       ${BILL_FROM}${scope.sql}
       GROUP BY o.table_id, COALESCE(o.table_number, '—')
       ORDER BY revenue DESC`,
      scope.params
    ),
    safeAll(db, 
      `SELECT ${minutesBetween('o.created_at', 'b.paid_at')} AS minutes ${BILL_FROM}${scope.sql} AND b.paid_at IS NOT NULL`,
      scope.params
    ),
    safeAll(db, 
      `SELECT ${hourOf(db, 'o.created_at')} AS hour, COUNT(DISTINCT o.id) AS orders
       ${BILL_FROM}${scope.sql}
       GROUP BY ${hourOf(db, 'o.created_at')} ORDER BY hour ASC`,
      scope.params
    ),
  ]);

  const servedOrdersPaged = await queryPaged(db,
    `SELECT o.order_number, COALESCE(o.table_number, '—') AS table_number,
            COALESCE(o.party_label, '') AS party_label,
            b.id AS bill_id, b.bill_number, b.status AS bill_status, b.grand_total, b.paid_at, o.created_at,
            ${minutesBetween('o.created_at', 'b.paid_at')} AS sitting_minutes,
            COALESCE(u.full_name, 'Unassigned') AS waiter_name
     ${BILL_FROM}
     LEFT JOIN users u ON o.waiter_id = u.id
     ${scope.sql}
     ORDER BY b.paid_at DESC, b.created_at DESC`,
    scope.params,
    servedOrdersPaging,
    ['grand_total']
  );

  const byTableId = new Map((perTable || []).map((r) => [r.table_id, r]));
  const dayCount = Math.max(1, eachDay(range).length);
  const totalOrders = (perTable || []).reduce((s, r) => s + num(r, 'orders'), 0);
  const maxOrdersOnATable = Math.max(1, ...(perTable || []).map((r) => num(r, 'orders')));

  const rows = (tables || []).map((t) => {
    const r = byTableId.get(t.id);
    const orders = num(r, 'orders');
    return {
      _record_id: t.id,
      table_number: t.table_number,
      section: t.section || '—',
      capacity: num(t, 'capacity'),
      current_status: t.status || 'available',
      orders,
      revenue: num(r, 'revenue'),
      turnover: orders / dayCount,
      avg_minutes: r?.avg_minutes == null ? null : Math.round(num(r, 'avg_minutes')),
      utilisation: (orders / maxOrdersOnATable) * 100,
    };
  });

  const occupied = (tables || []).filter((t) => ['occupied', 'reserved'].includes(t.status)).length;
  const occupancy = tables?.length ? (occupied / tables.length) * 100 : 0;
  const validDurations = (durations || []).map((d) => num(d, 'minutes')).filter((m) => Number.isFinite(m) && m >= 0);
  const sortedDurations = [...validDurations].sort((a,b) => a-b);
  const middle = Math.floor(sortedDurations.length / 2);
  const medianDining = !sortedDurations.length ? null : sortedDurations.length % 2 ? sortedDurations[middle] : (sortedDurations[middle-1] + sortedDurations[middle]) / 2;
  const avgDining = validDurations.length ? validDurations.reduce((s, m) => s + m, 0) / validDurations.length : 0;
  const revenuePerTable = tables?.length ? rows.reduce((s, r) => s + r.revenue, 0) / tables.length : 0;

  const busiest = rows.slice().sort((a, b) => b.revenue - a.revenue)[0];
  const quietest = rows.slice().sort((a, b) => a.orders - b.orders)[0];
  const peak = (byHour || []).slice().sort((a, b) => num(b, 'orders') - num(a, 'orders'))[0];

  const chips = [];
  if (busiest && busiest.revenue > 0) chips.push({ icon: 'star', text: `Table ${busiest.table_number} earned the most at ${money(busiest.revenue)}` });
  if (avgDining > 0) chips.push({ icon: 'clock', text: `A table is held for ${avgDining.toFixed(0)} minutes on average from order to bill` });
  if (peak) chips.push({ icon: 'clock', text: `${String(num(peak, 'hour')).padStart(2, '0')}:00 sees the highest table demand` });

  const insights = [];
  if (quietest && quietest.orders === 0) {
    const idle = rows.filter((r) => r.orders === 0);
    insights.push({ title: 'Idle tables', body: `${idle.length} table(s) took no orders at all in this period: ${idle.map((r) => r.table_number).slice(0, 5).join(', ')}.`, tone: 'warning' });
  }
  if (totalOrders && tables?.length) {
    insights.push({ title: 'Turnover', body: `Each table turned over ${(totalOrders / tables.length / dayCount).toFixed(1)} time(s) per day on average.`, tone: 'neutral' });
  }
  if (avgDining > 75) insights.push({ title: 'Long sittings', body: `An average sitting of ${avgDining.toFixed(0)} minutes limits how many covers you can serve at peak.`, tone: 'warning' });
  if (busiest && quietest && busiest.revenue > 0) {
    insights.push({ title: 'Uneven demand', body: `Table ${busiest.table_number} outsells table ${quietest.table_number} by ${money((busiest.revenue - quietest.revenue))} — check seating flow and section coverage.`, tone: 'neutral' });
  }

  return {
    chips,
    kpis: [
      { key: 'occupancy', label: 'Occupancy Now', value: occupancy, format: 'percent', sub: `${occupied} of ${tables?.length || 0} tables`, highlight: true },
      { key: 'turnover', label: 'Turnover / Table / Day', value: tables?.length ? totalOrders / tables.length / dayCount : 0, format: 'decimal' },
      { key: 'dining', label: 'Average Dining Time', value: avgDining || null, format: 'minutes', sub: avgDining ? 'order placed to bill settled' : 'no settled bills to measure' },
      { key: 'median_dining', label: 'Median Sitting Time', value: medianDining, format: 'minutes' },
      { key: 'longest_dining', label: 'Longest Sitting Time', value: sortedDurations.at(-1) ?? null, format: 'minutes' },
      { key: 'over_60', label: 'Sittings over 60 minutes', value: validDurations.filter((m) => m > 60).length, format: 'number' },
      { key: 'over_120', label: 'Sittings over 120 minutes', value: validDurations.filter((m) => m > 120).length, format: 'number' },
      { key: 'revenue', label: 'Revenue per Table', value: revenuePerTable, format: 'currency' },
    ],
    charts: {
      usage: rows.map((r) => ({ label: r.table_number, value: r.orders })),
      peakOccupancy: (byHour || []).map((r) => ({ label: `${String(num(r, 'hour')).padStart(2, '0')}:00`, value: num(r, 'orders') })),
      duration: rows.filter((r) => r.avg_minutes != null).map((r) => ({ label: r.table_number, value: r.avg_minutes })),
    },
    insights,
    tables: [
      {
        id: 'table-performance',
        title: 'Table Performance',
        columns: [
          { key: 'table_number', label: 'Table' },
          { key: 'section', label: 'Section' },
          { key: 'capacity', label: 'Seats', type: 'number', align: 'right' },
          { key: 'current_status', label: 'Status', type: 'status' },
          { key: 'orders', label: 'Orders', type: 'number', align: 'right' },
          { key: 'revenue', label: 'Revenue', type: 'currency', align: 'right' },
          { key: 'avg_minutes', label: 'Avg sitting', type: 'minutes', align: 'right' },
          { key: 'utilisation', label: 'Utilisation', type: 'percent', align: 'right' },
        ],
        rows,
        empty: 'No tables have been set up yet.',
      },
      withPagination({
        id: 'served-orders',
        title: 'Orders Served by Table',
        columns: [
          { key: 'created_at', label: 'Seated', type: 'datetime' },
          { key: 'paid_at', label: 'Served / Paid', type: 'datetime' },
          { key: 'table_number', label: 'Table' },
          { key: 'party_label', label: 'Party' },
          { key: 'order_number', label: 'Order' },
          { key: 'bill_number', label: 'Bill' },
          { key: 'bill_status', label: 'Status', type: 'status' },
          { key: 'waiter_name', label: 'Waiter' },
          { key: 'sitting_minutes', label: 'At table', type: 'minutes', align: 'right' },
          { key: 'grand_total', label: 'Amount', type: 'currency', align: 'right' },
        ],
        rows: servedOrdersPaged.rows.map((r) => ({
          _bill_id: r.bill_id,
          created_at: r.created_at,
          paid_at: r.paid_at,
          bill_status: r.bill_status,
          table_number: r.table_number || '—',
          party_label: r.party_label || '—',
          order_number: r.order_number || '—',
          bill_number: r.bill_number || '—',
          waiter_name: r.waiter_name || 'Unassigned',
          sitting_minutes: r.sitting_minutes == null ? null : Math.round(num(r, 'sitting_minutes')),
          grand_total: num(r, 'grand_total'),
        })),
        empty: 'No served table orders were settled in the selected period.',
      }, servedOrdersPaged),
    ],
  };
}

async function reservationsTab(db, range, f) {
  const detailPaging = readTablePaging(f, 'detail');
  /*
   * A business day is a calendar date here — reservations are booked against
   * `r.date`, not a timestamp, so selecting a business day narrows to that
   * day's bookings. Search covers who booked and where they were seated.
   * The rest of the filter bar has nothing to bind to on a booking; that is
   * declared in FILTER_SUPPORT so the UI can say so.
   */
  const bookingDate = f.businessDayId ? range.start : null;
  let dateWhere = bookingDate ? 'r.date = ?' : 'r.date BETWEEN ? AND ?';
  const params = bookingDate ? [bookingDate] : [range.start, range.end];
  if (f.search) {
    const like = `%${String(f.search).toLowerCase()}%`;
    dateWhere += ` AND (LOWER(COALESCE(r.name, '')) LIKE ? OR LOWER(COALESCE(r.phone, '')) LIKE ?)`;
    params.push(like, like);
  }
  const [statusRows, sourceRows, daily, hours] = await Promise.all([
    safeAll(db, `SELECT COALESCE(r.status, 'new') AS status, COUNT(*) AS count FROM reservations r WHERE ${dateWhere} GROUP BY COALESCE(r.status, 'new')`, params),
    safeAll(db, `SELECT COALESCE(r.source, 'web') AS source, COUNT(*) AS count FROM reservations r WHERE ${dateWhere} GROUP BY COALESCE(r.source, 'web')`, params),
    safeAll(db, `SELECT r.date AS d, COUNT(*) AS count FROM reservations r WHERE ${dateWhere} GROUP BY r.date`, params),
    safeAll(db, `SELECT SUBSTR(COALESCE(r.time, '00:00'), 1, 2) AS hour, COUNT(*) AS count FROM reservations r WHERE ${dateWhere} GROUP BY SUBSTR(COALESCE(r.time, '00:00'), 1, 2) ORDER BY hour`, params),
  ]);

  const reservationsPaged = await queryPaged(db,
    `SELECT r.id, r.name, r.phone, r.date, r.time, r.party_size, r.guests, r.status, r.source,
            r.checked_in_at, r.seated_at, t.table_number
     FROM reservations r
     LEFT JOIN tables t ON r.table_id = t.id
     WHERE ${dateWhere}
     ORDER BY r.date DESC, r.time DESC`,
    params,
    detailPaging
  );

  const counts = {};
  for (const r of statusRows || []) counts[r.status] = num(r, 'count');
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  const walkIns = (sourceRows || []).filter((r) => r.source !== 'web').reduce((s, r) => s + num(r, 'count'), 0);
  const noShows = counts.no_show || 0;
  const cancelled = counts.cancelled || 0;

  const chips = [];
  if (!total) {
    chips.push({ icon: 'info', text: 'The reservation book is empty for this date range' });
  } else {
    chips.push({ icon: 'info', text: `${total} booking(s) fall in this period` });
    chips.push({ icon: noShows ? 'warn' : 'up', text: `${noShows} no-show(s) — ${Math.round((noShows / total) * 100)}% of bookings` });
    const busiest = (daily || []).slice().sort((a, b) => num(b, 'count') - num(a, 'count'))[0];
    if (busiest) chips.push({ icon: 'clock', text: `${busiest.d} is the busiest booking day with ${num(busiest, 'count')} reservations` });
  }

  const insights = [];
  if (!total) {
    insights.push({
      title: 'No bookings recorded',
      body: 'The reservations book is empty for this date range. Reservations arrive through the public booking form and the Host Desk; once bookings exist, arrival hours, no-show rate and busiest days appear here.',
      tone: 'neutral',
    });
  } else {
    if (cancelled) insights.push({ title: 'Cancellations', body: `${cancelled} booking(s) were cancelled, a ${Math.round((cancelled / total) * 100)}% cancellation rate.`, tone: 'warning' });
    if (counts.completed) insights.push({ title: 'Completed sittings', body: `${counts.completed} booking(s) ran through to completion.`, tone: 'positive' });
    if (walkIns) insights.push({ title: 'Walk-in mix', body: `${walkIns} booking(s) were logged from a source other than the web form.`, tone: 'neutral' });
  }

  const days = eachDay(range);
  const dailyMap = new Map((daily || []).map((r) => [dateKey(r.d), num(r, 'count')]));

  return {
    chips,
    kpis: [
      { key: 'reservations', label: 'Reservations', value: total, format: 'number' },
      { key: 'walkins', label: 'Walk-ins', value: walkIns, format: 'number' },
      { key: 'noshows', label: 'No Shows', value: noShows, format: 'number', tone: 'negative' },
      { key: 'cancelRate', label: 'Cancellation Rate', value: total ? (cancelled / total) * 100 : 0, format: 'percent' },
    ],
    charts: {
      trend: days.map((d) => ({ label: d.day, sub: d.date, value: dailyMap.get(d.date) || 0 })),
      arrivalHours: (hours || []).map((r) => ({ label: `${r.hour}:00`, value: num(r, 'count') })),
      busyDays: days.map((d) => ({ label: d.day, value: dailyMap.get(d.date) || 0 })),
    },
    insights,
    table: withPagination({
      id: 'detail',
      title: 'Reservations',
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'time', label: 'Time' },
        { key: 'name', label: 'Customer' },
        { key: 'party_size', label: 'Guests', type: 'number', align: 'right' },
        { key: 'status', label: 'Status', type: 'status' },
        { key: 'table_number', label: 'Assigned Table' },
        { key: 'wait_minutes', label: 'Wait (min)', type: 'number', align: 'right' },
      ],
      rows: reservationsPaged.rows.map((r) => {
        let wait = null;
        if (r.checked_in_at && r.seated_at) {
          const diff = (new Date(r.seated_at) - new Date(r.checked_in_at)) / 60000;
          if (Number.isFinite(diff) && diff >= 0) wait = Math.round(diff);
        }
        return {
          _record_id: r.id,
          date: r.date,
          time: r.time || '—',
          name: r.name,
          party_size: num(r, 'party_size') || r.guests || 0,
          status: r.status || 'new',
          table_number: r.table_number || 'Unassigned',
          wait_minutes: wait,
        };
      }),
      empty: 'No reservations match your filters for this period.',
    }, reservationsPaged),
  };
}

async function suppliersTab(db, range, f) {
  const purchaseHistoryPaging = readTablePaging(f, 'purchase-history');
  /*
   * Supplier spend is read from `expenses`, which carries business_day_id,
   * payment_method and a free-text supplier — so the business-day, payment-method
   * and search filters all bind here. Employee, menu-category and order-type do
   * not exist on an expense; declared in FILTER_SUPPORT.
   */
  const scope = f.businessDayId
    ? { sql: 'business_day_id = ?', params: [f.businessDayId] }
    : { sql: "COALESCE(purchase_date, CAST(expense_date AS TEXT)) BETWEEN ? AND ?", params: [range.start, range.end] };
  let where = `${scope.sql} AND LOWER(COALESCE(status,'active'))<>'voided'`;
  const params = [...scope.params];
  if (f.paymentMethod) {
    const bucket = normalizePaymentFilterBucket(f.paymentMethod);
    if (bucket) {
      where += ` AND ${paymentColumnMatchesBucketSql("COALESCE(payment_method, 'cash')", bucket)}`;
    }
  }
  if (f.search) {
    const like = `%${String(f.search).toLowerCase()}%`;
    where += " AND (LOWER(COALESCE(supplier, '')) LIKE ? OR LOWER(COALESCE(description, '')) LIKE ? OR LOWER(COALESCE(category, '')) LIKE ?)";
    params.push(like, like, like);
  }
  // Aliased copy for the one query that prefixes columns with `e.`
  const whereE = where.replace(/(^|[\s(])(business_day_id|purchase_date|expense_date|payment_method|supplier|description|category|status)/g, '$1e.$2');
  const [bySupplier, daily, stocked] = await Promise.all([
    safeAll(db, 
      `SELECT COALESCE(NULLIF(TRIM(supplier), ''), 'Unattributed') AS supplier,
              COUNT(*) AS purchases, COALESCE(SUM(amount), 0) AS amount,
              MAX(COALESCE(purchase_date, CAST(expense_date AS TEXT))) AS last_purchase
       FROM expenses
       WHERE ${where}
       GROUP BY COALESCE(NULLIF(TRIM(supplier), ''), 'Unattributed')
       ORDER BY amount DESC`,
      params
    ),
    safeAll(db, 
      `SELECT COALESCE(purchase_date, CAST(expense_date AS TEXT)) AS d, COALESCE(SUM(amount), 0) AS amount
       FROM expenses
       WHERE ${where}
       GROUP BY COALESCE(purchase_date, CAST(expense_date AS TEXT))`,
      params
    ),
    safeAll(db,
      `SELECT COALESCE(NULLIF(TRIM(supplier), ''), 'Unattributed') AS supplier,
              COUNT(*) AS items,
              COALESCE(SUM(COALESCE(quantity, 0) * COALESCE(cost_per_unit, 0)), 0) AS stock_value
       FROM inventory_items
       GROUP BY COALESCE(NULLIF(TRIM(supplier), ''), 'Unattributed')`
    ),
  ]);

  const supplierLedgerPaged = await queryPaged(db,
    `SELECT e.id, e.description, e.category, e.amount, e.payment_method,
            COALESCE(NULLIF(TRIM(e.supplier), ''), 'Unattributed') AS supplier,
            COALESCE(e.purchase_date, CAST(e.expense_date AS TEXT)) AS spent_on
     FROM expenses e
     WHERE ${whereE}
     ORDER BY COALESCE(e.purchase_date, CAST(e.expense_date AS TEXT)) DESC`,
    params,
    purchaseHistoryPaging,
    ['amount']
  );
  const supplierPaySplit = await safeAll(db,
    `SELECT ${paymentBucketSql("COALESCE(e.payment_method,'cash')")} AS bucket,
            COALESCE(SUM(e.amount), 0) AS amount
       FROM expenses e
      WHERE ${whereE}
      GROUP BY ${paymentBucketSql("COALESCE(e.payment_method,'cash')")}`,
    params
  );
  supplierLedgerPaged.paymentTotals = { cash: 0, digital: 0, credit: 0, funding: 0 };
  for (const row of supplierPaySplit || []) {
    const bucket = String(row.bucket || '');
    if (bucket in supplierLedgerPaged.paymentTotals) supplierLedgerPaged.paymentTotals[bucket] = num(row, 'amount');
  }
  const stockBySupplier = new Map((stocked || []).map((r) => [r.supplier, r]));
  const total = (bySupplier || []).reduce((s, r) => s + num(r, 'amount'), 0);
  const named = (bySupplier || []).filter((r) => r.supplier !== 'Unattributed');

  const chips = [];
  chips.push({ icon: 'wallet', text: `${money(total)} spent with ${named.length} supplier(s) this period` });
  if (bySupplier?.[0]) chips.push({ icon: 'star', text: `${bySupplier[0].supplier} took the largest share at ${money(num(bySupplier[0], 'amount'))}` });
  if (total && (bySupplier || []).length) chips.push({ icon: 'info', text: `Average purchase value is ${money((total / (bySupplier || []).reduce((s, r) => s + num(r, 'purchases'), 0)))}` });

  const insights = [];
  if (bySupplier?.[0] && total) {
    insights.push({ title: 'Supplier concentration', body: `${bySupplier[0].supplier} accounts for ${Math.round((num(bySupplier[0], 'amount') / total) * 100)}% of period spend — a single point of failure if they miss a delivery.`, tone: 'warning' });
  }
  const unattributedStock = stockBySupplier.get('Unattributed');
  if (unattributedStock) {
    insights.push({ title: 'Unsourced stock', body: `${num(unattributedStock, 'items')} raw material(s) worth ${money(num(unattributedStock, 'stock_value'))} have no supplier on file.`, tone: 'neutral' });
  }
  insights.push({
    title: 'Not tracked in this system',
    body: 'Suppliers are free-text fields on expenses and inventory items — there is no supplier record, invoice due date, payment status or delivery timestamp. Outstanding balances, average delivery time and price-change history therefore cannot be reported.',
    tone: 'neutral',
  });

  const days = eachDay(range);
  const dailyMap = new Map((daily || []).map((r) => [dateKey(r.d), num(r, 'amount')]));
  const purchaseCount = (bySupplier || []).reduce((s, r) => s + num(r, 'purchases'), 0);

  return {
    chips,
    kpis: [
      { key: 'purchases', label: 'Purchases', value: total, format: 'currency', sub: `${purchaseCount} entries`, highlight: true },
      { key: 'suppliers', label: 'Suppliers Used', value: named.length, format: 'number' },
      { key: 'avg', label: 'Average Purchase', value: purchaseCount ? total / purchaseCount : 0, format: 'currency' },
      { key: 'top', label: 'Largest Supplier', value: bySupplier?.[0]?.supplier || null, format: 'text', sub: bySupplier?.[0] ? `${money(num(bySupplier[0], 'amount'))}` : null },
    ],
    charts: {
      overTime: days.map((d) => ({ label: d.day, sub: d.date, value: dailyMap.get(d.date) || 0 })),
      spend: (bySupplier || []).map((r) => ({ label: r.supplier, value: num(r, 'amount'), meta: `${num(r, 'purchases')} purchases` })),
      topSuppliers: (bySupplier || []).slice(0, 5).map((r) => ({ label: r.supplier, value: num(r, 'purchases'), meta: `${money(num(r, 'amount'))}` })),
    },
    insights,
    tables: [
      withPagination({
        id: 'purchase-history',
        title: 'Purchase History',
        columns: [
          { key: 'spent_on', label: 'Date' },
          { key: 'supplier', label: 'Supplier' },
          { key: 'description', label: 'Description' },
          { key: 'category', label: 'Category', type: 'badge' },
          { key: 'payment_method', label: 'Paid by' },
          { key: 'amount', label: 'Amount', type: 'currency', align: 'right' },
        ],
        rows: supplierLedgerPaged.rows.map((r) => ({
          _record_id: r.id,
          spent_on: r.spent_on,
          supplier: r.supplier,
          description: r.description || '—',
          category: String(r.category || 'other').replace(/_/g, ' '),
          payment_method: paymentMethodLabel(r.payment_method),
          amount: num(r, 'amount'),
        })),
        empty: 'No purchases were recorded against any supplier in this period.',
      }, supplierLedgerPaged),
      {
        id: 'supplier-ledger',
        title: 'Supplier Ledger',
        columns: [
          { key: 'supplier', label: 'Supplier' },
          { key: 'purchases', label: 'Purchases', type: 'number', align: 'right' },
          { key: 'amount', label: 'Total Spend', type: 'currency', align: 'right' },
          { key: 'share', label: 'Share', type: 'percent', align: 'right' },
          { key: 'items_supplied', label: 'Items Supplied', type: 'number', align: 'right' },
          { key: 'stock_value', label: 'Stock On Hand', type: 'currency', align: 'right' },
          { key: 'last_purchase', label: 'Last Purchase' },
        ],
        rows: (bySupplier || []).map((r) => {
          const stock = stockBySupplier.get(r.supplier);
          return {
            supplier: r.supplier,
            purchases: num(r, 'purchases'),
            amount: num(r, 'amount'),
            share: total ? (num(r, 'amount') / total) * 100 : 0,
            items_supplied: num(stock, 'items'),
            stock_value: num(stock, 'stock_value'),
            last_purchase: r.last_purchase || '—',
          };
        }),
        empty: 'No supplier activity has been recorded for this period.',
      },
    ],
    notes: [
      'Outstanding Payments and Price Changes tables are omitted: expenses carry no due date, payment status or per-unit price history, so both would be fabricated.',
      'Average Delivery Time is omitted: nothing in this schema records when an order was placed with a supplier versus when it arrived.',
    ],
  };
}

/* ------------------------------------------------------------------ */

/**
 * Everything reversed, rewritten or given away in the period.
 *
 * A thin tab on purpose: it reuses buildOrderOperationsAnalytics(), the same
 * builder the Analytics screen uses, so the exception log cannot drift between
 * the two surfaces. Loaded lazily and only when this tab is opened — it is a
 * heavy multi-query build that the other ten tabs must not pay for.
 */
async function changesTab(db, range, f) {
  const { buildOrderOperationsAnalytics } = await import('./order-operations-analytics.js');
  const operations = await buildOrderOperationsAnalytics(db, range, f.businessDayId || null)
    .catch(() => null);
  const s = operations?.summary || {};
  const cancelledOrderRows = (operations?.cancelledOrders || []).map((row) => ({
    cancelled_at: row.cancelledAt || row.updatedAt,
    order_number: row.orderNumber,
    order_type: row.orderType,
    table: row.table,
    quantity: num(row, 'quantity'),
    value: num(row, 'originalValue'),
    cancelled_by: row.cancelledBy || 'Not persisted',
    reason: row.reason || 'Not recorded',
  }));
  const itemChangeRows = (operations?.itemChanges || []).map((row) => ({
    created_at: row.createdAt,
    order_number: row.orderNumber,
    item: row.item,
    action: String(row.action || '').replace(/_/g, ' '),
    quantity: num(row, 'quantity'),
    value_difference: row.valueDifference == null ? null : num(row, 'valueDifference'),
    actor: row.actor || 'Not persisted',
    reason: row.reason || 'Not recorded',
  }));
  const correctionRows = (operations?.corrections || []).map((row) => ({
    _bill_id: row.billId,
    created_at: row.createdAt,
    type: row.type,
    bill_number: row.billNumber,
    order_number: row.orderNumber,
    original_amount: num(row, 'originalAmount'),
    amount: num(row, 'amount'),
    payment_methods: row.originalMethods?.join(' + ') || 'Not recorded',
    actor: row.actor || 'Not persisted',
    reason: row.reason || 'Not recorded',
  }));
  const revisionRows = (operations?.revisions || []).map((row) => ({
    _bill_id: row.billId,
    created_at: row.createdAt,
    bill_number: row.billNumber,
    order_number: row.orderNumber,
    status: row.status,
    original_total: num(row, 'originalTotal'),
    new_total: num(row, 'newTotal'),
    difference: num(row, 'delta'),
    created_by: row.createdBy || 'Not persisted',
    reason: row.reason || 'Not recorded',
  }));
  const discountRows = (operations?.discounts || []).map((row) => ({
    _bill_id: row.id,
    created_at: row.createdAt,
    bill_number: row.billNumber,
    order_number: row.orderNumber,
    order_type: row.orderType,
    gross: num(row, 'gross'),
    discount: num(row, 'discount'),
    discount_percent: num(row, 'discountPercent'),
    net_items: num(row, 'netItemValue'),
    cashier: row.cashier || 'Not persisted',
    reason: row.discountReason || 'Not recorded',
  }));
  const editLabels = {
    order_changed_table: 'Table changed',
    party_label_changed: 'Party name changed',
    delivery_executive_changed: 'Delivery rider changed',
    item_added: 'Item added',
    item_edited: 'Item edited',
    item_removed: 'Item removed',
    kot_item_cancelled: 'Kitchen item cancelled',
    bill_reopened_to_pos: 'Bill reopened',
    settlement_revised: 'Customer / payment revised',
    revision_supplement_due: 'Reopened total increased',
    revision_refund_due: 'Reopened total reduced',
    revision_finalized: 'Revision finalized',
    revision_cancelled: 'Revision cancelled',
    payment_added: 'Reopen payment added',
    reopen_settled: 'Reopened bill settled',
    reopen_refund_settled: 'Reopen refund settled',
  };
  const editActions = new Set(Object.keys(editLabels));
  const summarizeEditValue = (value) => {
    if (value == null || value === '') return '—';
    if (typeof value !== 'object') return String(value);
    const payments = value.allocations || value.payments;
    const parts = [];
    if (Array.isArray(payments)) {
      parts.push(payments.map((payment) => {
        const method = String(payment.method || payment.payment_method || 'payment').replace(/_/g, ' ');
        const amount = Number(payment.amount);
        return Number.isFinite(amount) ? `${method} Rs ${amount.toLocaleString('en-IN')}` : method;
      }).join(' + '));
    }
    if (value.customer_name) parts.push(`Customer: ${value.customer_name}`);
    if (value.orderStatus || value.billStatus) parts.push([value.orderStatus, value.billStatus].filter(Boolean).join(' / '));
    if (value.grandTotal != null) parts.push(`Rs ${Number(value.grandTotal).toLocaleString('en-IN')}`);
    if (value.item_name) parts.push(`${value.quantity || 1}× ${value.item_name}`);
    if (value.quantity != null && !value.item_name) parts.push(`Qty ${value.quantity}`);
    return parts.filter(Boolean).join(' · ') || 'Recorded details';
  };
  const editedOrderRows = (operations?.timeline || [])
    .filter((row) => editActions.has(row.action))
    .map((row) => ({
      _bill_id: row.billId || null,
      changed_at: row.createdAt,
      order_number: row.orderNumber || (row.orderId ? `Order ${row.orderId}` : '—'),
      bill_number: row.billId ? (operations?.bills || []).find((bill) => Number(bill.id) === Number(row.billId))?.billNumber || `Bill ${row.billId}` : '—',
      area: row.entity || 'Order',
      action: editLabels[row.action] || String(row.action || '').replace(/_/g, ' '),
      before: summarizeEditValue(row.before),
      after: summarizeEditValue(row.detail || row.after),
      actor: row.actor || 'Not persisted',
      reason: row.reason || 'No reason recorded',
    }));
  const cancelledOrders = paginateList(cancelledOrderRows, readTablePaging(f, 'cancelled-orders'), ['quantity', 'value']);
  const itemChanges = paginateList(itemChangeRows, readTablePaging(f, 'item-changes'), ['quantity', 'value_difference']);
  const editedOrders = paginateList(editedOrderRows, readTablePaging(f, 'edited-orders'));
  const corrections = paginateList(correctionRows, readTablePaging(f, 'voids-refunds'), ['original_amount', 'amount']);
  const revisions = paginateList(revisionRows, readTablePaging(f, 'bill-revisions'), ['original_total', 'new_total', 'difference']);
  const discounts = paginateList(discountRows, readTablePaging(f, 'discounted-bills'), ['gross', 'discount', 'net_items']);
  return {
    orderOperations: operations,
    kpis: [
      { key: 'cancelled_orders', label: 'Cancelled Orders', value: num(s, 'cancelledOrders'), format: 'number', hint: 'Orders cancelled before they were billed.' },
      { key: 'voided_bills', label: 'Voided Bills', value: num(s, 'voidedBills'), format: 'currency', hint: 'Bills that should never have existed. Value shown under Void Value.' },
      { key: 'void_value', label: 'Void Value', value: num(s, 'voidValue'), format: 'currency', hint: 'Money reversed by voiding bills.' },
      { key: 'refund_value', label: 'Refund Value', value: num(s, 'refundValue'), format: 'currency', hint: 'Money returned after the sale.' },
      { key: 'discount_given', label: 'Discount Given', value: num(s, 'discountAmount'), format: 'currency', hint: 'Total discounted away across ' + num(s, 'discountedBills') + ' bill(s).' },
    ],
    insights: [],
    chips: [],
    tables: [
      withPagination({
        id: 'cancelled-orders',
        title: 'Cancelled Orders',
        columns: [
          { key: 'cancelled_at', label: 'Cancelled', type: 'datetime' },
          { key: 'order_number', label: 'Order' },
          { key: 'order_type', label: 'Type', type: 'badge' },
          { key: 'table', label: 'Table' },
          { key: 'quantity', label: 'Qty', type: 'number', align: 'right' },
          { key: 'value', label: 'Value', type: 'currency', align: 'right' },
          { key: 'cancelled_by', label: 'Cancelled by' },
          { key: 'reason', label: 'Reason' },
        ],
        rows: cancelledOrders.rows,
        empty: 'No orders were cancelled in the selected period.',
      }, cancelledOrders),
      withPagination({
        id: 'edited-orders',
        title: 'Edited Orders',
        columns: [
          { key: 'changed_at', label: 'Changed', type: 'datetime' },
          { key: 'order_number', label: 'Order' },
          { key: 'bill_number', label: 'Bill' },
          { key: 'area', label: 'Area', type: 'badge' },
          { key: 'action', label: 'Action', type: 'badge' },
          { key: 'before', label: 'Before' },
          { key: 'after', label: 'After / detail' },
          { key: 'actor', label: 'Changed by' },
          { key: 'reason', label: 'Reason' },
        ],
        rows: editedOrders.rows,
        empty: 'No customer, payment, reopen, table or item edits were recorded in the selected period.',
      }, editedOrders),
      withPagination({
        id: 'item-changes',
        title: 'Cancelled & Changed Items',
        columns: [
          { key: 'created_at', label: 'Changed', type: 'datetime' },
          { key: 'order_number', label: 'Order' },
          { key: 'item', label: 'Item' },
          { key: 'action', label: 'Action', type: 'badge' },
          { key: 'quantity', label: 'Qty', type: 'number', align: 'right' },
          { key: 'value_difference', label: 'Value Change', type: 'currency', align: 'right' },
          { key: 'actor', label: 'Changed by' },
          { key: 'reason', label: 'Reason' },
        ],
        rows: itemChanges.rows,
        empty: 'No item cancellations or changes were recorded in the selected period.',
      }, itemChanges),
      withPagination({
        id: 'voids-refunds',
        title: 'Bill Voids & Refunds',
        columns: [
          { key: 'created_at', label: 'Corrected', type: 'datetime' },
          { key: 'type', label: 'Action', type: 'badge' },
          { key: 'bill_number', label: 'Bill' },
          { key: 'order_number', label: 'Order' },
          { key: 'original_amount', label: 'Original', type: 'currency', align: 'right' },
          { key: 'amount', label: 'Corrected', type: 'currency', align: 'right' },
          { key: 'payment_methods', label: 'Original payment' },
          { key: 'actor', label: 'Corrected by' },
          { key: 'reason', label: 'Reason' },
        ],
        rows: corrections.rows,
        empty: 'No bill voids or refunds were recorded in the selected period.',
      }, corrections),
      withPagination({
        id: 'bill-revisions',
        title: 'Reopened & Revised Bills',
        columns: [
          { key: 'created_at', label: 'Reopened', type: 'datetime' },
          { key: 'bill_number', label: 'Bill' },
          { key: 'order_number', label: 'Order' },
          { key: 'status', label: 'Status', type: 'status' },
          { key: 'original_total', label: 'Original', type: 'currency', align: 'right' },
          { key: 'new_total', label: 'New Total', type: 'currency', align: 'right' },
          { key: 'difference', label: 'Difference', type: 'currency', align: 'right' },
          { key: 'created_by', label: 'Reopened by' },
          { key: 'reason', label: 'Reason' },
        ],
        rows: revisions.rows,
        empty: 'No bills were reopened or revised in the selected period.',
      }, revisions),
      withPagination({
        id: 'discounted-bills',
        title: 'Discounted Bills',
        columns: [
          { key: 'created_at', label: 'Billed', type: 'datetime' },
          { key: 'bill_number', label: 'Bill' },
          { key: 'order_number', label: 'Order' },
          { key: 'order_type', label: 'Type', type: 'badge' },
          { key: 'gross', label: 'Before Discount', type: 'currency', align: 'right' },
          { key: 'discount', label: 'Discount', type: 'currency', align: 'right' },
          { key: 'discount_percent', label: 'Discount %', type: 'percent', align: 'right' },
          { key: 'net_items', label: 'After Discount', type: 'currency', align: 'right' },
          { key: 'cashier', label: 'Cashier' },
          { key: 'reason', label: 'Reason' },
        ],
        rows: discounts.rows,
        empty: 'No discounts were recorded in the selected period.',
      }, discounts),
    ],
  };
}

async function purchasesTab(db, range, f) {
  const purchasesPaging = readTablePaging(f, 'purchases');
  let where = f.businessDayId
    ? 'e.business_day_id = ?'
    : "COALESCE(p.invoice_date, CAST(date(p.created_at, '+5 hours', '+45 minutes') AS TEXT)) BETWEEN ? AND ?";
  const params = f.businessDayId ? [f.businessDayId] : [range.start, range.end];
  if (f.employeeId) { where += ' AND p.received_by = ?'; params.push(f.employeeId); }
  if (f.paymentMethod) {
    const bucket = normalizePaymentFilterBucket(f.paymentMethod);
    if (bucket) {
      where += ` AND ${paymentColumnMatchesBucketSql("COALESCE(e.payment_method,'cash')", bucket)}`;
    }
  }
  if (f.search) {
    const like = `%${String(f.search).toLowerCase()}%`;
    where += " AND (LOWER(COALESCE(p.invoice_number,'')) LIKE ? OR LOWER(COALESCE(s.name,p.supplier,'')) LIKE ? OR LOWER(COALESCE(p.notes,'')) LIKE ?)";
    params.push(like, like, like);
  }
  const [whole] = await Promise.all([safeGet(db,
    `SELECT COALESCE(SUM(CASE WHEN COALESCE(scoped.status,'received') <> 'voided' THEN scoped.total ELSE 0 END),0) AS total,
            COALESCE(SUM(CASE WHEN COALESCE(scoped.status,'received') <> 'voided' THEN 1 ELSE 0 END),0) AS records,
            COALESCE(SUM(CASE WHEN COALESCE(scoped.status,'received') <> 'voided' THEN scoped.line_count ELSE 0 END),0) AS items,
            COALESCE(SUM(CASE WHEN COALESCE(scoped.status,'received') <> 'voided' THEN scoped.quantity_received ELSE 0 END),0) AS quantity_received,
            COALESCE(SUM(CASE WHEN scoped.status = 'voided' THEN 1 ELSE 0 END),0) AS voided
     FROM (
       SELECT p.id,p.status,p.total,COUNT(pi.id) AS line_count,COALESCE(SUM(pi.quantity_received),0) AS quantity_received
       FROM purchases p
       LEFT JOIN suppliers s ON s.id=p.supplier_id
       LEFT JOIN users u ON u.id=p.received_by
       LEFT JOIN purchase_items pi ON pi.purchase_id=p.id
       LEFT JOIN expenses e ON e.source_type='purchase' AND e.source_id=p.id
       WHERE ${where}
       GROUP BY p.id,p.status,p.total
     ) scoped`,
    params
  )]);

  const purchasesPaged = await queryPaged(db,
    `SELECT p.id,p.invoice_number,p.invoice_date,p.created_at,p.status,p.total,
            COALESCE(s.name,p.supplier,'Unattributed') AS supplier,
            COALESCE(e.payment_method,'cash') AS payment_method,
            COALESCE(u.full_name,'System') AS received_by_name,
            COUNT(pi.id) AS line_count,COALESCE(SUM(pi.quantity_received),0) AS quantity_received
     FROM purchases p
     LEFT JOIN suppliers s ON s.id=p.supplier_id
     LEFT JOIN users u ON u.id=p.received_by
     LEFT JOIN purchase_items pi ON pi.purchase_id=p.id
     LEFT JOIN expenses e ON e.source_type='purchase' AND e.source_id=p.id
     WHERE ${where}
     GROUP BY p.id,p.invoice_number,p.invoice_date,p.created_at,p.status,p.total,s.name,p.supplier,e.payment_method,u.full_name
     ORDER BY COALESCE(p.invoice_date,CAST(p.created_at AS TEXT)) DESC,p.id DESC`,
    params,
    purchasesPaging,
    ['line_count', 'quantity_received', 'total']
  );

  // Voided purchases stay visible in the list (audit trail, badged "voided")
  // but must not inflate the footer. queryPaged sums every listed row, so
  // override the footer totals with the voided-excluded figures that the KPIs
  // and Analytics already use — otherwise the report reads higher than reality.
  purchasesPaged.columnTotals = {
    total: num(whole, 'total'),
    line_count: num(whole, 'items'),
    quantity_received: num(whole, 'quantity_received'),
  };

  const paySplit = await safeAll(db,
    `SELECT ${paymentBucketSql("COALESCE(e.payment_method,'cash')")} AS bucket,
            COALESCE(SUM(p.total), 0) AS amount
       FROM purchases p
       LEFT JOIN expenses e ON e.source_type='purchase' AND e.source_id=p.id
       LEFT JOIN suppliers s ON s.id=p.supplier_id
      WHERE ${where} AND COALESCE(p.status,'received') <> 'voided'
      GROUP BY ${paymentBucketSql("COALESCE(e.payment_method,'cash')")}`,
    params
  );
  purchasesPaged.paymentTotals = { cash: 0, digital: 0, credit: 0, funding: 0 };
  for (const row of paySplit || []) {
    const bucket = String(row.bucket || '');
    if (bucket in purchasesPaged.paymentTotals) purchasesPaged.paymentTotals[bucket] = num(row, 'amount');
  }
  // Credit purchases paid later via Accounts Payable move to the method that
  // paid them; only what is still owed stays under Credit.
  const [creditIds, settlements] = await Promise.all([
    safeAll(db,
      `SELECT DISTINCT p.id
         FROM purchases p
         LEFT JOIN expenses e ON e.source_type='purchase' AND e.source_id=p.id
         LEFT JOIN suppliers s ON s.id=p.supplier_id
        WHERE ${where} AND COALESCE(p.status,'received') <> 'voided'
          AND ${paymentColumnMatchesBucketSql("COALESCE(e.payment_method,'cash')", 'credit')}`,
      params
    ),
    safe(creditPurchaseSettlements(db), new Map()),
  ]);
  applyCreditSettlements(purchasesPaged.paymentTotals, (creditIds || []).map((r) => r.id), settlements);

  return {
    chips: [{ icon: 'info', text: 'Period and totals use the invoice date' }],
    kpis: [
      { key: 'total', label: 'Purchase Value', value: num(whole, 'total'), format: 'currency', sub: 'Invoice-date basis', highlight: true },
      { key: 'records', label: 'Purchases in Period', value: num(whole, 'records'), format: 'number', sub: 'By invoice date' },
      { key: 'items', label: 'Item Lines', value: num(whole, 'items'), format: 'number' },
      { key: 'voided', label: 'Voided Purchases', value: num(whole, 'voided'), format: 'number' },
    ],
    charts: {},
    insights: [],
    tables: [withPagination({
      id: 'purchases', title: 'Purchases',
      columns: [
        { key: 'invoice_date', label: 'Invoice Date', type: 'date' },
        { key: 'recorded_at', label: 'Recorded At', type: 'datetime' },
        { key: 'invoice_number', label: 'Invoice' }, { key: 'supplier', label: 'Supplier' },
        { key: 'status', label: 'Status', type: 'status' }, { key: 'payment_method', label: 'Paid by', type: 'badge' },
        { key: 'line_count', label: 'Items', type: 'number', align: 'right' },
        { key: 'quantity_received', label: 'Quantity', type: 'number', align: 'right' },
        { key: 'total', label: 'Total', type: 'currency', align: 'right' },
      ],
      rows: purchasesPaged.rows.map((row) => {
        const settled = settlements.get(Number(row.id));
        const due = settled ? settled.due : null;
        const total = num(row, 'total');
        return {
          _record_id: row.id,
          invoice_date: row.invoice_date || String(row.created_at || '').slice(0, 10),
          recorded_at: row.created_at,
          invoice_number: row.invoice_number || `PUR-${row.id}`,
          supplier: row.supplier, status: row.status,
          payment_method: paymentMethodLabel(row.payment_method)
            + (due == null || due >= total - 0.009 ? '' : due <= 0.009 ? ' · Paid' : ` · Rs ${due.toFixed(2)} due`),
          line_count: num(row, 'line_count'), quantity_received: num(row, 'quantity_received'), total,
          // Row-level split so the table's client-side search keeps the same buckets as the footer.
          ...(settled
            ? {
                cash_amount: settled.paid.cash || 0,
                digital_amount: settled.paid.digital || 0,
                funding_amount: settled.paid.funding || 0,
                credit_amount: due,
              }
            : {}),
        };
      }),
      empty: 'No purchase invoices fall inside the selected invoice-date period.',
    }, purchasesPaged)],
    notes: [
      'The selected period uses Invoice Date. Recorded At shows when somebody entered the purchase into the POS; these dates can legitimately differ for a backdated invoice.',
      'Open a purchase to see every item, item code, quantity, cost, payment method and delivery detail.',
      'Voided purchases are listed for reference but excluded from the totals and the cash / online / credit split, so the report matches Analytics.',
    ],
  };
}

/**
 * Category & Master-category report.
 *
 * Categories are an item-level concept, so this tab reads the same discount-
 * adjusted item revenue the Menu tab and Sales charts use, then rolls it up two
 * ways: by menu category, and by master category (Food / Beverages / Tobacco /
 * Other). It answers "how is each part of the menu selling?" without asking the
 * owner to pick one category at a time — which is why the old per-report
 * category filter was dropped in favour of this dedicated view.
 *
 * Period / employee / order-type / payment / search still apply (they scope the
 * bills these items came from), so you can still ask "how did drinks sell on
 * delivery last week?".
 */
async function categoriesTab(db, range, f) {
  const costMap = await getItemCostMap(db);
  const sold = await itemSales(db, range, f);

  // menu_item id -> its master category + category name (itemSales lacks the group).
  const metaRows = await safeAll(db,
    `SELECT mi.id, COALESCE(mc.name, 'Uncategorised') AS category_name, ${FOOD_GROUP_EXPR} AS food_group
     FROM menu_items mi LEFT JOIN menu_categories mc ON mi.category_id = mc.id`
  );
  const metaById = new Map((metaRows || []).map((m) => [m.id, m]));

  const catAgg = new Map();
  const groupAgg = new Map();
  for (const s of sold || []) {
    const id = s.menu_item_id;
    const meta = id != null ? metaById.get(id) : null;
    const category = s.category_name || meta?.category_name || 'Uncategorised';
    const groupId = meta ? meta.food_group : 'uncategorised';
    const quantity = num(s, 'quantity');
    const revenue = num(s, 'revenue');
    const entry = costMap.get(id);
    const unitCost = entry ? entry.cost : num(s, 'base_price') * COST_RATIO;
    const cost = unitCost * quantity;
    const profit = revenue - cost;

    const c = catAgg.get(category) || { category, groupId, revenue: 0, quantity: 0, cost: 0, profit: 0, items: new Set(), top: null };
    c.revenue += revenue; c.quantity += quantity; c.cost += cost; c.profit += profit;
    if (id != null) c.items.add(id);
    if (!c.top || revenue > c.top.revenue) c.top = { name: s.name, revenue };
    catAgg.set(category, c);

    const g = groupAgg.get(groupId) || { groupId, revenue: 0, quantity: 0, cost: 0, profit: 0, items: new Set(), cats: new Set() };
    g.revenue += revenue; g.quantity += quantity; g.cost += cost; g.profit += profit;
    if (id != null) g.items.add(id);
    g.cats.add(category);
    groupAgg.set(groupId, g);
  }

  const totalRevenue = Array.from(catAgg.values()).reduce((s, c) => s + c.revenue, 0);
  const totalProfit = Array.from(catAgg.values()).reduce((s, c) => s + c.profit, 0);

  const categoryRows = Array.from(catAgg.values())
    .map((c) => ({
      category: c.category,
      master_category: c.groupId === 'uncategorised' ? 'Uncategorised' : foodGroupLabel(c.groupId),
      items: c.items.size,
      quantity: c.quantity,
      revenue: c.revenue,
      food_cost: c.cost,
      profit: c.profit,
      margin: c.revenue ? (c.profit / c.revenue) * 100 : 0,
      share: totalRevenue ? (c.revenue / totalRevenue) * 100 : 0,
      top_item: c.top?.name || '—',
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const groupRows = Array.from(groupAgg.values())
    .map((g) => ({
      master_category: g.groupId === 'uncategorised' ? 'Uncategorised' : foodGroupLabel(g.groupId),
      categories: g.cats.size,
      items: g.items.size,
      quantity: g.quantity,
      revenue: g.revenue,
      food_cost: g.cost,
      profit: g.profit,
      margin: g.revenue ? (g.profit / g.revenue) * 100 : 0,
      share: totalRevenue ? (g.revenue / totalRevenue) * 100 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const topCategory = categoryRows[0] || null;
  const topGroup = groupRows[0] || null;

  const chips = [];
  if (topCategory) chips.push({ icon: 'star', text: `${topCategory.category} leads with ${Math.round(topCategory.share)}% of menu sales` });
  if (topGroup) chips.push({ icon: 'star', text: `${topGroup.master_category} is the biggest master category at ${money(topGroup.revenue)}` });
  if (categoryRows.length) chips.push({ icon: 'info', text: `${categoryRows.length} categor${categoryRows.length === 1 ? 'y' : 'ies'} sold across ${groupRows.length} master group${groupRows.length === 1 ? '' : 's'}` });

  const insights = [];
  if (topCategory && topCategory.share >= 50) {
    insights.push({ title: 'Heavy concentration', body: `${topCategory.category} alone makes up ${Math.round(topCategory.share)}% of menu sales — a slow day for it hits the whole shop.`, tone: 'warning' });
  }
  const weakMargin = categoryRows.filter((c) => c.revenue > 0).slice().sort((a, b) => a.margin - b.margin)[0];
  if (weakMargin && weakMargin.margin < 30) {
    insights.push({ title: 'Thin category margin', body: `${weakMargin.category} runs at a ${weakMargin.margin.toFixed(1)}% margin after food cost — worth a price or recipe review.`, tone: 'warning' });
  }
  if (topGroup && groupRows.length > 1) {
    insights.push({ title: 'Menu mix', body: `${topGroup.master_category} brings ${Math.round(topGroup.share)}% of sales; the rest is spread across ${groupRows.length - 1} other master group(s).`, tone: 'neutral' });
  }

  return {
    chips,
    kpis: [
      { key: 'top_category', label: 'Top Category', value: topCategory?.category || null, format: 'text', sub: topCategory ? `${money(topCategory.revenue)} · ${Math.round(topCategory.share)}%` : null, highlight: true },
      { key: 'top_master', label: 'Top Master Category', value: topGroup?.master_category || null, format: 'text', sub: topGroup ? `${money(topGroup.revenue)} · ${Math.round(topGroup.share)}%` : null },
      { key: 'total_sales', label: 'Total Menu Sales', value: totalRevenue, format: 'currency', hint: 'Discount-adjusted item sales across every category in this period.' },
      { key: 'total_profit', label: 'Profit after Food Cost', value: totalProfit, format: 'currency', hint: 'Item sales minus food cost (recipe cost where set, else the standard estimate).' },
      { key: 'categories_sold', label: 'Categories Sold', value: categoryRows.length, format: 'number', sub: `${groupRows.length} master group(s)` },
    ],
    charts: {
      revenueByCategory: categoryRows.map((c) => ({ label: c.category, value: c.revenue, meta: `${c.quantity} sold` })),
      revenueByMaster: groupRows.map((g) => ({ label: g.master_category, value: g.revenue, meta: `${g.quantity} sold` })),
      quantityByCategory: categoryRows.map((c) => ({ label: c.category, value: c.quantity })),
      profitByCategory: categoryRows.map((c) => ({ label: c.category, value: c.profit })),
      shareByMaster: groupRows.map((g) => ({ label: g.master_category, value: g.revenue })),
    },
    insights,
    tables: [
      {
        id: 'category-summary',
        title: 'Category Summary',
        columns: [
          { key: 'category', label: 'Category' },
          { key: 'master_category', label: 'Master', type: 'badge' },
          { key: 'top_item', label: 'Top Item' },
          { key: 'items', label: 'Items Sold', type: 'number', align: 'right' },
          { key: 'quantity', label: 'Qty', type: 'number', align: 'right' },
          { key: 'revenue', label: 'Revenue', type: 'currency', align: 'right' },
          { key: 'food_cost', label: 'Food Cost', type: 'currency', align: 'right' },
          { key: 'profit', label: 'Profit', type: 'currency', align: 'right' },
          { key: 'margin', label: 'Margin', type: 'percent', align: 'right' },
          { key: 'share', label: 'Share', type: 'percent', align: 'right' },
        ],
        rows: categoryRows,
        empty: 'No menu items were sold in the selected period.',
      },
      {
        id: 'master-category-summary',
        title: 'Master Category Summary',
        columns: [
          { key: 'master_category', label: 'Master Category' },
          { key: 'categories', label: 'Categories', type: 'number', align: 'right' },
          { key: 'items', label: 'Items Sold', type: 'number', align: 'right' },
          { key: 'quantity', label: 'Qty', type: 'number', align: 'right' },
          { key: 'revenue', label: 'Revenue', type: 'currency', align: 'right' },
          { key: 'food_cost', label: 'Food Cost', type: 'currency', align: 'right' },
          { key: 'profit', label: 'Profit', type: 'currency', align: 'right' },
          { key: 'margin', label: 'Margin', type: 'percent', align: 'right' },
          { key: 'share', label: 'Share', type: 'percent', align: 'right' },
        ],
        rows: groupRows,
        empty: 'No menu items were sold in the selected period.',
      },
    ],
    notes: [
      'Categories are counted from item lines, with each bill’s discount spread across its items — so these totals reconcile with the Sales charts.',
      'Food cost uses a real recipe where one exists, otherwise the standard estimate, exactly like the Menu report.',
    ],
  };
}

const BUILDERS = {
  overview: overviewTab,
  sales: salesTab,
  finance: financeTab,
  expenses: async (db, range, f) => {
    const finance = await financeTab(db, range, f);
    return {
      ...finance,
      tables: (finance.tables || []).filter((table) => table.id === 'ledger'),
      notes: ['Operating expenses only. Stock purchases stay in Purchases so the same cost is never counted twice.'],
    };
  },
  purchases: purchasesTab,
  orders: ordersTab,
  menu: menuTab,
  categories: categoriesTab,
  inventory: inventoryTab,
  customers: customersTab,
  employees: employeesTab,
  tables: tablesTab,
  reservations: reservationsTab,
  suppliers: suppliersTab,
  changes: changesTab,
};

export const REPORT_TABS = Object.keys(BUILDERS);

/**
 * Which filters actually bind to something on each tab.
 *
 * A filter that silently does nothing is worse than a missing one: the owner
 * changes it, the numbers stay put, and they lose trust in the whole report.
 * Every filter listed here is wired into that tab's queries; anything absent
 * has nothing to bind to (menu categories do not apply to raw stock; a booking
 * has no payment method) and the UI disables the control with a reason rather
 * than leaving it live and inert.
 *
 * scripts/probe-reports.mjs asserts this table matches reality by diffing the
 * SQL each builder emits with and without each filter.
 */
// Menu category / master-category are no longer per-report filters: an
// item-level slice of a bill-level report only ever confused the totals. The
// dedicated Categories tab answers that question in full instead.
const ALL_FILTERS = ['businessDayId', 'employeeId', 'paymentMethod', 'orderType', 'search'];

export const FILTER_SUPPORT = {
  overview: ALL_FILTERS,
  sales: ALL_FILTERS,
  finance: ALL_FILTERS,
  expenses: ALL_FILTERS,
  purchases: ['businessDayId', 'employeeId', 'paymentMethod', 'search'],
  orders: ALL_FILTERS,
  menu: ALL_FILTERS,
  // Categories reads item lines but scopes by the bills they came from, so the
  // period / staff / order-type / payment / search filters all still bind.
  categories: ALL_FILTERS,
  customers: ALL_FILTERS,
  employees: ALL_FILTERS,
  tables: ALL_FILTERS,
  inventory: ['businessDayId', 'employeeId', 'search'],
  reservations: ['businessDayId', 'search'],
  suppliers: ['businessDayId', 'paymentMethod', 'search'],
  // The exception log is scoped by period / business day only. Its rows come
  // from five different record types (orders, tickets, items, bills, audit
  // events), and a category or payment-method filter binds to none of them —
  // declaring one would leave a control that changes nothing.
  changes: ['businessDayId'],
};

/** Why a filter is unavailable, shown on the disabled control. */
export const FILTER_UNAVAILABLE_REASON = {
  purchases: 'Purchases contain raw-stock lines, not menu categories or order types.',
  inventory: 'Raw stock has no menu category, order type or payment method.',
  reservations: 'A booking has no items, staff member or payment attached.',
  suppliers: 'Supplier spend comes from expenses, which carry no staff member, menu category or order type.',
  changes: 'Cancellations, voids, refunds and discounts span orders, tickets and bills, so only the period or business day narrows them.',
};

/** The filters this tab honours. */
export function supportedFilters(tab) {
  return FILTER_SUPPORT[tab] || ALL_FILTERS;
}

/**
 * Tabs a cashier may open.
 *
 * /cashier/reports re-exports the admin page, so a cashier reaches the same
 * engine — which is what we want for consistency, but it also meant a cashier
 * could ask for tab=finance and read the expense ledger, supplier spend and
 * the profit line. Operational tabs only.
 *
 * Deliberately derived from REPORT_TABS and kept immediately beside it: a new
 * tab added above is denied to cashiers until someone consciously lists it
 * here, and the test asserts this stays a real subset that still withholds the
 * financial ones.
 */
export const CASHIER_REPORT_TABS = REPORT_TABS.filter((tab) =>
  // 'changes' is included deliberately: a cashier can void, refund and
  // discount, so the log of those actions is not something to hide from them.
  ['overview', 'sales', 'orders', 'changes', 'menu', 'categories', 'inventory', 'tables', 'reservations'].includes(tab)
);

/** Tabs only an admin may open — the complement, stated explicitly. */
export const ADMIN_ONLY_REPORT_TABS = REPORT_TABS.filter((tab) => !CASHIER_REPORT_TABS.includes(tab));

export const REPORT_TAB_PERMISSIONS = Object.freeze(Object.fromEntries(
  REPORT_TABS.map((tab) => [tab, `report.${tab === 'overview' ? 'sales' : tab}.view`])
));

/** Which tabs this role may see. The callback keeps this module browser-safe. */
export function allowedReportTabs(role, can = null) {
  if (isAdminLike(role)) return REPORT_TABS;
  if (typeof can === 'function') return REPORT_TABS.filter((tab) => can(REPORT_TAB_PERMISSIONS[tab]));
  // Backwards-compatible defaults used before the permission cache is loaded.
  return CASHIER_REPORT_TABS;
}

/** Dropdown options for the shared filter bar — only filters backed by real data. */
export async function getFilterOptions(db) {
  const [employees, categories, orderTypes, businessDays] = await Promise.all([
    safeAll(db, `SELECT id, full_name, username, role FROM users WHERE COALESCE(is_active, 1) = 1 ORDER BY full_name`),
    safeAll(db, `SELECT id, name FROM menu_categories ORDER BY name`),
    safeAll(db, `SELECT DISTINCT ${ORDER_TYPE_EXPR} AS order_type FROM orders o ORDER BY order_type`),
    safeAll(db, `SELECT id,business_date,status FROM business_days ORDER BY business_date DESC,id DESC LIMIT 120`),
  ]);
  return {
    employees: (employees || []).map((u) => ({ id: u.id, name: u.full_name || u.username, role: u.role })),
    categories: (categories || []).map((c) => ({ id: c.id, name: c.name })),
    foodGroups: FOOD_GROUPS,
    // Buckets, not raw DB strings — purchases write bank_transfer, POS writes qr.
    paymentMethods: PAYMENT_FILTER_OPTIONS,
    orderTypes: (orderTypes || []).map((o) => o.order_type),
    businessDays: (businessDays || []).map((day) => ({ ...day, business_date: dateKey(day.business_date) })),
  };
}

export async function buildReport(db, tab, range, filters) {
  const builder = BUILDERS[tab] || BUILDERS.overview;
  return builder(db, range, filters || {});
}
