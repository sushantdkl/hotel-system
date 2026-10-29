/**
 * Recipe / BOM engine: recipe CRUD, BOM explosion, raw-material deduction,
 * wastage logging.
 */

import { ensureColumn } from '@/lib/db/schema-helpers.js';
import { ensureSqliteTable } from '@/lib/db/ensure-sqlite-table.js';
import { ensureStockMovementsTable } from '@/lib/stock-movements.js';
import { applyStockChanges, ensureLedgerSchema } from '@/lib/inventory-ledger.js';
import { upsertLinkedExpense, voidLinkedExpense } from '@/lib/expense-links.js';
import { buildSearch, paginateQuery, resolveOrderBy } from '@/lib/paginate.js';
import { currentBusinessDayId } from '@/lib/business-days.js';

const MAX_RECIPE_DEPTH = 10;

export async function ensureRecipeTables(db) {
  await ensureColumn(db, 'inventory_items', 'purchase_unit', 'TEXT');
  await ensureColumn(db, 'inventory_items', 'consumption_unit', 'TEXT');
  await ensureColumn(db, 'inventory_items', 'conversion_factor', 'REAL DEFAULT 1');
  await ensureColumn(db, 'inventory_items', 'category', 'TEXT');
  await ensureStockMovementsTable(db);

  await ensureSqliteTable(
    db,
    `
    CREATE TABLE IF NOT EXISTS recipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('menu_item', 'sub_recipe')),
      menu_item_id INTEGER UNIQUE REFERENCES menu_items(id) ON DELETE CASCADE,
      yield_quantity REAL DEFAULT 1,
      yield_unit TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `
  );
  await ensureSqliteTable(
    db,
    `
    CREATE TABLE IF NOT EXISTS recipe_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      raw_material_id INTEGER REFERENCES inventory_items(id),
      component_recipe_id INTEGER REFERENCES recipes(id),
      quantity REAL NOT NULL,
      unit TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `
  );
  await ensureSqliteTable(
    db,
    `
    CREATE TABLE IF NOT EXISTS wastage_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raw_material_id INTEGER REFERENCES inventory_items(id),
      recipe_id INTEGER REFERENCES recipes(id),
      quantity REAL NOT NULL,
      unit TEXT,
      reason TEXT NOT NULL,
      logged_by INTEGER REFERENCES users(id),
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `
  );

  // Prep metadata the builder needs. menu_items.preparation_time only exists
  // for menu-linked recipes, so sub/batch recipes had nowhere to record either.
  await ensureColumn(db, 'recipes', 'prep_time_minutes', 'INTEGER');
  await ensureColumn(db, 'recipes', 'prep_notes', 'TEXT');
  await ensureColumn(db, 'wastage_log', 'business_day_id', 'INTEGER');
  await ensureColumn(db, 'wastage_log', 'status', "TEXT DEFAULT 'active'");
  await ensureColumn(db, 'wastage_log', 'void_reason', 'TEXT');
  await ensureColumn(db, 'wastage_log', 'voided_at', 'DATETIME');
  await ensureColumn(db, 'wastage_log', 'voided_by', 'INTEGER');
  await ensureColumn(db, 'wastage_log', 'menu_item_id', 'INTEGER');
  await ensureColumn(db, 'wastage_log', 'source_type', 'TEXT');
  await ensureColumn(db, 'wastage_log', 'source_id', 'INTEGER');

  await ensureLedgerSchema(db);
}

/**
 * Recursively explode a recipe into raw-material quantities.
 * `db` is used read-only here — safe to call inside or outside a transaction.
 * @returns {Promise<Map<number, number>>} raw_material_id -> total quantity
 */
export async function explodeRecipe(db, recipeId, multiplier, acc = new Map(), depth = 0) {
  if (depth > MAX_RECIPE_DEPTH) {
    throw new Error('Recipe nesting too deep — check for a circular sub-recipe reference.');
  }
  const lines = await db.all(`SELECT * FROM recipe_items WHERE recipe_id = ?`, [recipeId]);
  for (const line of lines) {
    const qty = Number(line.quantity) * multiplier;
    if (line.raw_material_id) {
      acc.set(line.raw_material_id, (acc.get(line.raw_material_id) || 0) + qty);
    } else if (line.component_recipe_id) {
      const sub = await db.get(`SELECT * FROM recipes WHERE id = ?`, [line.component_recipe_id]);
      if (!sub) continue;
      const subMultiplier = qty / Number(sub.yield_quantity || 1);
      await explodeRecipe(db, line.component_recipe_id, subMultiplier, acc, depth + 1);
    }
  }
  return acc;
}

