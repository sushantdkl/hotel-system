import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureLedgerSchema } from '@/lib/inventory-ledger.js';
import { ensureAccountingSchema } from '@/lib/accounting.js';
import { supplierOpenInvoices, supplierStatement } from '@/lib/accounting-suppliers.js';
import { normalizePaymentMethod } from '@/lib/payment-allocations.js';

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

/** Full supplier profile: identity, deliveries, supplied items, AP and payments. */
export async function GET(request, { params }) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'suppliers.view' });
    if (auth.error) return auth.error;
    const { id } = await params;
    const supplierId = Number(id);
    if (!Number.isInteger(supplierId) || supplierId < 1) {
      return NextResponse.json({ error: 'Invalid supplier.' }, { status: 400 });
    }

    const db = Database.getInstance();
    await ensureLedgerSchema(db);
    await ensureAccountingSchema(db);
    const supplier = await db.get(`SELECT * FROM suppliers WHERE id=?`, [supplierId]);
    if (!supplier) return NextResponse.json({ error: 'Supplier not found.' }, { status: 404 });

    const [purchases, items, statement, openInvoices] = await Promise.all([
      db.all(
        `SELECT p.id,p.invoice_number,p.invoice_date,p.status,p.subtotal,p.tax,p.discount,p.shipping,p.total,
                p.notes,p.attachment_url,p.created_at,u.full_name AS received_by_name,
                e.payment_method
         FROM purchases p
         LEFT JOIN users u ON u.id=p.received_by
         LEFT JOIN expenses e ON e.source_type='purchase' AND e.source_id=p.id
         WHERE p.supplier_id=? ORDER BY COALESCE(p.invoice_date,CAST(p.created_at AS TEXT)) DESC,p.id DESC LIMIT 250`,
        [supplierId]
      ),
      db.all(
        `SELECT i.id,i.item_name,i.purchase_unit,i.consumption_unit,
                COUNT(DISTINCT p.id) AS purchase_count,
                COALESCE(SUM(CASE WHEN COALESCE(p.status,'')<>'voided' THEN pi.quantity_received ELSE 0 END),0) AS quantity_received,
                COALESCE(SUM(CASE WHEN COALESCE(p.status,'')<>'voided' THEN pi.line_total ELSE 0 END),0) AS total_value,
                MAX(CASE WHEN COALESCE(p.status,'')<>'voided' THEN p.invoice_date END) AS last_received
         FROM purchase_items pi
         JOIN purchases p ON p.id=pi.purchase_id
         JOIN inventory_items i ON i.id=pi.inventory_item_id
         WHERE p.supplier_id=?
         GROUP BY i.id,i.item_name,i.purchase_unit,i.consumption_unit
         ORDER BY total_value DESC,i.item_name`,
        [supplierId]
      ),
      supplierStatement(db, supplierId),
      supplierOpenInvoices(db, supplierId),
    ]);

    const purchaseItemRows = await db.all(
      `SELECT pi.purchase_id,COALESCE(i.item_name,'Item') AS item_name,i.purchase_unit,
              pi.quantity_ordered,pi.quantity_received,pi.unit_cost,pi.line_total,pi.created_at
       FROM purchase_items pi
       JOIN purchases p ON p.id=pi.purchase_id
       LEFT JOIN inventory_items i ON i.id=pi.inventory_item_id
       WHERE p.supplier_id=?
       ORDER BY pi.purchase_id,pi.id`,
      [supplierId]
    ).catch(() => []);
    const itemsByPurchase = new Map();
    for (const row of purchaseItemRows || []) {
      if (!itemsByPurchase.has(row.purchase_id)) itemsByPurchase.set(row.purchase_id, []);
      itemsByPurchase.get(row.purchase_id).push({
        ...row,
        quantity_ordered: Number(row.quantity_ordered || 0),
        quantity_received: Number(row.quantity_received || 0),
        unit_cost: round2(row.unit_cost),
        line_total: round2(row.line_total),
      });
    }
    const purchasesWithItems = purchases.map((row) => ({
      ...row,
      payment_method: String(row.payment_method || '').toLowerCase() === 'owner_pocket'
        ? 'owner pocket'
        : String(row.payment_method || '').toLowerCase() === 'business_funding'
          ? 'business funding'
        : ['credit', 'due', 'unpaid', 'payable'].includes(String(row.payment_method || '').toLowerCase())
          ? 'credit'
            : normalizePaymentMethod(row.payment_method || 'cash'),
      items: itemsByPurchase.get(row.id) || [],
    }));

    let running = 0;
    const ledger = (statement || []).map((row) => {
      running = round2(running + Number(row.credit || 0) - Number(row.debit || 0));
      return { ...row, debit: round2(row.debit), credit: round2(row.credit), running_balance: running };
    });
    const livePurchases = purchases.filter((row) => row.status !== 'voided');
    const payments = ledger.filter((row) => row.source_type === 'supplier_payment' || row.reversed_source_type === 'supplier_payment');
    const totalPaid = round2(payments.reduce(
      (sum, row) => sum + (row.source_type === 'supplier_payment' ? Number(row.debit || 0) : -Number(row.credit || 0)),
      0
    ));

    return NextResponse.json({
      supplier,
      summary: {
        total_spend: round2(livePurchases.reduce((sum, row) => sum + Number(row.total || 0), 0)),
        purchases: livePurchases.length,
        voided_purchases: purchases.length - livePurchases.length,
        supplied_items: items.length,
        outstanding_payable: Math.max(0, running),
        total_paid: Math.max(0, totalPaid),
        open_invoices: openInvoices.length,
      },
      purchases: purchasesWithItems,
      items: items.map((row) => ({ ...row, quantity_received: Number(row.quantity_received || 0), total_value: round2(row.total_value) })),
      ledger,
      payments,
      open_invoices: openInvoices,
    });
  } catch (error) {
    return handleRouteError(error, 'Could not load the supplier profile.');
  }
}
