import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureColumn } from '@/lib/db/schema-helpers.js';
import { normalizeFoodGroup, DEFAULT_FOOD_GROUP } from '@/lib/food-groups.js';

/** Ensure the master-category ("food group") column exists before we read/write it. */
async function ensureFoodGroup(db) {
  try {
    await ensureColumn(db, 'menu_categories', 'food_group', `TEXT DEFAULT '${DEFAULT_FOOD_GROUP}'`);
  } catch (e) {
    console.warn('ensureFoodGroup:', e?.message || e);
  }
}

// GET - List all categories
export async function GET(request) {
  try {
    const auth = await requireAuth(request, { permission: 'menu.view' });
    if (auth.error) return auth.error;

    const db = Database.getInstance();
    await ensureFoodGroup(db);

    let categories;
    try {
      categories = await db.all(`
        SELECT id, name, display_order, icon, is_active, created_at,
               COALESCE(food_group, '${DEFAULT_FOOD_GROUP}') AS food_group
        FROM menu_categories
        WHERE is_active = 1
        ORDER BY display_order ASC, name ASC
      `);
    } catch (e) {
      // Column may be missing when app DB user cannot ALTER — still list categories.
      console.warn('categories food_group select:', e?.message || e);
      categories = await db.all(`
        SELECT id, name, display_order, icon, is_active, created_at
        FROM menu_categories
        WHERE is_active = 1
        ORDER BY display_order ASC, name ASC
      `);
      categories = (categories || []).map((c) => ({ ...c, food_group: DEFAULT_FOOD_GROUP }));
    }

    return NextResponse.json({ categories });
  } catch (error) {
    return handleRouteError(error, 'Failed to fetch categories');
  }
}

// POST - Create new category
export async function POST(request) {
  try {
    const auth = await requireAuth(request, { permission: 'menu.manage' });
    if (auth.error) return auth.error;

    const { name, icon, display_order, food_group } = await request.json();

    if (!name || name.trim() === '') {
      return NextResponse.json(
        { error: 'Category name is required' },
        { status: 400 }
      );
    }

    const db = Database.getInstance();
    await ensureFoodGroup(db);

    // A category is soft-deleted, while its name remains unique in the
    // database. Creating that same name again should restore it instead of
    // trying to insert a duplicate row.
    const existing = await db.get(
      'SELECT id, is_active FROM menu_categories WHERE name = ?',
      [name.trim()]
    );

    if (existing && Number(existing.is_active) === 1) {
      return NextResponse.json(
        { error: 'Category name already exists' },
        { status: 400 }
      );
    }

    // Get max display order if not provided
    let order = display_order;
    if (!order) {
      const maxOrder = await db.get(
        'SELECT MAX(display_order) as max_order FROM menu_categories'
      );
      order = (maxOrder?.max_order || 0) + 1;
    }

    if (existing) {
      await db.run(`
        UPDATE menu_categories
        SET icon = ?, display_order = ?, is_active = 1, food_group = ?
        WHERE id = ?
      `, [icon || null, order, normalizeFoodGroup(food_group), existing.id]);

      const category = await db.get(
        'SELECT * FROM menu_categories WHERE id = ?',
        [existing.id]
      );

      return NextResponse.json({
        message: 'Category restored successfully',
        category
      });
    }

    // Insert a brand-new category.
    const result = await db.run(`
      INSERT INTO menu_categories (name, icon, display_order, is_active, food_group)
      VALUES (?, ?, ?, 1, ?)
    `, [name.trim(), icon || null, order, normalizeFoodGroup(food_group)]);

    const category = await db.get(
      'SELECT * FROM menu_categories WHERE id = ?',
      [result.lastInsertRowid]
    );

    return NextResponse.json({
      message: 'Category created successfully',
      category
    }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to create category');
  }
}

// PUT - Update category
export async function PUT(request) {
  try {
    const auth = await requireAuth(request, { permission: 'menu.manage' });
    if (auth.error) return auth.error;

    const { id, name, icon, display_order, food_group } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'Category ID is required' }, { status: 400 });
    }

    if (!name || name.trim() === '') {
      return NextResponse.json(
        { error: 'Category name is required' },
        { status: 400 }
      );
    }

    const db = Database.getInstance();
    await ensureFoodGroup(db);

    // Check if category exists
    const existing = await db.get(
      'SELECT id FROM menu_categories WHERE id = ?',
      [id]
    );

    if (!existing) {
      return NextResponse.json(
        { error: 'Category not found' },
        { status: 404 }
      );
    }

    // Check if new name conflicts with another category
    const conflict = await db.get(
      'SELECT id FROM menu_categories WHERE name = ? AND id != ? AND is_active = 1',
      [name.trim(), id]
    );

    if (conflict) {
      return NextResponse.json(
        { error: 'Category name already exists' },
        { status: 400 }
      );
    }

    // Update category
    await db.run(`
      UPDATE menu_categories
      SET name = ?, icon = ?, display_order = ?, food_group = ?
      WHERE id = ?
    `, [name.trim(), icon || null, display_order || 0, normalizeFoodGroup(food_group), id]);

    const category = await db.get(
      'SELECT * FROM menu_categories WHERE id = ?',
      [id]
    );

    return NextResponse.json({
      message: 'Category updated successfully',
      category
    });
  } catch (error) {
    return handleRouteError(error, 'Failed to update category');
  }
}

// DELETE - Delete category
export async function DELETE(request) {
  try {
    const auth = await requireAuth(request, { permission: 'menu.manage' });
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Category ID is required' }, { status: 400 });
    }

    const db = Database.getInstance();

    // Check if category has any menu items
    const itemCount = await db.get(
      'SELECT COUNT(*) as count FROM menu_items WHERE category_id = ?',
      [id]
    );

    if (itemCount && itemCount.count > 0) {
      return NextResponse.json(
        { error: `Cannot delete category. ${itemCount.count} menu items are using this category.` },
        { status: 400 }
      );
    }

    // Soft delete - mark as inactive
    await db.run(
      'UPDATE menu_categories SET is_active = 0 WHERE id = ?',
      [id]
    );

    return NextResponse.json({
      message: 'Category deleted successfully'
    });
  } catch (error) {
    return handleRouteError(error, 'Failed to delete category');
  }
}
