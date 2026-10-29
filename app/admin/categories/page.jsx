'use client';

import { useState, useEffect, useCallback } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import { Plus, Edit, Trash2, Save, X, FolderOpen, GripVertical } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import { FOOD_GROUPS, DEFAULT_FOOD_GROUP, foodGroupLabel } from '@/lib/food-groups.js';

export default function CategoriesPage() {
  const { addToast } = useToast();
  const { confirm } = useConfirm();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    icon: '',
    display_order: 0,
    food_group: DEFAULT_FOOD_GROUP
  });

  /*
   * Declared before the effect that runs it, and memoised: as a plain arrow
   * below the effect it was a new identity every render and read before its own
   * declaration, so the dependency array could never be honest about it.
   */
  const fetchCategories = useCallback(async () => {
    try {
      const token = localStorage.getItem('pos_token');
      const response = await fetch('/api/restaurant/menu/categories', {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        setCategories(data.categories);
      }
      setLoading(false);
    } catch (error) {
      console.error('Error:', error);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Kicked off inside an async callback, not straight in the effect body, and
    // guarded so a response arriving after unmount cannot set state on a gone
    // component. fetchCategories itself stays reusable — the mutation handlers
    // below call it to refresh.
    let cancelled = false;
    (async () => {
      if (!cancelled) await fetchCategories();
    })();
    return () => { cancelled = true; };
  }, [fetchCategories]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    try {
      const token = localStorage.getItem('pos_token');
      const method = editingCategory ? 'PUT' : 'POST';
      const body = editingCategory 
        ? { ...formData, id: editingCategory.id }
        : formData;

      const response = await fetch('/api/restaurant/menu/categories', {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });

      const data = await response.json();

      if (response.ok) {
        fetchCategories();
        handleCancel();
        addToast(friendlyMessage('save_success', { description: 'Category was saved.' }));
      } else {
        addToast(friendlyFromError(data, 'save_failed'));
      }
    } catch (error) {
      console.error('Error:', error);
      addToast(friendlyFromError(error, 'save_failed'));
    }
  };

  const handleEdit = (category) => {
    setEditingCategory(category);
    setFormData({
      name: category.name,
      icon: category.icon || '',
      display_order: category.display_order || 0,
      food_group: category.food_group || DEFAULT_FOOD_GROUP
    });
    setShowForm(true);
  };

  const handleDelete = async (id, name) => {
    const ok = await confirm({
      title: `Delete "${name}"?`,
      message: `Are you sure you want to delete the "${name}" category?`,
      tone: 'delete',
    });
    if (!ok) return;
    
    try {
      const token = localStorage.getItem('pos_token');
      const response = await fetch(`/api/restaurant/menu/categories?id=${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });

      const data = await response.json();

      if (response.ok) {
        fetchCategories();
        addToast(friendlyMessage('delete_success', { description: 'Category was removed.' }));
      } else {
        addToast(friendlyFromError(data, 'delete_failed'));
      }
    } catch (error) {
      console.error('Error:', error);
      addToast(friendlyFromError(error, 'delete_failed'));
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingCategory(null);
    setFormData({
      name: '',
      icon: '',
      display_order: 0,
      food_group: DEFAULT_FOOD_GROUP
    });
  };

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center h-screen">
          <div className="text-xl text-gray-600">Loading...</div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="max-w-5xl mx-auto">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 sm:mb-8">
            <div>
              <h1 className="text-3xl font-bold text-gray-800">Menu Categories</h1>
              <p className="text-gray-700 mt-1">Organize your menu items into categories</p>
            </div>
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-lg"
            >
              <Plus className="w-5 h-5" />
              <span>Add Category</span>
            </button>
          </div>

          {/* Category Form Modal */}
          {showForm && (
            <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
              <div className="admin-form-shell max-h-[94dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-2xl">
                <div className="border-b border-gray-200 pb-5 mb-6">
                  <h2 className="text-2xl font-bold text-gray-800">
                    {editingCategory ? 'Edit Category' : 'Add New Category'}
                  </h2>
                </div>

                <form onSubmit={handleSubmit} className="admin-form-stack">
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-gray-700">Category Name *</span>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="h-11 sm:h-12 w-full rounded-xl border border-gray-300 px-4 text-base focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                      placeholder="e.g., Appetizers, Main Course"
                      required
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-gray-700">Master category</span>
                    <select
                      value={formData.food_group}
                      onChange={(e) => setFormData({ ...formData, food_group: e.target.value })}
                      className="h-11 sm:h-12 w-full rounded-xl border border-gray-300 px-4 text-base focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    >
                      {FOOD_GROUPS.map((g) => (
                        <option key={g.id} value={g.id}>{g.label}</option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-500 mt-2">Groups this category for reports (Food, Beverages, Tobacco…).</p>
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-gray-700">Icon (Optional)</span>
                    <input
                      type="text"
                      value={formData.icon}
                      onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                      className="h-11 sm:h-12 w-full rounded-xl border border-gray-300 px-4 text-base focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                      placeholder="🍕 (emoji or icon name)"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-gray-700">Display Order</span>
                    <input
                      type="number"
                      value={formData.display_order}
                      onChange={(e) => setFormData({ ...formData, display_order: parseInt(e.target.value) || 0 })}
                      className="h-11 sm:h-12 w-full rounded-xl border border-gray-300 px-4 text-base focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                      min="0"
                    />
                    <p className="text-xs text-gray-500 mt-2">Lower numbers appear first</p>
                  </label>

                  <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={handleCancel}
                      className="flex-1 flex items-center justify-center gap-2 h-11 sm:h-12 rounded-xl bg-gray-200 text-gray-700 hover:bg-gray-300 font-semibold"
                    >
                      <X className="w-4 h-4" />
                      <span>Cancel</span>
                    </button>
                    <button
                      type="submit"
                      className="flex-1 flex items-center justify-center gap-2 h-11 sm:h-12 rounded-xl bg-blue-600 text-white hover:bg-blue-700 font-semibold"
                    >
                      <Save className="w-4 h-4" />
                      <span>{editingCategory ? 'Update' : 'Create'}</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Categories List */}
          {categories.length === 0 ? (
            <div className="bg-white rounded-lg border-2 border-dashed border-gray-300 p-12 text-center">
              <FolderOpen className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-700 mb-2">No Categories Yet</h3>
              <p className="text-gray-500 mb-6">
                Create your first category to start organizing your menu
              </p>
              <button
                onClick={() => setShowForm(true)}
                className="inline-flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                <Plus className="w-5 h-5" />
                <span>Add Category</span>
              </button>
            </div>
          ) : (
            <>
              {/* Mobile category cards */}
              <div className="md:hidden space-y-3">
                {categories.map((category) => (
                  <div key={category.id} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-2xl flex-shrink-0">{category.icon || '📁'}</span>
                        <div className="min-w-0">
                          <h3 className="font-bold text-gray-900 truncate">{category.name}</h3>
                          <p className="text-xs text-gray-500">
                            Order: {category.display_order}
                            <span className="ml-2 inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                              {foodGroupLabel(category.food_group)}
                            </span>
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-3">
                      <button onClick={() => handleEdit(category)} className="flex-1 py-2 text-blue-600 bg-blue-50 rounded-lg text-sm font-semibold">Edit</button>
                      <button onClick={() => handleDelete(category.id, category.name)} className="flex-1 py-2 text-red-600 bg-red-50 rounded-lg text-sm font-semibold">Delete</button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop categories table */}
              <div className="hidden md:block bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Order
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Category
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Master category
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Icon
                      </th>
                      <th className="px-6 py-4 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {categories.map((category) => (
                      <tr key={category.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center text-sm text-gray-500">
                            <GripVertical className="w-4 h-4 mr-2 text-gray-400" />
                            {category.display_order}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">
                            {category.name}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">
                            {foodGroupLabel(category.food_group)}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-2xl">
                            {category.icon || '📁'}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <button
                            onClick={() => handleEdit(category)}
                            className="text-blue-600 hover:text-blue-900 mr-4"
                          >
                            <Edit className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => handleDelete(category.id, category.name)}
                            className="text-red-600 hover:text-red-900"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </div>
            </>
          )}

          {/* Stats */}
          <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-800">
              <strong>{categories.length}</strong> {categories.length === 1 ? 'category' : 'categories'} configured
            </p>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
