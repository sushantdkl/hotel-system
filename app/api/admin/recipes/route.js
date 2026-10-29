import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import {
  ensureRecipeTables,
  listRecipes,
  getRecipeWithItems,
  getRecipeCost,
  createRecipe,
  updateRecipe,
  deleteRecipe,
} from '@/lib/recipes.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'kitchen', 'waiter', 'cashier'], permission: 'recipes.view' });
    if (auth.error) return auth.error;

    const db = Database.getInstance();
    await ensureRecipeTables(db);

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const menuItemId = searchParams.get('menu_item_id');

    if (id) {
      const recipe = await getRecipeWithItems(db, id);
      if (!recipe) return NextResponse.json({ error: 'Recipe not found' }, { status: 404 });
      const cost = await getRecipeCost(db, id);
      return NextResponse.json({ recipe: { ...recipe, cost } });
    }

    if (menuItemId) {
      const recipe = await db.get(`SELECT id FROM recipes WHERE menu_item_id = ?`, [menuItemId]);
      if (!recipe) return NextResponse.json({ recipe: null });
      return NextResponse.json({ recipe: await getRecipeWithItems(db, recipe.id) });
    }

    // ?with_cost=1 prices every row server-side so the recipe table does not
    // have to fire one request per recipe.
    const recipes = await listRecipes(db, { withCost: searchParams.get('with_cost') === '1' });
    return NextResponse.json({ recipes });
  } catch (error) {
    return handleRouteError(error, 'Failed to load recipes');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'menu.manage' });
    if (auth.error) return auth.error;

    const data = await request.json();
    if (!data.name || !data.type) {
      return NextResponse.json({ error: 'Recipe name and type are required.' }, { status: 400 });
    }

    const db = Database.getInstance();
    await ensureRecipeTables(db);

    const recipe = await createRecipe(db, data);
    return NextResponse.json({ message: 'Recipe created successfully', recipe }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to create recipe');
  }
}

export async function PUT(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'menu.manage' });
    if (auth.error) return auth.error;

    const data = await request.json();
    if (!data.id) {
      return NextResponse.json({ error: 'Recipe id is required.' }, { status: 400 });
    }

    const db = Database.getInstance();
    await ensureRecipeTables(db);

    const recipe = await updateRecipe(db, data.id, data);
    return NextResponse.json({ message: 'Recipe updated successfully', recipe });
  } catch (error) {
    return handleRouteError(error, 'Failed to update recipe');
  }
}

export async function DELETE(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'menu.manage' });
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Recipe id is required.' }, { status: 400 });

    const db = Database.getInstance();
    await deleteRecipe(db, id);
    return NextResponse.json({ message: 'Recipe deleted successfully' });
  } catch (error) {
    return handleRouteError(error, 'Failed to delete recipe');
  }
}
