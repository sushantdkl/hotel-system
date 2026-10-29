import { NextResponse } from 'next/server';
import { TableRepository } from '@/lib/db/repositories/tables.js';
import { requireAuth } from '@/lib/api-guard.js';
import { applyReservationHoldsToTables } from '@/lib/leads.js';

const tableRepo = new TableRepository();

// Middleware to verify authentication
async function verifyAuth(request, permission) {
  const auth = await requireAuth(request, { permission });
  return auth.error ? null : auth.user;
}

// GET - Get all tables with filters
export async function GET(request) {
  try {
    const session = await verifyAuth(request, 'tables.view');
    
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const { searchParams } = new URL(request.url);
    const floor = searchParams.get('floor');
    const section = searchParams.get('section');
    const status = searchParams.get('status');
    const type = searchParams.get('type'); // 'available' or 'occupied'
    
    // Get specific table type
    if (type === 'available') {
      let tables = await tableRepo.getAvailableTables();
      tables = await applyReservationHoldsToTables(tables);
      tables = tables.filter((t) => t.status !== 'reserved');
      return NextResponse.json({
        success: true,
        tables,
        count: tables.length
      });
    }
    
    if (type === 'occupied') {
      const tables = await tableRepo.getOccupiedTables();
      return NextResponse.json({
        success: true,
        tables,
        count: tables.length
      });
    }
    
    // Get all tables with filters
    const filters = {
      floor: floor || null,
      section: section || null,
      status: status || null
    };
    
    let tables = await tableRepo.getAll(filters);
    tables = await applyReservationHoldsToTables(tables);
    
    return NextResponse.json({
      success: true,
      tables,
      count: tables.length
    });
    
  } catch (error) {
    console.error('Tables GET error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tables', details: error.message },
      { status: 500 }
    );
  }
}

// PATCH - Update table status or assign waiter
export async function PATCH(request) {
  try {
    const session = await verifyAuth(request, 'tables.update');
    
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const body = await request.json();
    const { id, action, status, waiter_id } = body;
    
    if (!id) {
      return NextResponse.json(
        { error: 'Missing table ID' },
        { status: 400 }
      );
    }
    
    let updated = false;
    let message = '';
    
    switch (action) {
      case 'update-status':
        if (!status) {
          return NextResponse.json(
            { error: 'Missing status field' },
            { status: 400 }
          );
        }
        
        if (!['available', 'occupied', 'cooking', 'ready', 'dining', 'awaiting_payment', 'cleaning', 'reserved'].includes(status)) {
          return NextResponse.json(
            { error: 'Invalid table status.' },
            { status: 400 }
          );
        }
        
        updated = await tableRepo.updateStatus(id, status);
        message = `Table status updated to ${status}`;
        break;
        
      case 'assign-waiter':
        if (!waiter_id) {
          return NextResponse.json(
            { error: 'Missing waiter_id field' },
            { status: 400 }
          );
        }
        
        updated = await tableRepo.assignWaiter(id, waiter_id);
        message = 'Waiter assigned to table';
        break;
        
      case 'clear':
        updated = await tableRepo.clearTable(id);
        message = 'Table cleared and set to available';
        break;
        
      default:
        return NextResponse.json(
          { error: 'Invalid action. Must be: update-status, assign-waiter, or clear' },
          { status: 400 }
        );
    }
    
    if (!updated) {
      return NextResponse.json(
        { error: 'Table not found or update failed' },
        { status: 404 }
      );
    }
    
    // Get updated table data
    const tables = await tableRepo.getAll({ table_id: id });
    const table = tables.find(t => t.table_id === id);
    
    return NextResponse.json({
      success: true,
      message,
      table
    });
    
  } catch (error) {
    console.error('Tables PATCH error:', error);
    if (error.code === 'open_order' || error.status === 409) {
      return NextResponse.json(
        { error: error.message, code: 'open_order' },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: 'Failed to update table' },
      { status: 500 }
    );
  }
}
