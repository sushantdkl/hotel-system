/**
 * Online-order lifecycle for the single-admin deployment.
 *
 * Statuses:  pending → accepted → ready → completed  (or cancelled / refunded)
 * Payment status is tracked separately (unpaid / paid / refunded / …).
 *
 * Accounting is posted through the EXISTING double-entry engine, only at the
 * correct stage, and is idempotent:
 *   - pending / accepted / ready  → no revenue, no invoice, no stock consumption
 *   - completed (paid)            → invoice + payment + sale journal + COGS/stock
 *   - refunded                    → linked reversal via refundBill (never deletes)
 * A completed order reuses the same bills/journal path as the counter POS, so it
 * flows into the existing cash/bank books, general ledger, P&L, balance sheet
 * and trial balance automatically.
 */
import { ensureColumn } from '@/lib/db/schema-helpers.js';
import { calculateBillTotals, parseSettingsRates } from '@/lib/billing-totals.js';
import { ensureAccountingSchema } from '@/lib/accounting.js';
import { deductStockForItems, restoreStockForItems, ensureStockSchema } from '@/lib/stock.js';
import { refundBill } from '@/lib/bill-corrections.js';
import { ensureSplitPaymentSchema, recordInitialSplitSettlement, validateAllocations } from '@/lib/split-payments.js';
import { businessDayIdForFinancialWork } from '@/lib/business-days.js';
import { nextDocumentNumber } from '@/lib/document-numbers.js';
import { normalizePhone } from '@/lib/customers.js';
import { ensurePromotionSchema, recalculatePromotionById, recordPromotionRedemption } from '@/lib/promotions.js';

export const ORDER_STATUSES = ['pending', 'accepted', 'ready', 'completed', 'cancelled', 'refunded'];
export const PAYMENT_STATUSES = ['unpaid', 'pending_verification', 'paid', 'partially_refunded', 'refunded', 'failed'];

const ALLOWED = {
  accept: ['pending'],
  reject: ['pending'],
  ready: ['accepted'],
  complete: ['accepted', 'ready'],
  cancel: ['pending', 'accepted', 'ready'],
  refund: ['completed'],
};