/**
 * Apply a raw-material delta map (consumption units) through the ledger. Must
 * be called with a `db` handle that is already transaction-scoped by the
 * caller — this function never opens its own transaction.
 *
 * Thin wrapper kept for the existing call sites; all quantity/cost/movement
 * writing happens in lib/inventory-ledger.js.
 */
export async function deductRawMaterials(db, deltaMap, options = {}) {
  const {
    direction = -1,
    changeType = direction < 0 ? 'order_deduction' : 'order_void',
    performedBy = null,
    reason = null,
    referenceId = null,
    businessDayId = null,
  } = options;

  const entries = Array.from(deltaMap, ([inventory_item_id, amount]) => ({
    inventory_item_id,
    quantity: Number(amount) * direction,
  }));

  const { applied, warnings } = await applyStockChanges(db, entries, {
    change_type: changeType,
    performed_by: performedBy,
    reason,
    reference_id: referenceId,
    business_day_id: businessDayId,
  });

  return { deducted: applied, warnings };
}

export async function getRecipeByMenuItemId(db, menuItemId) {
  if (!menuItemId) return null;
  return db.get(`SELECT * FROM recipes WHERE menu_item_id = ?`, [menuItemId]);
}

/**
 * `withCost` prices every recipe so the list can show food cost and margin
 * without the client making one request per row. It is O(recipes) queries —
 * fine at a single restaurant's recipe count, and opt-in so the pickers that
 * only need names stay cheap.
 */
export async function listRecipes(db, { withCost = false } = {}) {
  const recipes = await db.all(`
    SELECT r.*, mi.name as menu_item_name, mi.base_price as menu_item_price,
           (SELECT COUNT(*) FROM recipe_items ri WHERE ri.recipe_id = r.id) as item_count
    FROM recipes r
    LEFT JOIN menu_items mi ON r.menu_item_id = mi.id
    ORDER BY r.type, r.name
  `);
  if (!withCost) return recipes;

  const priced = [];
  for (const recipe of recipes) {
    const cost = await getRecipeCost(db, recipe.id);
    priced.push({ ...recipe, food_cost: cost.total_cost });
  }
  return priced;
}

export async function getRecipeWithItems(db, id) {
  const recipe = await db.get(
    `SELECT r.*, mi.name as menu_item_name, mi.base_price as menu_item_price,
            mi.image_url as menu_item_image, mi.preparation_time as menu_item_prep_time
     FROM recipes r
     LEFT JOIN menu_items mi ON r.menu_item_id = mi.id
     WHERE r.id = ?`,
    [id]
  );
  if (!recipe) return null;

  const items = await db.all(
    `SELECT ri.*, im.item_name as raw_material_name, im.unit as raw_material_unit,
            cr.name as component_recipe_name
     FROM recipe_items ri
     LEFT JOIN inventory_items im ON ri.raw_material_id = im.id
     LEFT JOIN recipes cr ON ri.component_recipe_id = cr.id
     WHERE ri.recipe_id = ?
     ORDER BY ri.id`,
    [id]
  );

  // Parents, so a sub-recipe can say what it feeds. One query instead of the
  // page fetching every recipe and scanning their lines.
  const used_in = await db.all(
    `SELECT DISTINCT r.id, r.name, r.type, mi.name AS menu_item_name
     FROM recipe_items ri
     JOIN recipes r ON ri.recipe_id = r.id
     LEFT JOIN menu_items mi ON r.menu_item_id = mi.id
     WHERE ri.component_recipe_id = ?
     ORDER BY r.name`,
    [id]
  );

  return { ...recipe, items, used_in };
}

/**
 * Total raw-material cost of one yield of a recipe, exploded through any
 * sub-recipes, priced at each raw material's current cost_per_unit.
 */
export async function getRecipeCost(db, recipeId) {
  const deltaMap = await explodeRecipe(db, recipeId, 1);
  const breakdown = [];
  let total = 0;
  for (const [rawMaterialId, qty] of deltaMap) {
    const item = await db.get(`SELECT * FROM inventory_items WHERE id = ?`, [rawMaterialId]);
    if (!item) continue;
    const lineCost = qty * Number(item.cost_per_unit || 0);
    total += lineCost;
    breakdown.push({
      inventory_item_id: rawMaterialId,
      item_name: item.item_name || item.name,
      quantity: qty,
      unit: item.consumption_unit || item.unit,
      cost_per_unit: Number(item.cost_per_unit || 0),
      line_cost: lineCost,
    });
  }
  breakdown.sort((a, b) => b.line_cost - a.line_cost);
  return { total_cost: total, breakdown };
}

