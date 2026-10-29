/**
 * Decrease inventory when menu/custom items are sold.
 *
 * A sold line resolves to an inventory row in exactly one way, in this order:
 *   1. variant inventory link (pours / sized portions) — stock_quantity = usage PER sale
 *   2. explicit `inventory_items.menu_item_id` 1:1 retail link (bottles, cans, packs)
 *   3. recipe / BOM (prepared dishes) — respects recipe yield
 *   4. strict name match in resolveInventoryItem()
 *
 * Direct menu links beat recipes so a linked pack of ice/beer never gets wiped
 * by a leftover recipe that still lists the whole case as one serving.
 */

import { ensureColumn } from '@/lib/db/schema-helpers.js';
import {
  ensureRecipeTables,
  getRecipeByMenuItemId,
  explodeRecipe,
  deductRawMaterials,
} from '@/lib/recipes.js';
import { ensureStockMovementsTable } from '@/lib/stock-movements.js';
import { applyStockChange, resolveInventoryItem } from '@/lib/inventory-ledger.js';
import { expandComboItems } from '@/lib/combos.js';
import { logger } from '@/lib/logger.js';

/**
 * Per-sale usage from a variant. Guards the common misconfig where someone
 * types the on-hand count (e.g. 14) into "Used per sale" instead of 1.
 */
function resolveVariantPerUnit(variant, inventoryRow) {
  let perUnit = Number(variant?.stock_quantity);
  if (!Number.isFinite(perUnit) || perUnit <= 0) perUnit = 1;

  const usageUnit = String(variant?.stock_unit || inventoryRow?.consumption_unit || inventoryRow?.unit || '')
    .trim()
    .toLowerCase();
  const countUnits = new Set(['', 'pcs', 'pc', 'piece', 'pieces', 'bottle', 'bottles', 'can', 'cans', 'pack', 'packs', 'unit', 'units', 'each']);
  // Whole-item retail: one sale always consumes 1, never the case count.
  if (perUnit > 1 && countUnits.has(usageUnit)) {
    logger.warn('variant_stock_usage_reset_to_one', {
      inventory_item_id: inventoryRow?.id,
      stock_quantity: perUnit,
      stock_unit: usageUnit || '(blank)',
    });
    return 1;
  }

  const onHand = Number(inventoryRow?.quantity ?? 0);
  if (perUnit > 1 && onHand > 0 && Math.abs(perUnit - onHand) < 1e-9) {
    logger.warn('variant_stock_usage_looks_like_on_hand', {
      inventory_item_id: inventoryRow?.id,
      stock_quantity: perUnit,
      on_hand: onHand,
    });
    return 1;
  }
  return perUnit;
}

// A variant with its own inventory_item_id overrides recipe/base link —
// e.g. "60ml" and "120ml" pours of the same bottle draw different amounts.
async function resolveVariantStockLink(db, menuId, variantName) {
  if (!menuId || !variantName) return null;
  const variant = await db.get(
    `SELECT * FROM menu_item_variants WHERE menu_item_id = ? AND variant_name = ?`,
    [menuId, variantName]
  );
  if (!variant?.inventory_item_id) return null;
  const row = await db.get(
    `SELECT * FROM inventory_items WHERE id = ? AND COALESCE(is_archived, 0) = 0`,
    [variant.inventory_item_id]
  );
  if (!row) return null;
  // Blank usage → 1 unit per sale (whole bottle / can / pack).
  return { row, perUnit: resolveVariantPerUnit(variant, row) };
}

/** Explicit 1:1 menu ↔ inventory link (packaged retail). */
async function resolveDirectMenuStockLink(db, menuId) {
  if (!menuId) return null;
  try {
    return await db.get(
      `SELECT i.*, COALESCE(mi.stock_usage, 1) AS menu_stock_usage
         FROM inventory_items i
         JOIN menu_items mi ON mi.id = i.menu_item_id
        WHERE i.menu_item_id = ? AND COALESCE(i.is_archived, 0) = 0
        LIMIT 1`,
      [menuId]
    );
  } catch {
    return null;
  }
}

