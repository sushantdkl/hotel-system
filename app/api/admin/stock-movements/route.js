import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureRecipeTables } from '@/lib/recipes.js';
import { listStockMovements } from '@/lib/stock-movements.js';
import { readListParams } from '@/lib/paginate.js';
import { ensureBusinessDaySchema } from '@/lib/business-days.js';
import { ensureLedgerSchema } from '@/lib/inventory-ledger.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'inventory.movements.view' });
    if (auth.error) return auth.error;

    const db = Database.getInstance();
    await ensureRecipeTables(db);
    await ensureBusinessDaySchema(db);
    await ensureLedgerSchema(db);

    const { searchParams } = new URL(request.url);
    const { rows, pagination } = await listStockMovements(db, {
      ...readListParams(searchParams),
      inventoryItemId: searchParams.get('item_id') || undefined,
      changeType: searchParams.get('change_type'),
      adjustmentsOnly: searchParams.get('adjustments_only') === '1',
      varianceOnly: searchParams.get('variance_only') === '1',
      pricedOnly: searchParams.get('priced_only') === '1',
      from: searchParams.get('from'),
      to: searchParams.get('to'),
      dateBasis: searchParams.get('date_basis'),
    });

    return NextResponse.json({ movements: rows, pagination });
  } catch (error) {
    return handleRouteError(error, 'Failed to load stock movement history');
  }
}