async function replaceRecipeItems(db, recipeId, items) {
  await db.run(`DELETE FROM recipe_items WHERE recipe_id = ?`, [recipeId]);
  for (const item of items || []) {
    if (!item.raw_material_id && !item.component_recipe_id) continue;
    if (item.raw_material_id && item.component_recipe_id) continue;
    await db.run(
      `INSERT INTO recipe_items (recipe_id, raw_material_id, component_recipe_id, quantity, unit)
       VALUES (?, ?, ?, ?, ?)`,
      [recipeId, item.raw_material_id || null, item.component_recipe_id || null, Number(item.quantity), item.unit || null]
    );
  }
}

async function rejectComboRecipe(db, menuItemId) {
  if (!menuItemId) return;
  await ensureColumn(db, 'menu_items', 'is_combo', 'INTEGER DEFAULT 0').catch(() => {});
  const item = await db.get('SELECT COALESCE(is_combo, 0) AS is_combo FROM menu_items WHERE id = ?', [menuItemId]);
  if (Number(item?.is_combo)) {
    throw Object.assign(new Error('Combo packs use the recipes of their component items and cannot have a separate recipe.'), { status: 409 });
  }
}

export async function createRecipe(db, data) {
  await rejectComboRecipe(db, data.type === 'menu_item' ? data.menu_item_id : null);
  return db.transaction(async (tx) => {
    const result = await tx.run(
      `INSERT INTO recipes (name, type, menu_item_id, yield_quantity, yield_unit, prep_time_minutes, prep_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        data.name,
        data.type,
        data.menu_item_id || null,
        Number(data.yield_quantity || 1),
        data.yield_unit || null,
        data.prep_time_minutes ? Number(data.prep_time_minutes) : null,
        data.prep_notes || null,
      ]
    );
    const recipeId = result.lastInsertRowid;
    await replaceRecipeItems(tx, recipeId, data.items);
    return getRecipeWithItems(tx, recipeId);
  });
}

export async function updateRecipe(db, id, data) {
  await rejectComboRecipe(db, data.type === 'menu_item' ? data.menu_item_id : null);
  return db.transaction(async (tx) => {
    await tx.run(
      `UPDATE recipes SET name = ?, type = ?, menu_item_id = ?, yield_quantity = ?, yield_unit = ?,
              prep_time_minutes = ?, prep_notes = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        data.name,
        data.type,
        data.menu_item_id || null,
        Number(data.yield_quantity || 1),
        data.yield_unit || null,
        data.prep_time_minutes ? Number(data.prep_time_minutes) : null,
        data.prep_notes || null,
        id,
      ]
    );
    await replaceRecipeItems(tx, id, data.items);
    return getRecipeWithItems(tx, id);
  });
}

export async function deleteRecipe(db, id) {
  await db.run(`DELETE FROM recipes WHERE id = ?`, [id]);
}

/**
 * Log wastage of either a raw material or a prepared/batch recipe item.
 * Opens its own transaction — this is a fresh entry point, not nested
 * inside an existing one.
 */
