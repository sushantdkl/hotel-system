'use client';

import { useState, useEffect } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import { Plus, Edit, Trash2, FolderOpen } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import { apiJson } from '@/lib/authed-fetch';

export default function InventoryCategoriesPage() {
  const { addToast } = useToast();
  const { confirm } = useConfirm();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const data = await apiJson('/api/admin/inventory-categories');
      setCategories(data.categories || []);
    } catch (error) {
      addToast(friendlyFromError(error, 'load_failed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setName('');
    setShowForm(true);
  };

  const openEdit = (c) => {
    setEditing(c);
    setName(c.name);
    setShowForm(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      addToast(friendlyMessage('validation', { description: 'Give the category a name.' }));
      return;
    }
    setSaving(true);
    try {
      await apiJson('/api/admin/inventory-categories', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify({ name: name.trim(), id: editing?.id }),
      });
      addToast(friendlyMessage('save_success', { description: editing ? 'Category updated.' : 'Category added.' }));
      setShowForm(false);
      setEditing(null);
      setName('');
      load();
    } catch (error) {
      addToast(friendlyFromError(error, 'save_failed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (c) => {
    const msg =
      c.item_count > 0
        ? `${c.item_count} item(s) will become uncategorised.`
        : '';
    const ok = await confirm({
      title: `Delete "${c.name}"?`,
      message: msg || undefined,
      tone: 'delete',
    });
    if (!ok) return;
    try {
      await apiJson(`/api/admin/inventory-categories?id=${c.id}`, { method: 'DELETE' });
      load();
    } catch (error) {
      addToast(friendlyFromError(error, 'delete_failed'));
    }
  };

  return (
    <AdminLayout>
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mx-auto w-full max-w-4xl">
          <div className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-800 sm:text-3xl">Inventory Categories</h1>
              <p className="mt-1 text-gray-700">
                Organise raw materials — Vegetables, Meat, Spices, Oil. Used to group and filter inventory items.
              </p>
            </div>
            <button
              onClick={openCreate}
              className="flex items-center gap-2 rounded-lg bg-gray-900 px-6 py-3 text-white hover:bg-gray-800"
            >
              <Plus className="h-5 w-5" />
              <span>Add Category</span>
            </button>
          </div>

          {showForm && (
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
              <div className="admin-form-shell max-h-[94dvh] w-full overflow-y-auto rounded-t-2xl sm:max-w-xl sm:rounded-2xl">
                <div className="mb-6 border-b border-gray-200 pb-5">
                  <h2 className="text-2xl font-bold text-gray-800">{editing ? 'Edit Category' : 'Add Category'}</h2>
                </div>
                <form onSubmit={submit} className="admin-form-stack" noValidate>
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-gray-700">Category name *</span>
                    <input
                      autoFocus
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="h-11 sm:h-12 w-full rounded-xl border border-gray-300 px-4 text-base text-gray-900"
                      placeholder="e.g. Vegetables"
                    />
                  </label>
                  <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => {
                        setShowForm(false);
                        setEditing(null);
                      }}
                      className="flex-1 rounded-xl bg-gray-200 px-6 py-3 font-semibold text-gray-700 hover:bg-gray-300"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      className="flex-1 rounded-xl bg-gray-900 px-6 py-3 font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
                    >
                      {saving ? 'Saving…' : editing ? 'Update' : 'Create'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px]">
                <thead className="border-b border-gray-200 bg-gray-50">
                  <tr>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Category</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Items</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {categories.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 font-medium text-gray-900">{c.name}</td>
                      <td className="px-6 py-4 text-gray-700">{c.item_count ?? 0}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => openEdit(c)} className="rounded-lg p-2 text-blue-600 hover:bg-blue-50">
                            <Edit className="h-4 w-4" />
                          </button>
                          <button onClick={() => remove(c)} className="rounded-lg p-2 text-red-600 hover:bg-red-50">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!loading && categories.length === 0 && (
              <div className="py-12 text-center">
                <FolderOpen className="mx-auto mb-4 h-12 w-12 text-gray-400" />
                <p className="text-gray-700">No categories yet. Add one like Vegetables or Spices.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
