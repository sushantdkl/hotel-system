import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureSqliteTable } from '@/lib/db/ensure-sqlite-table.js';

async function ensureStockReady(db) {
  if (db.driver === 'postgres') {
    await db.run(`
      CREATE TABLE IF NOT EXISTS stock_items (
        id SERIAL PRIMARY KEY,
        item_name TEXT NOT NULL,
        category TEXT NOT NULL,
        quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
        unit TEXT NOT NULL,
        cost_per_unit DOUBLE PRECISION NOT NULL DEFAULT 0,
        supplier TEXT,
        purchase_date TEXT,
        expiry_date TEXT,
        min_stock_level DOUBLE PRECISION DEFAULT 10,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    return;
  }
  await ensureSqliteTable(
    db,
    `
    CREATE TABLE IF NOT EXISTS stock_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_name TEXT NOT NULL,
      category TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit TEXT NOT NULL,
      cost_per_unit REAL NOT NULL,
      supplier TEXT,
      purchase_date TEXT,
      expiry_date TEXT,
      min_stock_level REAL DEFAULT 10,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `
  );
}

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier', 'kitchen'], permission: 'inventory.view' });
    if (auth.error) return auth.error;

    const db = Database.getInstance();
    await ensureStockReady(db);

    const stocks = await db.all(`
      SELECT * FROM stock_items
      ORDER BY created_at DESC
    `);

    return NextResponse.json({ stocks });
  } catch (error) {
    return handleRouteError(error, 'Failed to fetch stock');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'inventory.manage' });
    if (auth.error) return auth.error;

    const data = await request.json();
    const db = Database.getInstance();
    await ensureStockReady(db);

    const result = await db.run(
      `
      INSERT INTO stock_items (
        item_name, category, quantity, unit, cost_per_unit,
        supplier, purchase_date, expiry_date, min_stock_level, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        data.item_name,
        data.category,
        data.quantity,
        data.unit,
        data.cost_per_unit,
        data.supplier || null,
        data.purchase_date || null,
        data.expiry_date || null,
        data.min_stock_level || 10,
        data.notes || null,
      ]
    );

    const stock = await db.get('SELECT * FROM stock_items WHERE id = ?', [result.lastInsertRowid]);

    return NextResponse.json(
      { message: 'Stock item created successfully', stock },
      { status: 201 }
    );
  } catch (error) {
    return handleRouteError(error, 'Failed to create stock item');
  }
}

export async function PUT(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'inventory.manage' });
    if (auth.error) return auth.error;

    const data = await request.json();
    const db = Database.getInstance();
    await ensureStockReady(db);

    await db.run(
      `
      UPDATE stock_items
      SET item_name = ?, category = ?, quantity = ?, unit = ?,
          cost_per_unit = ?, supplier = ?, purchase_date = ?,
          expiry_date = ?, min_stock_level = ?, notes = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
      [
        data.item_name,
        data.category,
        data.quantity,
        data.unit,
        data.cost_per_unit,
        data.supplier || null,
        data.purchase_date || null,
        data.expiry_date || null,
        data.min_stock_level || 10,
        data.notes || null,
        data.id,
      ]
    );

    const stock = await db.get('SELECT * FROM stock_items WHERE id = ?', [data.id]);

    return NextResponse.json({ message: 'Stock item updated successfully', stock });
  } catch (error) {
    return handleRouteError(error, 'Failed to update stock item');
  }
}

export async function DELETE(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'inventory.manage' });
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    const db = Database.getInstance();
    await db.run('DELETE FROM stock_items WHERE id = ?', [id]);

    return NextResponse.json({ message: 'Stock item deleted successfully' });
  } catch (error) {
    return handleRouteError(error, 'Failed to delete stock item');
  }
}
