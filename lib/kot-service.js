/**
 * Admin single-operator KOT engine.
 *
 * Turns the shared kitchen `kots` / `kot_items` tables into an immutable
 * production record: each KOT is a snapshot of the quantities that were unsent
 * at issue time, with a per-order sequence, human-readable number, issuing
 * administrator, reprint counter and idempotency guard.
 *
 * Reuses the existing lifecycle — inventory is deducted by OrderRepository when
 * items are ADDED to the order (see lib/stock.js), so issuing a KOT never
 * touches stock (never double-consumes). Cancelling a *sent* item either
 * reverses that consumption (not yet prepared) or leaves it consumed as wastage
 * (already prepared). Revenue / AR / VAT post once at payment via the existing
 * split-payment engine — a KOT never posts an accounting entry.
 */

import Database from '@/lib/db/index.js';
import { ensureColumn, serialPkSql } from '@/lib/db/schema-helpers.js';
import { restoreStockForItems } from '@/lib/stock.js';
import { nextDocumentNumber } from '@/lib/document-numbers.js';
import { businessDayIdForExistingWork, currentBusinessDayId } from '@/lib/business-days.js';
import { tableStatusFromOrder } from '@/lib/restaurant-status.js';
import { expandComboItems } from '@/lib/combos.js';
import { ensureRecipeTables, logPreparedItemWastage } from '@/lib/recipes.js';

const ACTIVE = `COALESCE(oi.status, '') NOT IN ('voided', 'cancelled')`;

let schemaReady = false;

/** Idempotently add the immutable-KOT columns + audit log on either driver. */
export async function ensureKotProSchema(db) {
  if (schemaReady && db.driver !== 'sqlite') return; // sqlite dev DB is cheap to re-check
  // Ensure base tables exist (SQLite dev DBs create them lazily elsewhere too).
  const pk = serialPkSql(db);
  await db.run(`CREATE TABLE IF NOT EXISTS kots (
    ${pk}, kot_number TEXT, order_id INTEGER NOT NULL, station TEXT DEFAULT 'main',
    status TEXT DEFAULT 'pending', prepared_by INTEGER,
    printed_at ${db.driver === 'postgres' ? 'TIMESTAMP' : 'DATETIME'} DEFAULT CURRENT_TIMESTAMP,
    started_at ${db.driver === 'postgres' ? 'TIMESTAMP' : 'DATETIME'},
    completed_at ${db.driver === 'postgres' ? 'TIMESTAMP' : 'DATETIME'})`).catch(() => {});
  await db.run(`CREATE TABLE IF NOT EXISTS kot_items (
    ${pk}, kot_id INTEGER NOT NULL, order_item_id INTEGER, menu_item_id INTEGER,
    quantity INTEGER NOT NULL DEFAULT 1, special_instructions TEXT, status TEXT DEFAULT 'pending')`).catch(() => {});

  // Each ensure is soft — cPanel app users often cannot ALTER tables they don't own.
  await ensureColumn(db, 'order_items', 'sent_quantity', 'INTEGER DEFAULT 0');
  await ensureColumn(db, 'order_items', 'variant_name', 'TEXT');
  await ensureColumn(db, 'orders', 'party_label', 'TEXT');

  for (const [col, ddl] of [
    ['sequence', 'INTEGER DEFAULT 1'], ['table_id', 'INTEGER'], ['table_number', 'TEXT'],
    ['order_type', 'TEXT'], ['kot_type', "TEXT DEFAULT 'new'"], ['issued_by', 'INTEGER'],
    ['issued_by_name', 'TEXT'], ['order_notes', 'TEXT'], ['reprint_count', 'INTEGER DEFAULT 0'],
    ['last_printed_at', db.driver === 'postgres' ? 'TIMESTAMP' : 'DATETIME'],
    ['amends_kot_id', 'INTEGER'], ['voided', 'INTEGER DEFAULT 0'], ['idempotency_key', 'TEXT'],
    ['void_reason', 'TEXT'], ['voided_at', db.driver === 'postgres' ? 'TIMESTAMP' : 'DATETIME'],
    ['cancel_reason', 'TEXT'], ['cancelled_at', db.driver === 'postgres' ? 'TIMESTAMP' : 'DATETIME'],
    ['cancelled_by', 'INTEGER'], ['previous_status', 'TEXT'],
  ]) {
    try { await ensureColumn(db, 'kots', col, ddl); } catch (e) {
      console.warn(`ensureKotProSchema(kots.${col}):`, e?.message || e);
    }
  }

  for (const [col, ddl] of [
    ['item_name', 'TEXT'], ['variant_name', 'TEXT'], ['is_cancellation', 'INTEGER DEFAULT 0'], ['combo_units', 'INTEGER'],
  ]) {
    try { await ensureColumn(db, 'kot_items', col, ddl); } catch (e) {
      console.warn(`ensureKotProSchema(kot_items.${col}):`, e?.message || e);
    }
  }

  await db.run(
    'CREATE UNIQUE INDEX IF NOT EXISTS ux_kots_idempotency_key ON kots(idempotency_key)' +
      (db.driver === 'postgres' ? ' WHERE idempotency_key IS NOT NULL' : '')
  ).catch(() => {});

  await db.run(`CREATE TABLE IF NOT EXISTS pos_audit_log (
    ${pk}, action TEXT NOT NULL, actor_id INTEGER, actor_name TEXT, order_id INTEGER,
    table_id INTEGER, kot_id INTEGER, bill_id INTEGER, reason TEXT,
    previous_value TEXT, new_value TEXT, detail TEXT,
    created_at ${db.driver === 'postgres' ? 'TIMESTAMP' : 'DATETIME'} DEFAULT CURRENT_TIMESTAMP)`).catch(() => {});

  schemaReady = true;
}

