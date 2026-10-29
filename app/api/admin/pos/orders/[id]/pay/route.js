import { NextResponse } from 'next/server';
import { formatSittingDuration } from '@/lib/time-utils.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import Database from '@/lib/db/index.js';
import { calculateBillTotals, parseSettingsRates, resolveServiceCharge } from '@/lib/billing-totals.js';
import { resolveCustomerForSale } from '@/lib/customers.js';
import { ensureAccountingSchema } from '@/lib/accounting.js';
import {
  ensureSplitPaymentSchema,
  recordInitialSplitSettlement,
  recordSupplementalSettlement,
  validateAllocations,
} from '@/lib/split-payments.js';
import { completeReservationForOrder } from '@/lib/leads.js';
import { getOrderWorkspace, logPosEvent, ensureKotProSchema } from '@/lib/kot-service.js';
import { refundBillAdmin, recordAudit } from '@/lib/bills-admin.js';
import { diffReopenItems, parseJsonField } from '@/lib/reopen-diff.js';
import { nextDocumentNumber } from '@/lib/document-numbers.js';
import { businessDayIdForFinancialWork } from '@/lib/business-days.js';
import { ensurePermissionCache, isPermissionAllowedSync } from '@/lib/permissions.js';
import { ensureOrderColumns } from '@/lib/online-orders.js';
import { ensureDeliverySchema } from '@/lib/delivery.js';
import { ensurePromotionSchema, evaluatePromotion, recalculatePromotionById, recordPromotionRedemption, normalizePromotion } from '@/lib/promotions.js';
import { isPromotionScheduledNow } from '@/lib/promotion-display.js';
import { normalizePaymentMethod } from '@/lib/payment-allocations.js';
import { isAdminLike } from '@/lib/roles.js';
import { applyPackageAllowance, lockChargeableStay, orderOutlet, prepareRoomCharges } from '@/lib/hotel/room-charges.js';
import { permissionRole } from '@/lib/roles.js';

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const EPS = 0.01;

/** After a bill is paid, KOTs for that order leave the Active board. */
async function completeOrderKots(tx, orderId) {
  await tx.run(
    `UPDATE kots SET status = 'completed',
       completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)
     WHERE order_id = ? AND COALESCE(voided, 0) = 0
       AND COALESCE(status, '') NOT IN ('completed', 'cancelled')`,
    [orderId]
  ).catch(() => {});
}

function primaryPaymentMethod(allocations = []) {
  if (!allocations.length) return 'cash';
  const sorted = [...allocations].sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0));
  const top = sorted[0];
  return ['cash', 'credit', 'room'].includes(top?.method) ? top.method : 'online';
}

/** Normalise incoming payment into the allocation shape the split engine expects. */
function incomingAllocations(data, total) {
  if (Array.isArray(data.allocations) && data.allocations.length) return data.allocations;
  const method = normalizePaymentMethod(data.payment_method || 'cash');
  return [{
    method,
    amount: total,
    cash_tendered: method === 'cash' ? Number(data.cash_tendered ?? data.amount_paid ?? total) : undefined,
    reference: data.qr_reference,
    verified: data.qr_verified === true,
    due_date: data.credit_due_date,
    notes: data.payment_notes,
  }];
}

async function existingPaidSale(db, idempotencyKey) {
  if (!idempotencyKey) return null;
  const bill = await db.get('SELECT * FROM bills WHERE idempotency_key = ?', [idempotencyKey]);
  if (!bill) return null;
  return { idempotent: true, bill_number: bill.bill_number, bill_id: bill.id, order_id: bill.order_id,
    payment_status: bill.payment_status, outstanding: Number(bill.outstanding_amount || 0) };
}

async function sumBillPayments(db, billId) {
  const row = await db.get(
    `SELECT COALESCE(SUM(amount), 0) AS s FROM bill_payments WHERE bill_id = ?`,
    [billId]
  ).catch(() => null);
  return round2(Number(row?.s || 0));
}