function httpErr(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/** Add the online-order columns if a column is missing (idempotent, both DBs). */
export async function ensureOrderColumns(db) {
  // Postgres has no DATETIME type; SQLite has no TIMESTAMP in old builds.
  const TS = db?.driver === 'postgres' ? 'TIMESTAMP' : 'DATETIME';
  const cols = [
    ['payment_status', "TEXT DEFAULT 'unpaid'"],
    ['payment_method', 'TEXT'],
    ['cancel_reason', 'TEXT'],
    ['accepted_at', TS],
    ['ready_at', TS],
    ['completed_at', TS],
    ['cancelled_at', TS],
    ['stock_consumed', 'INTEGER DEFAULT 0'],
    ['stock_reserved', 'INTEGER DEFAULT 0'],
    ['refunded_amount', 'REAL DEFAULT 0'],
    ['delivery_address', 'TEXT'],
    ['nearby_landmark', 'TEXT'],
    ['customer_note', 'TEXT'],
    ['idempotency_key', 'TEXT'],
    ['party_label', 'TEXT'],
    ['delivery_fee', 'REAL DEFAULT 0'],
    ['delivery_distance_km', 'REAL'],
    ['delivery_pricing_label', 'TEXT'],
  ];
  for (const [col, ddl] of cols) {
    try {
      await ensureColumn(db, 'orders', col, ddl);
    } catch (e) {
      // One missing privilege / race must not 500 the whole orders list.
      console.error(`ensureOrderColumns(${col}):`, e?.message || e);
    }
  }
  await ensureColumn(db, 'bills', 'delivery_fee', 'REAL DEFAULT 0').catch(() => {});
  await db.run(
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_idempotency_key
       ON orders(idempotency_key) WHERE idempotency_key IS NOT NULL`
  ).catch(() => {});
}

async function loadSettingsRates(db) {
  const rows = await db.all('SELECT setting_key, setting_value FROM system_settings');
  const settings = {};
  for (const r of rows || []) settings[r.setting_key] = r.setting_value;
  return parseSettingsRates(settings);
}

export async function getOrder(db, id) {
  const order = await db.get('SELECT * FROM orders WHERE id = ?', [id]);
  if (!order) return null;
  const items = await db.all('SELECT * FROM order_items WHERE order_id = ?', [id]);
  const bill = await db.get('SELECT * FROM bills WHERE order_id = ? ORDER BY id DESC LIMIT 1', [id]);
  return { ...order, items, bill };
}

function assertTransition(action, status) {
  if (!ALLOWED[action]) throw httpErr(`Unknown action "${action}".`, 400);
  if (!ALLOWED[action].includes(status)) {
    throw httpErr(`Cannot ${action} an order that is "${status}".`, 409);
  }
}

/** Find or create a customer by phone (no AR posted for cash/digital sales). */
async function linkCustomer(db, { name, phone }) {
  if (!phone) return null;
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return null;
  let cust = await db.get('SELECT id FROM customers WHERE phone = ? OR phone_digits = ? LIMIT 1', [normalizedPhone, normalizedPhone]);
  if (!cust) {
    try {
      await db.run('INSERT INTO customers (name, phone, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)', [name || 'Guest', normalizedPhone]);
      cust = await db.get('SELECT id FROM customers WHERE phone = ? OR phone_digits = ? LIMIT 1', [normalizedPhone, normalizedPhone]);
    } catch { /* concurrent insert / schema variance */ }
  }
  return cust?.id || null;
}

export async function transition(db, { orderId, action, reason, payment_method, allocations: requestedAllocations, idempotency_key, amount, wastage = false, user }) {
  await ensureOrderColumns(db);
  const order = await db.get('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (!order) throw httpErr('Order not found.', 404);
  if (action === 'complete' && order.status === 'completed') {
    const existing = await db.get('SELECT id, bill_number FROM bills WHERE order_id = ? ORDER BY id LIMIT 1', [orderId]);
    if (existing) return { status: 'completed', idempotent: true, bill_id: existing.id, bill_number: existing.bill_number };
  }
  assertTransition(action, order.status);
  const uid = user?.id || null;

  switch (action) {
    case 'accept': {
      // Reservation is logical here; stock is consumed atomically at completion,
      // which is the point where over-sell must be prevented.
      await db.run(
        "UPDATE orders SET status='accepted', accepted_at=CURRENT_TIMESTAMP, stock_reserved=1, updated_at=CURRENT_TIMESTAMP WHERE id=?",
        [orderId]
      );
      return { status: 'accepted' };
    }
    case 'ready': {
      await db.run("UPDATE orders SET status='ready', ready_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?", [orderId]);
      return { status: 'ready' };
    }
    case 'reject':
    case 'cancel': {
      if (!reason || !String(reason).trim()) throw httpErr('A reason is required.', 400);
      return db.transaction(async (tx) => {
        // Nothing was posted before completion, so only release the reservation.
        if (order.stock_consumed) {
          const items = await tx.all('SELECT * FROM order_items WHERE order_id = ?', [orderId]);
          if (!wastage) await restoreStockForItems(tx, items, { orderId, performedBy: uid });
          // When `wastage` is true the prepared food is written off by the
          // existing inventory rules (stock stays consumed → recorded as loss).
        }
        await tx.run(
          "UPDATE orders SET status='cancelled', cancel_reason=?, cancelled_at=CURRENT_TIMESTAMP, stock_reserved=0, updated_at=CURRENT_TIMESTAMP WHERE id=?",
          [String(reason).trim().slice(0, 300), orderId]
        );
        return { status: 'cancelled' };
      });
    }
    case 'complete': {
      const method = (payment_method === 'online' ? 'qr' : payment_method) || 'cash';
      await ensureStockSchema(db);
      await ensureAccountingSchema(db);
      await ensureSplitPaymentSchema(db);
      await ensurePromotionSchema(db);
      return db.transaction(async (tx) => {
        // Idempotency: a completed order with a bill posts nothing again.
        const existing = await tx.get('SELECT id, bill_number FROM bills WHERE order_id = ?', [orderId]);
        const fresh = await tx.get('SELECT * FROM orders WHERE id = ?', [orderId]);
        // An online order accepted before rollover remains attributable to its
        // original business day, while still being completable later.
        const businessDayId = await businessDayIdForFinancialWork(tx, 'orders', orderId);
        if (existing && fresh.status === 'completed') {
          return { idempotent: true, bill_id: existing.id, bill_number: existing.bill_number };
        }

        const items = await tx.all('SELECT * FROM order_items WHERE order_id = ?', [orderId]);
        const subtotal = items.reduce((s, i) => s + Number(i.subtotal ?? i.price * i.quantity), 0);
        const promotionItems = [];
        for (const item of items) {
          const category = item.menu_item_id ? await tx.get('SELECT category_id FROM menu_items WHERE id = ?', [item.menu_item_id]) : null;
          promotionItems.push({ ...item, category_id: category?.category_id || null });
        }
        const promotion = await recalculatePromotionById(tx, {
          promotionId: fresh.promotion_id,
          items: promotionItems,
          channel: fresh.promotion_channel || 'website',
        });
        const { vatPercent, servicePercent } = await loadSettingsRates(tx);
        const deliveryFee = Math.max(0, Number(fresh.delivery_fee || 0));
        const totals = calculateBillTotals(subtotal, { discountAmount: promotion?.discount || 0, vatPercent, servicePercent, deliveryFee });

        const customerId = order.customer_id || (await linkCustomer(tx, { name: order.customer_name, phone: order.customer_phone }));
        const customer = customerId ? await tx.get('SELECT * FROM customers WHERE id=?', [customerId]) : null;
        const rawAllocations = Array.isArray(requestedAllocations) && requestedAllocations.length
          ? requestedAllocations
          : [{ method, amount: totals.total, cash_tendered: method === 'cash' ? totals.total : undefined }];
        const allocations = validateAllocations(rawAllocations, totals.total, { customer, allowCredit: true, actorRole: user?.role });
        const requestKey = String(idempotency_key || `online-complete-${orderId}`).slice(0, 100);

        let billId = existing?.id;
        let billNumber = existing?.bill_number;
        if (!existing) {
          billNumber = await nextDocumentNumber(tx, { type: 'bill', prefix: 'BILL', order });
          const billRes = await tx.run(
            `INSERT INTO bills (bill_number, order_id, customer_id, subtotal, tax, vat_amount, service_charge, tax_percent, service_charge_percent,
               delivery_fee, discount_amount, discount_reason, promotion_id, promotion_code, grand_total, status, payment_status, outstanding_amount, idempotency_key, business_day_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', 'unpaid', ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`,
            [billNumber, orderId, customerId, totals.subtotal, totals.tax, totals.tax, totals.serviceCharge, vatPercent, servicePercent,
              totals.deliveryFee, totals.discount, promotion?.name || null, promotion?.id || null, promotion?.code || null,
              totals.total, totals.total, requestKey, businessDayId, fresh.created_at]
          );
          billId = billRes.lastInsertRowid;
        }
        await recordPromotionRedemption(tx, { promotion, orderId, billId, channel: fresh.promotion_channel || 'website', customerPhone: fresh.customer_phone });

        const payment = await recordInitialSplitSettlement(tx, {
          billId, billNumber, total: totals.total, tax: totals.tax, allocations,
          customer, actorId: uid, requestKey,
          businessDayId,
        });

        // Consume stock (Dr COGS / Cr Inventory via recipe) exactly once.
        let stock = { warnings: [] };
        if (!fresh.stock_consumed) {
          stock = await deductStockForItems(tx, items, { orderId, performedBy: uid });
          await tx.run('UPDATE orders SET stock_consumed = 1 WHERE id = ?', [orderId]);
        }

        await tx.run(
          `UPDATE orders SET status='completed', payment_status=?, payment_method=?, customer_id=?, completed_at=CURRENT_TIMESTAMP, stock_reserved=0, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
          [payment.status, allocations.length > 1 ? 'split' : allocations[0].method, customerId, orderId]
        );

        return { status: 'completed', bill_id: billId, bill_number: billNumber, totals, payment, warnings: stock.warnings || [] };
      });
    }
    case 'refund': {
      if (!reason || !String(reason).trim()) throw httpErr('A reason is required.', 400);
      const bill = await db.get('SELECT * FROM bills WHERE order_id = ? ORDER BY id DESC LIMIT 1', [orderId]);
      if (!bill) throw httpErr('No invoice to refund for this order.', 400);
      const refundAmt = amount != null ? Number(amount) : Number(bill.grand_total);
      const full = refundAmt >= Number(bill.grand_total);
      return db.transaction(async (tx) => {
        // Linked reversal (never deletes the original journal). Prepared food is
        // not returned to sellable stock (restock handled by existing rules).
        await refundBill(tx, {
          bill_id: bill.id,
          bill_number: bill.bill_number,
          amount: refundAmt,
          full,
          method: order.payment_method || 'cash',
          reason: String(reason).trim(),
          created_by: uid,
        });
        await tx.run(
          `UPDATE orders SET status='refunded', payment_status=?, refunded_amount=COALESCE(refunded_amount,0)+?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
          [full ? 'refunded' : 'partially_refunded', refundAmt, orderId]
        );
        return { status: 'refunded', refunded: refundAmt, full };
      });
    }
    default:
      throw httpErr(`Unknown action "${action}".`, 400);
  }
}
