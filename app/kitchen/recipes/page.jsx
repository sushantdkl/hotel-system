'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, ChevronDown, Clock, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/components/ui/toast';
import { friendlyFromError } from '@/lib/friendly-message';

export default function KitchenRecipesPage() {
  const router = useRouter();
  const { apiCall } = useAuth();
  const { addToast } = useToast();
  const [recipes, setRecipes] = useState([]);
  const [details, setDetails] = useState({});
  const [expanded, setExpanded] = useState(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiCall('/api/admin/recipes')
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Could not load recipes');
        setRecipes(data.recipes || []);
      })
      .catch((error) => addToast(friendlyFromError(error, 'load_failed')))
      .finally(() => setLoading(false));
  }, [apiCall, addToast]);

  const openRecipe = useCallback(async (recipe) => {
    const next = expanded === recipe.id ? null : recipe.id;
    setExpanded(next);
    if (!next || details[next]) return;
    try {
      const response = await apiCall(`/api/admin/recipes?id=${next}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not load recipe');
      setDetails((current) => ({ ...current, [next]: data.recipe }));
    } catch (error) {
      addToast(friendlyFromError(error, 'load_failed'));
    }
  }, [expanded, details, apiCall, addToast]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return recipes.filter((recipe) => !q || [recipe.name, recipe.menu_item_name]
      .some((value) => String(value || '').toLowerCase().includes(q)));
  }, [recipes, search]);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3">
          <button type="button" onClick={() => router.push('/kitchen')} aria-label="Back to kitchen" className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100"><ArrowLeft className="h-5 w-5" /></button>
          <div><h1 className="font-bold text-slate-950">Kitchen recipes</h1><p className="text-xs text-slate-500">Ingredients, yield, timing, and preparation notes</p></div>
        </div>
        <div className="mx-auto max-w-4xl px-4 pb-3"><div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search recipe" className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm" /></div></div>
      </header>

      <main className="mx-auto max-w-4xl space-y-3 p-4">
        {visible.map((recipe) => {
          const detail = details[recipe.id];
          const isOpen = expanded === recipe.id;
          return (
            <article key={recipe.id} className="border border-slate-200 bg-white">
              <button type="button" onClick={() => openRecipe(recipe)} className="flex w-full items-center gap-3 p-4 text-left">
                <div className="flex h-10 w-10 items-center justify-center bg-slate-100 text-slate-700"><BookOpen className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1"><h2 className="truncate font-semibold text-slate-950">{recipe.name}</h2><p className="text-xs text-slate-500">{recipe.menu_item_name || (recipe.type === 'sub_recipe' ? 'Sub-recipe' : 'Unlinked recipe')} | Yield {Number(recipe.yield_quantity || 1)} {recipe.yield_unit || ''}</p></div>
                {recipe.prep_time_minutes ? <span className="flex items-center gap-1 text-xs font-semibold text-slate-600"><Clock className="h-4 w-4" />{recipe.prep_time_minutes}m</span> : null}
                <ChevronDown className={`h-5 w-5 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </button>
              {isOpen && (
                <div className="border-t border-slate-100 bg-slate-50 p-4">
                  {!detail ? <p className="text-sm text-slate-500">Loading recipe...</p> : (
                    <div className="space-y-4">
                      <div className="overflow-hidden border border-slate-200 bg-white">
                        {(detail.items || []).map((item) => <div key={item.id} className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 last:border-0"><span className="text-sm font-medium text-slate-900">{item.raw_material_name || item.component_recipe_name}</span><span className="text-sm font-semibold tabular-nums text-slate-700">{Number(item.quantity || 0)} {item.unit || item.raw_material_unit || ''}</span></div>)}
                        {(detail.items || []).length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-500">No ingredients recorded.</p>}
                      </div>
                      {detail.prep_notes && <div><p className="text-xs font-semibold uppercase text-slate-500">Preparation notes</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-800">{detail.prep_notes}</p></div>}
                    </div>
                  )}
                </div>
              )}
            </article>
          );
        })}
        {loading && <p className="py-16 text-center text-slate-500">Loading recipes...</p>}
        {!loading && visible.length === 0 && <p className="py-16 text-center text-slate-500">No recipes found.</p>}
      </main>
    </div>
  );
}
