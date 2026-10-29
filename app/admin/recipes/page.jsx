'use client';

/**
 * Recipes as a table with a side-panel builder. The owner rejected the old
 * full-page form and the large recipe cards that came with it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import AdminLayout from '@/components/admin/admin-layout';
import { ExternalLink, Pencil, Plus } from 'lucide-react';
import Link from 'next/link';
import { useToast } from '@/components/ui/toast';
import { friendlyFromError } from '@/lib/friendly-message';
import { apiJson } from '@/lib/authed-fetch';
import DataGrid, { StatusBadge } from '@/components/admin/data-grid';
import AttentionBar from '@/components/admin/attention-bar';
import { KpiCards } from '@/components/admin/report-kit';
import RecipePanel from '@/components/inventory/recipe-panel';
import { formatNepalDate } from '@/lib/time-utils';

export default function RecipesPage() {
  const pathname = usePathname();
  const recipeBase = pathname?.startsWith('/cashier') ? '/cashier/recipes' : '/admin/recipes';
  const { addToast } = useToast();
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('all');
  const [panel, setPanel] = useState(null); // { id } | { create: true }

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiJson('/api/admin/recipes?with_cost=1');
      setRecipes(data.recipes || []);
    } catch (error) {
      addToast(friendlyFromError(error, 'load_failed'));
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const rows = useMemo(() => {
    const enriched = recipes.map((r) => {
      const price = Number(r.menu_item_price || 0);
      const cost = Number(r.food_cost || 0);
      return {
        ...r,
        price,
        cost,
        margin: price > 0 ? ((price - cost) / price) * 100 : null,
        // A recipe with no lines never deducts anything; a menu recipe with no
        // menu item never fires at all. Both are worth flagging.
        state: !Number(r.item_count) ? 'empty' : r.type === 'menu_item' && !r.menu_item_id ? 'unlinked' : 'active',
      };
    });
    return typeFilter === 'all' ? enriched : enriched.filter((r) => r.type === typeFilter);
  }, [recipes, typeFilter]);

  const needsWork = rows.filter((r) => r.state !== 'active');
  const thinMargin = rows.filter((r) => r.margin !== null && r.margin < 40 && r.cost > 0);
  const menuRecipes = rows.filter((r) => r.type === 'menu_item');
  const avgMargin = menuRecipes.filter((r) => r.margin !== null);

  const columns = useMemo(
    () => [
      {
        key: 'name',
        label: 'Recipe',
        className: 'text-gray-900 font-medium',
        render: (r) => (
          <button type="button" onClick={() => setPanel({ id: r.id })} className="hover:underline">
            {r.name}
          </button>
        ),
      },
      {
        key: 'menu_item_name',
        label: 'Menu item',
        render: (r) =>
          r.menu_item_name || (
            <span className="text-gray-300">{r.type === 'sub_recipe' ? 'Sub-recipe' : 'Not linked'}</span>
          ),
      },
      {
        key: 'yield',
        label: 'Yield',
        value: (r) => Number(r.yield_quantity || 1),
        numeric: true,
        render: (r) => `${Number(r.yield_quantity || 1)} ${r.yield_unit || ''}`.trim(),
      },
      {
        key: 'cost',
        label: 'Food cost',
        align: 'right',
        numeric: true,
        className: 'text-gray-900 font-medium',
        render: (r) => `Rs ${r.cost.toFixed(2)}`,
      },
      {
        key: 'margin',
        label: 'Margin',
        align: 'right',
        numeric: true,
        value: (r) => (r.margin === null ? -Infinity : r.margin),
        render: (r) =>
          r.margin === null ? (
            <span className="text-gray-300">—</span>
          ) : (
            <span className={r.margin < 40 ? 'font-medium text-amber-700' : 'text-gray-900'}>{r.margin.toFixed(1)}%</span>
          ),
      },
      { key: 'item_count', label: 'Ingredients', align: 'right', numeric: true, value: (r) => Number(r.item_count || 0) },
      {
        key: 'state',
        label: 'Status',
        render: (r) =>
          r.state === 'active' ? (
            <StatusBadge tone="green">Active</StatusBadge>
          ) : r.state === 'empty' ? (
            <StatusBadge tone="amber">No ingredients</StatusBadge>
          ) : (
            <StatusBadge tone="amber">Not linked</StatusBadge>
          ),
      },
      {
        key: 'updated_at',
        label: 'Last updated',
        value: (r) => r.updated_at || '',
        render: (r) => (r.updated_at ? formatNepalDate(r.updated_at) : '—'),
      },
    ],
    []
  );

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Recipes</h1>
            <p className="mt-1 text-sm text-gray-500 sm:text-base">
              What each dish costs to make, and which ones are not yet wired to deduct stock.
            </p>
          </div>
          <button type="button" onClick={() => setPanel({ create: true })} className="inline-flex items-center gap-1.5 self-start rounded-xl bg-gray-900 px-3.5 py-2.5 text-sm font-semibold text-white hover:bg-gray-800">
            <Plus className="h-4 w-4" /> New recipe
          </button>
        </div>
      </header>

      <div className="space-y-5 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <KpiCards
          kpis={[
            { key: 'count', label: 'Recipes', value: recipes.length, format: 'number', sub: `${menuRecipes.length} on the menu` },
            {
              key: 'margin',
              label: 'Average margin',
              value: avgMargin.length ? avgMargin.reduce((s, r) => s + r.margin, 0) / avgMargin.length : 0,
              format: 'percent',
              sub: 'Menu recipes with a price',
            },
            { key: 'thin', label: 'Under 40% margin', value: thinMargin.length, format: 'number', sub: 'Worth repricing' },
            { key: 'todo', label: 'Need finishing', value: needsWork.length, format: 'number', sub: 'Empty or unlinked' },
          ]}
        />

        {needsWork.length > 0 && (
          <AttentionBar
            tone="amber"
            title={`${needsWork.length} recipe${needsWork.length === 1 ? '' : 's'} will not deduct stock`}
            body={`${needsWork.map((r) => r.name).slice(0, 3).join(', ')}${needsWork.length > 3 ? ` and ${needsWork.length - 3} more` : ''} — either they have no ingredients, or they are not linked to a menu item.`}
          />
        )}

        <DataGrid
          title="All recipes"
          columns={columns}
          rows={rows}
          csvName="recipes"
          onRowClick={(row) => setPanel({ id: row.id })}
          defaultSort={{ key: 'name', dir: 'asc' }}
          searchPlaceholder="Search recipes…"
          empty={
            loading
              ? 'Loading recipes…'
              : 'No recipes yet. Add one and link it to a menu item — that is what makes an order deduct ingredients.'
          }
          footNote="Food cost is priced at each ingredient's current moving-average cost. Click a row to open the builder."
          toolbar={
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="h-10 rounded-lg border border-gray-300 px-3 text-sm text-gray-700">
              <option value="all">All types</option>
              <option value="menu_item">Menu items</option>
              <option value="sub_recipe">Sub-recipes</option>
            </select>
          }
          renderActions={(row) => (
            <>
              <button type="button" title="Edit recipe" aria-label="Edit recipe" onClick={() => setPanel({ id: row.id })} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-900">
                <Pencil className="h-4 w-4" />
              </button>
              <Link href={`${recipeBase}/${row.id}`} title="Open profile" aria-label="Open profile" className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-900">
                <ExternalLink className="h-4 w-4" />
              </Link>
            </>
          )}
        />
      </div>

      {panel && (
        <RecipePanel
          recipeId={panel.id}
          recipes={recipes}
          onClose={() => setPanel(null)}
          onSaved={fetchAll}
        />
      )}
    </AdminLayout>
  );
}
