import { NextResponse } from 'next/server';
import { MenuRepository } from '@/lib/db/repositories/menu.js';
import { requireAuth } from '@/lib/api-guard.js';
import { comboAvailableOn, getCombosForMenuItems } from '@/lib/combos.js';
import { sortCombosFirst } from '@/lib/promotion-display.js';

const menuRepo = new MenuRepository();

async function posMenuItems(items = []) {
  const map = await getCombosForMenuItems(menuRepo.db, items.map((item) => item.item_id || item.id));
  const withCombos = items.map((item) => {
    const combo = map.get(Number(item.item_id || item.id));
    return combo ? { ...item, is_combo: 1, combo: { ...combo, savings: Math.max(0, Number(combo.original_price || 0) - Number(item.price ?? item.base_price ?? 0)) } } : item;
  }).filter((item) => !item.combo || comboAvailableOn(item.combo, 'pos'));
  return sortCombosFirst(withCombos);
}

// Middleware to verify authentication
async function verifyAuth(request, permission) {
  const auth = await requireAuth(request, { permission });
  return auth.error ? null : auth.user;
}

// GET - Get menu items or categories
export async function GET(request) {
  try {
    const session = await verifyAuth(request, 'menu.view');
    
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type'); // 'items' or 'categories'
    const category = searchParams.get('category');
    const search = searchParams.get('search');
    const available = searchParams.get('available');
    const itemId = searchParams.get('id');
    
    // Get specific item with variants
    if (itemId) {
      const rawItem = await menuRepo.getItemById(parseInt(itemId));
      const item = (await posMenuItems(rawItem ? [rawItem] : []))[0];
      
      if (!item) {
        return NextResponse.json(
          { error: 'Item not found' },
          { status: 404 }
        );
      }
      
      return NextResponse.json({
        success: true,
        item
      });
    }
    
    // Get categories
    if (type === 'categories') {
      const categories = await menuRepo.getCategories();
      
      return NextResponse.json({
        success: true,
        categories
      });
    }
    
    // Get items by category
    if (category) {
      const items = await posMenuItems(await menuRepo.getItemsByCategory(parseInt(category)));
      
      return NextResponse.json({
        success: true,
        items
      });
    }
    
    // Get all items with filters
    const filters = {
      search: search || null,
      available: available === 'true' ? true : available === 'false' ? false : null
    };
    
    const items = await posMenuItems(await menuRepo.getAllItems(filters));
    
    return NextResponse.json({
      success: true,
      items,
      count: items.length
    });
    
  } catch (error) {
    console.error('Menu GET error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch menu data' },
      { status: 500 }
    );
  }
}

// POST - Create new menu item (Admin only)
export async function POST(request) {
  try {
    const session = await verifyAuth(request, 'menu.manage');
    
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const body = await request.json();
    const {
      category_id,
      name,
      name_nepali,
      description,
      base_price,
      prep_time_minutes,
      spice_level,
      is_vegetarian,
      is_available,
      image_url,
      variants
    } = body;
    
    // Validate required fields
    if (!category_id || !name || !base_price) {
      return NextResponse.json(
        { error: 'Missing required fields: category_id, name, base_price' },
        { status: 400 }
      );
    }
    
    const itemId = await menuRepo.createItem({
      category_id,
      name,
      name_nepali: name_nepali || null,
      description: description || null,
      base_price,
      prep_time_minutes: prep_time_minutes || 15,
      spice_level: spice_level || 'medium',
      is_vegetarian: is_vegetarian || false,
      is_available: is_available !== false,
      image_url: image_url || null
    });
    
    // Get the created item
    const item = await menuRepo.getItemById(itemId);
    
    return NextResponse.json({
      success: true,
      message: 'Menu item created successfully',
      item
    }, { status: 201 });
    
  } catch (error) {
    console.error('Menu POST error:', error);
    return NextResponse.json(
      { error: 'Failed to create menu item' },
      { status: 500 }
    );
  }
}

// PATCH - Update menu item or toggle availability
export async function PATCH(request) {
  try {
    const session = await verifyAuth(request, 'menu.manage');
    
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const body = await request.json();
    const { id, action, ...updates } = body;
    
    if (!id) {
      return NextResponse.json(
        { error: 'Missing item ID' },
        { status: 400 }
      );
    }
    
    // Handle toggle availability action
    if (action === 'toggle-availability') {
      const updated = await menuRepo.toggleAvailability(id);
      
      if (!updated) {
        return NextResponse.json(
          { error: 'Item not found' },
          { status: 404 }
        );
      }
      
      const item = await menuRepo.getItemById(id);
      
      return NextResponse.json({
        success: true,
        message: `Item ${item.is_available ? 'enabled' : 'disabled'}`,
        item
      });
    }
    
    // Update item
    const updated = await menuRepo.updateItem(id, updates);
    
    if (!updated) {
      return NextResponse.json(
        { error: 'Item not found or update failed' },
        { status: 404 }
      );
    }
    
    const item = await menuRepo.getItemById(id);
    
    return NextResponse.json({
      success: true,
      message: 'Menu item updated successfully',
      item
    });
    
  } catch (error) {
    console.error('Menu PATCH error:', error);
    return NextResponse.json(
      { error: 'Failed to update menu item' },
      { status: 500 }
    );
  }
}

// DELETE - Delete menu item (Admin only)
export async function DELETE(request) {
  try {
    const session = await verifyAuth(request, 'menu.manage');
    
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json(
        { error: 'Missing item ID' },
        { status: 400 }
      );
    }
    
    const deleted = await menuRepo.deleteItem(parseInt(id));
    
    if (!deleted) {
      return NextResponse.json(
        { error: 'Item not found or has dependencies' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      message: 'Menu item deleted successfully'
    });
    
  } catch (error) {
    console.error('Menu DELETE error:', error);
    return NextResponse.json(
      { error: 'Failed to delete menu item' },
      { status: 500 }
    );
  }
}
