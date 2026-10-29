import Database from '../index.js';
import { ensureColumn } from '../schema-helpers.js';
import { BILL_NUMBER_PATTERN, nextDocumentNumber } from '../../document-numbers.js';
import { businessDayIdForExistingWork, currentBusinessDayId } from '../../business-days.js';
import { ensureMenuVariantsSchema } from '../../menu-variants.js';
import { createComboSnapshot } from '../../combos.js';

const ACTIVE_ITEM_SQL = `COALESCE(oi.status, '') NOT IN ('voided', 'cancelled')`;

export class OrderRepository {
  constructor() {
    this.db = Database.getInstance();
  }

  async ensureCustomerIdColumn() {
    try {
      const { ensureColumn } = await import('../schema-helpers.js');
      await ensureColumn(this.db, 'orders', 'customer_id', 'INTEGER');
    } catch {
      /* already exists */
    }
  }

  async _getMenuItem(id) {
    return await this.db.get('SELECT id, name, base_price, is_available FROM menu_items WHERE id = ?', [id]);
  }

  async assertCurrentBusinessDay(orderId, { existingWork = false } = {}) {
    if (existingWork) return businessDayIdForExistingWork(this.db, 'orders', orderId);
    const businessDayId = await currentBusinessDayId(this.db, { required: true, allowStale: true });
    const order = await this.db.get('SELECT business_day_id FROM orders WHERE id=?', [orderId]);
    if (!order) throw Object.assign(new Error('Order not found.'), { status: 404 });
    if (Number(order.business_day_id || 0) !== Number(businessDayId)) {
      throw Object.assign(new Error('This order does not belong to the current business day.'), { status: 409 });
    }
    return businessDayId;
  }

