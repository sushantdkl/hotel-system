/**
 * Inventory Dashboard composer for /admin/inventory/dashboard.
 *
 * Read-only. Reuses the existing inventory schema, thresholds and stock-movement
 * ledger. Category is free text on inventory_items (COALESCE → 'Uncategorised').
 *
 * IMPORTANT: physical quantities in different units (kg, btl, pc) are NEVER
 * summed together. Category cards report SKU counts and status counts; the only
 * aggregate summed across a category is monetary stock VALUE (qty × cost), which
 * is unit-safe.
 */

import { getDailyBurnRates } from '@/lib/stock-movements.js';

const num = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const round2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;

const NAME = `COALESCE(NULLIF(TRIM(i.item_name), ''), i.name)`;
const CAT = `COALESCE(NULLIF(TRIM(i.category), ''), 'Uncategorised')`;
const THRESHOLD = `COALESCE(i.min_stock_level, i.min_stock, 0)`;
const ACTIVE = `COALESCE(i.is_archived, 0) = 0`;

async function safe(promise, fallback) {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

function statusOf(qty, threshold) {
  if (qty <= 0) return 'out';
  if (qty <= threshold) return 'low';
  return 'in';
}

export async function composeInventoryDashboard(db, { range, category = null, status = null, search = null } = {}) {
  const period = range || { start: '1970-01-01', end: '2999-12-31', label: 'All time' };

  // --- All active items (single read; everything derives from this) ------
  const items = await safe(
    db.all(
      `SELECT i.id, ${NAME} AS name, ${CAT} AS category,
              COALESCE(i.quantity, 0) AS quantity, i.unit,
              COALESCE(i.cost_per_unit, 0) AS cost_per_unit,
              ${THRESHOLD} AS threshold, i.supplier, i.updated_at
       FROM inventory_items i
       WHERE ${ACTIVE}
       ORDER BY ${NAME} ASC`
    ),
    []
  );

  const enriched = items.map((it) => {
    const qty = num(it.quantity);
    const threshold = num(it.threshold);
    const st = statusOf(qty, threshold);
    return {
      id: it.id,
      name: it.name,
      category: it.category,
      quantity: qty,
      unit: it.unit || '',
      cost_per_unit: num(it.cost_per_unit),
      threshold,
      shortage: st === 'in' ? 0 : round2(Math.max(0, threshold - qty)),
      value: round2(qty * num(it.cost_per_unit)),
      supplier: it.supplier || null,
      updated_at: it.updated_at || null,
      status: st,
    };
  });

  // --- Summary (unit-safe: counts + monetary value only) -----------------
  const summary = {
    totalSkus: enriched.length,
    inStock: enriched.filter((i) => i.status === 'in').length,
    lowStock: enriched.filter((i) => i.status === 'low').length,
    outOfStock: enriched.filter((i) => i.status === 'out').length,
    stockValue: round2(enriched.reduce((s, i) => s + i.value, 0)),
  };

  // --- Wastage value in the period --------------------------------------
  const wastageRow = await safe(
    db.get(
      `SELECT COALESCE(SUM(COALESCE(w.total_cost, w.quantity * COALESCE(im.cost_per_unit, 0))), 0) AS value,
              COUNT(*) AS entries
       FROM wastage_log w
       LEFT JOIN inventory_items im ON w.raw_material_id = im.id
       WHERE date(w.created_at, '+5 hours', '+45 minutes') BETWEEN ? AND ?`,
      [period.start, period.end]
    ),
    { value: 0, entries: 0 }
  );
  summary.wastageValue = round2(num(wastageRow.value));
  summary.wastageEntries = num(wastageRow.entries);

  const recentMovementCount = await safe(
    db.get(
      `SELECT COUNT(*) AS c FROM stock_movements WHERE date(created_at, '+5 hours', '+45 minutes') BETWEEN ? AND ?`,
      [period.start, period.end]
    ),
    { c: 0 }
  );
  summary.recentMovements = num(recentMovementCount.c);

  // --- Category cards (SKU/status counts + unit-safe value) --------------
  const catMap = new Map();
  for (const i of enriched) {
    if (!catMap.has(i.category)) {
      catMap.set(i.category, { category: i.category, skus: 0, low: 0, out: 0, value: 0 });
    }
    const c = catMap.get(i.category);
    c.skus += 1;
    if (i.status === 'low') c.low += 1;
    if (i.status === 'out') c.out += 1;
    c.value = round2(c.value + i.value);
  }
  const categories = [...catMap.values()]
    .map((c) => ({ ...c, badge: c.out > 0 ? 'out' : c.low > 0 ? 'low' : 'in' }))
    .sort((a, b) => b.value - a.value || a.category.localeCompare(b.category));

  // --- Movement-driven panels -------------------------------------------
  const burn = await safe(getDailyBurnRates(db, { days: 7 }), new Map());

  const usageRows = await safe(
    db.all(
      `SELECT m.inventory_item_id AS id, SUM(ABS(m.quantity_changed)) AS used
       FROM stock_movements m
       WHERE m.change_type = 'order_deduction'
         AND date(m.created_at, '+5 hours', '+45 minutes') BETWEEN ? AND ?
       GROUP BY m.inventory_item_id
       ORDER BY used DESC
       LIMIT 8`,
      [period.start, period.end]
    ),
    []
  );
  const byId = new Map(enriched.map((i) => [i.id, i]));
  const topMoving = usageRows
    .map((r) => {
      const it = byId.get(r.id);
      if (!it) return null;
      return { id: it.id, name: it.name, category: it.category, unit: it.unit, stock: it.quantity, used: num(r.used) };
    })
    .filter(Boolean);

  const movedIds = new Set(usageRows.map((r) => r.id));
  const slowMoving = enriched
    .filter((i) => i.quantity > 0 && !movedIds.has(i.id))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8)
    .map((i) => ({ id: i.id, name: i.name, category: i.category, unit: i.unit, stock: i.quantity, value: i.value }));

  const withDays = (i) => {
    const b = num(burn.get(i.id));
    return { ...i, daysLeft: b > 0 ? Math.floor(i.quantity / b) : null };
  };

  const lowStockAlerts = enriched
    .filter((i) => i.status === 'low')
    .sort((a, b) => b.shortage - a.shortage)
    .map(withDays);

  const outOfStock = enriched
    .filter((i) => i.status === 'out')
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(withDays);

  const recentlyAdjusted = await safe(
    db.all(
      `SELECT m.id, ${NAME.replace(/i\./g, 'im.')} AS name, im.unit, m.change_type, m.quantity_changed,
              m.reason, m.created_at, u.full_name AS performed_by
       FROM stock_movements m
       LEFT JOIN inventory_items im ON m.inventory_item_id = im.id
       LEFT JOIN users u ON m.performed_by = u.id
       WHERE m.change_type IN ('adjustment', 'stock_count', 'correction', 'manual_adjustment')
       ORDER BY m.created_at DESC LIMIT 8`
    ),
    []
  );

  const recentReceipts = await safe(
    db.all(
      `SELECT m.id, ${NAME.replace(/i\./g, 'im.')} AS name, im.unit, m.quantity_changed,
              COALESCE(m.unit_cost, im.cost_per_unit) AS unit_cost, m.created_at
       FROM stock_movements m
       LEFT JOIN inventory_items im ON m.inventory_item_id = im.id
       WHERE m.change_type IN ('purchase_receipt', 'manual_restock')
       ORDER BY m.created_at DESC LIMIT 8`
    ),
    []
  );

  const recentMovements = await safe(
    db.all(
      `SELECT m.id, ${NAME.replace(/i\./g, 'im.')} AS name, im.unit, m.change_type,
              m.quantity_changed, m.balance_after, m.reason, m.created_at, u.full_name AS performed_by
       FROM stock_movements m
       LEFT JOIN inventory_items im ON m.inventory_item_id = im.id
       LEFT JOIN users u ON m.performed_by = u.id
       ORDER BY m.created_at DESC LIMIT 15`
    ),
    []
  );

  const wastage = await safe(
    db.all(
      `SELECT w.id, ${NAME.replace(/i\./g, 'im.')} AS name, w.quantity, w.unit, w.reason,
              COALESCE(w.total_cost, w.quantity * COALESCE(im.cost_per_unit, 0)) AS cost, w.created_at
       FROM wastage_log w
       LEFT JOIN inventory_items im ON w.raw_material_id = im.id
       WHERE date(w.created_at, '+5 hours', '+45 minutes') BETWEEN ? AND ?
       ORDER BY w.created_at DESC LIMIT 10`,
      [period.start, period.end]
    ),
    []
  );

  // --- Optional server-side filtering for the item lists -----------------
  const applyFilters = (list) =>
    list.filter((i) => {
      if (category && i.category !== category) return false;
      if (status && i.status !== status) return false;
      if (search && !String(i.name).toLowerCase().includes(String(search).toLowerCase())) return false;
      return true;
    });

  return {
    range: period,
    generatedAt: new Date().toISOString(),
    summary,
    categories,
    filterOptions: {
      categories: categories.map((c) => c.category),
      statuses: ['in', 'low', 'out'],
    },
    panels: {
      topMoving,
      slowMoving,
      lowStockAlerts: applyFilters(lowStockAlerts),
      outOfStock: applyFilters(outOfStock),
      recentlyAdjusted: (recentlyAdjusted || []).map((r) => ({
        id: r.id, name: r.name, unit: r.unit, change_type: r.change_type,
        quantity_changed: num(r.quantity_changed), reason: r.reason || null,
        created_at: r.created_at, performed_by: r.performed_by || null,
      })),
      recentReceipts: (recentReceipts || []).map((r) => ({
        id: r.id, name: r.name, unit: r.unit, quantity_changed: num(r.quantity_changed),
        unit_cost: num(r.unit_cost), created_at: r.created_at,
      })),
      recentMovements: (recentMovements || []).map((r) => ({
        id: r.id, name: r.name, unit: r.unit, change_type: r.change_type,
        quantity_changed: num(r.quantity_changed), balance_after: r.balance_after == null ? null : num(r.balance_after),
        reason: r.reason || null, created_at: r.created_at, performed_by: r.performed_by || null,
      })),
      wastage: (wastage || []).map((r) => ({
        id: r.id, name: r.name, quantity: num(r.quantity), unit: r.unit,
        reason: r.reason || null, cost: round2(r.cost), created_at: r.created_at,
      })),
    },
  };
}
