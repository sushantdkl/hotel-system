'use client';

/**
 * Recipe builder as a side panel, not a full-page form.
 *
 * Costing is computed live in the browser from the same rule the server uses
 * (lib/recipes.js getRecipeCost): raw-material lines cost quantity ×
 * cost_per_unit in consumption units, sub-recipe lines cost a pro-rata share of
 * the component's own food cost. The server recomputes on save, so this is a
 * preview, not a second source of truth.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Copy, ExternalLink, Plus, Trash2, X } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import { apiJson, authedRequest } from '@/lib/authed-fetch';

const blankLine = () => ({ raw_material_id: '', component_recipe_id: '', quantity: '', unit: '' });

export default function RecipePanel({ recipeId, seedType = 'menu_item', recipes, onClose, onSaved }) {
  const { addToast } = useToast();
  const creating = !recipeId;
  const [loading, setLoading] = useState(!creating);
  const [saving, setSaving] = useState(false);
  const [materials, setMaterials] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [menuItemSearch, setMenuItemSearch] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [form, setForm] = useState({
    name: '',
    type: seedType,
    menu_item_id: '',
    yield_quantity: 1,
    yield_unit: '',
    prep_time_minutes: '',
    prep_notes: '',
  });
  const [lines, setLines] = useState([blankLine()]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // The ingredient picker deliberately uses the default endpoint, which
        // excludes archived items — a retired ingredient must not be pickable.
        const [inv, menu] = await Promise.all([
          apiJson('/api/admin/inventory'),
          apiJson('/api/admin/products').catch(() => ({ products: [], items: [] })),
        ]);
        if (cancelled) return;
        setMaterials(inv.items || []);
        setMenuItems((menu.products || menu.items || menu.menuItems || []).filter((item) => !Number(item.is_combo)));
      } catch (error) {
        addToast(friendlyFromError(error, 'load_failed'));
      }

      if (creating) return;
      try {
        const data = await apiJson(`/api/admin/recipes?id=${recipeId}`);
        if (cancelled) return;
        const r = data.recipe;
        setForm({
          name: r.name || '',
          type: r.type,
          menu_item_id: r.menu_item_id || '',
          yield_quantity: r.yield_quantity ?? 1,
          yield_unit: r.yield_unit || '',
          prep_time_minutes: r.prep_time_minutes ?? '',
          prep_notes: r.prep_notes || '',
        });
        setLines(
          (r.items || []).length
            ? r.items.map((l) => ({
                raw_material_id: l.raw_material_id ? String(l.raw_material_id) : '',
                component_recipe_id: l.component_recipe_id ? String(l.component_recipe_id) : '',
                quantity: String(l.quantity ?? ''),
                unit: l.unit || '',
              }))
            : [blankLine()]
        );
      } catch (error) {
        addToast(friendlyFromError(error, 'load_failed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipeId]);

  const materialById = useMemo(() => new Map(materials.map((m) => [String(m.id), m])), [materials]);
  const recipeById = useMemo(() => new Map((recipes || []).map((r) => [String(r.id), r])), [recipes]);
  const subRecipes = useMemo(
    () => (recipes || []).filter((r) => r.type === 'sub_recipe' && String(r.id) !== String(recipeId)),
    [recipes, recipeId]
  );

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const costed = useMemo(
    () =>
      lines.map((line) => {
        const qty = Number(line.quantity || 0);
        if (line.raw_material_id) {
          const m = materialById.get(line.raw_material_id);
          const unitCost = Number(m?.cost_per_unit || 0);
          return {
            ...line,
            label: m?.item_name || 'Unknown item',
            unit: line.unit || m?.consumption_unit || m?.unit || '',
            unitCost,
            subtotal: qty * unitCost,
            kind: 'ingredient',
          };
        }
        if (line.component_recipe_id) {
          const sub = recipeById.get(line.component_recipe_id);
          const subYield = Number(sub?.yield_quantity || 1) || 1;
          const unitCost = Number(sub?.food_cost || 0) / subYield;
          return {
            ...line,
            label: sub?.name || 'Unknown sub-recipe',
            unit: line.unit || sub?.yield_unit || '',
            unitCost,
            subtotal: qty * unitCost,
            kind: 'sub_recipe',
          };
        }
        return { ...line, label: '', unitCost: 0, subtotal: 0, kind: 'empty' };
      }),
    [lines, materialById, recipeById]
  );

  const foodCost = costed.reduce((s, l) => s + l.subtotal, 0);
  const menuItem = menuItems.find((m) => String(m.id) === String(form.menu_item_id));

  // The form stores the stable id, while the field shows a human-readable
  // name. Keeping those separate lets typing filter the native dropdown
  // without accidentally saving a menu-item name where an id is required.
  useEffect(() => {
    if (!form.menu_item_id) return;
    const selected = menuItems.find((m) => String(m.id) === String(form.menu_item_id));
    if (selected) setMenuItemSearch(selected.name || '');
  }, [form.menu_item_id, menuItems]);
  const sellingPrice = Number(menuItem?.base_price ?? menuItem?.price ?? 0);
  const profit = sellingPrice - foodCost;
  const margin = sellingPrice > 0 ? (profit / sellingPrice) * 100 : null;
  const perYield = Number(form.yield_quantity || 1) || 1;

  function updateLine(i, patch) {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  function pick(i, value) {
    // One select drives both columns; the two ids are mutually exclusive.
    if (value.startsWith('r:')) {
      const sub = recipeById.get(value.slice(2));
      updateLine(i, { raw_material_id: '', component_recipe_id: value.slice(2), unit: sub?.yield_unit || '' });
    } else if (value) {
      const m = materialById.get(value);
      updateLine(i, { raw_material_id: value, component_recipe_id: '', unit: m?.consumption_unit || m?.unit || '' });
    } else {
      updateLine(i, { raw_material_id: '', component_recipe_id: '' });
    }
  }

  function payload() {
    return {
      ...form,
      menu_item_id: form.type === 'menu_item' ? form.menu_item_id || null : null,
      yield_quantity: Number(form.yield_quantity || 1),
      prep_time_minutes: form.prep_time_minutes === '' ? null : Number(form.prep_time_minutes),
      items: lines
        .filter((l) => (l.raw_material_id || l.component_recipe_id) && Number(l.quantity) > 0)
        .map((l) => ({
          raw_material_id: l.raw_material_id ? Number(l.raw_material_id) : null,
          component_recipe_id: l.component_recipe_id ? Number(l.component_recipe_id) : null,
          quantity: Number(l.quantity),
          unit: l.unit || null,
        })),
    };
  }

  async function save() {
    if (!form.name.trim()) {
      addToast(friendlyMessage('validation', { description: 'Give the recipe a name.' }));
      return;
    }
    setSaving(true);
    try {
      const body = payload();
      if (creating) {
        await apiJson('/api/admin/recipes', { method: 'POST', body: JSON.stringify(body) });
      } else {
        await apiJson('/api/admin/recipes', { method: 'PUT', body: JSON.stringify({ ...body, id: recipeId }) });
      }
      addToast(friendlyMessage('save_success', { description: `${form.name} saved.` }));
      onSaved?.();
      onClose();
    } catch (error) {
      addToast(friendlyFromError(error, 'save_failed'));
    } finally {
      setSaving(false);
    }
  }

  async function duplicate() {
    setSaving(true);
    try {
      // A copy never claims the menu item — menu_item_id is unique per recipe.
      await apiJson('/api/admin/recipes', {
        method: 'POST',
        body: JSON.stringify({ ...payload(), name: `${form.name} (copy)`, type: 'sub_recipe', menu_item_id: null }),
      });
      addToast(
        friendlyMessage('save_success', {
          description: `Copied as “${form.name} (copy)”. It is a sub-recipe until you link it to a menu item.`,
        })
      );
      onSaved?.();
      onClose();
    } catch (error) {
      addToast(friendlyFromError(error, 'save_failed'));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    try {
      const res = await authedRequest(`/api/admin/recipes?id=${recipeId}`, { method: 'DELETE' });
      if (!res.ok) throw await res.json().catch(() => ({}));
      addToast(friendlyMessage('delete_success', { description: `${form.name} deleted.` }));
      onSaved?.();
      onClose();
    } catch (error) {
      addToast(friendlyFromError(error, 'delete_failed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="relative z-10 flex h-full w-full max-w-4xl flex-col overflow-y-auto bg-white shadow-xl animate-in fade-in duration-200">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-gray-200 bg-white px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
              {creating ? 'New recipe' : form.type === 'menu_item' ? 'Menu item recipe' : 'Sub-recipe / batch'}
            </p>
            <h2 className="truncate text-lg font-semibold text-gray-900">{form.name || 'Untitled recipe'}</h2>
          </div>
          <div className="flex items-center gap-1">
            {!creating && (
              <Link href={`/admin/recipes/${recipeId}`} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-900" title="Open full profile">
                <ExternalLink className="h-4 w-4" />
              </Link>
            )}
            <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        {loading ? (
          <p className="p-8 text-center text-sm text-gray-500">Loading recipe…</p>
        ) : (
          <div className="flex-1 space-y-6 p-5 lg:p-6">
            <Step
              n={1}
              title="Recipe details"
              hint={
                form.type === 'menu_item'
                  ? 'A menu-item recipe deducts stock every time that dish is ordered — so it must be linked to a menu item.'
                  : 'A sub-recipe is a batch (a sauce, a dough) you reuse inside other recipes. It is not sold directly.'
              }
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Recipe name">
                  <input value={form.name} onChange={(e) => set({ name: e.target.value })} className={INPUT} placeholder="e.g. Chicken Momo" />
                </Field>
                <Field label="Recipe type">
                  <select value={form.type} onChange={(e) => set({ type: e.target.value })} className={INPUT}>
                    <option value="menu_item">Menu item — sold to customers</option>
                    <option value="sub_recipe">Sub-recipe / batch — used inside other recipes</option>
                  </select>
                </Field>
                {form.type === 'menu_item' && (
                  <Field label="Linked menu item">
                    <input
                      list="recipe-menu-items"
                      value={menuItemSearch}
                      onChange={(e) => {
                        const value = e.target.value;
                        setMenuItemSearch(value);
                        const match = menuItems.find((m) => String(m.name || '').toLowerCase() === value.trim().toLowerCase());
                        set({ menu_item_id: match ? String(match.id) : '' });
                      }}
                      className={INPUT}
                      placeholder="Type to search menu items…"
                    />
                    <datalist id="recipe-menu-items">
                      {menuItems.map((m) => <option key={m.id} value={m.name} />)}
                    </datalist>
                    <span className="mt-1 block text-xs text-gray-500">Type to search or select from the dropdown. Required for stock to deduct on each order.</span>
                  </Field>
                )}
                <Field label="This recipe makes">
                  <div className="flex gap-2">
                    <input type="number" step="any" value={form.yield_quantity} onChange={(e) => set({ yield_quantity: e.target.value })} className={INPUT} aria-label="Yield quantity" />
                    <input value={form.yield_unit} onChange={(e) => set({ yield_unit: e.target.value })} className={INPUT} placeholder="portions" aria-label="Yield unit" />
                  </div>
                  <span className="mt-1 block text-xs text-gray-500">e.g. 10 portions, 1 pot, 24 pieces. Food cost is divided by this.</span>
                </Field>
                <Field label="Prep time (minutes)">
                  <input type="number" value={form.prep_time_minutes} onChange={(e) => set({ prep_time_minutes: e.target.value })} className={INPUT} placeholder="Optional" />
                </Field>
              </div>
            </Step>

            <Step
              n={2}
              title="Ingredients"
              hint="List everything the batch above uses. Pick a stock item or another sub-recipe, then enter how much. Costs fill in automatically."
              action={
                <button type="button" onClick={() => setLines((p) => [...p, blankLine()])} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  <Plus className="h-3.5 w-3.5" /> Add row
                </button>
              }
            >
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                      <th className="whitespace-nowrap px-3 py-2 font-semibold">Ingredient</th>
                      <th className="whitespace-nowrap px-3 py-2 font-semibold">Qty</th>
                      <th className="whitespace-nowrap px-3 py-2 font-semibold">Unit</th>
                      <th className="whitespace-nowrap px-3 py-2 text-right font-semibold">Cost</th>
                      <th className="whitespace-nowrap px-3 py-2 text-right font-semibold">Share</th>
                      <th className="whitespace-nowrap px-3 py-2 text-right font-semibold">Subtotal</th>
                      <th className="w-8 px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {costed.map((line, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2">
                          <select
                            value={line.component_recipe_id ? `r:${line.component_recipe_id}` : line.raw_material_id}
                            onChange={(e) => pick(i, e.target.value)}
                            className="h-9 w-52 rounded-md border border-gray-300 px-2 text-sm"
                          >
                            <option value="">Select…</option>
                            <optgroup label="Ingredients">
                              {materials.map((m) => (
                                <option key={m.id} value={m.id}>{m.item_name}</option>
                              ))}
                            </optgroup>
                            {subRecipes.length > 0 && (
                              <optgroup label="Sub-recipes">
                                {subRecipes.map((r) => (
                                  <option key={r.id} value={`r:${r.id}`}>{r.name}</option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <input type="number" step="any" value={line.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} className="h-9 w-20 rounded-md border border-gray-300 px-2 text-sm" />
                        </td>
                        <td className="px-3 py-2">
                          <input value={line.unit} onChange={(e) => updateLine(i, { unit: e.target.value })} className="h-9 w-20 rounded-md border border-gray-300 px-2 text-sm" />
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-500">{line.unitCost ? `Rs ${line.unitCost.toFixed(3)}` : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-500">
                          {foodCost > 0 && line.subtotal > 0 ? `${((line.subtotal / foodCost) * 100).toFixed(0)}%` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-900">Rs {line.subtotal.toFixed(2)}</td>
                        <td className="px-2 py-2">
                          {lines.length > 1 && (
                            <button type="button" onClick={() => setLines((p) => p.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!materials.length && (
                <p className="mt-2 text-xs text-gray-500">
                  No active ingredients to pick from yet — add inventory items first. Archived items are hidden on purpose.
                </p>
              )}
            </Step>

            <Step n={3} title="Cost & method" hint="Live preview from current ingredient costs. The server recalculates on save.">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Metric label="Food cost" value={`Rs ${foodCost.toFixed(2)}`} sub={`Rs ${(foodCost / perYield).toFixed(2)} per ${form.yield_unit || 'unit'}`} />
                <Metric label="Selling price" value={sellingPrice ? `Rs ${sellingPrice.toFixed(2)}` : '—'} sub={form.type === 'menu_item' ? 'From the menu item' : 'Sub-recipes are not sold'} />
                <Metric label="Profit" value={sellingPrice ? `Rs ${profit.toFixed(2)}` : '—'} tone={profit < 0 ? 'red' : 'green'} />
                <Metric label="Margin" value={margin === null ? '—' : `${margin.toFixed(1)}%`} tone={margin !== null && margin < 0 ? 'red' : 'green'} />
              </div>

              <div className="mt-4">
                <Field label="Prep notes">
                  <textarea rows={3} value={form.prep_notes} onChange={(e) => set({ prep_notes: e.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="Method, batching instructions, plating…" />
                </Field>
              </div>
            </Step>

            {confirmDelete && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
                <p className="font-semibold">Delete {form.name}?</p>
                <p className="mt-1">Its ingredient lines go too, and orders for the linked menu item stop deducting stock.</p>
                <div className="mt-3 flex gap-2">
                  <button type="button" disabled={saving} onClick={remove} className="h-10 rounded-lg bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
                    Delete it
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(false)} className="h-10 rounded-lg border border-red-300 bg-white px-4 text-sm font-medium text-red-800">
                    Keep it
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {!loading && (
          <footer className="sticky bottom-0 flex flex-wrap gap-2 border-t border-gray-200 bg-white px-5 py-4">
            <button type="button" disabled={saving} onClick={save} className="h-10 rounded-lg bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">
              {saving ? 'Saving…' : creating ? 'Create recipe' : 'Save changes'}
            </button>
            {!creating && (
              <>
                <button type="button" disabled={saving} onClick={duplicate} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  <Copy className="h-4 w-4" /> Duplicate
                </button>
                <button type="button" onClick={() => setConfirmDelete(true)} className="ml-auto h-10 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-500 hover:bg-gray-50 hover:text-red-600">
                  Delete
                </button>
              </>
            )}
          </footer>
        )}
      </aside>
    </div>
  );
}

const INPUT = 'h-10 w-full rounded-lg border border-gray-300 px-3 text-sm text-gray-900';

function Step({ n, title, hint, action, children }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-bold text-white">
            {n}
          </span>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
            {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      {children}
    </label>
  );
}

function Metric({ label, value, sub, tone }) {
  const tones = { red: 'text-red-700', green: 'text-emerald-700' };
  return (
    <div className="rounded-xl border border-gray-200 p-3">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`mt-1 truncate text-lg font-bold tabular-nums ${tones[tone] || 'text-gray-900'}`}>{value}</p>
      {sub && <p className="mt-0.5 truncate text-xs text-gray-400">{sub}</p>}
    </div>
  );
}
