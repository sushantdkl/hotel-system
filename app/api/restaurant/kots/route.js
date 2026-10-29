import { NextResponse } from 'next/server';
import { KotRepository } from '@/lib/db/repositories/kots.js';
import { requireAuth } from '@/lib/api-guard.js';

const kotRepo = new KotRepository();

// Middleware to verify authentication
async function verifyAuth(request, permission) {
  const auth = await requireAuth(request, { permission });
  return auth.error ? null : auth.user;
}

// GET - Get KOTs by filters or specific KOT
export async function GET(request) {
  try {
    const session = await verifyAuth(request, 'kots.view');
    
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const status = searchParams.get('status');
    const station = searchParams.get('station');
    const date = searchParams.get('date');
    const type = searchParams.get('type'); // 'active', 'stats'
    const limit = parseInt(searchParams.get('limit') || '50');
    
    // Get specific KOT with items
    if (id) {
      const kot = await kotRepo.getById(parseInt(id));
      
      if (!kot) {
        return NextResponse.json(
          { error: 'KOT not found' },
          { status: 404 }
        );
      }
      
      return NextResponse.json({
        success: true,
        kot
      });
    }
    
    // Get kitchen stats
    if (type === 'stats') {
      const stats = await kotRepo.getStats(date);
      
      return NextResponse.json({
        success: true,
        stats
      });
    }
    
    // Get active KOTs
    if (type === 'active' || (!status && !station && !date)) {
      const kots = await kotRepo.getActive();
      
      // Fetch items for each KOT
      const kotsWithItems = [];
      for (const kot of kots) {
        const items = await kotRepo.getItems(kot.kot_id || kot.id);
        kotsWithItems.push({ ...kot, items });
      }
      
      return NextResponse.json({
        success: true,
        kots: kotsWithItems,
        count: kotsWithItems.length
      });
    }
    
    // Get pending KOTs for a station
    if (station && !status) {
      const kots = await kotRepo.getPendingByStation(station);
      
      return NextResponse.json({
        success: true,
        kots,
        count: kots.length
      });
    }
    
    // Get KOTs with filters
    const kots = await kotRepo.getByFilters({
      status,
      station,
      date,
      limit
    });
    
    // Fetch items for each KOT
    const kotsWithItems = [];
    for (const kot of kots) {
      const items = await kotRepo.getItems(kot.kot_id || kot.id);
      kotsWithItems.push({ ...kot, items });
    }
    
    return NextResponse.json({
      success: true,
      kots: kotsWithItems,
      count: kotsWithItems.length
    });
    
  } catch (error) {
    console.error('KOTs GET error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch KOTs' },
      { status: 500 }
    );
  }
}

// POST - Create new KOT
export async function POST(request) {
  try {
    const session = await verifyAuth(request, 'kots.create');
    
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const body = await request.json();
    const { order_id, station, items } = body;
    
    // Validate required fields
    if (!order_id || !station || !items || items.length === 0) {
      return NextResponse.json(
        { error: 'Missing required fields: order_id, station, items' },
        { status: 400 }
      );
    }
    
    // Validate station
    const validStations = ['hot-kitchen', 'cold-kitchen', 'bar', 'tandoor', 'grill'];
    if (!validStations.includes(station)) {
      return NextResponse.json(
        { error: `Invalid station. Must be one of: ${validStations.join(', ')}` },
        { status: 400 }
      );
    }
    
    const kotId = await kotRepo.create({
      order_id,
      station,
      items,
      prepared_by: null,
      order_notes: body.order_notes ?? body.kot_note ?? null,
    });
    
    // Get the created KOT with items
    const kot = await kotRepo.getById(kotId);
    
    return NextResponse.json({
      success: true,
      message: 'KOT created successfully',
      kot
    }, { status: 201 });
    
  } catch (error) {
    console.error('KOTs POST error:', error);
    return NextResponse.json(
      { error: 'Failed to create KOT' },
      { status: 500 }
    );
  }
}

// PATCH - Update KOT status or item status
export async function PATCH(request) {
  try {
    const session = await verifyAuth(request, 'kots.update');
    
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const body = await request.json();
    const { id, action, status, kot_item_id, item_status } = body;
    
    // Update individual KOT item status
    if (action === 'update-item') {
      if (!kot_item_id || !item_status) {
        return NextResponse.json(
          { error: 'Missing required fields: kot_item_id, item_status' },
          { status: 400 }
        );
      }
      
      const updated = await kotRepo.updateItemStatus(kot_item_id, item_status);
      
      if (!updated) {
        return NextResponse.json(
          { error: 'KOT item not found' },
          { status: 404 }
        );
      }
      
      return NextResponse.json({
        success: true,
        message: 'KOT item status updated'
      });
    }
    
    // Complete all items in a KOT
    if (action === 'complete-all') {
      if (!id) {
        return NextResponse.json(
          { error: 'Missing KOT ID' },
          { status: 400 }
        );
      }
      
      await kotRepo.completeAllItems(id);
      const kot = await kotRepo.getById(id);
      
      return NextResponse.json({
        success: true,
        message: 'All items marked as completed',
        kot
      });
    }
    
    // Update KOT status
    if (!id || !status) {
      return NextResponse.json(
        { error: 'Missing required fields: id, status' },
        { status: 400 }
      );
    }
    
    const validStatuses = ['pending', 'preparing', 'ready', 'completed'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      );
    }
    
    const prepared_by = status === 'preparing' ? session.user_id : null;
    const updated = await kotRepo.updateStatus(id, status, prepared_by);
    
    if (!updated) {
      return NextResponse.json(
        { error: 'KOT not found' },
        { status: 404 }
      );
    }
    
    const kot = await kotRepo.getById(id);
    
    return NextResponse.json({
      success: true,
      message: `KOT status updated to ${status}`,
      kot
    });
    
  } catch (error) {
    console.error('KOTs PATCH error:', error);
    return NextResponse.json(
      { error: 'Failed to update KOT' },
      { status: 500 }
    );
  }
}