  async _insertOrderItem(orderId, item) {
    const menuItem = await this._getMenuItem(item.menu_item_id);
    if (!menuItem || Number(menuItem.is_available) === 0) {
      throw Object.assign(new Error('One of the selected menu items is no longer available.'), { status: 409, code: 'item_unavailable' });
    }
    let name = item.item_name || item.name || menuItem?.name || 'Item';
    let variantName = null;
    let price = null;

    // A variant name is never trusted for price — always re-resolved from
    // menu_item_variants server-side, same rule as the public /orders API.
    if (item.variant_name && item.menu_item_id) {
      await ensureMenuVariantsSchema(this.db);
      const variant = await this.db.get(
        'SELECT variant_name, price, price_modifier FROM menu_item_variants WHERE menu_item_id = ? AND variant_name = ?',
        [item.menu_item_id, String(item.variant_name)]
      );
      if (!variant) throw Object.assign(new Error('The selected item variation is no longer available.'), { status: 409, code: 'variant_unavailable' });
      variantName = variant.variant_name;
      price = variant.price != null ? Number(variant.price) : Number(menuItem?.base_price || 0) + Number(variant.price_modifier || 0);
      name = `${menuItem?.name || name} (${variantName})`;
    }
    // Never accept the client cart price. It may be stale or tampered with.
    if (price == null) price = Number(menuItem?.base_price || 0);
    const quantity = Number(item.quantity || 1);
    const subtotal = price * quantity;
    const comboSnapshot = item.combo_snapshot || await createComboSnapshot(this.db, { ...item, item_name: name });

    // Live schema: price (not unit_price), optional item_id
    return await this.db.run(`
      INSERT INTO order_items (
        order_id, item_id, menu_item_id, item_name, variant_name,
        quantity, price, subtotal, special_instructions, status, combo_snapshot
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      orderId,
      item.menu_item_id,
      item.menu_item_id,
      name,
      variantName,
      quantity,
      price,
      subtotal,
      item.special_instructions || null,
      item.status || 'pending',
      comboSnapshot,
    ]);
  }
  
  async ensurePartyLabelColumn() {
    try {
      const { ensureColumn } = await import('../schema-helpers.js');
      await ensureColumn(this.db, 'orders', 'party_label', 'TEXT');
    } catch {
      /* ignore */
    }
  }

  async create(orderData) {
    await this.ensureCustomerIdColumn();
    await this.ensurePartyLabelColumn();
    const tableId = orderData.table_id || null;
    let tableNumber = orderData.table_number || null;
    const allowMultiple = Boolean(orderData.new_party || orderData.allow_multiple);
    const partyLabel = orderData.party_label || null;
    const businessDayId = orderData.business_day_id || await currentBusinessDayId(this.db, { required: true });

    if (tableId && !tableNumber) {
      const table = await this.db.get('SELECT table_number FROM tables WHERE id = ?', [tableId]);
      tableNumber = table?.table_number || null;
    }
    
    const { deductStockForItems, ensureStockSchema, markOrderStockConsumed, restoreOrderStockIfNeeded } = await import('../../stock.js');
    await ensureStockSchema(this.db);

    return await this.db.transaction(async () => {
      const orderNumber = await nextDocumentNumber(this.db, {
        type: 'order', prefix: 'ORD',
        order: { ...orderData, table_id: tableId, table_number: tableNumber },
      });
      const result = await this.db.run(`
        INSERT INTO orders (
          order_number, table_id, table_number, waiter_id, order_type,
          status, notes, customer_name, customer_phone, customer_id, party_label, business_day_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [
        orderNumber,
        tableId,
        tableNumber,
        orderData.waiter_id || null,
        orderData.order_type || 'dine_in',
        orderData.notes || null,
        orderData.customer_name || null,
        orderData.customer_phone || null,
        orderData.customer_id || null,
        partyLabel,
        businessDayId,
      ]);
      
      const orderId = result.lastInsertRowid;
      
      for (const item of orderData.items || []) {
        await this._insertOrderItem(orderId, item);
      }

      const stock = await deductStockForItems(this.db, orderData.items || [], {
        orderId,
        performedBy: orderData.waiter_id || null,
      });
      if (stock?.deducted?.length) {
        await markOrderStockConsumed(this.db, orderId);
      }
      
      if (tableId) {
        // Single-party open: cancel leftover open orders. Multi-party: keep siblings.
        if (!allowMultiple) {
          const siblings = await this.db.all(
            `SELECT * FROM orders
              WHERE table_id = ?
                AND id != ?
                AND status NOT IN ('completed', 'cancelled')`,
            [tableId, orderId]
          );
          if (siblings?.length) {
            await ensureColumn(this.db, 'orders', 'cancel_reason', 'TEXT').catch(() => {});
            await ensureColumn(this.db, 'orders', 'cancelled_at', this.db.driver === 'postgres' ? 'TIMESTAMP' : 'DATETIME').catch(() => {});
          }
          for (const sibling of siblings || []) {
            const siblingItems = await this.getOrderItems(sibling.id, { includeVoided: false });
            try {
              await restoreOrderStockIfNeeded(this.db, sibling, siblingItems, {
                performedBy: orderData.waiter_id || null,
                reason: 'Auto-cancelled: replaced by newer order on this table',
              });
            } catch (e) {
              console.error('createOrder sibling restock:', e);
            }
            await this.db.run(
              `UPDATE orders
               SET status = 'cancelled',
                   notes = COALESCE(notes, '') || char(10) || 'Auto-cancelled: replaced by newer order on this table',
                   cancel_reason = COALESCE(cancel_reason, 'Replaced by newer order on this table'),
                   cancelled_at = CURRENT_TIMESTAMP,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = ?`,
              [sibling.id]
            );
          }
        }

        await this.db.run(`
          UPDATE tables 
          SET status = 'occupied',
              current_order_id = ?,
              waiter_id = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [orderId, orderData.waiter_id || null, tableId]);
      }
      
      return { order_id: orderId, order_number: orderNumber, stock, party_label: partyLabel };
    });
  }

  /** Free a table only when no other active parties remain on it. */
  async releaseTableIfEmpty(tableId, keepOrderId = null) {
    if (!tableId) return;
    const remaining = await this.db.get(
      `SELECT id FROM orders
       WHERE table_id = ?
         AND status NOT IN ('completed', 'cancelled')
         ${keepOrderId ? 'AND id != ?' : ''}
       ORDER BY id DESC LIMIT 1`,
      keepOrderId ? [tableId, keepOrderId] : [tableId]
    );
    if (remaining) {
      await this.db.run(
        `UPDATE tables SET status = 'occupied', current_order_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [remaining.id, tableId]
      );
    } else {
      await this.db.run(
        `UPDATE tables SET status = 'available', current_order_id = NULL, waiter_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [tableId]
      );
    }
  }

  /** Cancel dine-in orders that are no longer the table's current_order_id */
  async cancelOrphanTableOrders() {
    try {
      await ensureColumn(this.db, 'orders', 'cancel_reason', 'TEXT').catch(() => {});
      await ensureColumn(this.db, 'orders', 'cancelled_at', this.db.driver === 'postgres' ? 'TIMESTAMP' : 'DATETIME').catch(() => {});
      const orphans = await this.db.all(`
        SELECT o.*
          FROM orders o
         WHERE o.table_id IS NOT NULL
           AND o.status NOT IN ('completed', 'cancelled')
           AND (
             SELECT t.current_order_id FROM tables t WHERE t.id = o.table_id
           ) IS NOT NULL
           AND o.id != (
             SELECT t.current_order_id FROM tables t WHERE t.id = o.table_id
           )
      `);
      if (!orphans?.length) return;

      const { restoreOrderStockIfNeeded } = await import('../../stock.js');
      for (const orphan of orphans) {
        try {
          const items = await this.getOrderItems(orphan.id, { includeVoided: false });
          await restoreOrderStockIfNeeded(this.db, orphan, items, {
            reason: 'Auto-cancelled: orphaned (table has a newer order)',
          });
        } catch (e) {
          console.error('cancelOrphanTableOrders restock:', e);
        }
        await this.db.run(`
          UPDATE orders
          SET status = 'cancelled',
              notes = COALESCE(notes, '') || char(10) || 'Auto-cancelled: orphaned (table has a newer order)',
              cancel_reason = COALESCE(cancel_reason, 'Orphaned: table has a newer order'),
              cancelled_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [orphan.id]);
      }
    } catch (e) {
      console.error('cancelOrphanTableOrders:', e);
    }
  }
  
