'use client';

import { useEffect, useState } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import { Plus, Edit, Trash2, Wallet } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import { apiJson } from '@/lib/authed-fetch';

export default function ExpenseCategoriesPage() {
  const { addToast } = useToast();
  const { confirm } = useConfirm();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try { const d = await apiJson('/api/admin/expense-categories'); setCategories(d.categories || []); }
    catch (error) { addToast(friendlyFromError(error, 'load_failed')); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  // Which business the category's costs belong to in the Business report P&L.
  const setUnit = async (c, unit) => {
    try {
      await apiJson('/api/admin/expense-categories', { method: 'PUT', body: JSON.stringify({ id: c.id, name: c.name, business_unit: unit }) });
      setCategories((list) => list.map((x) => (x.id === c.id ? { ...x, business_unit: unit } : x)));
    } catch (error) { addToast(friendlyFromError(error, 'save_failed')); }
  };

  const openCreate = () => { setEditing(null); setName(''); setShowForm(true); };
  const openEdit = (c) => { setEditing(c); setName(c.name); setShowForm(true); };

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) { addToast(friendlyMessage('validation', { description: 'Give the category a name.' })); return; }
    setSaving(true);
    try {
      await apiJson('/api/admin/expense-categories', { method: editing ? 'PUT' : 'POST', body: JSON.stringify({ name: name.trim(), id: editing?.id }) });
      addToast(friendlyMessage('save_success', { description: editing ? 'Category updated.' : 'Category added.' }));
      setShowForm(false); setEditing(null); setName(''); load();
    } catch (error) { addToast(friendlyFromError(error, 'save_failed')); }
    finally { setSaving(false); }
  };

  const remove = async (c) => {
    const ok = await confirm({
      title: `Delete "${c.name}"?`,
      tone: 'delete',
    });
    if (!ok) return;
    try { await apiJson(`/api/admin/expense-categories?id=${c.id}`, { method: 'DELETE' }); load(); }
    catch (error) { addToast(friendlyFromError(error, 'delete_failed')); }
  };

  return (
    <AdminLayout>
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mx-auto w-full max-w-4xl">
          <div className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-800 sm:text-3xl">Expense Categories</h1>
              <p className="mt-1 text-gray-700">Organise expenses — Rent, Utilities, Salaries, Marketing. Used when logging expenses.</p>
            </div>
            <button onClick={openCreate} className="flex items-center gap-2 rounded-lg bg-gray-900 px-6 py-3 text-white hover:bg-gray-800">
              <Plus className="h-5 w-5" /> <span>Add Category</span>
            </button>
          </div>

          {showForm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="w-full max-w-lg rounded-2xl bg-white p-6 sm:p-8">
                <h2 className="mb-5 text-xl font-bold text-gray-800">{editing ? 'Edit Category' : 'Add Category'}</h2>
                <form onSubmit={submit} noValidate>
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium text-gray-700">Category name *</span>
                    <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="h-11 w-full rounded-lg border border-gray-300 px-3 text-gray-900" placeholder="e.g. Rent" />
                  </label>
                  <div className="mt-6 flex gap-3">
                    <button type="submit" disabled={saving} className="flex-1 rounded-lg bg-gray-900 px-6 py-3 text-white hover:bg-gray-800 disabled:opacity-50">{saving ? 'Saving…' : editing ? 'Update' : 'Create'}</button>
                    <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="flex-1 rounded-lg bg-gray-200 px-6 py-3 text-gray-700 hover:bg-gray-300">Cancel</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
            <table className="w-full">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Category</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Used</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Business</th>
                  <th className="px-6 py-4 text-right text-sm font-semibold text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {categories.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium text-gray-900">{c.name}</td>
                    <td className="px-6 py-4 text-gray-700">{c.usage_count ?? 0}</td>
                    <td className="px-6 py-4">
                      <select aria-label={`Business for ${c.name}`} value={c.business_unit || 'shared'} onChange={(e) => setUnit(c, e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-900">
                        <option value="restaurant">Restaurant</option><option value="hotel">Hotel</option><option value="shared">Shared</option>
                      </select>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => openEdit(c)} className="rounded-lg p-2 text-blue-600 hover:bg-blue-50"><Edit className="h-4 w-4" /></button>
                        <button onClick={() => remove(c)} className="rounded-lg p-2 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && categories.length === 0 && (
              <div className="py-12 text-center"><Wallet className="mx-auto mb-4 h-12 w-12 text-gray-400" /><p className="text-gray-700">No categories yet. Add one like Rent or Utilities.</p></div>
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
