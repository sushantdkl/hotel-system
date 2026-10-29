'use client';

/**
 * Full recipe profile: costing, ingredient breakdown, where it is used, and
 * the ingredient cost history the ledger can actually support.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import AdminLayout from '@/components/admin/admin-layout';
import { ArrowLeft, ChefHat, Clock, Package, Pencil } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { friendlyFromError } from '@/lib/friendly-message';
import { apiJson } from '@/lib/authed-fetch';
import { formatNepalDate } from '@/lib/time-utils';
import { KpiCards } from '@/components/admin/report-kit';
import RecipePanel from '@/components/inventory/recipe-panel';

export default function RecipeProfilePage() {
  const { id } = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const cashierPanel = pathname?.startsWith('/cashier');
  const recipeBase = cashierPanel ? '/cashier/recipes' : '/admin/recipes';
  const inventoryBase = cashierPanel ? '/cashier/inventory' : '/admin/inventory';
  const { addToast } = useToast();
  const [recipe, setRecipe] = useState(null);
  const [allRecipes, setAllRecipes] = useState([]);
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [one, all, mov] = await Promise.all([
        apiJson(`/api/admin/recipes?id=${id}`),
        apiJson('/api/admin/recipes?with_cost=1').catch(() => ({ recipes: [] })),
        // Cost basis only comes from priced movements, so ask for those and cap
        // the window rather than pulling a thousand rows to filter in the browser.
        apiJson('/api/admin/stock-movements?priced_only=1&page_size=200').catch(() => ({ movements: [] })),
      ]);
      setRecipe(one.recipe);
      setAllRecipes(all.recipes || []);
      setMovements(mov.movements || []);
    } catch (error) {
      addToast(friendlyFromError(error, 'load_failed'));
    } finally {
      setLoading(false);
    }
  }, [id, addToast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Parents come straight from the API now (`used_in`); the old page fetched
  // every recipe and scanned their lines to work this out.
  const usedIn = recipe?.used_in || [];

  /** Cost basis per ingredient over time, straight off the movement rows. */
  const costHistory = useMemo(() => {
    const ingredientIds = new Set((recipe?.cost?.breakdown || []).map((b) => b.inventory_item_id));
    const byItem = new Map();
    for (const m of movements) {
      if (!ingredientIds.has(m.inventory_item_id)) continue;
      if (m.unit_cost === null || m.unit_cost === undefined) continue;
      const list = byItem.get(m.inventory_item_id) || [];
      list.push({ at: m.created_at, cost: Number(m.unit_cost), type: m.change_type });
      byItem.set(m.inventory_item_id, list);
    }
    return Array.from(byItem, ([itemId, points]) => {
      const sorted = points.sort((a, b) => new Date(a.at) - new Date(b.at));
      const name = recipe.cost.breakdown.find((b) => b.inventory_item_id === itemId)?.item_name || `Item #${itemId}`;
      return {
        itemId,
        name,
        first: sorted[0],
        last: sorted[sorted.length - 1],
        points: sorted.length,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [movements, recipe]);

  if (loading || !recipe) {
    return (
      <AdminLayout>
        <p className="p-8 text-center text-sm text-gray-500">{loading ? 'Loading recipe…' : 'This recipe could not be loaded.'}</p>
      </AdminLayout>
    );
  }

  const sellingPrice = Number(recipe.menu_item_price || 0);
  const foodCost = Number(recipe.cost?.total_cost || 0);
  const profit = sellingPrice - foodCost;
  const margin = sellingPrice > 0 ? (profit / sellingPrice) * 100 : null;
  const isMenuItem = recipe.type === 'menu_item';

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button onClick={() => router.push(recipeBase)} className="shrink-0 rounded-lg border border-gray-300 p-2 text-gray-700 hover:bg-gray-50" aria-label="Back to recipes">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold text-gray-900 sm:text-2xl">{recipe.menu_item_name || recipe.name}</h1>
              <p className="text-sm text-gray-500">{isMenuItem ? 'Menu item recipe' : 'Sub-recipe / batch'}</p>
            </div>
          </div>
          <button type="button" onClick={() => setEditing(true)} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-gray-900 px-3.5 py-2.5 text-sm font-semibold text-white hover:bg-gray-800">
            <Pencil className="h-4 w-4" /> Edit recipe
          </button>
        </div>
      </header>

      <div className="space-y-5 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <KpiCards
          kpis={[
            { key: 'price', label: 'Selling price', value: isMenuItem ? sellingPrice : null, format: 'currency', sub: isMenuItem ? 'From the menu item' : 'Not sold directly' },
            { key: 'cost', label: 'Food cost', value: foodCost, format: 'currency', sub: `Per ${recipe.yield_quantity} ${recipe.yield_unit || 'unit(s)'}` },
            { key: 'profit', label: 'Gross profit', value: isMenuItem ? profit : null, format: 'currency' },
            { key: 'margin', label: 'Margin', value: margin, format: 'percent' },
          ]}
        />

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900">Details</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex items-center gap-2 text-gray-600">
                <Clock className="h-4 w-4 shrink-0 text-gray-400" />
                Prep time: {recipe.prep_time_minutes || recipe.menu_item_prep_time ? `${recipe.prep_time_minutes || recipe.menu_item_prep_time} min` : 'Not recorded'}
              </div>
              <div className="flex items-center gap-2 text-gray-600">
                <Package className="h-4 w-4 shrink-0 text-gray-400" />
                Yield: {recipe.yield_quantity} {recipe.yield_unit || 'unit(s)'}
              </div>
              <div className="flex items-center gap-2 text-gray-600">
                <ChefHat className="h-4 w-4 shrink-0 text-gray-400" />
                {recipe.items?.length || 0} ingredient line(s)
              </div>
            </dl>
            {recipe.prep_notes && (
              <div className="mt-4 border-t border-gray-100 pt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Prep notes</h3>
                <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-gray-600">{recipe.prep_notes}</p>
              </div>
            )}
            {usedIn.length > 0 && (
              <div className="mt-4 border-t border-gray-100 pt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Used in</h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {usedIn.slice(0, 8).map((r) => (
                    <Link key={r.id} href={`${recipeBase}/${r.id}`} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200">
                      {r.menu_item_name || r.name}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm lg:col-span-2">
            <h2 className="text-base font-semibold text-gray-900">Cost breakdown</h2>
            {recipe.cost?.breakdown?.length ? (
              <div className="mt-4 overflow-x-auto rounded-xl border border-gray-100">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                      <th className="px-3 py-2 font-semibold">Ingredient</th>
                      <th className="px-3 py-2 text-right font-semibold">Quantity</th>
                      <th className="px-3 py-2 text-right font-semibold">Cost / unit</th>
                      <th className="px-3 py-2 text-right font-semibold">Share</th>
                      <th className="px-3 py-2 text-right font-semibold">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {recipe.cost.breakdown.map((b) => (
                      <tr key={b.inventory_item_id} className="text-gray-600">
                        <td className="px-3 py-2.5 font-medium text-gray-900">
                          <Link href={`${inventoryBase}/${b.inventory_item_id}`} className="hover:underline">{b.item_name}</Link>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{b.quantity.toFixed(2)} {b.unit}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">Rs {b.cost_per_unit.toFixed(3)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{foodCost > 0 ? `${((b.line_cost / foodCost) * 100).toFixed(0)}%` : '—'}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-medium text-gray-900">Rs {b.line_cost.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-gray-500">
                No ingredients are linked yet, so this recipe costs nothing and deducts nothing. Edit it to add lines.
              </p>
            )}
          </section>
        </div>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-base font-semibold text-gray-900">Ingredient cost history</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            What each ingredient was worth when stock actually moved — the cost basis the ledger stamped on every movement.
          </p>
          {costHistory.length ? (
            <div className="mt-4 overflow-x-auto rounded-xl border border-gray-100">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                    <th className="px-3 py-2 font-semibold">Ingredient</th>
                    <th className="px-3 py-2 font-semibold">Earliest recorded</th>
                    <th className="px-3 py-2 font-semibold">Most recent</th>
                    <th className="px-3 py-2 text-right font-semibold">Change</th>
                    <th className="px-3 py-2 text-right font-semibold">Movements</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {costHistory.map((h) => {
                    const delta = h.last.cost - h.first.cost;
                    return (
                      <tr key={h.itemId} className="text-gray-600">
                        <td className="px-3 py-2.5 font-medium text-gray-900">{h.name}</td>
                        <td className="px-3 py-2.5">
                          Rs {h.first.cost.toFixed(3)} <span className="text-xs text-gray-400">· {formatNepalDate(h.first.at)}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          Rs {h.last.cost.toFixed(3)} <span className="text-xs text-gray-400">· {formatNepalDate(h.last.at)}</span>
                        </td>
                        <td className={`px-3 py-2.5 text-right tabular-nums ${delta > 0 ? 'text-red-600' : delta < 0 ? 'text-emerald-600' : ''}`}>
                          {delta === 0 ? 'flat' : `${delta > 0 ? '+' : ''}Rs ${delta.toFixed(3)}`}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{h.points}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-gray-500">
              No priced stock movements for these ingredients yet. Receive a delivery and the cost basis starts building here.
            </p>
          )}
        </section>

      </div>

      {editing && (
        <RecipePanel
          recipeId={id}
          recipes={allRecipes}
          onClose={() => setEditing(false)}
          onSaved={fetchData}
        />
      )}
    </AdminLayout>
  );
}