function normalizeMenuStockUsage(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return n;
}

async function recipeMultiplier(_db, recipe, soldQty) {
  const yieldQty = Number(recipe?.yield_quantity || 1);
  const safeYield = Number.isFinite(yieldQty) && yieldQty > 0 ? yieldQty : 1;
  return Number(soldQty) / safeYield;
}

/**
 * Idempotent schema top-up for the tables the sold-line stock path touches.
 */
export async function ensureStockSchema(db) {
  try {
    await ensureColumn(db, 'menu_items', 'stock_usage', 'REAL DEFAULT 1');
  } catch {
    /* ignore — migration may own the production column */
  }
  try {
    await ensureColumn(db, 'inventory_items', 'menu_item_id', 'INTEGER');
  } catch {
    /* ignore — already exists */
  }
  try {
    await ensureColumn(db, 'orders', 'stock_consumed', 'INTEGER DEFAULT 0');
  } catch {
    /* ignore — already exists */
  }
  try {
    await ensureRecipeTables(db);
  } catch {
    /* ignore — already exists */
  }
  try {
    await ensureStockMovementsTable(db);
  } catch {
    /* ignore — already exists */
  }
}

/** Mark that this order has posted at least one sale deduction. */
export async function markOrderStockConsumed(db, orderId) {
  if (!orderId) return;
  await db.run('UPDATE orders SET stock_consumed = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [orderId]);
}

/**
 * Whether cancel/replace should reverse inventory for this order.
 * Prefer the stock_consumed flag; fall back to ledger rows for legacy dine-in
 * orders that deducted before the flag was set.
 */
export async function orderNeedsStockRestore(db, order) {
  if (!order?.id) return false;
  if (Number(order.stock_consumed) === 1) return true;
  const hit = await db.get(
    `SELECT id FROM stock_movements
      WHERE change_type = 'order_deduction' AND reference_id = ?
      LIMIT 1`,
    [String(order.id)]
  ).catch(() => null);
  return Boolean(hit);
}

/**
 * Restore active line items when an order is cancelled/replaced, then clear
 * stock_consumed so a second cancel cannot restock again.
 */
export async function restoreOrderStockIfNeeded(db, order, items = [], context = {}) {
  if (!(await orderNeedsStockRestore(db, order))) {
    return { restored: false, warnings: [] };
  }
  const result = await restoreStockForItems(db, items, {
    orderId: order.id,
    performedBy: context.performedBy || null,
    reason: context.reason || 'Order cancelled',
  });
  await db.run('UPDATE orders SET stock_consumed = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [order.id]);
  // Keep boolean `restored` after spread — restoreStockForItems returns `restored: []`.
  return { ...result, restored: true };
}


/**
 * Stop an order only when the exact linked stock is intentionally visible in
 * POS. Recipes and hidden/unlinked inventory keep their existing behaviour.
 */
export async function assertVisibleStockAvailable(db, item, quantity = 1) {
  const menuId = Number(item?.menu_item_id || item?.item_id || item?.id || 0);
  if (!menuId) return;

  const expanded = await expandComboItems(db, [{ ...item, quantity }], { requireAvailable: true });
  if (expanded.length !== 1 || Number(expanded[0]?.combo_menu_item_id) === menuId) {
    for (const component of expanded) {
      await assertVisibleStockAvailable(db, component, component.quantity);
    }
    return;
  }

  await ensureStockSchema(db);
  await ensureColumn(db, 'inventory_items', 'pos_stock_visible', 'INTEGER DEFAULT 0');

  const requested = Math.max(0, Number(quantity || 0));
  const variantName = String(item?.variant_name || '').trim();
  let stock = null;
  let required = requested;

  if (variantName) {
    const variant = await db.get(
      `SELECT v.stock_quantity, v.inventory_item_id, i.quantity, i.item_name, i.unit
         FROM menu_item_variants v
         JOIN inventory_items i ON i.id = v.inventory_item_id
        WHERE v.menu_item_id = ? AND v.variant_name = ?
          AND COALESCE(v.pos_stock_visible, 0) = 1
          AND COALESCE(i.is_archived, 0) = 0
        LIMIT 1`,
      [menuId, variantName]
    );
    if (variant) {
      stock = variant;
      required *= resolveVariantPerUnit(variant, variant);
    }
  }
  if (!stock) {
    stock = await db.get(
      `SELECT i.quantity, i.item_name, i.unit, COALESCE(mi.stock_usage, 1) AS per_unit
         FROM inventory_items i
         JOIN menu_items mi ON mi.id = i.menu_item_id
        WHERE i.menu_item_id = ?
          AND COALESCE(i.pos_stock_visible, 0) = 1
          AND COALESCE(i.is_archived, 0) = 0
        LIMIT 1`,
      [menuId]
    );
    if (stock) required *= normalizeMenuStockUsage(stock.per_unit);
  }

  if (!stock) return;
  const available = Number(stock.quantity || 0);
  if (available + 1e-9 >= required && available > 0) return;

  const itemName = item?.item_name || item?.name || stock.item_name || 'This item';
  throw Object.assign(
    new Error(`No stock for "${itemName}". This item cannot be ordered.`),
    { status: 409, code: 'no_stock' }
  );
}

/**
 * @param {object} db - PosDatabase instance
 * @param {Array<{menu_item_id?:number,name?:string,item_name?:string,quantity:number}>} items
 * @returns {Promise<{deducted: Array, warnings: Array}>}
 */
export async function deductStockForItems(db, items = [], context = {}) {
  await ensureStockSchema(db);
  const { orderId, performedBy } = context;
  const deducted = [];
  const warnings = [];

  const stockItems = await expandComboItems(db, items, { requireAvailable: true });
  for (const item of stockItems) {
    const qty = Number(item.quantity || 0);
    if (qty <= 0) continue;

    await assertVisibleStockAvailable(db, item, qty);

    const menuId = item.menu_item_id || item.item_id || item.id || null;

    const variantLink = await resolveVariantStockLink(db, menuId, item.variant_name);
    if (variantLink) {
      const applied = await applyStockChange(db, {
        inventory_item_id: variantLink.row.id,
        quantity: -(variantLink.perUnit * qty),
        change_type: 'order_deduction',
        performed_by: performedBy,
        reason: item.item_name || item.name,
        reference_id: orderId,
      });
      if (applied) {
        deducted.push({ ...applied, sold: variantLink.perUnit * qty });
        if (applied.warning) warnings.push(applied.warning);
        const min = Number(variantLink.row.min_stock_level ?? variantLink.row.min_stock ?? 0);
        if (applied.to <= 0 && !applied.warning) warnings.push(`${applied.name} is now out of stock.`);
        else if (min > 0 && applied.to > 0 && applied.to <= min) {
          warnings.push(`${applied.name} is running low (${applied.to} ${variantLink.row.unit || 'left'}).`);
        }
      }
      continue;
    }

    // Packaged retail link — uses menu_items.stock_usage (default 1).
    const direct = await resolveDirectMenuStockLink(db, menuId);
    if (direct) {
      const perSale = normalizeMenuStockUsage(direct.menu_stock_usage);
      const applied = await applyStockChange(db, {
        inventory_item_id: direct.id,
        quantity: -(perSale * qty),
        change_type: 'order_deduction',
        performed_by: performedBy,
        reason: item.item_name || item.name || direct.item_name,
        reference_id: orderId,
      });
      if (applied) {
        deducted.push({ ...applied, sold: perSale * qty });
        if (applied.warning) warnings.push(applied.warning);
        const min = Number(direct.min_stock_level ?? direct.min_stock ?? 0);
        if (applied.to <= 0 && !applied.warning) warnings.push(`${applied.name} is now out of stock.`);
        else if (min > 0 && applied.to > 0 && applied.to <= min) {
          warnings.push(`${applied.name} is running low (${applied.to} ${direct.unit || 'left'}).`);
        }
      }
      continue;
    }

    const recipe = await getRecipeByMenuItemId(db, menuId);

    if (recipe) {
      const deltaMap = await explodeRecipe(db, recipe.id, await recipeMultiplier(db, recipe, qty));
      const result = await deductRawMaterials(db, deltaMap, {
        direction: -1,
        changeType: 'order_deduction',
        performedBy,
        reason: item.item_name || item.name || null,
        referenceId: orderId,
      });
      deducted.push(...result.deducted.map((d) => ({ ...d, sold: d.amount })));
      warnings.push(...result.warnings);
      continue;
    }

    const { row, warning } = await resolveInventoryItem(db, item);
    if (warning) warnings.push(warning);
    if (!row) continue;

    const applied = await applyStockChange(db, {
      inventory_item_id: row.id,
      quantity: -qty,
      change_type: 'order_deduction',
      performed_by: performedBy,
      reason: row.item_name || row.name,
      reference_id: orderId,
    });
    if (!applied) continue;

    deducted.push({ ...applied, sold: qty });
    if (applied.warning) warnings.push(applied.warning);

    const min = Number(row.min_stock_level ?? row.min_stock ?? 0);
    if (applied.to <= 0 && !applied.warning) {
      warnings.push(`${applied.name} is now out of stock.`);
    } else if (min > 0 && applied.to > 0 && applied.to <= min) {
      warnings.push(`${applied.name} is running low (${applied.to} ${row.unit || 'left'}).`);
    }
  }

  return { deducted, warnings };
}

/**
 * Restore inventory when items are voided/cancelled.
 */
export async function restoreStockForItems(db, items = [], context = {}) {
  await ensureStockSchema(db);
  const { performedBy, reason = 'Order item voided', orderId = null } = context;
  const restored = [];
  const warnings = [];

  const stockItems = await expandComboItems(db, items);
  for (const item of stockItems) {
    const qty = Number(item.quantity || 0);
    if (qty <= 0) continue;

    const menuId = item.menu_item_id || item.item_id || item.id || null;

    const variantLink = await resolveVariantStockLink(db, menuId, item.variant_name);
    if (variantLink) {
      const applied = await applyStockChange(db, {
        inventory_item_id: variantLink.row.id,
        quantity: variantLink.perUnit * qty,
        change_type: 'order_void',
        performed_by: performedBy,
        reason,
        reference_id: orderId,
      });
      if (applied) restored.push({ ...applied, restored: variantLink.perUnit * qty });
      continue;
    }

    const direct = await resolveDirectMenuStockLink(db, menuId);
    if (direct) {
      const perSale = normalizeMenuStockUsage(direct.menu_stock_usage);
      const applied = await applyStockChange(db, {
        inventory_item_id: direct.id,
        quantity: perSale * qty,
        change_type: 'order_void',
        performed_by: performedBy,
        reason,
        reference_id: orderId,
      });
      if (applied) restored.push({ ...applied, restored: perSale * qty });
      continue;
    }

    const recipe = await getRecipeByMenuItemId(db, menuId);

    if (recipe) {
      const deltaMap = await explodeRecipe(db, recipe.id, await recipeMultiplier(db, recipe, qty));
      const result = await deductRawMaterials(db, deltaMap, {
        direction: 1,
        changeType: 'order_void',
        performedBy,
        reason,
        referenceId: orderId,
      });
      restored.push(...result.deducted.map((d) => ({ ...d, restored: d.amount })));
      continue;
    }

    const { row, warning } = await resolveInventoryItem(db, item);
    if (warning) warnings.push(warning);
    if (!row) continue;

    const applied = await applyStockChange(db, {
      inventory_item_id: row.id,
      quantity: qty,
      change_type: 'order_void',
      performed_by: performedBy,
      reason,
      reference_id: orderId,
    });
    if (applied) restored.push({ ...applied, restored: qty });
  }

  return { restored, warnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// REMOVED: ensureBeverageInventory() / autoLinkBeverageStock()
// Do NOT reintroduce automatic inventory<->menu linking on the order/bill path.
// Links belong to the owner via inventory or product forms.
// ─────────────────────────────────────────────────────────────────────────────
