import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureRecipeTables } from '@/lib/recipes.js';
import { applyStockChange } from '@/lib/inventory-ledger.js';
import { resolveSupplier } from '@/lib/purchases.js';

/**
 * Legacy single-line restock. Quantities and unit_cost are in PURCHASE units
 * (that's how a delivery note reads) — the ledger converts. Prefer
 * POST /api/admin/purchases, which also writes a header and an expense.
 */
export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'inventory.manage' });
    if (auth.error) return auth.error;

    const data = await request.json();
    const itemId = data.inventory_item_id;
    const addedQuantity = Number(data.added_quantity);
    if (!itemId || !(addedQuantity > 0)) {
      return NextResponse.json({ error: 'Pick a raw material and enter a quantity greater than zero.' }, { status: 400 });
    }

    const db = Database.getInstance();
    await ensureRecipeTables(db);

    const item = await db.get('SELECT * FROM inventory_items WHERE id = ?', [itemId]);
    if (!item) return NextResponse.json({ error: 'Raw material not found.' }, { status: 404 });
    if (Number(item.is_archived) === 1) {
      return NextResponse.json({ error: 'That item is archived — unarchive it before restocking.' }, { status: 400 });
    }

    const result = await db.transaction(async (tx) => {
      if (data.supplier) {
        const supplier = await resolveSupplier(tx, data.supplier);
        await tx.run(`UPDATE inventory_items SET supplier = ?, supplier_id = ? WHERE id = ?`, [
          supplier?.name || data.supplier,
          supplier?.id || null,
          itemId,
        ]);
      }
      return applyStockChange(tx, {
        inventory_item_id: itemId,
        quantity: addedQuantity,
        units: data.units === 'consumption' ? 'consumption' : 'purchase',
        unit_cost: data.unit_cost ?? null,
        change_type: 'purchase_receipt',
        performed_by: auth.user?.id || null,
        reason: data.invoice_number ? `PO/Invoice ${data.invoice_number}` : 'Manual restock',
        reference_id: data.invoice_number || null,
      });
    });

    const updated = await db.get('SELECT * FROM inventory_items WHERE id = ?', [itemId]);
    return NextResponse.json({ message: 'Stock restocked successfully', item: updated, movement: result });
  } catch (error) {
    return handleRouteError(error, 'Failed to restock item');
  }
}
