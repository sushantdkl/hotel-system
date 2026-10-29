/**
 * Operational refund & void for bills. Orchestrates the pieces that already
 * exist — reuses the accounting engine (reverseJournal / refund), the order
 * workflow (order status + table release) and inventory (restoreStockForItems).
 * No accounting logic is re-implemented here.
 *
 *   voidPaidBill  — reverses the whole sale journal (payment + revenue + tax),
 *                   marks the bill voided, cancels the order, frees the table,
 *                   and (by default) restocks. A void = the sale never happened.
 *   refundBill    — returns money for a served bill: Dr Sales / Cr the medium,
 *                   partial or full, over-refund prevented. Stock stays consumed.
 *
 * Everything runs in one transaction and is written to bill_corrections for a
 * complete audit trail. Nothing historical is deleted.
 */

import { ensureAccountingSchema } from './accounting.js';
import { reverseJournal, refund } from './accounting-corrections.js';
import { currentBusinessDayId } from './business-days.js';
import { ensureSqliteTable } from './db/ensure-sqlite-table.js';
import { ensureColumn, serialPkSql } from './db/schema-helpers.js';
import { ensureSplitPaymentSchema } from './split-payments.js';
import { assertNotRoomCharged, reverseRoomChargeForBill } from '@/lib/hotel/room-charges.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const bad = (m) => Object.assign(new Error(m), { status: 400 });
const conflict = (m) => Object.assign(new Error(m), { status: 409 });

/**
 * Exported so the report engine can prepare this table too — reports read
 * bill_corrections for refunds and voids, and an install that has never issued
 * a refund has never created it.
 */