/** Append-only audit event. Best-effort — never breaks the caller. */
export async function logPosEvent(db, event = {}) {
  try {
    await ensureKotProSchema(db);
    await db.run(
      `INSERT INTO pos_audit_log
        (action, actor_id, actor_name, order_id, table_id, kot_id, bill_id, reason, previous_value, new_value, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        event.action, event.actor_id ?? null, event.actor_name ?? null, event.order_id ?? null,
        event.table_id ?? null, event.kot_id ?? null, event.bill_id ?? null, event.reason ?? null,
        event.previous_value != null ? String(event.previous_value) : null,
        event.new_value != null ? String(event.new_value) : null,
        event.detail != null ? (typeof event.detail === 'string' ? event.detail : JSON.stringify(event.detail)) : null,
      ]
    );
  } catch (e) {
    // Audit must never take down the primary operation.
    console.error('pos_audit_log insert failed:', e?.message);
  }
}

/** Rows of a KOT snapshot, joined to the order line for the current live status. */
async function kotItems(db, kotId) {
  return db.all(
    `SELECT ki.*, ki.id AS kot_item_id,
            COALESCE(ki.item_name, oi.item_name, mi.name) AS item_name,
            COALESCE(ki.variant_name, oi.variant_name) AS variant_name
     FROM kot_items ki
     LEFT JOIN order_items oi ON ki.order_item_id = oi.id
     LEFT JOIN menu_items mi ON COALESCE(ki.menu_item_id, oi.menu_item_id, oi.item_id) = mi.id
     WHERE ki.kot_id = ? ORDER BY ki.id`,
    [kotId]
  );
}

/** One KOT with its immutable line snapshot. */
export async function getKot(db, kotId) {
  await ensureKotProSchema(db);
  const kot = await db.get(
    `SELECT k.*, k.id AS kot_id, COALESCE(k.kot_number, 'KOT-' || k.id) AS kot_number,
            o.order_number
     FROM kots k LEFT JOIN orders o ON k.order_id = o.id WHERE k.id = ?`,
    [kotId]
  );
  if (!kot) return null;
  kot.items = await kotItems(db, kotId);
  return kot;
}

/** All KOTs for an order, newest first, each with its snapshot lines. */
export async function getKotsForOrder(db, orderId) {
  await ensureKotProSchema(db);
  const kots = await db.all(
    `SELECT k.*, k.id AS kot_id, COALESCE(k.kot_number, 'KOT-' || k.id) AS kot_number
     FROM kots k WHERE k.order_id = ? ORDER BY k.sequence ASC, k.id ASC`,
    [orderId]
  );
  for (const k of kots) k.items = await kotItems(db, k.kot_id);
  return kots;
}

/**
 * Full POS workspace for one order: header, live items (with unsent quantity),
 * KOT history and the current bill / payment state.
 */
export async function getOrderWorkspace(db, orderId) {
  await ensureKotProSchema(db);
  const order = await db.get(
    `SELECT o.*, o.id AS order_id, COALESCE(t.table_number, o.table_number) AS table_number,
            t.id AS table_id
     FROM orders o LEFT JOIN tables t ON o.table_id = t.id WHERE o.id = ?`,
    [orderId]
  );
  if (!order) return null;

  const items = await db.all(
    `SELECT oi.*, oi.id AS order_item_id,
            COALESCE(oi.item_name, mi.name) AS item_name,
            COALESCE(oi.sent_quantity, 0) AS sent_quantity,
            (oi.quantity - COALESCE(oi.sent_quantity, 0)) AS unsent_quantity,
            mi.image_url AS image_url, mi.category_id AS category_id, mc.name AS category
     FROM order_items oi
     LEFT JOIN menu_items mi ON COALESCE(oi.menu_item_id, oi.item_id) = mi.id
     LEFT JOIN menu_categories mc ON mi.category_id = mc.id
     WHERE oi.order_id = ? AND ${ACTIVE}
     ORDER BY oi.id`,
    [orderId]
  );

  const kots = await getKotsForOrder(db, orderId);
  const bill = await db.get(
    `SELECT * FROM bills WHERE order_id = ? ORDER BY
       CASE WHEN status = 'reopened' THEN 0 WHEN status = 'paid' THEN 1 ELSE 2 END,
       id DESC LIMIT 1`,
    [orderId]
  );
  let allocations = [];
  if (bill) {
    allocations = await db.all(
      `SELECT method, amount, provider, reference_number AS reference, due_date
       FROM bill_payment_allocations WHERE bill_id = ? ORDER BY id`,
      [bill.id]
    ).catch(() => []);
  }

  const unsentCount = items.reduce((n, it) => n + Math.max(0, Number(it.unsent_quantity) || 0), 0);
  const isReopened = String(bill?.status || '').toLowerCase() === 'reopened';
  let alreadyPaid = 0;
  if (isReopened && bill) {
    const paidRow = await db.get(
      `SELECT COALESCE(SUM(amount), 0) AS s FROM bill_payments WHERE bill_id = ?`,
      [bill.id]
    ).catch(() => null);
    alreadyPaid = Number(paidRow?.s ?? bill.grand_total ?? 0);
  }

  return {
    order,
    items,
    kots,
    bill: bill || null,
    payments: allocations,
    unsent_count: unsentCount,
    kot_count: kots.filter((k) => !k.voided && k.kot_type !== 'cancellation').length,
    reopened: isReopened,
    already_paid: alreadyPaid,
    reopen_original: isReopened && bill ? {
      subtotal: Number(bill.subtotal || 0),
      discount: Number(bill.discount_amount || 0),
      tax: Number(bill.tax ?? bill.vat_amount ?? 0),
      tax_percent: Number(bill.tax_percent || 0),
      service_charge: Number(bill.service_charge || 0),
      service_charge_percent: Number(bill.service_charge_percent || 0),
      delivery_fee: Number(bill.delivery_fee || 0),
      grand_total: Number(bill.grand_total || 0),
    } : null,
  };
}

const fail = (message, status = 400, code = null) =>
  { throw Object.assign(new Error(message), { status, code }); };

/**
 * Cancel every kitchen ticket when its parent order is cancelled/voided.
 * `previous_status` preserves whether kitchen work was pending, preparing or
 * completed before the table was cleared.
 */
export async function cancelKotsForOrder(db, { orderId, reason, actorId = null }) {
  await ensureKotProSchema(db);
  const cleanReason = String(reason || '').trim() || 'Order cancelled';
  return db.run(
    `UPDATE kots
        SET previous_status = CASE
              WHEN LOWER(COALESCE(status, 'pending')) != 'cancelled' THEN COALESCE(status, 'pending')
              ELSE previous_status
            END,
            status = 'cancelled',
            voided = 1,
            cancel_reason = COALESCE(NULLIF(cancel_reason, ''), ?),
            void_reason = COALESCE(NULLIF(void_reason, ''), ?),
            cancelled_at = COALESCE(cancelled_at, CURRENT_TIMESTAMP),
            cancelled_by = COALESCE(cancelled_by, ?),
            voided_at = COALESCE(voided_at, CURRENT_TIMESTAMP)
      WHERE order_id = ?
        AND (LOWER(COALESCE(status, 'pending')) != 'cancelled' OR COALESCE(voided, 0) = 0)`,
    [cleanReason, cleanReason, actorId, orderId]
  );
}

async function assertCurrentDayRecord(db, table, id) {
  return businessDayIdForExistingWork(db, table, id);
}

/**
 * After a KOT or a sent item is cancelled, the order/table can be left in a
 * stale "cooking"/"preparing" state even though nothing is left to cook:
 *  - cancelling an item doesn't touch the original KOT it was issued on, so
 *    that ticket sits "pending" on the kitchen board forever for food that
 *    will never be made — auto-resolve it once every item on it is gone.
 *  - the order/table status then needs to fall back to reflect what (if
 *    anything) is actually still being prepared.
 * Called at the end of cancelKot/cancelSentItem, inside their transaction.
 */
async function reconcileOrderAfterKotChange(tx, orderId) {
  const order = await tx.get(`SELECT * FROM orders WHERE id = ?`, [orderId]);
  if (!order || ['completed', 'cancelled'].includes(String(order.status || ''))) return;

  const openKots = await tx.all(
    `SELECT id FROM kots WHERE order_id = ? AND COALESCE(voided, 0) = 0
       AND COALESCE(kot_type, 'new') != 'cancellation' AND COALESCE(status, 'pending') IN ('pending', 'preparing')`,
    [orderId]
  );
  for (const kot of openKots) {
    const unresolved = await tx.get(
      `SELECT COUNT(*) AS n FROM kot_items ki
         JOIN order_items oi ON oi.id = ki.order_item_id
        WHERE ki.kot_id = ? AND COALESCE(ki.is_cancellation, 0) = 0
          AND COALESCE(oi.status, '') NOT IN ('voided', 'cancelled')`,
      [kot.id]
    );
    if (Number(unresolved?.n || 0) === 0) {
      await tx.run(
        `UPDATE kots SET status = 'cancelled', voided = 1, previous_status = status,
           void_reason = COALESCE(void_reason, 'All items on this ticket were cancelled.'),
           voided_at = COALESCE(voided_at, CURRENT_TIMESTAMP)
         WHERE id = ?`,
        [kot.id]
      );
    }
  }

  const activeKot = await tx.get(
    `SELECT id FROM kots WHERE order_id = ? AND COALESCE(voided, 0) = 0
       AND COALESCE(kot_type, 'new') != 'cancellation' AND COALESCE(status, 'pending') IN ('pending', 'preparing')
       LIMIT 1`,
    [orderId]
  );
  const sentLeft = await tx.get(
    `SELECT COALESCE(SUM(COALESCE(sent_quantity, 0)), 0) AS sent FROM order_items
      WHERE order_id = ? AND COALESCE(status, '') NOT IN ('voided', 'cancelled')`,
    [orderId]
  );
  const stillPreparing = ['preparing', 'ready', 'dining', 'served'].includes(String(order.status || ''));
  if (!activeKot && Number(sentLeft?.sent || 0) <= 0 && stillPreparing) {
    await tx.run(`UPDATE orders SET status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [orderId]);
    if (order.table_id) {
      await tx.run(
        `UPDATE tables SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [tableStatusFromOrder('pending'), order.table_id]
      ).catch(() => {});
    }
  }
}

/**
 * Save + issue a KOT for the currently unsent quantities of an order.
 * Idempotent on `idempotencyKey`. Never creates a zero-item KOT.
 */
export async function issueKot(db, { orderId, actor = {}, idempotencyKey = null, orderNotes = null }) {
  await ensureKotProSchema(db);
  await assertCurrentDayRecord(db, 'orders', orderId);

  // Fast idempotency short-circuit (unique index still guards the race).
  if (idempotencyKey) {
    const prior = await db.get('SELECT id FROM kots WHERE idempotency_key = ?', [idempotencyKey]);
    if (prior) return { idempotent: true, kot: await getKot(db, prior.id) };
  }

  const result = await db.transaction(async (tx) => {
    const lock = tx.driver === 'postgres' ? ' FOR UPDATE' : '';
    const order = await tx.get(`SELECT * FROM orders WHERE id = ?${lock}`, [orderId]);
    if (!order) fail('This order could not be found.', 404);
    if (['completed', 'cancelled'].includes(String(order.status || ''))) {
      fail('This order can no longer accept kitchen tickets.', 409);
    }

    if (idempotencyKey) {
      const prior = await tx.get('SELECT id FROM kots WHERE idempotency_key = ?', [idempotencyKey]);
      if (prior) return { idempotent: true, kotId: prior.id };
    }

    const unsent = await tx.all(
      `SELECT oi.*, oi.id AS order_item_id,
              COALESCE(oi.item_name, mi.name) AS item_name,
              mi.is_available AS is_available,
              (oi.quantity - COALESCE(oi.sent_quantity, 0)) AS unsent_quantity
       FROM order_items oi
       LEFT JOIN menu_items mi ON COALESCE(oi.menu_item_id, oi.item_id) = mi.id
       WHERE oi.order_id = ? AND ${ACTIVE} AND (oi.quantity - COALESCE(oi.sent_quantity, 0)) > 0
       ORDER BY oi.id`,
      [orderId]
    );
    if (!unsent.length) fail('There are no new items to send to the kitchen.', 409, 'no_unsent_items');

    // Revalidate availability at issue time.
    for (const it of unsent) {
      if (it.menu_item_id && it.is_available === 0) {
        fail(`"${it.item_name}" is no longer available.`, 409, 'item_unavailable');
      }
    }

    const seqRow = await tx.get('SELECT COALESCE(MAX(sequence), 0) AS m FROM kots WHERE order_id = ?', [orderId]);
    const sequence = Number(seqRow?.m || 0) + 1;
    const kotType = sequence === 1 ? 'new' : 'additional';
    const kotNumber = await nextDocumentNumber(tx, { type: 'kot', prefix: 'KOT', order });

    const businessDayId = order.business_day_id || await currentBusinessDayId(tx, { required: true, allowStale: true });
    const ins = await tx.run(
      `INSERT INTO kots
        (kot_number, order_id, station, status, sequence, table_id, table_number, order_type,
         kot_type, issued_by, issued_by_name, order_notes, reprint_count, printed_at, last_printed_at, idempotency_key, business_day_id)
       VALUES (?, ?, 'main', 'pending', ?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?)`,
      [kotNumber, orderId, sequence, order.table_id || null, order.table_number || null,
        order.order_type || null, kotType, actor.id || null, actor.full_name || actor.name || null,
        orderNotes ?? order.notes ?? null, idempotencyKey, businessDayId]
    );
    const kotId = ins.lastInsertRowid;

    for (const it of unsent) {
      const expanded = await expandComboItems(tx, [{ ...it, quantity: it.unsent_quantity }], { requireAvailable: true });
      const isCombo = expanded.some((component) => Number(component.combo_menu_item_id) === Number(it.menu_item_id || it.item_id));
      if (isCombo) {
        for (const component of expanded) {
          const note = [`Combo: ${it.item_name}`, it.special_instructions].filter(Boolean).join(' | ');
          await tx.run(
            `INSERT INTO kot_items
              (kot_id, order_item_id, menu_item_id, quantity, special_instructions, status, item_name, variant_name, is_cancellation, combo_units)
             VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, 0, ?)`,
            [kotId, it.order_item_id, component.menu_item_id, component.quantity,
              note, component.item_name, component.variant_name || null, it.unsent_quantity]
          );
        }
      } else {
        await tx.run(
          `INSERT INTO kot_items
            (kot_id, order_item_id, menu_item_id, quantity, special_instructions, status, item_name, variant_name, is_cancellation, combo_units)
           VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, 0, NULL)`,
          [kotId, it.order_item_id, it.menu_item_id || it.item_id || null, it.unsent_quantity,
            it.special_instructions || null, it.item_name || null, it.variant_name || null]
        );
      }
      await tx.run('UPDATE order_items SET sent_quantity = quantity WHERE id = ?', [it.order_item_id]);
    }

    // Any new ticket is active kitchen work, including items added after reopen.
    if (['pending', 'dining', 'served', 'awaiting_payment'].includes(String(order.status))) {
      await tx.run("UPDATE orders SET status = 'preparing', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [orderId]);
      if (order.table_id) {
        await tx.run("UPDATE tables SET status = 'cooking', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [order.table_id]);
      }
    }

    return { kotId, sequence, kotNumber, table_id: order.table_id };
  });

  if (result.idempotent) return { idempotent: true, kot: await getKot(db, result.kotId) };

  await logPosEvent(db, {
    action: 'kot_issued', actor_id: actor.id, actor_name: actor.full_name || actor.name,
    order_id: orderId, table_id: result.table_id, kot_id: result.kotId,
    new_value: result.kotNumber, detail: { sequence: result.sequence },
  });
  return { kot: await getKot(db, result.kotId) };
}

/** Reprint an existing KOT snapshot. Never rebuilds from live order data. */
export async function reprintKot(db, { kotId, actor = {} }) {
  await ensureKotProSchema(db);
  const existing = await db.get('SELECT * FROM kots WHERE id = ?', [kotId]);
  if (!existing) fail('This kitchen ticket could not be found.', 404);
  await db.run(
    'UPDATE kots SET reprint_count = COALESCE(reprint_count, 0) + 1, last_printed_at = CURRENT_TIMESTAMP WHERE id = ?',
    [kotId]
  );
  await logPosEvent(db, {
    action: 'kot_reprinted', actor_id: actor.id, actor_name: actor.full_name || actor.name,
    order_id: existing.order_id, kot_id: kotId,
    previous_value: existing.reprint_count, new_value: Number(existing.reprint_count || 0) + 1,
  });
  const kot = await getKot(db, kotId);
  kot.is_reprint = true;
  return { kot };
}

/** Cancel a KOT snapshot with a mandatory reason. Keeps the row for history. */
export async function cancelKot(db, { kotId, reason, prepared = false, actor = {} }) {
  await ensureKotProSchema(db);
  if (prepared) await ensureRecipeTables(db);
  await assertCurrentDayRecord(db, 'kots', kotId);
  const cleanReason = String(reason || '').trim();
  if (!cleanReason) fail('A reason is required to cancel a KOT.', 400, 'reason_required');

  const outcome = await db.transaction(async (tx) => {
    const lock = tx.driver === 'postgres' ? ' FOR UPDATE' : '';
    const existing = await tx.get(`SELECT * FROM kots WHERE id = ?${lock}`, [kotId]);
    if (!existing) fail('This kitchen ticket could not be found.', 404);

    const status = String(existing.status || '').toLowerCase();
    if (status === 'cancelled' || Number(existing.voided || 0) === 1) {
      fail('This kitchen ticket is already cancelled.', 409);
    }
    if (String(existing.kot_type || '').toLowerCase() === 'cancellation') {
      fail('Cancellation KOTs are already historical records.', 409);
    }
    if (!['pending', 'preparing'].includes(status || 'pending')) {
      fail('Only active KOTs can be cancelled. Completed KOTs must remain in history.', 409);
    }

    const order = await tx.get(`SELECT * FROM orders WHERE id = ?${lock}`, [existing.order_id]);
    if (!order) fail('The order linked to this KOT could not be found.', 404);
    if (['completed', 'cancelled'].includes(String(order.status || '').toLowerCase())) {
      fail('KOTs for completed or cancelled orders cannot be cancelled from the KOT board.', 409);
    }

    const items = await tx.all(
      `SELECT ki.*, oi.sent_quantity, oi.quantity AS order_quantity,
              COALESCE(ki.menu_item_id, oi.menu_item_id, oi.item_id) AS resolved_menu_item_id
       FROM kot_items ki
       LEFT JOIN order_items oi ON ki.order_item_id = oi.id
       WHERE ki.kot_id = ?`,
      [kotId]
    );

    const adjustedOrderItems = new Set();
    for (const item of items || []) {
      if (!item.order_item_id || Number(item.is_cancellation || 0) === 1) continue;
      if (adjustedOrderItems.has(Number(item.order_item_id))) continue;
      adjustedOrderItems.add(Number(item.order_item_id));
      const sent = Number(item.sent_quantity || 0);
      const qty = Number(item.combo_units ?? item.quantity ?? 0);
      await tx.run(
        `UPDATE order_items
         SET sent_quantity = CASE
           WHEN COALESCE(sent_quantity, 0) - ? < 0 THEN 0
           ELSE COALESCE(sent_quantity, 0) - ?
         END
         WHERE id = ?`,
        [qty, qty, item.order_item_id]
      );
    }

    await tx.run(
      `UPDATE kots
       SET status = 'cancelled',
           voided = 1,
           cancel_reason = ?,
           cancelled_at = CURRENT_TIMESTAMP,
           cancelled_by = ?,
           previous_status = ?,
           void_reason = COALESCE(void_reason, ?),
           voided_at = COALESCE(voided_at, CURRENT_TIMESTAMP),
           order_notes = COALESCE(NULLIF(order_notes, ''), ?)
       WHERE id = ?`,
      [cleanReason, actor.id || null, existing.status || null, cleanReason, `CANCELLED: ${cleanReason}`, kotId]
    );

    const wastage = [];
    if (prepared) {
      for (const item of items || []) {
        if (!item.resolved_menu_item_id || Number(item.is_cancellation || 0) === 1 || Number(item.quantity || 0) <= 0) continue;
        wastage.push(await logPreparedItemWastage(tx, {
          menu_item_id: item.resolved_menu_item_id,
          quantity: Number(item.quantity),
          logged_by: actor.id || null,
          employee_id: actor.id || null,
          business_day_id: existing.business_day_id || order.business_day_id || null,
          source_type: 'kot_cancellation',
          source_id: kotId,
          notes: `Prepared item cancelled from ${existing.kot_number || `KOT-${kotId}`}: ${cleanReason}`,
        }, { withinTransaction: true }));
      }
    }

    await reconcileOrderAfterKotChange(tx, existing.order_id);

    return { existing, wastage };
  });
  await logPosEvent(db, {
    action: 'kot_cancelled',
    actor_id: actor.id,
    actor_name: actor.full_name || actor.name,
    order_id: outcome.existing.order_id,
    table_id: outcome.existing.table_id,
    kot_id: kotId,
    reason: cleanReason,
    previous_value: outcome.existing.status,
    new_value: 'cancelled',
    detail: { prepared, wastage_ids: outcome.wastage.map((entry) => entry.id) },
  });

  return { kot: await getKot(db, kotId), wastage: outcome.wastage };
}

/**
 * Cancel a *sent* order line (already on a KOT). Requires a reason, keeps the
 * original KOT untouched, writes a cancellation KOT, and reverses inventory
 * only when the item was not yet prepared.
 */
export async function cancelSentItem(db, { orderId, orderItemId, quantity = null, reason, prepared = false, actor = {} }) {
  await ensureKotProSchema(db);
  if (prepared) await ensureRecipeTables(db);
  await assertCurrentDayRecord(db, 'orders', orderId);
  const cleanReason = String(reason || '').trim();
  if (!cleanReason) fail('A reason is required to cancel a sent item.', 400, 'reason_required');

  const outcome = await db.transaction(async (tx) => {
    const lock = tx.driver === 'postgres' ? ' FOR UPDATE' : '';
    const order = await tx.get(`SELECT * FROM orders WHERE id = ?${lock}`, [orderId]);
    if (!order) fail('This order could not be found.', 404);
    if (['completed', 'cancelled'].includes(String(order.status || ''))) {
      fail('This order can no longer be edited.', 409);
    }
    const item = await tx.get('SELECT * FROM order_items WHERE id = ? AND order_id = ?', [orderItemId, orderId]);
    if (!item) fail('Order item not found.', 404);
    if (['voided', 'cancelled'].includes(String(item.status || ''))) fail('This item is already cancelled.', 409);
    if (Number(item.sent_quantity || 0) <= 0) {
      fail('This item was never sent to the kitchen — remove it from the draft instead.', 409, 'not_sent');
    }

    const liveQty = Number(item.quantity);
    const cancelQty = quantity == null ? liveQty : Math.min(liveQty, Math.max(1, parseInt(quantity, 10)));
    const unitPrice = Number(item.price || 0);
    const remaining = liveQty - cancelQty;

    if (remaining <= 0) {
      await tx.run(
        `UPDATE order_items SET status = 'cancelled',
           special_instructions = COALESCE(special_instructions, '') || ?
         WHERE id = ?`,
        [`\nCancelled (${prepared ? 'wastage' : 'stock returned'}): ${cleanReason}`, orderItemId]
      );
    } else {
      await tx.run(
        `UPDATE order_items SET quantity = ?, subtotal = ?, sent_quantity = ?,
           special_instructions = COALESCE(special_instructions, '') || ?
         WHERE id = ?`,
        [remaining, unitPrice * remaining, remaining, `\nReduced by ${cancelQty} (${cleanReason})`, orderItemId]
      );
    }

    // Inventory: reverse consumption only when the food was not yet prepared.
    // Prepared food stays consumed (recorded as wastage) — never auto-returned.
    if (!prepared) {
      await restoreStockForItems(tx, [{
        menu_item_id: item.menu_item_id || item.item_id,
        item_name: item.item_name,
        variant_name: item.variant_name,
        quantity: cancelQty,
        combo_snapshot: item.combo_snapshot,
      }], { orderId, reason: `Sent item cancelled before prep: ${cleanReason}` });
    }

    const seqRow = await tx.get('SELECT COALESCE(MAX(sequence), 0) AS m FROM kots WHERE order_id = ?', [orderId]);
    const sequence = Number(seqRow?.m || 0) + 1;
    // A cancellation notice is a ticket for the same channel as its order, so
    // it carries the same prefix — K-D-014 cancels against K-D-011.
    const kotNumber = await nextDocumentNumber(tx, { type: 'kot', prefix: 'KOT', order });
    // Link the cancellation notice to the KOT that actually sent this line.
    // Linking to the newest ticket makes history look like an unrelated or
    // duplicate cancellation whenever several tickets exist on one order.
    const sourceKot = await tx.get(
      `SELECT ki.kot_id AS id
         FROM kot_items ki
         JOIN kots k ON k.id = ki.kot_id
        WHERE ki.order_item_id = ?
          AND COALESCE(ki.is_cancellation, 0) = 0
          AND COALESCE(k.kot_type, 'new') <> 'cancellation'
        ORDER BY k.sequence DESC, k.id DESC
        LIMIT 1`,
      [orderItemId]
    );
    const businessDayId = order.business_day_id || await currentBusinessDayId(tx, { required: true, allowStale: true });
    const ins = await tx.run(
      `INSERT INTO kots
        (kot_number, order_id, station, status, sequence, table_id, table_number, order_type,
         kot_type, issued_by, issued_by_name, order_notes, amends_kot_id, reprint_count, printed_at, last_printed_at, business_day_id)
       VALUES (?, ?, 'main', 'pending', ?, ?, ?, ?, 'cancellation', ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)`,
      [kotNumber, orderId, sequence, order.table_id || null, order.table_number || null,
        order.order_type || null, actor.id || null, actor.full_name || actor.name || null,
        `CANCEL: ${cleanReason}${prepared ? ' [WASTAGE]' : ''}`, sourceKot?.id || null, businessDayId]
    );
    const kotId = ins.lastInsertRowid;
    const expanded = await expandComboItems(tx, [{ ...item, quantity: cancelQty }]);
    const isCombo = expanded.some((component) => Number(component.combo_menu_item_id) === Number(item.menu_item_id || item.item_id));
    if (isCombo) {
      for (const component of expanded) {
        await tx.run(
          `INSERT INTO kot_items
            (kot_id, order_item_id, menu_item_id, quantity, special_instructions, status, item_name, variant_name, is_cancellation, combo_units)
           VALUES (?, ?, ?, ?, ?, 'cancelled', ?, ?, 1, ?)`,
          [kotId, orderItemId, component.menu_item_id, component.quantity,
            `Combo: ${item.item_name} | ${cleanReason}`, component.item_name, component.variant_name || null, cancelQty]
        );
      }
    } else {
      await tx.run(
        `INSERT INTO kot_items
          (kot_id, order_item_id, menu_item_id, quantity, special_instructions, status, item_name, variant_name, is_cancellation, combo_units)
         VALUES (?, ?, ?, ?, ?, 'cancelled', ?, ?, 1, NULL)`,
        [kotId, orderItemId, item.menu_item_id || item.item_id || null, cancelQty,
          cleanReason, item.item_name || null, item.variant_name || null]
      );
    }

    const wastage = [];
    if (prepared) {
      for (const component of expanded) {
        if (!(component.menu_item_id || item.menu_item_id || item.item_id) || Number(component.quantity || 0) <= 0) continue;
        wastage.push(await logPreparedItemWastage(tx, {
          menu_item_id: component.menu_item_id || item.menu_item_id || item.item_id || null,
          quantity: Number(component.quantity),
          logged_by: actor.id || null,
          employee_id: actor.id || null,
          business_day_id: businessDayId,
          source_type: 'kot_item_cancellation',
          source_id: kotId,
          notes: `Prepared item cancelled from order ${order.order_number || orderId}: ${cleanReason}`,
        }, { withinTransaction: true }));
      }
    }

    await reconcileOrderAfterKotChange(tx, orderId);

    return {
      kotId, kotNumber, cancelQty, prepared, wastage, table_id: order.table_id,
      item: {
        order_item_id: item.id,
        menu_item_id: item.menu_item_id || item.item_id || null,
        item_name: item.item_name,
        variant_name: item.variant_name,
        quantity: cancelQty,
        price: unitPrice,
        subtotal: unitPrice * cancelQty,
      },
    };
  });

  await logPosEvent(db, {
    action: 'kot_item_cancelled', actor_id: actor.id, actor_name: actor.full_name || actor.name,
    order_id: orderId, table_id: outcome.table_id, kot_id: outcome.kotId,
    reason: cleanReason, detail: { ...outcome.item, prepared: outcome.prepared, wastage_ids: outcome.wastage.map((entry) => entry.id) },
  });
  return { cancellation_kot: await getKot(db, outcome.kotId), workspace: await getOrderWorkspace(db, orderId), wastage: outcome.wastage };
}

export function getDb() {
  return Database.getInstance();
}