  async getById(id) {
    return await this.db.get(`
      SELECT o.*, 
             o.id as order_id,
             COALESCE(t.table_number, o.table_number) as table_number, 
             u.full_name as waiter_name,
             (SELECT COALESCE(SUM(subtotal), 0) FROM order_items
              WHERE order_id = o.id AND COALESCE(status, '') NOT IN ('voided', 'cancelled')) as total_amount,
             (SELECT COUNT(*) FROM order_items
              WHERE order_id = o.id AND COALESCE(status, '') NOT IN ('voided', 'cancelled')) as item_count
      FROM orders o
      LEFT JOIN tables t ON o.table_id = t.id
      LEFT JOIN users u ON o.waiter_id = u.id
      WHERE o.id = ?
    `, [id]);
  }
  
  async getAll(filters = {}) {
    // Scalar subqueries — Postgres rejects GROUP BY o.id with joined non-agg columns
    let sql = `
      SELECT o.*,
             o.id as order_id,
             COALESCE(t.table_number, o.table_number) as table_number,
             u.full_name as waiter_name,
             (
               SELECT COUNT(oi.id)
               FROM order_items oi
               WHERE oi.order_id = o.id AND ${ACTIVE_ITEM_SQL}
             ) as item_count,
             (
               SELECT COALESCE(SUM(oi.subtotal), 0)
               FROM order_items oi
               WHERE oi.order_id = o.id AND ${ACTIVE_ITEM_SQL}
             ) as total_amount
      FROM orders o
      LEFT JOIN tables t ON o.table_id = t.id
      LEFT JOIN users u ON o.waiter_id = u.id
    `;

    const conditions = [];
    const params = [];

    if (filters.status) {
      conditions.push('o.status = ?');
      params.push(filters.status);
    }

    if (filters.status_in && Array.isArray(filters.status_in) && filters.status_in.length) {
      conditions.push(`o.status IN (${filters.status_in.map(() => '?').join(',')})`);
      params.push(...filters.status_in);
    }

    if (filters.waiter_id) {
      conditions.push('o.waiter_id = ?');
      params.push(filters.waiter_id);
    }

    if (filters.order_type) {
      conditions.push('o.order_type = ?');
      params.push(filters.order_type);
    }

    if (filters.active_items_only) {
      conditions.push(`EXISTS (
        SELECT 1 FROM order_items oi2
        WHERE oi2.order_id = o.id
          AND COALESCE(oi2.status, '') NOT IN ('voided', 'cancelled')
      )`);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY o.created_at ASC';

    if (filters.limit) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
    }

    return await this.db.all(sql, params);
  }

