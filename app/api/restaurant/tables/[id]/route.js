import { NextResponse } from 'next/server';
import { TableRepository } from '@/lib/db/repositories/tables.js';
import { requireAuth } from '@/lib/api-guard.js';

async function verifyAuth(request) {
  const auth = await requireAuth(request, { permission: 'tables.view' });
  return auth.error ? null : auth.user;
}

// GET - Get single table details
export async function GET(request, context) {
  try {
    const session = await verifyAuth(request);
    
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const { params } = context;
    const { id: tableId } = await params;
    const tableRepo = new TableRepository();
    
    const tables = await tableRepo.getAll({ table_id: tableId });
    const table = tables.find(t => t.table_id === parseInt(tableId));
    
    if (!table) {
      return NextResponse.json(
        { error: 'Table not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      table
    });
    
  } catch (error) {
    console.error('Table GET error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch table' },
      { status: 500 }
    );
  }
}
