import { nepalOperationalRangeBounds } from '@/lib/report-dates.js';
import { parseDbDate } from '@/lib/time-utils.js';

const SETTLED = new Set(['paid', 'partially_paid', 'reopened', 'refunded']);
const VOID = new Set(['void', 'voided', 'cancelled', 'canceled']);
const OPEN = new Set(['pending', 'preparing', 'ready', 'dining', 'open', 'awaiting_payment', 'in_progress', 'reopened', 'unpaid']);

export const ORDER_ATTENTION_THRESHOLDS = Object.freeze({
  maximumValidPrepMinutes: 240,
});

const n = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const round2 = (value) => Math.round((n(value) + Number.EPSILON) * 100) / 100;
const lower = (value) => String(value || '').toLowerCase();
const cleanReason = (value) => String(value || '').trim() || 'No reason recorded';
const parse = (value) => {
  if (value == null || value === '') return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return value; }
};

async function safe(promise, fallback = []) {
  try { return await promise; } catch { return fallback; }
}

function scope(range, businessDayId, alias, timestamp = 'created_at') {
  if (businessDayId) return { sql: `${alias}.business_day_id = ?`, params: [businessDayId] };
  const { start, endExclusive } = nepalOperationalRangeBounds(range.__driver, range.start, range.end);
  return { sql: `${alias}.${timestamp} >= ? AND ${alias}.${timestamp} < ?`, params: [start, endExclusive] };
}

function auditScope(range, businessDayId, auditAlias, parentAlias, timestamp = 'created_at') {
  if (businessDayId) return { sql: `${parentAlias}.business_day_id = ?`, params: [businessDayId] };
  const { start, endExclusive } = nepalOperationalRangeBounds(range.__driver, range.start, range.end);
  return { sql: `${auditAlias}.${timestamp} >= ? AND ${auditAlias}.${timestamp} < ?`, params: [start, endExclusive] };
}

function utcMs(value) {
  if (!value) return null;
  const date = parseDbDate(value);
  return date && Number.isFinite(date.getTime()) ? date.getTime() : null;
}

function minutesBetween(start, end) {
  const a = utcMs(start); const b = utcMs(end);
  return a == null || b == null ? null : round2((b - a) / 60000);
}

function nepalHour(value) {
  const ms = utcMs(value);
  if (ms == null) return null;
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kathmandu', hour: '2-digit', hour12: false }).format(new Date(ms))) % 24;
}

function orderType(row) {
  if (String(row.order_number || '').startsWith('WEB-')) return 'Online ordering';
  const type = lower(row.order_type).replace(/-/g, '_');
  if (type === 'delivery') return 'Delivery';
  if (['takeaway', 'take_away', 'pickup'].includes(type) || (!row.table_id && !String(row.table_number || '').trim())) return 'Takeaway';
  return 'Dine-in';
}

function paymentGroup(method) {
  const value = lower(method);
  if (value === 'cash') return 'Cash';
  if (['credit', 'due', 'unpaid'].includes(value)) return 'Credit';
  return 'Online';
}

function aggregateReasons(rows, { reason = (row) => row.reason, value = (row) => row.value || 0 } = {}) {
  const map = new Map();
  for (const row of rows) {
    const label = cleanReason(reason(row));
    const current = map.get(label) || { reason: label, count: 0, value: 0 };
    current.count += 1;
    current.value += n(value(row));
    map.set(label, current);
  }
  const total = rows.length;
  return Array.from(map.values()).map((row) => ({ ...row, value: round2(row.value), share: total ? round2(row.count / total * 100) : 0 })).sort((a, b) => b.count - a.count || b.value - a.value);
}