  /**
   * Kitchen board: active orders + non-voided items in two queries (no N+1).
   */
  async getKitchenBoard({ limit = 40 } = {}) {
    const orders = await this.getAll({
      status_in: ['pending', 'confirmed', 'preparing', 'cooking', 'ready'],
      active_items_only: true,
      limit,
    });
    if (!orders.length) return { orders: [], itemsByOrder: {} };

    const ids = orders.map((o) => o.order_id || o.id);
    const placeholders = ids.map(() => '?').join(',');
    const items = await this.db.all(
      `SELECT oi.*
       FROM order_items oi
       WHERE oi.order_id IN (${placeholders})
         AND COALESCE(oi.status, '') NOT IN ('voided', 'cancelled')
       ORDER BY oi.id ASC`,
      ids
    );

    const itemsByOrder = {};
    for (const item of items) {
      const oid = item.order_id;
      if (!itemsByOrder[oid]) itemsByOrder[oid] = [];
      itemsByOrder[oid].push(item);
    }
    return { orders, itemsByOrder };
  }
  
  async updateStatus(id, status) {
    await this.assertCurrentBusinessDay(id, { existingWork: true });
    const { tableStatusFromOrder, ORDER_STATUS } = await import('../../restaurant-status.js');

    return await this.db.transaction(async () => {
      await this.db.run(`
        UPDATE orders 
        SET status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [status, id]);

      const order = await this.getById(id);
      if (!order?.table_id) return true;

      // Only free table after payment or cancel — and only if no sibling parties remain.
      if (status === ORDER_STATUS.COMPLETED || status === ORDER_STATUS.CANCELLED) {
        await this.releaseTableIfEmpty(order.table_id, id);
        return true;
      }

      const tableStatus = tableStatusFromOrder(status);
      await this.db.run(`
        UPDATE tables 
        SET status = ?,
            current_order_id = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [tableStatus, id, order.table_id]);

      return true;
    });
  }
  