async function writeWastage(db, entry, { withinTransaction = false, deductStock = true } = {}) {
  const {
    raw_material_id,
    recipe_id,
    menu_item_id,
    quantity,
    unit,
    reason,
    logged_by,
    notes,
    employee_id = null,
    shift = null,
    photo_url = null,
    business_day_id = null,
    source_type = null,
    source_id = null,
  } = entry;
  if (!raw_material_id && !recipe_id && !menu_item_id) {
    throw new Error('Select a raw material or prepared item to log wastage for.');
  }
  const qty = Number(quantity);
  if (!(qty > 0)) {
    throw new Error('Wastage quantity must be greater than zero.');
  }

  const performWrite = async (tx) => {
    const businessDayId = business_day_id || await currentBusinessDayId(tx, { required: true });
    let resolvedRecipeId = recipe_id || null;
    let resolvedRawMaterialId = raw_material_id || null;
    if (!resolvedRecipeId && !resolvedRawMaterialId && menu_item_id) {
      resolvedRecipeId = (await getRecipeByMenuItemId(tx, menu_item_id))?.id || null;
      if (!resolvedRecipeId) {
        resolvedRawMaterialId = (await tx.get(
          `SELECT id FROM inventory_items WHERE menu_item_id = ? AND COALESCE(is_archived, 0) = 0 LIMIT 1`,
          [menu_item_id]
        ).catch(() => null))?.id || null;
      }
    }

    let deltaMap;
    if (resolvedRecipeId) {
      const recipe = await tx.get(`SELECT * FROM recipes WHERE id = ?`, [resolvedRecipeId]);
      if (!recipe) throw new Error('Recipe not found.');
      const multiplier = qty / Number(recipe.yield_quantity || 1);
      deltaMap = await explodeRecipe(tx, resolvedRecipeId, multiplier);
    } else if (resolvedRawMaterialId) {
      deltaMap = new Map([[resolvedRawMaterialId, qty]]);
    } else {
      deltaMap = new Map();
    }

    const result = await tx.run(
      `INSERT INTO wastage_log
         (raw_material_id, recipe_id, menu_item_id, quantity, unit, reason, logged_by, notes, employee_id, shift, photo_url, business_day_id, source_type, source_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        resolvedRawMaterialId,
        resolvedRecipeId,
        menu_item_id || null,
        qty,
        unit || null,
        reason || 'other',
        logged_by || null,
        notes || null,
        employee_id || null,
        shift || null,
        photo_url || null,
        businessDayId,
        source_type,
        source_id,
      ]
    );
    const wastageId = result.lastInsertRowid;

    // Ledger writes the quantity, the moving-average-aware cost basis and the
    // stock_movements row in one place.
    const stock = deductStock
      ? await deductRawMaterials(tx, deltaMap, {
          direction: -1,
          changeType: 'wastage',
          performedBy: logged_by,
          reason: reason || 'other',
          referenceId: wastageId,
          businessDayId,
        })
      : {
          deducted: await Promise.all(Array.from(deltaMap, async ([inventoryItemId, amount]) => {
            const item = await tx.get('SELECT item_name, cost_per_unit FROM inventory_items WHERE id = ?', [inventoryItemId]);
            const unitCost = Number(item?.cost_per_unit || 0);
            return {
              inventory_item_id: inventoryItemId,
              name: item?.item_name || `Item #${inventoryItemId}`,
              amount: Number(amount),
              unit_cost: unitCost,
              cost_value: Number(amount) * unitCost,
            };
          })),
          warnings: [],
        };

    // Value the loss at the cost basis the ledger recorded, then post it as a
    // real expense so food cost isn't understated.
    const totalCost = stock.deducted.reduce((sum, d) => sum + Number(d.cost_value || 0), 0);
    await tx.run(`UPDATE wastage_log SET total_cost = ? WHERE id = ?`, [totalCost, wastageId]);

    let expense_id = null;
    if (totalCost > 0) {
      const label = stock.deducted.map((d) => d.name).join(', ') || 'Wastage';
      expense_id = await upsertLinkedExpense(tx, 'wastage', wastageId, {
        description: `Inventory loss — ${label} (${reason || 'other'})`,
        category: 'inventory_loss',
        amount: totalCost,
        notes: notes || null,
        payment_method: 'none',
        logged_by: logged_by || null,
        receipt_url: photo_url || null,
      });
    }

    return { id: wastageId, stock, total_cost: totalCost, expense_id, warnings: stock.warnings };
  };

  return withinTransaction ? performWrite(db) : db.transaction(performWrite);
}

export async function logWastage(db, entry, options = {}) {
  return writeWastage(db, entry, options);
}

/**
 * Record food that was already consumed from inventory by an order. This logs
 * and costs the loss without deducting the same ingredients a second time.
 */
export async function logPreparedItemWastage(db, entry, { withinTransaction = false } = {}) {
  return writeWastage(db, {
    ...entry,
    reason: entry.reason || 'returned',
    unit: entry.unit || 'portion',
  }, { withinTransaction, deductStock: false });
}