export async function buildOrderOperationsAnalytics(db, range, businessDayId = null) {
  range = { ...range, __driver: db.driver };
  const os = scope(range, businessDayId, 'o');
  const ks = scope(range, businessDayId, 'k', 'printed_at');
  const bs = scope(range, businessDayId, 'b');
  const cs = scope(range, businessDayId, 'bc');
  const pas = auditScope(range, businessDayId, 'pa', 'o');
  const bas = auditScope(range, businessDayId, 'ba', 'b');

  const [ordersRaw, itemsRaw, kotsRaw, kotItemsRaw, billsRaw, allocationsRaw, correctionsRaw, revisionsRaw, billAuditRaw, posAuditRaw, usersRaw] = await Promise.all([
    safe(db.all(
      `SELECT o.id,o.order_number,o.table_id,o.table_number,o.order_type,o.status,o.customer_name,o.customer_id,
              o.cancel_reason,o.cancelled_at,o.created_at,o.updated_at,o.completed_at,o.waiter_id,
              COALESCE(c.name,NULLIF(o.customer_name,''),'Walk-in') AS customer,
              COALESCE(w.full_name,'Unassigned') AS waiter_name,COALESCE(w.role,'—') AS waiter_role
       FROM orders o LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN users w ON w.id=o.waiter_id
       WHERE ${os.sql} ORDER BY o.created_at DESC`, os.params
    )),
    safe(db.all(
      `SELECT oi.id,oi.order_id,oi.item_id,oi.menu_item_id,COALESCE(oi.item_name,mi.name,'Item') AS item_name,oi.variant_name,
              oi.quantity,oi.price,oi.subtotal,oi.status,oi.sent_quantity,oi.special_instructions,oi.created_at
       FROM order_items oi JOIN orders o ON o.id=oi.order_id LEFT JOIN menu_items mi ON mi.id=COALESCE(oi.menu_item_id,oi.item_id)
       WHERE ${os.sql} ORDER BY oi.created_at,oi.id`, os.params
    )),
    safe(db.all(
      `SELECT k.id,k.kot_number,k.order_id,k.status,k.kot_type,k.sequence,k.amends_kot_id,k.table_number,k.printed_at,k.started_at,
              k.completed_at,k.cancelled_at,k.cancelled_by,k.previous_status,k.cancel_reason,k.void_reason,k.voided,k.voided_at,
              k.issued_by,k.issued_by_name,o.order_number,
              (SELECT MAX(b2.paid_at) FROM bills b2 WHERE b2.order_id=o.id) AS paid_at,
              COALESCE(cu.full_name,k.issued_by_name,'Unassigned') AS cancelled_by_name,COALESCE(cu.role,'—') AS cancelled_by_role
       FROM kots k JOIN orders o ON o.id=k.order_id
       LEFT JOIN users cu ON cu.id=k.cancelled_by WHERE ${ks.sql}
       ORDER BY k.printed_at DESC`, ks.params
    )),
    safe(db.all(
      `SELECT ki.id,ki.kot_id,ki.order_item_id,COALESCE(ki.item_name,oi.item_name,mi.name,'Item') AS item_name,
              ki.variant_name,ki.quantity,ki.status,ki.is_cancellation,ki.special_instructions,
              COALESCE(oi.price,mi.base_price) AS price
       FROM kot_items ki JOIN kots k ON k.id=ki.kot_id JOIN orders o ON o.id=k.order_id
       LEFT JOIN order_items oi ON oi.id=ki.order_item_id LEFT JOIN menu_items mi ON mi.id=COALESCE(ki.menu_item_id,oi.menu_item_id,oi.item_id)
       WHERE ${ks.sql} ORDER BY ki.id`, ks.params
    )),
    safe(db.all(
      `SELECT b.id,b.bill_number,b.order_id,b.subtotal,b.discount_amount,b.discount_reason,b.grand_total,b.status,
              b.service_charge,b.service_charge_percent,
              b.payment_status,b.outstanding_amount,b.refunded_amount,b.created_at,b.paid_at,b.void_reason,b.voided_at,b.cashier_id,
              o.order_number,o.table_number,o.order_type,COALESCE(u.full_name,'Unassigned') AS cashier_name,COALESCE(u.role,'—') AS cashier_role
       FROM bills b JOIN orders o ON o.id=b.order_id LEFT JOIN users u ON u.id=b.cashier_id
       WHERE ${bs.sql} ORDER BY b.created_at DESC`, bs.params
    )),
    safe(db.all(
      `SELECT p.bill_id,p.method,p.amount,p.provider,p.reference_number,p.created_at,p.settlement_status
       FROM (
         SELECT bpa.bill_id,bpa.method,bpa.amount,bpa.provider,bpa.reference_number,bpa.created_at,bpa.settlement_status,bpa.business_day_id
         FROM bill_payment_allocations bpa
         UNION ALL
         SELECT bp.bill_id,bp.payment_method AS method,bp.amount,bp.provider,bp.reference_number,bp.created_at,bp.settlement_status,bp.business_day_id
         FROM bill_payments bp WHERE NOT EXISTS (SELECT 1 FROM bill_payment_allocations ba WHERE ba.bill_id=bp.bill_id)
       ) p JOIN bills b ON b.id=p.bill_id WHERE ${businessDayId ? 'p.business_day_id = ?' : 'p.created_at >= ? AND p.created_at < ?'}
       ORDER BY p.created_at DESC`, businessDayId ? [businessDayId] : Object.values(nepalOperationalRangeBounds(db.driver, range.start, range.end))
    )),
    safe(db.all(
      `SELECT bc.id,bc.bill_id,bc.type,bc.amount,bc.reason,bc.restocked,bc.created_by,bc.created_at,
              b.bill_number,b.order_id,b.grand_total,b.status AS bill_status,o.order_number,
              COALESCE(u.full_name,'Unassigned') AS actor_name,COALESCE(u.role,'—') AS actor_role
       FROM bill_corrections bc JOIN bills b ON b.id=bc.bill_id JOIN orders o ON o.id=b.order_id
       LEFT JOIN users u ON u.id=bc.created_by WHERE ${cs.sql} ORDER BY bc.created_at DESC`, cs.params
    )),
    safe(db.all(
      `SELECT br.*,b.bill_number,b.order_id,b.grand_total,o.order_number,
              COALESCE(cu.full_name,'Unassigned') AS created_by_name,COALESCE(cu.role,'—') AS created_by_role,
              COALESCE(fu.full_name,'Unassigned') AS finalized_by_name
       FROM bill_revisions br JOIN bills b ON b.id=br.bill_id JOIN orders o ON o.id=b.order_id
       LEFT JOIN users cu ON cu.id=br.created_by LEFT JOIN users fu ON fu.id=br.finalized_by
       WHERE ${businessDayId ? 'b.business_day_id = ?' : 'br.created_at >= ? AND br.created_at < ?'} ORDER BY br.created_at DESC`,
      businessDayId ? [businessDayId] : Object.values(nepalOperationalRangeBounds(db.driver, range.start, range.end))
    )),
    safe(db.all(
      `SELECT ba.*,b.bill_number,b.order_id,o.order_number,COALESCE(u.full_name,'Unassigned') AS actor_name,COALESCE(u.role,'—') AS actor_role
       FROM bill_audit ba JOIN bills b ON b.id=ba.bill_id JOIN orders o ON o.id=b.order_id LEFT JOIN users u ON u.id=ba.actor_id
       WHERE ${bas.sql} ORDER BY ba.created_at DESC`, bas.params
    )),
    safe(db.all(
      `SELECT pa.*,o.order_number,COALESCE(u.full_name,pa.actor_name,'Unassigned') AS resolved_actor,COALESCE(u.role,'—') AS actor_role
       FROM pos_audit_log pa LEFT JOIN orders o ON o.id=pa.order_id LEFT JOIN bills b ON b.id=pa.bill_id
       LEFT JOIN users u ON u.id=pa.actor_id WHERE ${businessDayId ? '(o.business_day_id = ? OR b.business_day_id = ?)' : 'pa.created_at >= ? AND pa.created_at < ?'}
       ORDER BY pa.created_at DESC LIMIT 2000`, businessDayId ? [businessDayId, businessDayId] : Object.values(nepalOperationalRangeBounds(db.driver, range.start, range.end))
    )),
    safe(db.all(`SELECT id,full_name,role FROM users`)),
  ]);

  const users = new Map(usersRaw.map((row) => [Number(row.id), row]));
  const orders = ordersRaw.map((row) => ({ ...row, orderType: orderType(row), status: lower(row.status) || 'pending' }));
  const ordersById = new Map(orders.map((row) => [Number(row.id), row]));
  const itemsByOrder = new Map();
  for (const item of itemsRaw) {
    const list = itemsByOrder.get(Number(item.order_id)) || [];
    list.push(item); itemsByOrder.set(Number(item.order_id), list);
  }
  const billsById = new Map(billsRaw.map((row) => [Number(row.id), row]));
  const billsByOrder = new Map();
  for (const bill of billsRaw) {
    const list = billsByOrder.get(Number(bill.order_id)) || [];
    list.push(bill); billsByOrder.set(Number(bill.order_id), list);
  }
  const paymentsByBill = new Map();
  for (const payment of allocationsRaw) {
    if (['cancelled', 'voided', 'failed'].includes(lower(payment.settlement_status))) continue;
    const list = paymentsByBill.get(Number(payment.bill_id)) || [];
    list.push(payment); paymentsByBill.set(Number(payment.bill_id), list);
  }
  const kotItemsByKot = new Map();
  for (const item of kotItemsRaw) {
    const list = kotItemsByKot.get(Number(item.kot_id)) || [];
    list.push(item); kotItemsByKot.set(Number(item.kot_id), list);
  }

  const posAudit = posAuditRaw.map((row) => ({ ...row, detailParsed: parse(row.detail), previousParsed: parse(row.previous_value), newParsed: parse(row.new_value) }));
  const billAudit = billAuditRaw.map((row) => ({ ...row, previousParsed: parse(row.previous_value), newParsed: parse(row.new_value) }));
  const orderCancelAudits = new Map(posAudit.filter((row) => ['order_cancelled', 'order_voided'].includes(row.action)).map((row) => [Number(row.order_id), row]));

  const orderRows = orders.map((order) => {
    const items = itemsByOrder.get(Number(order.id)) || [];
    const bills = billsByOrder.get(Number(order.id)) || [];
    const cancelAudit = orderCancelAudits.get(Number(order.id));
    const originalValue = round2(items.reduce((sum, item) => sum + n(item.subtotal || n(item.price) * n(item.quantity)), 0));
    const liveValue = round2(items.filter((item) => !['cancelled', 'voided'].includes(lower(item.status))).reduce((sum, item) => sum + n(item.subtotal || n(item.price) * n(item.quantity)), 0));
    const settledBills = bills.filter((bill) => SETTLED.has(lower(bill.status)));
    return {
      id: order.id, orderNumber: order.order_number, createdAt: order.created_at, updatedAt: order.updated_at,
      completedAt: order.completed_at, cancelledAt: order.cancelled_at || cancelAudit?.created_at || null,
      status: order.status, orderType: order.orderType, table: order.table_number || '—', customer: order.customer,
      staff: order.waiter_name, staffRole: order.waiter_role, originalValue, liveValue,
      itemCount: items.length, quantity: items.reduce((sum, item) => sum + n(item.quantity), 0),
      reason: cleanReason(order.cancel_reason || cancelAudit?.reason), cancelledBy: cancelAudit?.resolved_actor || 'Not persisted', cancelledByRole: cancelAudit?.actor_role || '—',
      ageMinutes: minutesBetween(order.created_at, order.cancelled_at || order.completed_at || order.updated_at),
      kotCount: kotsRaw.filter((kot) => Number(kot.order_id) === Number(order.id)).length,
      kitchenStarted: kotsRaw.some((kot) => Number(kot.order_id) === Number(order.id) && (kot.started_at || ['preparing', 'ready'].includes(lower(kot.previous_status)))),
      billCount: bills.length,
      billId: bills[0]?.id || null,
      billNumber: bills[0]?.bill_number || null,
      completedSales: round2(settledBills.reduce((sum, bill) => sum + n(bill.grand_total) - n(bill.refunded_amount), 0)),
    };
  });

  const kotRows = kotsRaw.map((kot) => {
    const items = kotItemsByKot.get(Number(kot.id)) || [];
    const printedToComplete = minutesBetween(kot.printed_at, kot.completed_at);
    const startedToComplete = minutesBetween(kot.started_at, kot.completed_at);
    const cancelled = lower(kot.status) === 'cancelled' || n(kot.voided) === 1 || lower(kot.kot_type) === 'cancellation';
    let lifecycle = 'still_open';
    let prepMinutes = null;
    if (cancelled) lifecycle = 'cancelled';
    else if (kot.completed_at && !kot.started_at) lifecycle = 'auto_closed_or_incomplete';
    else if (kot.started_at && kot.completed_at && startedToComplete >= 0 && startedToComplete <= ORDER_ATTENTION_THRESHOLDS.maximumValidPrepMinutes) {
      lifecycle = 'completed_normally'; prepMinutes = startedToComplete;
    } else if (kot.started_at && kot.completed_at) lifecycle = 'invalid_timestamps';
    return {
      id: kot.id, kotNumber: kot.kot_number || `KOT-${kot.id}`, orderId: kot.order_id, orderNumber: kot.order_number,
      table: kot.table_number || '—', status: lower(kot.status), previousStatus: kot.previous_status,
      type: kot.kot_type || 'new', amendsKotId: kot.amends_kot_id || null, printedAt: kot.printed_at, startedAt: kot.started_at, completedAt: kot.completed_at,
      cancelledAt: kot.cancelled_at || kot.voided_at, cancelledBy: kot.cancelled_by_name, cancelledByRole: kot.cancelled_by_role,
      reason: cleanReason(kot.cancel_reason || kot.void_reason), lifecycle, prepMinutes, printedToComplete,
      itemCount: items.length, quantity: items.reduce((sum, item) => sum + n(item.quantity), 0),
      value: round2(items.reduce((sum, item) => sum + n(item.price) * n(item.quantity), 0)),
      items: items.map((item) => ({ name: item.item_name, variant: item.variant_name, quantity: n(item.quantity), value: round2(n(item.price) * n(item.quantity)), cancellation: n(item.is_cancellation) === 1 })),
    };
  });

  // Cancelling a sent item creates a cancellation notice KOT for the kitchen.
  // If it was the last active line, the original KOT is also auto-resolved.
  // Both are implementation records for one item-removal action, so retain
  // them in storage but do not count them as extra operator cancellations.
  const cancellationNoticeSourceIds = new Set(kotRows
    .filter((row) => lower(row.type) === 'cancellation' && row.amendsKotId)
    .map((row) => Number(row.amendsKotId)));
  const reportableKotRows = kotRows.filter((row) => {
    if (lower(row.type) === 'cancellation') return false;
    const autoResolved = cancellationNoticeSourceIds.has(Number(row.id))
      && cleanReason(row.reason) === 'All items on this ticket were cancelled.';
    return !autoResolved;
  });

  const bills = billsRaw.map((bill) => {
    const payments = paymentsByBill.get(Number(bill.id)) || [];
    const paid = round2(payments.reduce((sum, row) => sum + n(row.amount), 0));
    return {
      id: bill.id, billNumber: bill.bill_number, orderId: bill.order_id, orderNumber: bill.order_number,
      table: bill.table_number || '—', orderType: orderType(bill), createdAt: bill.created_at, paidAt: bill.paid_at,
      status: lower(bill.status), paymentStatus: lower(bill.payment_status), subtotal: round2(bill.subtotal),
      gross: round2(bill.subtotal), discount: round2(bill.discount_amount),
      // Percent OF the menu value the discount was taken off, so it matches what
      // the cashier keyed in.
      discountPercent: n(bill.subtotal) ? round2(n(bill.discount_amount) / n(bill.subtotal) * 100) : 0,
      // What the guest actually pays after the discount, before tax/service —
      // the "-> Rs 800" half of a discount line.
      netItemValue: round2(n(bill.subtotal) - n(bill.discount_amount)),
      discountReason: cleanReason(bill.discount_reason), total: round2(bill.grand_total), paid,
      // The optional per-bill service / extra charge, with the percent it came
      // from (0 when it was keyed in as rupees).
      serviceCharge: round2(bill.service_charge), servicePercent: n(bill.service_charge_percent),
      outstanding: round2(bill.outstanding_amount), refunded: round2(bill.refunded_amount),
      voidReason: cleanReason(bill.void_reason), voidedAt: bill.voided_at,
      cashierId: bill.cashier_id, cashier: bill.cashier_name, cashierRole: bill.cashier_role,
      methods: [...new Set(payments.map((row) => paymentGroup(row.method)))], payments,
    };
  });
  const billsMap = new Map(bills.map((row) => [Number(row.id), row]));

  const corrections = correctionsRaw.map((row) => ({
    id: row.id, type: row.type, billId: row.bill_id, billNumber: row.bill_number, orderId: row.order_id,
    orderNumber: row.order_number, originalAmount: round2(row.grand_total), amount: round2(row.amount),
    full: n(row.amount) >= n(row.grand_total) - 0.01, reason: cleanReason(row.reason), actor: row.actor_name,
    actorRole: row.actor_role, createdAt: row.created_at, restocked: !!n(row.restocked),
    originalMethods: billsMap.get(Number(row.bill_id))?.methods || [],
  }));
  const revisions = revisionsRaw.map((row) => ({
    id: row.id, billId: row.bill_id, billNumber: row.bill_number, orderId: row.order_id, orderNumber: row.order_number,
    status: row.status, reason: cleanReason(row.reason), originalTotal: round2(row.grand_total), delta: round2(row.delta_amount),
    newTotal: round2(n(row.grand_total) + n(row.delta_amount)), refundAmount: round2(row.refund_amount),
    createdBy: row.created_by_name, createdByRole: row.created_by_role, createdAt: row.created_at,
    finalizedBy: row.finalized_by_name, finalizedAt: row.finalized_at,
    originalSnapshot: parse(row.original_snapshot), revisedSnapshot: parse(row.revised_snapshot),
  }));

  const itemById = new Map(itemsRaw.map((item) => [Number(item.id), item]));
  const kotItemByOrderItemId = new Map();
  for (const item of kotItemsRaw) {
    const key = Number(item.order_item_id || 0);
    if (key && !kotItemByOrderItemId.has(key)) kotItemByOrderItemId.set(key, item);
  }
  const finite = (...values) => {
    for (const value of values) if (value !== null && value !== '' && Number.isFinite(Number(value))) return Number(value);
    return null;
  };
  const legacyAddedSnapshots = posAudit
    .filter((row) => row.action === 'item_added')
    .flatMap((row) => (Array.isArray(row.detailParsed) ? row.detailParsed : [row.detailParsed || {}])
      .map((detail) => ({ orderId: Number(row.order_id), at: utcMs(row.created_at) || 0, detail })));
  const itemAudit = posAudit
    .filter((row) => ['item_added', 'item_edited', 'item_removed', 'kot_item_cancelled'].includes(row.action))
    .flatMap((row) => {
      // Older item-added events stored an array while edits/removals stored an
      // object. Normalise both shapes and emit one report row per changed line.
      const details = Array.isArray(row.detailParsed) ? row.detailParsed : [row.detailParsed || {}];
      return details.map((rawDetail, index) => {
        // A short-lived legacy build logged a deleted line's ID only. Pair it
        // with the latest preceding add on that order when possible; this is a
        // best-effort recovery for old rows, while new rows carry an exact price
        // snapshot above.
        const legacyAdd = ['item_removed', 'kot_item_cancelled'].includes(row.action)
          ? legacyAddedSnapshots
            .filter((candidate) => candidate.orderId === Number(row.order_id) && candidate.at <= (utcMs(row.created_at) || 0))
            .sort((a, b) => b.at - a.at)[0]?.detail
          : null;
        const detail = { ...(legacyAdd || {}), ...(rawDetail || {}) };
        const before = row.previousParsed && typeof row.previousParsed === 'object' ? row.previousParsed : {};
        const after = row.newParsed && typeof row.newParsed === 'object' ? row.newParsed : {};
        const itemId = Number(detail.order_item_id || before.order_item_id || after.order_item_id || 0);
        const menuItemId = Number(detail.menu_item_id || before.menu_item_id || after.menu_item_id || 0);
        const namedCandidate = itemsRaw.find((candidate) =>
          Number(candidate.order_id) === Number(row.order_id)
          && ((menuItemId && Number(candidate.menu_item_id || candidate.item_id) === menuItemId)
            || (detail.item_name && candidate.item_name === detail.item_name))
        );
        const catalogCandidate = menuItemId
          ? itemsRaw.find((candidate) => Number(candidate.menu_item_id || candidate.item_id) === menuItemId)
          : null;
        const item = itemById.get(itemId) || kotItemByOrderItemId.get(itemId) || namedCandidate || catalogCandidate;
        const quantity = finite(detail.quantity, after.quantity, before.quantity, item?.quantity, 1) ?? 1;
        const price = finite(detail.price, after.price, before.price, item?.price);
        const beforeQty = finite(before.quantity, typeof row.previousParsed === 'number' ? row.previousParsed : null);
        const afterQty = finite(after.quantity, typeof row.newParsed === 'number' ? row.newParsed : null, quantity);
        const explicitSubtotal = finite(detail.subtotal, after.subtotal, before.subtotal);
        let valueDifference = null;
        if (row.action === 'item_added') valueDifference = explicitSubtotal ?? (price == null ? null : round2(price * quantity));
        else if (['item_removed', 'kot_item_cancelled'].includes(row.action)) valueDifference = explicitSubtotal == null && price == null ? null : -round2(explicitSubtotal ?? price * quantity);
        else if (beforeQty != null && afterQty != null && price != null) valueDifference = round2((afterQty - beforeQty) * price);
        else if (finite(before.subtotal) != null && finite(after.subtotal) != null) valueDifference = round2(finite(after.subtotal) - finite(before.subtotal));
        return {
          id: details.length > 1 ? `${row.id}-${index}` : row.id,
          orderId: row.order_id, orderNumber: row.order_number,
          item: detail.item_name || after.item_name || before.item_name || item?.item_name || 'Item details unavailable',
          action: row.action, before: row.previousParsed, after: row.newParsed, quantity,
          valueDifference,
          reason: cleanReason(row.reason), actor: row.resolved_actor, actorRole: row.actor_role, createdAt: row.created_at,
          prepared: detail.prepared ?? null,
        };
      });
    });

  const completedBills = bills.filter((bill) => SETTLED.has(bill.status));
  const voidedBills = bills.filter((bill) => VOID.has(bill.status));
  const discountedBills = bills.filter((bill) => bill.discount > 0);
  const refunds = corrections.filter((row) => row.type === 'refund');
  const voidCorrections = corrections.filter((row) => row.type === 'void');
  const cancelledOrders = orderRows.filter((row) => row.status === 'cancelled');
  const openOrders = orderRows.filter((row) => OPEN.has(row.status));
  const cancelledKots = reportableKotRows.filter((row) => row.lifecycle === 'cancelled');
  const normalKots = reportableKotRows.filter((row) => row.lifecycle === 'completed_normally' && row.prepMinutes != null);
  const invalidKots = reportableKotRows.filter((row) => ['auto_closed_or_incomplete', 'invalid_timestamps'].includes(row.lifecycle));
  const prepValues = normalKots.map((row) => row.prepMinutes).sort((a, b) => a - b);
  const medianPrep = prepValues.length ? prepValues.length % 2 ? prepValues[Math.floor(prepValues.length / 2)] : (prepValues[prepValues.length / 2 - 1] + prepValues[prepValues.length / 2]) / 2 : null;

  const lifecycle = {
    ordersCreated: orderRows.length,
    kotSent: new Set(kotRows.filter((row) => row.type !== 'cancellation').map((row) => row.orderId)).size,
    preparing: kotRows.filter((row) => row.status === 'preparing').length,
    ready: kotRows.filter((row) => row.status === 'ready').length,
    served: orderRows.filter((row) => ['served', 'awaiting_payment'].includes(row.status)).length,
    billed: new Set(bills.map((row) => row.orderId)).size,
    paid: new Set(completedBills.filter((row) => row.paid >= row.total - 0.01).map((row) => row.orderId)).size,
  };

  const summary = {
    ordersCreated: orderRows.length, completedOrders: orderRows.filter((row) => row.status === 'completed').length,
    openOrders: openOrders.length, cancelledOrders: cancelledOrders.length,
    totalOrderValue: round2(orderRows.reduce((sum, row) => sum + row.originalValue, 0)),
    completedSalesValue: round2(completedBills.reduce((sum, row) => sum + row.total - row.refunded, 0)),
    averageOrderValue: orderRows.length ? round2(orderRows.reduce((sum, row) => sum + row.originalValue, 0) / orderRows.length) : 0,
    dineIn: orderRows.filter((row) => row.orderType === 'Dine-in').length,
    takeaway: orderRows.filter((row) => row.orderType === 'Takeaway').length,
    delivery: orderRows.filter((row) => row.orderType === 'Delivery').length,
    pendingPayments: bills.filter((row) => row.outstanding > 0 || ['partial', 'partially_paid'].includes(row.paymentStatus)).length,
    unpaidBills: bills.filter((row) => row.paid <= 0 && !VOID.has(row.status)).length,
    discountedBills: discountedBills.length, discountAmount: round2(discountedBills.reduce((sum, row) => sum + row.discount, 0)),
    serviceCharge: round2(completedBills.reduce((sum, row) => sum + n(row.serviceCharge), 0)),
    voidedBills: voidedBills.length, voidValue: round2(voidCorrections.reduce((sum, row) => sum + row.amount, 0)),
    refunds: refunds.length, refundValue: round2(refunds.reduce((sum, row) => sum + row.amount, 0)),
  };

  const staffMap = new Map();
  const staff = (id, fallbackName = 'Unassigned', fallbackRole = '—') => {
    const user = users.get(Number(id));
    const key = Number(id) || `name:${fallbackName}`;
    if (!staffMap.has(key)) staffMap.set(key, { id: Number(id) || null, name: user?.full_name || fallbackName, role: user?.role || fallbackRole, ordersCreated: 0, salesHandled: 0, billsGenerated: 0, discounts: 0, discountValue: 0, ordersCancelled: 0, itemsCancelled: 0, kotsCancelled: 0, billsVoided: 0, billsReopened: 0, refunds: 0 });
    return staffMap.get(key);
  };
  for (const row of posAudit) {
    const member = staff(row.actor_id, row.resolved_actor, row.actor_role);
    if (row.action === 'order_created') member.ordersCreated += 1;
    if (['item_removed', 'kot_item_cancelled'].includes(row.action)) member.itemsCancelled += 1;
    if (row.action === 'order_cancelled') member.ordersCancelled += 1;
    if (row.action === 'kot_cancelled') member.kotsCancelled += 1;
  }
  for (const bill of bills) {
    const member = staff(bill.cashierId, bill.cashier, bill.cashierRole);
    member.billsGenerated += 1; member.salesHandled += SETTLED.has(bill.status) ? bill.total - bill.refunded : 0;
    if (bill.discount > 0) { member.discounts += 1; member.discountValue += bill.discount; }
  }
  for (const row of correctionsRaw) {
    const member = staff(row.created_by, row.actor_name, row.actor_role);
    if (row.type === 'void') member.billsVoided += 1; else member.refunds += 1;
  }
  for (const row of billAudit.filter((item) => item.event === 'bill_reopened_to_pos')) staff(row.actor_id, row.actor_name, row.actor_role).billsReopened += 1;
  const staffRows = Array.from(staffMap.values()).map((row) => ({ ...row, salesHandled: round2(row.salesHandled), discountValue: round2(row.discountValue), cancellationRate: row.ordersCreated ? round2(row.ordersCancelled / row.ordersCreated * 100) : null })).filter((row) => row.ordersCreated || row.billsGenerated || row.itemsCancelled || row.kotsCancelled || row.billsVoided || row.billsReopened || row.refunds).sort((a, b) => b.salesHandled - a.salesHandled);

  const itemMap = new Map();
  for (const item of itemsRaw) {
    const key = `${item.item_name}|${item.variant_name || ''}`;
    const row = itemMap.get(key) || { item: item.item_name, variant: item.variant_name, orderedQuantity: 0, revenue: 0, cancelledQuantity: 0, cancellationValue: 0, modifications: 0 };
    row.orderedQuantity += n(item.quantity); row.revenue += ['cancelled', 'voided'].includes(lower(item.status)) ? 0 : n(item.subtotal);
    if (['cancelled', 'voided'].includes(lower(item.status))) { row.cancelledQuantity += n(item.quantity); row.cancellationValue += n(item.price) * n(item.quantity); }
    itemMap.set(key, row);
  }
  for (const event of itemAudit) {
    const key = Array.from(itemMap.keys()).find((candidate) => candidate.startsWith(`${event.item}|`));
    if (key) itemMap.get(key).modifications += 1;
  }
  const itemAnalytics = Array.from(itemMap.values()).map((row) => ({ ...row, revenue: round2(row.revenue), cancellationValue: round2(row.cancellationValue), cancellationRate: row.orderedQuantity ? round2(row.cancelledQuantity / row.orderedQuantity * 100) : 0 })).sort((a, b) => b.revenue - a.revenue);

  const paymentMap = new Map();
  for (const row of allocationsRaw) {
    const label = paymentGroup(row.method); const current = paymentMap.get(label) || { method: label, amount: 0, transactions: 0 };
    current.amount += n(row.amount); current.transactions += 1; paymentMap.set(label, current);
  }
  const paymentAnalytics = Array.from(paymentMap.values()).map((row) => ({ ...row, amount: round2(row.amount) })).sort((a, b) => b.amount - a.amount);
  /*
   * Collections by medium, for the period summary cards. Read off the SAME
   * grouped allocations as the payment breakdown chart, so a card and the chart
   * under it cannot disagree. "QR" is every digital medium (QR/Bank, card,
   * wallet) — the split between them is the chart's job, not a headline card's.
   */
  const collectedBy = (predicate) => round2(
    paymentAnalytics.filter((row) => predicate(row.method)).reduce((sum, row) => sum + row.amount, 0)
  );
  summary.cashSale = collectedBy((m) => m === 'Cash');
  summary.qrSale = collectedBy((m) => m !== 'Cash' && m !== 'Credit');
  summary.creditSale = collectedBy((m) => m === 'Credit');

  const hourMap = new Map();
  for (const row of orderRows) { const hour = nepalHour(row.createdAt); if (hour == null) continue; const current = hourMap.get(hour) || { hour, orders: 0, sales: 0, cancellations: 0 }; current.orders += 1; current.sales += row.completedSales; if (row.status === 'cancelled') current.cancellations += 1; hourMap.set(hour, current); }
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ label: `${String(hour).padStart(2, '0')}:00`, value: hourMap.get(hour)?.orders || 0, sales: round2(hourMap.get(hour)?.sales || 0), cancellations: hourMap.get(hour)?.cancellations || 0 }));
  const typeMap = new Map();
  for (const row of orderRows) { const current = typeMap.get(row.orderType) || { type: row.orderType, orders: 0, sales: 0, cancelled: 0 }; current.orders += 1; current.sales += row.completedSales; if (row.status === 'cancelled') current.cancelled += 1; typeMap.set(row.orderType, current); }
  const byType = Array.from(typeMap.values()).map((row) => ({ ...row, sales: round2(row.sales), average: row.orders ? round2(row.sales / row.orders) : 0, cancellationRate: row.orders ? round2(row.cancelled / row.orders * 100) : 0 }));

  const timeline = [
    ...posAudit.map((row) => ({ id: `pos-${row.id}`, orderId: row.order_id, orderNumber: row.order_number, billId: row.bill_id, kotId: row.kot_id, entity: row.bill_id ? 'Bill' : row.kot_id ? 'KOT' : 'Order', action: row.action, actor: row.resolved_actor, actorRole: row.actor_role, reason: row.reason, before: row.previousParsed, after: row.newParsed, detail: row.detailParsed, createdAt: row.created_at })),
    ...billAudit.map((row) => ({ id: `bill-${row.id}`, orderId: row.order_id, orderNumber: row.order_number, billId: row.bill_id, entity: 'Bill', action: row.event, actor: row.actor_name, actorRole: row.actor_role, reason: row.reason, before: row.previousParsed, after: row.newParsed, detail: null, createdAt: row.created_at })),
  ].sort((a, b) => (utcMs(b.createdAt) || 0) - (utcMs(a.createdAt) || 0));

  const reasons = {
    orderCancellations: aggregateReasons(cancelledOrders, { value: (row) => row.originalValue }),
    kotCancellations: aggregateReasons(cancelledKots, { value: (row) => row.value }),
    itemCancellations: aggregateReasons(itemAudit.filter((row) => ['item_removed', 'kot_item_cancelled'].includes(row.action)), { value: (row) => Math.abs(row.valueDifference) }),
    billVoids: aggregateReasons(voidCorrections, { value: (row) => row.amount }),
    refunds: aggregateReasons(refunds, { value: (row) => row.amount }),
    reopens: aggregateReasons(revisions, { value: (row) => Math.abs(row.delta) }),
    discounts: aggregateReasons(discountedBills, { reason: (row) => row.discountReason, value: (row) => row.discount }),
  };

  return {
    summary, lifecycle, thresholds: ORDER_ATTENTION_THRESHOLDS,
    orders: orderRows, kots: reportableKotRows, cancelledOrders, cancelledKots, itemChanges: itemAudit,
    bills, discounts: discountedBills, corrections, revisions, payments: paymentAnalytics,
    pendingBills: bills.filter((row) => row.outstanding > 0 || row.paid < row.total - 0.01),
    paymentEvents: billAudit.filter((row) => /payment|settlement|refund/i.test(row.event)),
    staff: staffRows, items: itemAnalytics, timeline, reasons,
    charts: { byHour, byType, prep: normalKots.map((row) => ({ label: row.kotNumber, value: row.prepMinutes })) },
    kitchenQuality: {
      validCompleted: normalKots.length, autoClosedOrIncomplete: invalidKots.filter((row) => row.lifecycle === 'auto_closed_or_incomplete').length,
      invalidTimestamps: invalidKots.filter((row) => row.lifecycle === 'invalid_timestamps').length,
      stillOpen: reportableKotRows.filter((row) => row.lifecycle === 'still_open').length, cancelled: cancelledKots.length,
      averagePrepMinutes: prepValues.length ? round2(prepValues.reduce((sum, value) => sum + value, 0) / prepValues.length) : null,
      medianPrepMinutes: medianPrep == null ? null : round2(medianPrep),
      note: 'Prep averages require a persisted preparing timestamp followed by a valid completion timestamp. Tickets auto-closed during billing and historical tickets without a preparing transition are reported separately and never included in averages.',
    },
    limitations: [
      'Older whole-order cancellations do not persist a cancelling user; those rows are labelled “Not persisted”.',
      'Discounts are stored on bills, but a separate discount-applied-by/approved-by field is not persisted. The report shows the bill cashier as context, not as a claim of approval.',
      'Complimentary item and item-level refund records are not separate persisted models, so those sections are omitted rather than inferred.',
      'Historical table transfer events are available only where POS audit logging was active.',
    ],
  };
}