  async cancelOrder(id, reason, { actorId = null } = {}) {
    await this.assertCurrentBusinessDay(id, { existingWork: true });
    const cleanReason = String(reason || '').trim();
    if (!cleanReason) {
      throw Object.assign(new Error('A reason is required to cancel an order.'), { status: 400 });
    }
    await ensureColumn(this.db, 'orders', 'cancel_reason', 'TEXT').catch(() => {});
    await ensureColumn(this.db, 'orders', 'cancelled_at', this.db.driver === 'postgres' ? 'TIMESTAMP' : 'DATETIME').catch(() => {});

    return await this.db.transaction(async () => {
      // Only restore stock if the order was still live — cancelling an already
      // cancelled/completed order must never restock twice.
      const before = await this.getById(id);
      const wasActive = before && !['cancelled', 'completed'].includes(String(before.status || ''));

      await this.db.run(`
        UPDATE orders
        SET status = 'cancelled',
            notes = COALESCE(notes, '') || ?,
            cancel_reason = ?,
            cancelled_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [`\nCancel: ${cleanReason}`, cleanReason, id]);

      const { cancelKotsForOrder } = await import('../../kot-service.js');
      await cancelKotsForOrder(this.db, { orderId: id, reason: cleanReason, actorId });

      if (wasActive) {
        try {
          const { restoreOrderStockIfNeeded } = await import('../../stock.js');
          const items = await this.getOrderItems(id, { includeVoided: false });
          await restoreOrderStockIfNeeded(this.db, before, items, {
            performedBy: actorId,
            reason: `Order cancelled: ${cleanReason}`,
          });
        } catch (e) {
          console.error('cancelOrder restock:', e);
        }
      }

      const order = await this.getById(id);
      if (order?.table_id) {
        await this.releaseTableIfEmpty(order.table_id, id);
      }

      try {
        const { cancelReservationForOrder, CANCEL_REASON } = await import('../../leads.js');
        await cancelReservationForOrder(id, CANCEL_REASON.RESTAURANT, this.db);
      } catch {
        /* optional */
      }
      return true;
    });
  }
  
  async getActiveOrders() {
    return await this.db.all(`
      SELECT o.*, o.id as order_id,
             COALESCE(t.table_number, o.table_number) as table_number,
             u.full_name as waiter_name,
             (
               SELECT COUNT(oi.id)
               FROM order_items oi
               WHERE oi.order_id = o.id AND ${ACTIVE_ITEM_SQL}
             ) as item_count,
             (
               SELECT COALESCE(SUM(oi.subtotal), 0)
               FROM order_items oi
               WHERE oi.order_id = o.id AND ${ACTIVE_ITEM_SQL}
             ) as total_amount
      FROM orders o
      LEFT JOIN tables t ON o.table_id = t.id
      LEFT JOIN users u ON o.waiter_id = u.id
      WHERE o.status NOT IN ('completed', 'cancelled')
      ORDER BY o.created_at ASC
    `);
  }
  
  async getPendingOrders() {
    return await this.getAll({ status: 'pending' });
  }

  async getOrderItems(orderId, { includeVoided = true } = {}) {
    const voidFilter = includeVoided ? '' : ` AND COALESCE(oi.status, '') NOT IN ('voided', 'cancelled')`;
    return await this.db.all(`
      SELECT oi.*, 
             oi.id as item_id,
             COALESCE(oi.price, 0) as price,
             COALESCE(oi.price, 0) as unit_price,
             COALESCE(oi.item_name, mi.name) as item_name, 
             mc.name as category, 
             mi.is_vegetarian as is_veg,
             mi.image_url as image_url
      FROM order_items oi
      LEFT JOIN menu_items mi ON COALESCE(oi.menu_item_id, oi.item_id) = mi.id
      LEFT JOIN menu_categories mc ON mi.category_id = mc.id
      WHERE oi.order_id = ?${voidFilter}
      ORDER BY oi.created_at
    `, [orderId]);
  }

  /**
   * Soft-void a line item. Restores stock. Excludes from bill totals.
   */
  async voidItem(orderId, itemId, reason = '') {
    await this.assertCurrentBusinessDay(orderId, { existingWork: true });
    const order = await this.getById(orderId);
    if (!order) throw new Error('Order not found.');
    if (['completed', 'cancelled'].includes(order.status)) {
      throw new Error('This order is already finished.');
    }
    if (order.status === 'awaiting_payment') {
      throw new Error('Unlock the bill request before voiding items.');
    }

    const item = await this.db.get(
      `SELECT * FROM order_items WHERE id = ? AND order_id = ?`,
      [itemId, orderId]
    );
    if (!item) throw new Error('Order item not found.');
    if (['voided', 'cancelled'].includes(item.status)) {
      throw new Error('This item is already voided.');
    }

    const { restoreStockForItems } = await import('../../stock.js');
    return await this.db.transaction(async () => {
      await this.db.run(
        `UPDATE order_items
         SET status = 'voided',
             special_instructions = COALESCE(special_instructions, '') || ?
         WHERE id = ?`,
        [`\nVoided: ${reason || 'No reason'}`, itemId]
      );
      await restoreStockForItems(this.db, [
        {
          menu_item_id: item.menu_item_id || item.item_id,
          item_name: item.item_name,
          variant_name: item.variant_name,
          quantity: item.quantity,
          combo_snapshot: item.combo_snapshot,
        },
      ], { orderId, reason: reason ? `Voided item: ${reason}` : 'Voided item' });
      await this.db.run(
        `UPDATE orders
         SET notes = COALESCE(notes, '') || ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [`\nVoided item #${itemId}: ${reason || 'No reason'}`, orderId]
      );
      return true;
    });
  }