/** Reverse the exact stock and expense effects of one wastage event. */
export async function voidWastage(db, id, { reason, performedBy = null } = {}) {
  const cleanReason = String(reason || '').trim();
  if (!cleanReason) throw Object.assign(new Error('A reason is required to void wastage.'), { status: 400 });
  await ensureRecipeTables(db);
  const businessDayId = await currentBusinessDayId(db, { required: true, allowStale: true });
  return db.transaction(async (tx) => {
    const row = await tx.get(`SELECT * FROM wastage_log WHERE id=?`, [id]);
    if (!row) throw Object.assign(new Error('Wastage record not found.'), { status: 404 });
    if (String(row.status || 'active').toLowerCase() === 'voided') {
      throw Object.assign(new Error('This wastage record is already voided.'), { status: 409 });
    }
    const movements = await tx.all(
      `SELECT inventory_item_id,quantity_changed FROM stock_movements
       WHERE change_type='wastage' AND reference_id=? ORDER BY id`,
      [String(id)]
    );
    await applyStockChanges(tx, movements.map((movement) => ({
      inventory_item_id: movement.inventory_item_id,
      quantity: Math.max(0, -Number(movement.quantity_changed || 0)),
    })), {
      change_type: 'manual_adjustment', performed_by: performedBy,
      reason: `Void wastage #${id}: ${cleanReason}`, reference_id: id, business_day_id: businessDayId,
    });
    await voidLinkedExpense(tx, 'wastage', id, {
      reason: cleanReason, performedBy, businessDayId, withinTransaction: true,
    });
    await tx.run(
      `UPDATE wastage_log SET status='voided',void_reason=?,voided_at=CURRENT_TIMESTAMP,voided_by=? WHERE id=?`,
      [cleanReason, performedBy, id]
    );
    return tx.get(`SELECT * FROM wastage_log WHERE id=?`, [id]);
  });
}

const WASTAGE_SORTS = {
  created_at: 'w.created_at',
  item: 'im.item_name',
  quantity: 'w.quantity',
  reason: 'w.reason',
  cost: 'w.total_cost',
  employee_name: 'e.full_name',
  shift: 'w.shift',
};

const WASTAGE_SEARCH_COLUMNS = ['im.item_name', 'r.name', 'mi.name', 'wk.kot_number', 'w.reason', 'w.notes', 'w.shift', 'e.full_name', 'u.full_name'];

/** @returns {{ rows: any[], pagination: object }} */
export async function listWastage(
  db,
  { reason, from, to, page = 1, pageSize = 50, exportAll = false, sort = '', dir = 'DESC', search = '' } = {}
) {
  const conditions = ["LOWER(COALESCE(w.status,'active'))<>'voided'"];
  const params = [];

  if (reason && reason !== 'all') {
    conditions.push('w.reason = ?');
    params.push(reason);
  }
  if (from) {
    conditions.push("date(w.created_at, '+5 hours', '+45 minutes') >= date(?)");
    params.push(from);
  }
  if (to) {
    conditions.push("date(w.created_at, '+5 hours', '+45 minutes') <= date(?)");
    params.push(to);
  }

  const searchClause = buildSearch(search, WASTAGE_SEARCH_COLUMNS);
  if (searchClause.clause) {
    conditions.push(searchClause.clause);
    params.push(...searchClause.params);
  }

  return paginateQuery(db, {
    // expense_amount replaces what the page used to work out by fetching every
    // inventory_loss expense and matching source_id in the browser.
    columns: `w.*, im.item_name as raw_material_name, r.name as recipe_name, mi.name as menu_item_name,
              wk.kot_number as source_kot_number,
              (SELECT b.id FROM bills b WHERE b.order_id = wk.order_id ORDER BY b.id DESC LIMIT 1) AS source_bill_id,
              u.full_name as logged_by_name, e.full_name as employee_name,
              (SELECT x.amount FROM expenses x
                WHERE x.source_type = 'wastage' AND x.source_id = w.id
                  AND LOWER(COALESCE(x.status,'active'))<>'voided'
                LIMIT 1) AS expense_amount`,
    from: `wastage_log w
      LEFT JOIN inventory_items im ON w.raw_material_id = im.id
      LEFT JOIN recipes r ON w.recipe_id = r.id
      LEFT JOIN menu_items mi ON w.menu_item_id = mi.id
      LEFT JOIN kots wk ON w.source_id = wk.id AND w.source_type IN ('kot_cancellation','kot_item_cancellation')
      LEFT JOIN users u ON w.logged_by = u.id
      LEFT JOIN users e ON w.employee_id = e.id`,
    where: conditions.join(' AND '),
    params,
    orderBy: resolveOrderBy(sort, dir, WASTAGE_SORTS, 'created_at', 'w.id'),
    page,
    pageSize,
    exportAll,
  });
}