export async function ensureBillCorrectionsSchema(db) {
  if (db.driver === 'postgres') return;
  const pk = serialPkSql(db);
  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS bill_corrections (
    ${pk}, bill_id INTEGER NOT NULL, type TEXT NOT NULL, amount REAL NOT NULL,
    reason TEXT NOT NULL, restocked INTEGER DEFAULT 0, journal_id INTEGER,
    created_by INTEGER, business_day_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await ensureColumn(db, 'bill_corrections', 'business_day_id', 'INTEGER');
  await ensureColumn(db, 'bills', 'refunded_amount', 'REAL DEFAULT 0');
  await ensureColumn(db, 'bills', 'void_reason', 'TEXT');
  await ensureColumn(db, 'bills', 'voided_at', 'DATETIME');
  await ensureColumn(db, 'order_items', 'variant_name', 'TEXT');
}

async function loadBill(db, bill_id, bill_number) {
  let bill = null;
  if (bill_id) bill = await db.get(`SELECT * FROM bills WHERE id = ?`, [bill_id]);
  else if (bill_number) bill = await db.get(`SELECT * FROM bills WHERE bill_number = ?`, [bill_number]);
  if (!bill) throw bad('Bill not found.');
  return bill;
}

async function refundedSoFar(db, billId) {
  const row = await db.get(`SELECT COALESCE(SUM(CASE WHEN type='refund' THEN amount WHEN type='refund_reversal' THEN -amount ELSE 0 END), 0) AS s FROM bill_corrections WHERE bill_id = ?`, [billId]);
  return round2(row?.s || 0);
}

/**
 * Resolve a journal to the operational bill behind it, if any.  Correction
 * operators work with journal ids, but bill, payment, collection and write-off
 * journals use different source ids.  Keeping the resolution here gives the
 * preview and the actual reversal exactly the same target.
 */
export async function getCorrectionJournalPreview(db, journalId) {
  await ensureAccountingSchema(db);
  await ensureSplitPaymentSchema(db);
  const id = Number(journalId);
  if (!Number.isInteger(id) || id <= 0) throw bad('Enter a valid journal id.');

  const journal = await db.get(
    `SELECT je.*, u.full_name AS created_by_name,
       (SELECT id FROM journal_entries r WHERE r.source_type='reversal' AND r.source_id=je.id LIMIT 1) AS reversal_id
     FROM journal_entries je
     LEFT JOIN users u ON u.id=je.created_by
     WHERE je.id=?`,
    [id]
  );
  if (!journal) throw bad('Journal not found.');

  const lines = await db.all(
    `SELECT jl.id,jl.debit,jl.credit,jl.memo,a.code AS account_code,a.name AS account_name
     FROM journal_lines jl
     LEFT JOIN accounts a ON a.id=jl.account_id
     WHERE jl.journal_id=? ORDER BY jl.id`,
    [id]
  );

  let bill = null;
  if (journal.source_type === 'bill') {
    bill = await db.get(`SELECT * FROM bills WHERE id=?`, [journal.source_id]);
  }
  if (!bill && journal.external_ref) {
    bill = await db.get(
      `SELECT b.* FROM bill_payments bp JOIN bills b ON b.id=bp.bill_id
       WHERE ?=bp.idempotency_key || ':journal' OR ?=bp.idempotency_key || ':supplement-journal' LIMIT 1`,
      [journal.external_ref, journal.external_ref]
    ).catch(() => null);
  }
  if (!bill && journal.external_ref) {
    bill = await db.get(
      `SELECT b.* FROM customer_ledger cl JOIN bills b ON b.id=cl.bill_id
       WHERE ?=cl.idempotency_key OR ?=cl.idempotency_key || ':journal' LIMIT 1`,
      [journal.external_ref, journal.external_ref]
    ).catch(() => null);
  }
  if (!bill && journal.source_type !== 'bill') {
    const numberMatch = String(journal.memo || '').match(/\bbill\s+([^:—]+?)(?:\s*$|\s*[—:])/i);
    if (numberMatch?.[1]) bill = await db.get(`SELECT * FROM bills WHERE bill_number=?`, [numberMatch[1].trim()]);
  }
  if (!bill && ['bill_payment', 'credit_collection', 'bill_supplement'].includes(String(journal.source_type))) {
    bill = await db.get(
      `SELECT b.* FROM bill_payments bp JOIN bills b ON b.id=bp.bill_id WHERE bp.id=?`,
      [journal.source_id]
    ).catch(() => null);
  }
  if (!bill && journal.source_type === 'bill_payment') {
    bill = await db.get(`SELECT * FROM bills WHERE id=?`, [journal.source_id]);
  }
  if (!bill && journal.source_type === 'credit_writeoff') {
    bill = await db.get(
      `SELECT b.* FROM customer_ledger cl JOIN bills b ON b.id=cl.bill_id WHERE cl.id=?`,
      [journal.source_id]
    ).catch(() => null);
  }
  let refundCorrection = null;
  if (journal.source_type === 'refund') {
    refundCorrection = await db.get(
      `SELECT bc.*,b.bill_number FROM bill_corrections bc JOIN bills b ON b.id=bc.bill_id
       WHERE bc.type='refund' AND bc.journal_id=? ORDER BY bc.id DESC LIMIT 1`,
      [journal.id]
    ).catch(() => null);
    if (refundCorrection && !bill) bill = await db.get(`SELECT * FROM bills WHERE id=?`, [refundCorrection.bill_id]);
  }
  let billDetails = null;
  if (bill) {
    const [order, items, payments, credit] = await Promise.all([
      bill.order_id ? db.get(`SELECT id,order_number,order_type,status,table_id,customer_id FROM orders WHERE id=?`, [bill.order_id]) : null,
      bill.order_id ? db.all(
        `SELECT oi.quantity,oi.price AS unit_price,oi.subtotal AS total_price,COALESCE(mi.name,oi.item_name,'Item') AS name
         FROM order_items oi LEFT JOIN menu_items mi ON mi.id=COALESCE(oi.menu_item_id,oi.item_id)
         WHERE oi.order_id=? ORDER BY oi.id`,
        [bill.order_id]
      ).catch(() => []) : [],
      db.all(
        `SELECT payment_method,amount,settlement_status,created_at FROM bill_payments WHERE bill_id=? ORDER BY id`,
        [bill.id]
      ).catch(() => []),
      db.get(
        `SELECT COALESCE(SUM(debit),0) AS charged,COALESCE(SUM(credit),0) AS cleared,
                COALESCE(SUM(debit-credit),0) AS outstanding
         FROM customer_ledger WHERE bill_id=?`,
        [bill.id]
      ).catch(() => ({ charged: 0, cleared: 0, outstanding: 0 })),
    ]);
    billDetails = { ...bill, order, items, payments, credit };
  }

  let target = null;
  let action = billDetails ? 'void_bill' : 'reverse_journal';
  if (refundCorrection) {
    target = { type: 'refund', correction: refundCorrection };
    action = 'reverse_refund';
  } else if (journal.source_type === 'credit_collection') action = 'reverse_credit_collection';
  else if (journal.source_type === 'credit_writeoff') action = 'reverse_credit_writeoff';
  else if (journal.source_type === 'supplier_payment') action = 'reverse_supplier_payment';
  else if (journal.source_type === 'expense') {
    const expense = await db.get(`SELECT * FROM expenses WHERE id=?`, [journal.source_id]).catch(() => null);
    if (expense) {
      target = { type: 'expense', ...expense };
      if (String(expense.source_type || '').toLowerCase() === 'purchase' && expense.source_id) {
        const purchase = await db.get(`SELECT * FROM purchases WHERE id=?`, [expense.source_id]).catch(() => null);
        if (purchase) target = { type: 'purchase', expense, purchase };
      }
      if (String(expense.source_type || '').toLowerCase() === 'wastage' && expense.source_id) {
        const wastage = await db.get(`SELECT * FROM wastage_log WHERE id=?`, [expense.source_id]).catch(() => null);
        if (wastage) target = { type: 'wastage', expense, wastage };
      }
      action = target?.type === 'purchase' ? 'void_purchase'
        : target?.type === 'wastage' ? 'void_wastage'
          : 'void_expense';
    }
  }

  return {
    journal: { ...journal, lines },
    bill: billDetails,
    target,
    action,
  };
}

async function reverseCustomerCreditEvent(db, preview, { reason, created_by }) {
  const dayId = await currentBusinessDayId(db, { required: true, allowStale: true });
  return db.transaction(async (tx) => {
    const existing = await tx.get(
      `SELECT id FROM journal_entries WHERE source_type='reversal' AND source_id=? LIMIT 1`,
      [preview.journal.id]
    );
    if (existing) throw conflict('This journal has already been reversed.');

    const resolveEvent = async (journal) => {
      let payment = null;
      let ledger = null;
      if (journal.source_type === 'credit_collection') {
        payment = await tx.get(`SELECT * FROM bill_payments WHERE id=?`, [journal.source_id]);
        if (payment) {
          ledger = await tx.get(
            `SELECT * FROM customer_ledger WHERE payment_id=? AND entry_type='credit_payment' ORDER BY id DESC LIMIT 1`,
            [payment.id]
          );
        }
      } else if (journal.source_type === 'credit_writeoff') {
        ledger = await tx.get(`SELECT * FROM customer_ledger WHERE id=?`, [journal.source_id]);
      }
      return { journal, payment, ledger };
    };
    const primary = await resolveEvent(preview.journal);
    const { ledger } = primary;
    if (!ledger?.bill_id || !ledger?.customer_id) {
      throw conflict('The customer credit record behind this journal could not be resolved.');
    }
    const bill = await tx.get(`SELECT * FROM bills WHERE id=?`, [ledger.bill_id]);
    if (!bill) throw conflict('The bill behind this customer credit record no longer exists.');
    if (['void','voided','cancelled','canceled'].includes(String(bill.status || '').toLowerCase())) {
      throw conflict('The linked bill is already voided.');
    }

    const events = [primary];
    const externalRef = String(preview.journal.external_ref || '');
    const settlementRoot = externalRef.includes(':') ? externalRef.split(':')[0] : null;
    if (settlementRoot) {
      const companions = await tx.all(
        `SELECT je.* FROM journal_entries je
         WHERE je.id<>? AND je.source_type IN ('credit_collection','credit_writeoff')
           AND je.external_ref LIKE ?
           AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.source_type='reversal' AND r.source_id=je.id)
         ORDER BY je.id`,
        [preview.journal.id, `${settlementRoot}:%`]
      );
      for (const companionJournal of companions || []) {
        const companion = await resolveEvent(companionJournal);
        if (companion.ledger?.bill_id && companion.ledger?.customer_id === ledger.customer_id) {
          events.push(companion);
        }
      }
    }

    let amount = 0;
    const amountByBill = new Map();
    const reversedJournals = [];
    for (const event of events) {
      const eventAmount = round2(Number(event.ledger?.credit || 0) - Number(event.ledger?.debit || 0));
      if (!(eventAmount > 0)) continue;
      const eventBill = await tx.get(`SELECT * FROM bills WHERE id=?`, [event.ledger.bill_id]);
      if (!eventBill || ['void','voided','cancelled','canceled'].includes(String(eventBill.status || '').toLowerCase())) continue;
      const reversalId = await reverseJournal(tx, {
        journal_id: event.journal.id,
        reason,
        created_by,
        business_day_id: dayId,
      });
      const isWriteOff = event.journal.source_type === 'credit_writeoff';
      await tx.run(
        `INSERT INTO customer_ledger
           (customer_id,bill_id,payment_id,entry_type,debit,credit,note,created_by,idempotency_key,business_day_id)
         VALUES (?,?,?,'adjustment',?,0,?,?,?,?)`,
        [ledger.customer_id, bill.id, event.payment?.id || null, eventAmount,
          `${isWriteOff ? 'Write-off' : 'Credit collection'} reversal — correction: ${reason}`,
          created_by, `correction:${event.journal.id}:customer-ledger`, dayId]
      );
      if (event.payment) {
        await tx.run(`UPDATE bill_payments SET settlement_status='voided' WHERE id=?`, [event.payment.id]);
        await tx.run(`UPDATE bill_payment_allocations SET settlement_status='voided' WHERE payment_id=?`, [event.payment.id]).catch(() => {});
      }
      amount = round2(amount + eventAmount);
      amountByBill.set(eventBill.id, round2((amountByBill.get(eventBill.id) || 0) + eventAmount));
      reversedJournals.push({ journal_id: event.journal.id, reversal_id: reversalId, source_type: event.journal.source_type, amount: eventAmount });
    }
    if (!(amount > 0) || !reversedJournals.length) throw conflict('This customer credit event has no amount left to reverse.');

    let outstanding = Number(bill.outstanding_amount || 0);
    for (const [billId, reopenAmount] of amountByBill) {
      const affectedBill = await tx.get(`SELECT * FROM bills WHERE id=?`, [billId]);
      const nextOutstanding = round2(Math.min(Number(affectedBill.grand_total || 0), Number(affectedBill.outstanding_amount || 0) + reopenAmount));
      const nextStatus = nextOutstanding >= Number(affectedBill.grand_total || 0) - 0.001 ? 'unpaid' : 'partially_paid';
      await tx.run(
        `UPDATE bills SET outstanding_amount=?,payment_status=?,status=?,paid_at=NULL WHERE id=?`,
        [nextOutstanding, nextStatus, nextStatus, billId]
      );
      if (billId === bill.id) outstanding = nextOutstanding;
    }
    const balance = await tx.get(
      `SELECT COALESCE(SUM(debit-credit),0) AS amount FROM customer_ledger WHERE customer_id=?`,
      [ledger.customer_id]
    );
    await tx.run(`UPDATE customers SET current_credit=? WHERE id=?`, [
      round2(Math.max(0, Number(balance?.amount || 0))), ledger.customer_id,
    ]);
    return {
      action: preview.action,
      journal_id: reversedJournals[0].reversal_id,
      reversed_journal: preview.journal.id,
      reversed_journals: reversedJournals,
      bundled_settlement: reversedJournals.length > 1,
      bill_id: bill.id,
      bill_ids: [...amountByBill.keys()],
      amount,
      outstanding,
    };
  });
}

async function reverseRefundEvent(db, preview, { reason, created_by }) {
  const dayId = await currentBusinessDayId(db, { required: true, allowStale: true });
  return db.transaction(async (tx) => {
    const correction = await tx.get(
      `SELECT * FROM bill_corrections WHERE id=? AND type='refund'`,
      [preview.target.correction.id]
    );
    if (!correction) throw conflict('The refund record behind this journal no longer exists.');
    const reversalId = await reverseJournal(tx, {
      journal_id: preview.journal.id, reason, created_by, business_day_id: dayId,
    });
    await tx.run(
      `INSERT INTO bill_corrections
         (bill_id,type,amount,reason,restocked,journal_id,created_by,business_day_id)
       VALUES (?,'refund_reversal',?,?,0,?,?,?)`,
      [correction.bill_id, correction.amount, reason, reversalId, created_by, dayId]
    );
    const refunded = Math.max(0, await refundedSoFar(tx, correction.bill_id));
    await tx.run(
      `UPDATE bills SET refunded_amount=?,status=CASE WHEN LOWER(COALESCE(status,''))='refunded'
         THEN CASE WHEN COALESCE(outstanding_amount,0)>0 THEN 'partially_paid' ELSE 'paid' END ELSE status END
       WHERE id=?`,
      [refunded, correction.bill_id]
    );
    return {
      action: 'reverse_refund', journal_id: reversalId, reversed_journal: preview.journal.id,
      bill_id: correction.bill_id, amount: round2(correction.amount), refunded_total: round2(refunded),
    };
  });
}

/** Reverse a journal and keep its operational source in sync. */
export async function reverseCorrectionByJournal(db, {
  journal_id, reason, restock = true, created_by = null,
  allow_purchase_void = true, allow_previous_day_purchase = false,
}) {
  if (!String(reason || '').trim()) throw bad('A reason is required to reverse a journal.');
  const preview = await getCorrectionJournalPreview(db, journal_id);
  if (preview.journal.source_type === 'reversal') throw conflict('That entry is itself a reversal.');
  if (['reverse_credit_collection', 'reverse_credit_writeoff'].includes(preview.action)) {
    return reverseCustomerCreditEvent(db, preview, { reason, created_by });
  }
  if (preview.action === 'reverse_refund') {
    return reverseRefundEvent(db, preview, { reason, created_by });
  }
  if (preview.action === 'void_purchase') {
    if (!allow_purchase_void) {
      throw Object.assign(new Error('You do not have permission to void purchases.'), { status: 403 });
    }
    const { voidPurchase } = await import('./purchases.js');
    const result = await voidPurchase(db, preview.target.purchase.id, {
      reason, performedBy: created_by, allowPreviousDay: allow_previous_day_purchase,
    });
    return { action: 'void_purchase', purchase_id: result.id, result };
  }
  if (preview.action === 'void_expense') {
    const { voidExpense } = await import('./expense-links.js');
    const result = await voidExpense(db, preview.target.id, { reason, performedBy: created_by });
    return { action: 'void_expense', expense_id: result.id, result };
  }
  if (preview.action === 'void_wastage') {
    const { voidWastage } = await import('./recipes.js');
    const result = await voidWastage(db, preview.target.wastage.id, { reason, performedBy: created_by });
    return { action: 'void_wastage', wastage_id: result.id, result };
  }
  if (preview.action === 'void_bill' && preview.bill) {
    // Older correction behavior could reverse only the accounting journal and
    // leave the bill/customer credit operationally active.  Complete that
    // half-finished correction; voidPaidBill skips journals already reversed.
    const result = await voidPaidBill(db, {
      bill_id: preview.bill.id,
      reason,
      restock,
      created_by,
    });
    return { action: 'void_bill', ...result };
  }
  if (preview.journal.reversal_id) throw conflict('This journal has already been reversed.');
  const businessDayId = await currentBusinessDayId(db, { required: true, allowStale: true });
  const reversalId = await db.transaction((tx) => reverseJournal(tx, {
    journal_id, reason, created_by, business_day_id: businessDayId,
  }));
  return { action: preview.action, journal_id: reversalId, reversed_journal: Number(journal_id) };
}

/** Void a paid bill: reverse accounting, cancel order, free table, restock. */
export async function voidPaidBill(db, { bill_id, bill_number, reason, restock = true, created_by = null }) {
  await ensureBillCorrectionsSchema(db);
  await ensureSplitPaymentSchema(db);
  if (!String(reason || '').trim()) throw bad('A reason is required to void a bill.');
  const bill = await loadBill(db, bill_id, bill_number);
  if (String(bill.status) === 'voided') throw conflict('This bill is already voided.');
  // Room-charged bills can be voided: the sale journal reversal below clears the
  // guest receivable / package liability, and the folio row is neutralized.
  const roomCharged = await db.get("SELECT id FROM bill_payment_allocations WHERE bill_id = ? AND method IN ('room', 'package') LIMIT 1", [bill.id]).catch(() => null);
  const priorRefund = await refundedSoFar(db, bill.id);
  if (priorRefund > 0.001) {
    throw conflict('This bill already has a refund. Refund the remaining balance instead of voiding the original sale.');
  }
  await ensureAccountingSchema(db);
  const businessDayId = await currentBusinessDayId(db, { required: true, allowStale: true });

  return db.transaction(async (tx) => {
    if (roomCharged) {
      if (tx.driver === 'postgres') await tx.get("SELECT id FROM hotel_properties WHERE id = 'main' FOR UPDATE");
      await reverseRoomChargeForBill(tx, { billId: bill.id, actorId: created_by || 1, reason: `Void bill ${bill.bill_number}: ${reason}`, businessDayId });
    }
    // Reverse the sale journal — one contra entry undoes payment + revenue + tax.
    const journals = await tx.all(
      `SELECT DISTINCT je.id,je.source_type
       FROM journal_entries je
       WHERE ((je.source_type='bill' AND je.source_id=?)
          OR (je.source_type='bill_payment' AND je.source_id=?)
          OR (je.source_type IN ('bill_payment','credit_collection','bill_supplement') AND je.source_id IN
                (SELECT id FROM bill_payments WHERE bill_id=?))
          OR (je.source_type='bill_supplement' AND je.source_id=?)
          OR je.external_ref IN (
                SELECT cl.idempotency_key || ':journal'
                FROM customer_ledger cl WHERE cl.bill_id=?
             ))
         AND NOT EXISTS (
               SELECT 1 FROM journal_entries reversal
               WHERE reversal.source_type='reversal' AND reversal.source_id=je.id
             )
       ORDER BY je.id`,
      [bill.id, bill.id, bill.id, bill.id, bill.id]
    );
    const reversed = [];
    for (const journal of journals) {
      const reversalId = await reverseJournal(tx, {
        journal_id: journal.id,
        reason: `Void bill ${bill.bill_number}: ${reason}`,
        created_by,
        business_day_id: businessDayId,
        folio_corrected: Boolean(roomCharged),
      });
      reversed.push({ journalId: journal.id, reversalId, sourceType: journal.source_type });
    }

    const mediaRows = await tx.all(
      `SELECT LOWER(COALESCE(payment_method,'other')) AS method,COALESCE(SUM(amount),0) AS amount
       FROM bill_payments
       WHERE bill_id=? AND LOWER(COALESCE(settlement_status,'received')) NOT IN ('voided','cancelled','failed')
       GROUP BY LOWER(COALESCE(payment_method,'other'))`,
      [bill.id]
    ).catch(() => []);

    const customerRows = await tx.all(
      `SELECT id,customer_id,debit,credit FROM customer_ledger
       WHERE bill_id=? AND COALESCE(note,'') NOT LIKE 'Void reversal:%'
       ORDER BY id`,
      [bill.id]
    ).catch(() => []);
    for (const row of customerRows) {
      await tx.run(
        `INSERT INTO customer_ledger
           (customer_id,bill_id,entry_type,debit,credit,note,created_by,idempotency_key,business_day_id)
         VALUES (?,?,'adjustment',?,?,?,?,?,?)`,
        [row.customer_id, bill.id, round2(row.credit), round2(row.debit),
          `Void reversal: bill ${bill.bill_number}, ledger row ${row.id}`,
          created_by, `void:${bill.id}:ledger:${row.id}`, businessDayId]
      );
    }

    await tx.run(`UPDATE bill_payments SET settlement_status='voided' WHERE bill_id=?`, [bill.id]).catch(() => {});
    await tx.run(`UPDATE bill_payment_allocations SET settlement_status='voided' WHERE bill_id=?`, [bill.id]).catch(() => {});
    await tx.run(
      `UPDATE bills SET status='voided',payment_status='voided',outstanding_amount=0,
         void_reason=?,voided_at=CURRENT_TIMESTAMP WHERE id=?`,
      [reason, bill.id]
    );

    const customerIds = [...new Set(customerRows.map((row) => row.customer_id).filter(Boolean))];
    for (const customerId of customerIds) {
      const balance = await tx.get(
        `SELECT COALESCE(SUM(debit-credit),0) AS amount FROM customer_ledger WHERE customer_id=?`,
        [customerId]
      );
      await tx.run(`UPDATE customers SET current_credit=? WHERE id=?`, [
        round2(Math.max(0, Number(balance?.amount || 0))), customerId,
      ]);
    }

    let restocked = 0;
    if (bill.order_id) {
      const items = await tx.all(
        `SELECT menu_item_id, item_id, variant_name, quantity, combo_snapshot FROM order_items
         WHERE order_id = ? AND COALESCE(status, '') NOT IN ('voided', 'cancelled')`,
        [bill.order_id]
      );
      await tx.run(
        `UPDATE orders SET status = 'cancelled', notes = COALESCE(notes, '') || ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [`\nVoided bill ${bill.bill_number}: ${reason}`, bill.order_id]
      );
      const { cancelKotsForOrder } = await import('./kot-service.js');
      await cancelKotsForOrder(tx, {
        orderId: bill.order_id,
        reason: `Order voided: ${reason}`,
        actorId: created_by,
      });
      await tx.run(
        `UPDATE tables SET status = 'available', current_order_id = NULL, waiter_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE current_order_id = ?`,
        [bill.order_id]
      );
      if (restock && items.length) {
        const { restoreStockForItems } = await import('./stock.js');
        await restoreStockForItems(tx, items, { orderId: bill.order_id, reason: `Void bill ${bill.bill_number}` });
        restocked = 1;
      }
    }

    await tx.run(
      `INSERT INTO bill_corrections (bill_id, type, amount, reason, restocked, journal_id, created_by, business_day_id)
       VALUES (?, 'void', ?, ?, ?, ?, ?, ?)`,
      [bill.id, round2(bill.grand_total), reason, restocked, reversed[0]?.reversalId || null, created_by, businessDayId]
    );

    return {
      bill_id: bill.id,
      bill_number: bill.bill_number,
      reversed_journal: reversed[0]?.journalId || null,
      journal_id: reversed[0]?.reversalId || null,
      reversed_journals: reversed,
      refund_by_method: mediaRows.map((row) => ({ method: row.method, amount: round2(row.amount) })),
      restocked: !!restocked,
    };
  });
}

/** Refund a served bill (full or partial). Over-refund is prevented. */
export async function refundBill(db, { bill_id, bill_number, amount, full = false, method = 'cash', reason, created_by = null, withinTransaction = false }) {
  await ensureBillCorrectionsSchema(db);
  if (!String(reason || '').trim()) throw bad('A reason is required to refund.');
  await ensureAccountingSchema(db);
  const apply = async (tx) => {
    if (tx.driver === 'postgres') {
      if (bill_id) await tx.get('SELECT id FROM bills WHERE id=? FOR UPDATE',[bill_id]);
      else await tx.get('SELECT id FROM bills WHERE bill_number=? FOR UPDATE',[bill_number]);
    }
    const bill = await loadBill(tx, bill_id, bill_number);
  if (String(bill.status) === 'voided') throw conflict('This bill is voided — there is nothing to refund.');
  await assertNotRoomCharged(tx, bill.id);
  const businessDayId = await currentBusinessDayId(tx, { required: true, allowStale: true });

  const prior = await refundedSoFar(tx, bill.id);
  const remaining = round2(Number(bill.grand_total) - prior);
  if (remaining <= 0.001) throw conflict('This bill is already fully refunded.');
  const amt = full ? remaining : round2(amount);
  if (!(amt > 0)) throw bad('Refund amount must be greater than zero.');
  if (amt > remaining + 0.001) throw bad(`Only ${remaining} can still be refunded on this bill.`);

    const journalId = await refund(tx, { amount: amt, method, bill_id: bill.id, reason, created_by, business_day_id: businessDayId });
    const newRefunded = round2(prior + amt);
    const fullyRefunded = newRefunded >= round2(Number(bill.grand_total)) - 0.001;
    await tx.run(
      `UPDATE bills SET refunded_amount = ?, status = CASE WHEN ? = 1 THEN 'refunded' ELSE status END WHERE id = ?`,
      [newRefunded, fullyRefunded ? 1 : 0, bill.id]
    );
    await tx.run(
      `INSERT INTO bill_corrections (bill_id, type, amount, reason, journal_id, created_by, business_day_id) VALUES (?, 'refund', ?, ?, ?, ?, ?)`,
      [bill.id, amt, reason, journalId, created_by, businessDayId]
    );
    return { bill_id: bill.id, amount: amt, refunded_total: newRefunded, remaining: round2(remaining - amt), fully_refunded: fullyRefunded, journal_id: journalId };
  };
  return withinTransaction ? apply(db) : db.transaction(apply);
}

/** Refund/void history with bill + who did it, for the corrections screen. */
export async function listBillCorrections(db, limit = 50) {
  await ensureBillCorrectionsSchema(db);
  return db.all(
    `SELECT bc.*, b.bill_number, u.full_name AS by_name
     FROM bill_corrections bc
     LEFT JOIN bills b ON bc.bill_id = b.id
     LEFT JOIN users u ON bc.created_by = u.id
     ORDER BY bc.id DESC LIMIT ${Number(limit) || 50}`
  );
}