/**
 * Finalise the invoice + settle it (Cash / QR / Credit / split) for a table or
 * takeaway order. Reopened bills only settle the difference vs payments already taken,
 * via a supplemental journal (never replacing the original sale journal).
 */
export async function POST(request, context) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'bills.pay' });
    if (auth.error) return auth.error;
    const { id } = await context.params;
    const orderId = parseInt(id, 10);
    if (!Number.isFinite(orderId)) return NextResponse.json({ error: 'Invalid order.' }, { status: 400 });

    const data = await request.json();
    const idempotencyKey = String(data.idempotency_key || '').trim().slice(0, 100);
    if (!idempotencyKey) return NextResponse.json({ error: 'Missing checkout key. Please retry.' }, { status: 400 });

    const db = Database.getInstance();
    await ensureOrderColumns(db);
    await ensureKotProSchema(db);
    await ensureAccountingSchema(db);
    await ensureSplitPaymentSchema(db);
    await ensureDeliverySchema(db);
    await ensurePromotionSchema(db);

    const prior = await existingPaidSale(db, idempotencyKey);
    if (prior) return NextResponse.json({ success: true, message: 'This payment was already recorded.', ...prior });

    const rows = await db.all('SELECT setting_key, setting_value FROM system_settings');
    const settings = {};
    for (const r of rows || []) settings[r.setting_key] = r.setting_value;
    const { vatPercent, servicePercent } = parseSettingsRates(settings);

    const reopenedBill = await db.get(
      `SELECT * FROM bills WHERE order_id = ? AND LOWER(status) = 'reopened' ORDER BY id DESC LIMIT 1`,
      [orderId]
    );
    const effectiveVatPercent = reopenedBill?.tax_percent == null
      ? vatPercent
      : Number(reopenedBill.tax_percent || 0);

    const requestedDiscount = Number(data.discount || 0);
    const changesExistingDiscount = !reopenedBill
      || Math.abs(requestedDiscount - Number(reopenedBill.discount_amount || 0)) > EPS;
    if (requestedDiscount > 0 && changesExistingDiscount && !isAdminLike(auth.user.role)) {
      await ensurePermissionCache(db);
      if (!isPermissionAllowedSync(permissionRole(auth.user), 'bills.discount')) {
        return NextResponse.json({ error: 'You do not have access to apply a discount.' }, { status: 403 });
      }
    }

    // Charge to a hotel room: permission and hotel schema before the transaction.
    const chargesRoom = incomingAllocations(data, 0).some((row) => normalizePaymentMethod(row?.method) === 'room');
    if (chargesRoom) {
      await ensurePermissionCache(db);
      if (!isPermissionAllowedSync(permissionRole(auth.user), 'pos.charge_to_room')) {
        return NextResponse.json({ error: 'You do not have access to charge bills to a hotel room.' }, { status: 403 });
      }
      await prepareRoomCharges(db);
    }

    // Capture the pre-settle picture for reopened bills: what the cart looked like
    // at reopen (snapshot from the reopen audit) and what had already been paid,
    // so the receipt + history can show exactly what changed and how it settled.
    let reopenSnapshotItems = [];
    let priorPayments = [];
    if (reopenedBill) {
      const revAudit = await db.get(
        `SELECT previous_value, new_value FROM bill_audit
         WHERE bill_id = ? AND event = 'bill_reopened_to_pos' ORDER BY id DESC LIMIT 1`,
        [reopenedBill.id]
      ).catch(() => null);
      const snap = parseJsonField(revAudit?.previous_value) || parseJsonField(revAudit?.new_value) || {};
      reopenSnapshotItems = Array.isArray(snap.items) ? snap.items : [];
      priorPayments = await db.all(
        `SELECT method, amount, provider, reference_number AS reference FROM bill_payment_allocations
         WHERE bill_id = ? ORDER BY id`,
        [reopenedBill.id]
      ).catch(() => []);
      if (!priorPayments.length) {
        priorPayments = await db.all(
          `SELECT payment_method AS method, amount, provider, reference_number AS reference FROM bill_payments
           WHERE bill_id = ? ORDER BY id`,
          [reopenedBill.id]
        ).catch(() => []);
      }
    }

    const result = await db.transaction(async (tx) => {
      const settlement = await (async () => {
      const lock = tx.driver === 'postgres' ? ' FOR UPDATE' : '';
      const order = await tx.get(`SELECT * FROM orders WHERE id = ?${lock}`, [orderId]);
      if (!order) throw Object.assign(new Error('Order not found.'), { status: 404 });
      // An older order remains owned by its original business day, while an
      // open current store session is still required to receive the payment.
      const businessDayId = await businessDayIdForFinancialWork(tx, 'orders', orderId);

      const paid = await tx.get("SELECT id, bill_number FROM bills WHERE order_id = ? AND status = 'paid'", [orderId]);
      if (paid && !reopenedBill) {
        throw Object.assign(new Error(`This order was already paid (Bill #${paid.bill_number}).`), { status: 409, code: 'already_paid' });
      }
      if (order.status === 'completed' || order.status === 'cancelled') {
        throw Object.assign(new Error('This order can no longer accept payment.'), { status: 409 });
      }

      // Reopened carts may have edited previously-sent lines — sync sent_quantity to quantity
      // so settle does not require reprinting a full KOT for already-served food.
      const unsent = await tx.get(
        `SELECT COALESCE(SUM(quantity - COALESCE(sent_quantity,0)),0) AS u
         FROM order_items WHERE order_id = ? AND COALESCE(status,'') NOT IN ('voided','cancelled')`,
        [orderId]
      );
      if (Number(unsent?.u || 0) > 0) {
        throw Object.assign(new Error('Send the new items to the kitchen (KOT) before taking payment.'), { status: 409, code: 'unsent_items' });
      }

      const promotionItems = await tx.all(
        `SELECT oi.id AS order_item_id,
                COALESCE(oi.menu_item_id, oi.item_id) AS menu_item_id,
                mi.category_id, oi.quantity, oi.price, oi.subtotal
         FROM order_items oi
         LEFT JOIN menu_items mi ON COALESCE(oi.menu_item_id, oi.item_id) = mi.id
         WHERE oi.order_id = ? AND COALESCE(oi.status,'') NOT IN ('voided','cancelled')`, [orderId]
      );
      const subtotal = promotionItems.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
      if (subtotal <= 0) throw Object.assign(new Error('This order has no billable items.'), { status: 409, code: 'empty_order' });

      let promotion = null;
      const manualDiscount = Number(data.discount || 0);
      if (!(manualDiscount > 0)) {
        const requestedPromotionId = Number(data.promotion_id || 0);
        const savedPromotionId = Number(order.promotion_id || reopenedBill?.promotion_id || 0);
        const promotionId = requestedPromotionId || savedPromotionId;
        if (promotionId) {
          const stickyRow = await tx.get('SELECT * FROM promotions WHERE id = ?', [promotionId]);
          const stickyTargets = stickyRow
            ? await tx.all('SELECT * FROM promotion_targets WHERE promotion_id = ?', [promotionId])
            : [];
          const stickyPromo = stickyRow ? normalizePromotion(stickyRow, stickyTargets) : null;
          // Sticky promotion_id must still be inside its Nepal schedule at pay time.
          if (stickyPromo && isPromotionScheduledNow(stickyPromo)) {
            promotion = await recalculatePromotionById(tx, {
              promotionId,
              items: promotionItems,
              channel: order.promotion_channel || 'pos',
            });
          }
          if (!promotion) {
            promotion = await evaluatePromotion(tx, {
              items: promotionItems,
              channel: 'pos',
              couponCode: data.coupon_code,
            });
            if (data.coupon_code && !promotion) {
              throw Object.assign(new Error('This coupon is invalid or no longer eligible for this bill.'), { status: 400, code: 'coupon_invalid' });
            }
          }
        } else {
          promotion = await evaluatePromotion(tx, { items: promotionItems, channel: 'pos', couponCode: data.coupon_code });
          if (data.coupon_code && !promotion) throw Object.assign(new Error('This coupon is invalid or no longer eligible for this bill.'), { status: 400, code: 'coupon_invalid' });
        }
      }

      const isDelivery = data.delivery == null
        ? String(order.order_type || '').toLowerCase() === 'delivery'
        : Boolean(data.delivery);
      if (isDelivery && order.table_id) {
        throw Object.assign(new Error('Only a table-less takeaway can be changed to delivery at checkout.'), { status: 400 });
      }
      const finalOrderType = isDelivery ? 'delivery' : (order.table_id ? 'dine_in' : 'takeaway');
      const requestedDeliveryFee = data.delivery_fee == null
        ? Number(reopenedBill?.delivery_fee ?? order.delivery_fee ?? 0)
        : Number(data.delivery_fee);
      const deliveryFee = isDelivery
        ? Math.max(0, Number.isFinite(requestedDeliveryFee) ? requestedDeliveryFee : 0)
        : 0;
      // undefined (field omitted) preserves whatever was already assigned; an explicit
      // null (cleared in the picker) or an id both replace it.
      const deliveryExecutiveId = !isDelivery
        ? null
        : data.delivery_executive_id !== undefined
          ? (data.delivery_executive_id ? parseInt(data.delivery_executive_id, 10) : null)
          : (order.delivery_executive_id || null);
      /*
       * The optional per-bill service / extra charge. The client sends the mode
       * and the value it was keyed in as, never a computed amount — the bill is
       * re-priced here, so a tampered or stale client total can never become the
       * charge. With no mode sent, the house rate from Settings still applies.
       */
      const service = resolveServiceCharge(
        data.service_charge_mode
          ? { enabled: true, mode: data.service_charge_mode, value: data.service_charge_value }
          : reopenedBill
            ? {
                enabled: true,
                mode: Number(reopenedBill.service_charge_percent || 0) > 0 ? 'percent' : 'amount',
                value: Number(reopenedBill.service_charge_percent || 0) > 0
                  ? Number(reopenedBill.service_charge_percent || 0)
                  : Number(reopenedBill.service_charge || 0),
              }
            : null,
        servicePercent
      );
      const totals = calculateBillTotals(subtotal, {
        discountAmount: promotion?.discount || (manualDiscount > 0 ? manualDiscount : undefined),
        vatPercent: effectiveVatPercent,
        servicePercent: service.servicePercent,
        serviceAmount: service.serviceAmount,
        deliveryFee,
      });

      // ---- Reopened bill: settle only the difference vs payments already taken ----
      if (reopenedBill) {
        const paidSum = await sumBillPayments(tx, reopenedBill.id);
        const alreadyPaid = paidSum > EPS ? paidSum : round2(reopenedBill.grand_total);
        const due = round2(totals.total - alreadyPaid);

        const customerInfo = await resolveCustomerForSale(tx, {
          mode: data.customer_mode || (data.customer_phone || order.customer_phone ? 'customer' : 'walkin'),
          phone: data.customer_phone || order.customer_phone,
          name: data.customer_name || order.customer_name,
          address: data.customer_address,
          amount: Math.max(due, 0),
          recordSale: due > EPS,
        });

        let payment = { status: 'paid', outstanding: 0, allocations: [] };
        let deferTotals = false;

        if (due > EPS) {
          const allocations = validateAllocations(incomingAllocations(data, due), due, {
            customer: customerInfo.customer,
            allowCredit: true,
            actorRole: auth.user?.role,
          });
          // Supplemental journal — must NOT replace the original sale journal.
          payment = await recordSupplementalSettlement(tx, {
            billId: reopenedBill.id,
            billNumber: reopenedBill.bill_number,
            total: due,
            tax: round2(totals.tax - Number(reopenedBill.tax || reopenedBill.vat_amount || 0)),
            allocations,
            customer: customerInfo.customer,
            actorId: auth.user.id,
            requestKey: idempotencyKey,
            businessDayId,
          });
        } else if (due < -EPS) {
          // Refund must run while grand_total still reflects the original paid amount.
          deferTotals = true;
          payment = { status: 'paid', outstanding: 0, allocations: [], refundDue: round2(-due) };
        }

        if (!deferTotals) {
          await tx.run(
            `UPDATE bills SET
               subtotal = ?, tax = ?, vat_amount = ?, service_charge = ?, delivery_fee = ?,
               discount_amount = ?, discount_reason = ?, promotion_id = ?, promotion_code = ?, grand_total = ?, status = ?,
               payment_status = ?, outstanding_amount = ?,
               tax_percent = ?, service_charge_percent = ?,
               paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP),
               idempotency_key = COALESCE(idempotency_key, ?)
             WHERE id = ?`,
            [
              totals.subtotal, totals.tax, totals.tax, totals.serviceCharge, totals.deliveryFee,
              totals.discount,
              promotion?.name || (manualDiscount > 0 ? data.discount_reason || reopenedBill.discount_reason || null : null),
              promotion?.id || (Math.abs(manualDiscount - Number(reopenedBill.discount_amount || 0)) <= EPS ? reopenedBill.promotion_id : null),
              promotion?.code || (Math.abs(manualDiscount - Number(reopenedBill.discount_amount || 0)) <= EPS ? reopenedBill.promotion_code : null),
              totals.total, payment.status, payment.status, payment.outstanding, effectiveVatPercent, totals.servicePercent,
              idempotencyKey, reopenedBill.id,
            ]
          );
        }

        await tx.run(
        `UPDATE orders SET status = 'completed', order_type = ?, customer_id = COALESCE(?, customer_id),
             customer_name = COALESCE(?, customer_name), customer_phone = COALESCE(?, customer_phone),
             payment_method = COALESCE(?, payment_method), delivery_fee = ?, delivery_executive_id = ?,
             updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [
            finalOrderType,
            customerInfo.customer_id, customerInfo.customer_name, customerInfo.customer_phone,
            primaryPaymentMethod(payment.allocations || []), totals.deliveryFee, deliveryExecutiveId, orderId,
          ]
        );
        await completeOrderKots(tx, orderId);
        if (order.table_id) {
          const remaining = await tx.get(
            `SELECT id FROM orders
             WHERE table_id = ? AND id != ? AND status NOT IN ('completed','cancelled')
             ORDER BY id DESC LIMIT 1`,
            [order.table_id, orderId]
          );
          if (remaining) {
            await tx.run(
              `UPDATE tables SET status = 'occupied', current_order_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
              [remaining.id, order.table_id]
            );
          } else {
            await tx.run(
              `UPDATE tables SET status = 'available', current_order_id = NULL, waiter_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
              [order.table_id]
            );
          }
        }
        await completeReservationForOrder(orderId, tx).catch(() => {});

        const items = await tx.all(
          `SELECT * FROM order_items WHERE order_id = ? AND COALESCE(status,'') NOT IN ('voided','cancelled') ORDER BY id`,
          [orderId]
        );
        return {
          order: { ...order, order_type: finalOrderType, delivery_fee: deliveryFee, delivery_executive_id: deliveryExecutiveId },
          billId: reopenedBill.id,
          billNumber: reopenedBill.bill_number,
          totals,
          payment,
          customerInfo,
          items,
          allocations: payment.allocations || [],
          reopened: true,
          alreadyPaid,
          due,
          refundDue: payment.refundDue || 0,
          deferTotals,
          vatPercent: effectiveVatPercent,
          // The percent THIS bill was charged at — 0 when the cashier keyed a
          // flat rupee amount — so the receipt and the stored row agree.
          servicePercent: totals.servicePercent,
          idempotencyKey,
          promotion,
        };
      }

      // ---- Normal first-time checkout ----
      const customerInfo = await resolveCustomerForSale(tx, {
        mode: data.customer_mode || (data.customer_phone || order.customer_phone ? 'customer' : 'walkin'),
        phone: data.customer_phone || order.customer_phone,
        name: data.customer_name || order.customer_name,
        address: data.customer_address,
        amount: totals.total,
        recordSale: true,
      });

      const room = chargesRoom ? await lockChargeableStay(tx, data.room_reservation_id) : null;
      const allocations = validateAllocations(incomingAllocations(data, totals.total), totals.total, {
        customer: customerInfo.customer,
        allowCredit: true,
        actorRole: auth.user?.role,
        room,
      });

      const billNumber = await nextDocumentNumber(tx, { type: 'bill', prefix: 'BILL', order });
      const billResult = await tx.run(
        `INSERT INTO bills (bill_number, order_id, customer_id, subtotal, tax, vat_amount, service_charge, delivery_fee,
           discount_amount, discount_reason, promotion_id, promotion_code, grand_total, status, payment_status, outstanding_amount,
           cashier_id, tax_percent, service_charge_percent, idempotency_key, business_day_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', 'unpaid', ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`,
        [billNumber, orderId, customerInfo.customer_id, totals.subtotal, totals.tax, totals.tax,
          totals.serviceCharge, totals.deliveryFee, totals.discount, promotion ? promotion.name : (data.discount_reason || null), promotion?.id || null, promotion?.code || null, totals.total,
          totals.total, auth.user.id, effectiveVatPercent, totals.servicePercent, idempotencyKey, businessDayId, order.created_at]
      );
      const billId = billResult.lastInsertRowid;
      await recordPromotionRedemption(tx, { promotion, orderId, billId, channel: order.promotion_channel || 'pos', customerPhone: customerInfo.customer_phone });

      // Charge to room: the guest's meal-plan allowance covers what it can
      // (settled as `package`), the rest goes to the folio as `room`.
      const outlet = room ? await orderOutlet(tx, orderId) : 'restaurant';
      const settled = room
        ? await applyPackageAllowance(tx, { room, allocations, billId, billNumber, actorId: auth.user.id, outlet, usePackage: data.use_package !== false })
        : { allocations };
      if (room) await tx.run('UPDATE orders SET hotel_stay_id = COALESCE(hotel_stay_id, ?) WHERE id = ?', [room.id, orderId]);

      const payment = await recordInitialSplitSettlement(tx, {
        billId, billNumber, total: totals.total, tax: totals.tax, allocations: settled.allocations,
        customer: customerInfo.customer, actorId: auth.user.id, requestKey: idempotencyKey,
        businessDayId, room, outlet,
      });

      await tx.run(
        `UPDATE orders SET status = 'completed', order_type = ?, customer_id = COALESCE(?, customer_id),
           customer_name = COALESCE(?, customer_name), customer_phone = COALESCE(?, customer_phone),
           payment_method = COALESCE(?, payment_method), delivery_fee = ?, delivery_executive_id = ?,
           updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [
          finalOrderType,
          customerInfo.customer_id, customerInfo.customer_name, customerInfo.customer_phone,
          primaryPaymentMethod(payment.allocations || allocations), totals.deliveryFee, deliveryExecutiveId, orderId,
        ]
      );
      await completeOrderKots(tx, orderId);
      if (order.table_id) {
        const remaining = await tx.get(
          `SELECT id FROM orders
           WHERE table_id = ? AND id != ? AND status NOT IN ('completed','cancelled')
           ORDER BY id DESC LIMIT 1`,
          [order.table_id, orderId]
        );
        if (remaining) {
          await tx.run(
            `UPDATE tables SET status = 'occupied', current_order_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [remaining.id, order.table_id]
          );
        } else {
          await tx.run(
            `UPDATE tables SET status = 'available', current_order_id = NULL, waiter_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [order.table_id]
          );
        }
      }
      await completeReservationForOrder(orderId, tx).catch(() => {});

      const items = await tx.all(
        `SELECT * FROM order_items WHERE order_id = ? AND COALESCE(status,'') NOT IN ('voided','cancelled') ORDER BY id`,
        [orderId]
      );
      return { order: { ...order, order_type: finalOrderType, delivery_fee: deliveryFee, delivery_executive_id: deliveryExecutiveId }, billId, billNumber, totals, payment, customerInfo, items, allocations, promotion, reopened: false, alreadyPaid: 0, due: totals.total, refundDue: 0 };
      })();

    // Reopen change summary: what items were added / removed / changed vs the
    // snapshot taken when the bill was reopened. Drives receipt + history display.
    const reopenChanges = settlement.reopened
      ? diffReopenItems(reopenSnapshotItems, settlement.items)
      : null;
    const newPayments = (settlement.allocations || []).map((a) => ({
      method: a.method, amount: Number(a.amount || 0), provider: a.provider || null, reference: a.reference || null,
    }));

    // Preserve the original invoice and post the refund through the existing reversal service.
    if (settlement.refundDue > EPS) {
      await refundBillAdmin(tx, {
        withinTransaction: true,
        billId: settlement.billId,
        amount: settlement.refundDue,
        method: normalizePaymentMethod(data.allocations?.[0]?.method || data.payment_method || 'cash'),
        reason: 'Reopened bill — items removed / total reduced',
        actorId: auth.user.id,
      });
      // A refund is its own authoritative reversal. Keep the invoice face value
      // or every report that subtracts refunds would deduct this return twice.
      await tx.run("UPDATE bills SET status='paid', payment_status='paid', outstanding_amount=0 WHERE id=?", [settlement.billId]);
      await recordAudit(tx, {
        bill_id: settlement.billId,
        event: 'reopen_refund_settled',
        actor_id: auth.user.id,
        reason: 'Items removed after reopen',
        new_value: {
          refundDue: settlement.refundDue, newTotal: settlement.totals.total, alreadyPaid: settlement.alreadyPaid,
          changes: reopenChanges, priorPayments, newPayments, originalItems: reopenSnapshotItems, originalTotals: reopenedBill,
        },
      });
    } else if (settlement.reopened) {
      await recordAudit(tx, {
        bill_id: settlement.billId,
        event: 'reopen_settled',
        actor_id: auth.user.id,
        new_value: {
          alreadyPaid: settlement.alreadyPaid, due: settlement.due, newTotal: settlement.totals.total,
          changes: reopenChanges, priorPayments, newPayments,
        },
      });
    }

      return { ...settlement, reopenChanges, newPayments };
    });
    const reopenChanges = result.reopenChanges;
    const newPayments = result.newPayments;

    const change = (result.allocations || []).reduce((s, a) => s + Number(a.change || 0), 0);

    await logPosEvent(db, { action: 'invoice_generated', actor_id: auth.user.id, actor_name: auth.user.full_name, order_id: orderId, bill_id: result.billId, new_value: result.billNumber });
    await logPosEvent(db, { action: 'payment_recorded', actor_id: auth.user.id, actor_name: auth.user.full_name, order_id: orderId, bill_id: result.billId, detail: { status: result.payment.status, outstanding: result.payment.outstanding, methods: (result.allocations || []).map((a) => a.method), reopened: !!result.reopened, due: result.due } });
    await logPosEvent(db, { action: 'bill_completed', actor_id: auth.user.id, actor_name: auth.user.full_name, order_id: orderId, bill_id: result.billId });
    if (result.order.table_id) {
      await logPosEvent(db, { action: 'table_released', actor_id: auth.user.id, actor_name: auth.user.full_name, order_id: orderId, table_id: result.order.table_id });
    }

    const kots = (await getOrderWorkspace(db, orderId))?.kots || [];
    const finalBill = await db.get('SELECT paid_at FROM bills WHERE id=?', [result.billId]);
    const receiptTotals = result.refundDue > EPS ? {
      subtotal: Number(reopenedBill.subtotal), discount: Number(reopenedBill.discount_amount),
      tax: Number(reopenedBill.tax), serviceCharge: Number(reopenedBill.service_charge),
      deliveryFee: Number(reopenedBill.delivery_fee), total: Number(reopenedBill.grand_total),
    } : result.totals;
    const receiptItems = result.refundDue > EPS && reopenSnapshotItems.length
      ? reopenSnapshotItems.map(i => ({ item_name: i.name || i.item_name, quantity: i.quantity, price: i.unitPrice ?? i.price, subtotal: i.total ?? i.subtotal, variant_name: i.variant || i.variant_name }))
      : result.items;
    return NextResponse.json({
      success: true,
      message: result.reopened
        ? (result.due > EPS
          ? `Reopened bill settled — collected ${result.due.toFixed(2)} extra.`
          : result.refundDue > EPS
            ? `Reopened bill settled — refunded ${result.refundDue.toFixed(2)}.`
            : 'Reopened bill settled — no balance change.')
        : 'Payment recorded.',
      bill_id: result.billId,
      bill_number: result.billNumber,
      order_number: result.order.order_number,
      payment_status: result.payment.status,
      outstanding: result.payment.outstanding,
      change,
      due: result.due,
      already_paid: result.alreadyPaid,
      receipt: {
        bill_number: result.billNumber,
        order_number: result.order.order_number,
        table_number: result.order.table_number,
        order_type: result.order.order_type,
        kot_numbers: kots.filter((k) => k.kot_type !== 'cancellation').map((k) => k.kot_number),
        items: receiptItems,
        subtotal: receiptTotals.subtotal,
        discount: receiptTotals.discount,
        discount_label: result.promotion?.name || (receiptTotals.discount > 0 ? data.discount_reason || 'Discount' : null),
        promotion_code: result.promotion?.code || null,
        tax: receiptTotals.tax,
        tax_percent: result.vatPercent ?? effectiveVatPercent,
        service_charge: receiptTotals.serviceCharge,
        service_charge_percent: result.servicePercent,
        delivery_fee: receiptTotals.deliveryFee,
        grand_total: receiptTotals.total,
        already_paid: result.alreadyPaid,
        due: result.due,
        allocations: result.payment.allocations,
        outstanding: result.payment.outstanding,
        change,
        payment_status: result.payment.status,
        customer_name: result.customerInfo.customer_name || '',
        customer_phone: result.customerInfo.customer_phone || '',
        sitting_duration: result.order.table_id && finalBill?.paid_at ? formatSittingDuration(result.order.created_at, finalBill.paid_at) : null,
        processed_by: auth.user.full_name,
        processed_at: new Date().toISOString(),
        restaurant_name: settings.restaurant_name || 'Raithane Daure Chulo',
        restaurant_address: settings.restaurant_address || '',
        restaurant_phone: settings.restaurant_phone || '',
        vat_number: settings.vat_number || '',
        pan_number: settings.pan_number || '',
        receipt_footer: settings.receipt_footer || '',
        // Reopen extras: change log + how it was paid before / now.
        reopened: !!result.reopened,
        item_changes: reopenChanges,
        prior_payments: result.reopened ? priorPayments : [],
        new_payments: result.reopened ? newPayments : [],
        refund_due: result.refundDue || 0,
      },
    });
  } catch (error) {
    if (error?.status && error.status < 500) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return handleRouteError(error, 'We could not complete this payment. Please try again.');
  }
}