  async addItems(orderId, items) {
    // existingWork: adding a course to a table opened before the day rolled
    // over is live work, so it is carried forward like cancel/void/status.
    await this.assertCurrentBusinessDay(orderId, { existingWork: true });
    const { deductStockForItems, ensureStockSchema, markOrderStockConsumed } = await import('../../stock.js');
    await ensureStockSchema(this.db);
    return await this.db.transaction(async () => {
      for (const item of items || []) {
        await this._insertOrderItem(orderId, item);
      }
      const stock = await deductStockForItems(this.db, items || [], { orderId });
      if (stock?.deducted?.length) {
        await markOrderStockConsumed(this.db, orderId);
      }
      await this.db.run(`UPDATE orders SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [orderId]);
      return true;
    });
  }

  /**
   * Persist bill + payment rows. Pass `tx` to run inside an outer transaction.
   */
  async createBillAndPayment(billData, tx = null) {
    const db = tx || this.db;
    const run = async () => {
      const incomingBillNumber = String(billData.bill_number || '').trim();
      const billOrder = billData.order_id
        ? await db.get('SELECT order_type, table_id, table_number, business_day_id, created_at FROM orders WHERE id = ?', [billData.order_id])
        : null;
      const billNumber = BILL_NUMBER_PATTERN.test(incomingBillNumber)
        ? incomingBillNumber.toUpperCase()
        : await nextDocumentNumber(db, { type: 'bill', prefix: 'BILL', order: billOrder || billData });
      const grandTotal = billData.final_amount ?? billData.grand_total ?? 0;
      const tax = billData.tax_amount ?? billData.tax ?? 0;
      const paidAmount = billData.amount_paid ?? grandTotal;
      if (Number(paidAmount) < 0 || Math.abs(Number(paidAmount) - Number(grandTotal)) > 0.009) {
        throw Object.assign(new Error('The recorded payment must equal the finalized bill total.'), { status: 400 });
      }
      const businessDayId = billData.business_day_id || billOrder?.business_day_id || await currentBusinessDayId(db, { required: true });

      const billResult = await db.run(
        `
        INSERT INTO bills (
          bill_number, order_id, subtotal, tax, vat_amount, service_charge,
          discount_amount, discount_reason, grand_total, status,
          cashier_id, tax_percent, service_charge_percent,
          business_day_id, created_at, paid_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
      `,
        [
          billNumber,
          billData.order_id,
          billData.subtotal ?? 0,
          tax,
          tax,
          billData.service_charge ?? 0,
          billData.discount_amount ?? 0,
          billData.discount_reason || null,
          grandTotal,
          billData.cashier_id || null,
          billData.tax_percent ?? 0,
          billData.service_charge_percent ?? 0,
          businessDayId,
          billOrder?.created_at || null,
        ]
      );

      const billId = billResult.lastInsertRowid;

      const payResult = await db.run(
        `
        INSERT INTO bill_payments (bill_id, amount, payment_method, reference_number, business_day_id, created_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `,
        [
          billId,
          paidAmount,
          billData.payment_method || 'cash',
          billData.reference_number || null,
          businessDayId,
        ]
      );

      return {
        bill: { id: billId, bill_number: billNumber, status: 'paid' },
        payment: { id: payResult.lastInsertRowid, bill_id: billId, amount: paidAmount },
      };
    };

    if (tx) return run();
    return this.db.transaction(async (inner) => {
      // Re-bind to inner tx by temporarily using recursive call
      return this.createBillAndPayment(billData, inner);
    });
  }

  async getAllPayments(startDate = null, endDate = null) {
    const nepalDate = this.db.driver === 'postgres'
      ? `payment_time::date`
      : `date(payment_time, '+5 hours', '+45 minutes')`;
    let query = `
      SELECT * FROM (
        SELECT
          'allocation-' || a.id AS row_key,
          a.id,
          a.bill_id,
          a.amount,
          a.method AS payment_method,
          a.provider,
          a.reference_number,
          a.notes,
          COALESCE(a.created_at, bp.created_at, b.paid_at, b.created_at) AS payment_time,
          COALESCE(a.created_at, bp.created_at, b.paid_at, b.created_at) AS created_at,
          b.bill_number,
          b.grand_total,
          b.discount_amount,
          b.discount_reason,
          o.order_number,
          o.table_id,
          COALESCE(t.table_number, o.table_number) AS table_number,
          COALESCE(c.name, o.customer_name) AS customer_name,
          COALESCE(c.phone, o.customer_phone) AS customer_phone,
          CASE WHEN (SELECT COUNT(*) FROM bill_payment_allocations ax WHERE ax.bill_id = a.bill_id) > 1 THEN 1 ELSE 0 END AS is_split
        FROM bill_payment_allocations a
        JOIN bills b ON a.bill_id = b.id
        JOIN orders o ON b.order_id = o.id
        LEFT JOIN bill_payments bp ON bp.id = a.payment_id
        LEFT JOIN tables t ON o.table_id = t.id
        LEFT JOIN customers c ON c.id = COALESCE(a.customer_id, b.customer_id, o.customer_id)

        UNION ALL

        SELECT
          'payment-' || bp.id AS row_key,
          bp.id,
          bp.bill_id,
          bp.amount,
          bp.payment_method,
          bp.provider,
          bp.reference_number,
          bp.notes,
          COALESCE(bp.created_at, b.paid_at, b.created_at) AS payment_time,
          COALESCE(bp.created_at, b.paid_at, b.created_at) AS created_at,
          b.bill_number,
          b.grand_total,
          b.discount_amount,
          b.discount_reason,
          o.order_number,
          o.table_id,
          COALESCE(t.table_number, o.table_number) AS table_number,
          COALESCE(c.name, o.customer_name) AS customer_name,
          COALESCE(c.phone, o.customer_phone) AS customer_phone,
          0 AS is_split
        FROM bill_payments bp
        JOIN bills b ON bp.bill_id = b.id
        JOIN orders o ON b.order_id = o.id
        LEFT JOIN tables t ON o.table_id = t.id
        LEFT JOIN customers c ON c.id = COALESCE(bp.customer_id, b.customer_id, o.customer_id)
        WHERE NOT EXISTS (
          SELECT 1 FROM bill_payment_allocations a
          WHERE a.payment_id = bp.id
        )
      ) payment_history
      WHERE 1=1
    `;
    const params = [];

    if (startDate) {
      query += ` AND ${nepalDate} >= date(?)`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND ${nepalDate} <= date(?)`;
      params.push(endDate);
    }

    query += ` ORDER BY payment_time DESC, id DESC`;
    return await this.db.all(query, params);
  }
}
