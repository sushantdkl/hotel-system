'use client';

import { useEffect, useState } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import { Plus, Edit, Trash2, Building2 } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import { apiJson } from '@/lib/authed-fetch';
import { useCapabilities } from '@/lib/use-capabilities';

export default function DepartmentsPage() {
  const { addToast } = useToast();
  const { confirm } = useConfirm();
  const { can } = useCapabilities();
  const canManage = can('hrm.departments.manage');
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', is_active: true });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try { const d = await apiJson('/api/admin/hrm/departments'); setDepartments(d.departments || []); }
    catch (error) { addToast(friendlyFromError(error, 'load_failed')); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm({ name: '', description: '', is_active: true }); setShowForm(true); };
  const openEdit = (d) => { setEditing(d); setForm({ name: d.name, description: d.description || '', is_active: !!d.is_active }); setShowForm(true); };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { addToast(friendlyMessage('validation', { description: 'Give the department a name.' })); return; }
    setSaving(true);
    try {
      await apiJson('/api/admin/hrm/departments', { method: editing ? 'PUT' : 'POST', body: JSON.stringify({ ...form, id: editing?.id }) });
      addToast(friendlyMessage('save_success', { description: editing ? 'Department updated.' : 'Department added.' }));
      setShowForm(false); setEditing(null); load();
    } catch (error) { addToast(friendlyFromError(error, 'save_failed')); }
    finally { setSaving(false); }
  };

  const remove = async (d) => {
    const ok = await confirm({ title: `Delete "${d.name}"?`, message: d.staff_count > 0 ? `${d.staff_count} staff member(s) will be unassigned from this department.` : undefined, tone: 'delete' });
    if (!ok) return;
    try { await apiJson(`/api/admin/hrm/departments?id=${d.id}`, { method: 'DELETE' }); load(); }
    catch (error) { addToast(friendlyFromError(error, 'delete_failed')); }
  };

  return (
    <AdminLayout>
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mx-auto w-full max-w-4xl">
          <div className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-800 sm:text-3xl">Departments</h1>
              <p className="mt-1 text-gray-700">Group staff by department — Kitchen, Service, Management.</p>
            </div>
            {canManage && (
              <button onClick={openCreate} className="flex items-center gap-2 rounded-lg bg-gray-900 px-6 py-3 text-white hover:bg-gray-800">
                <Plus className="h-5 w-5" /> <span>Add Department</span>
              </button>
            )}
          </div>

          {showForm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="w-full max-w-lg rounded-2xl bg-white p-6 sm:p-8">
                <h2 className="mb-5 text-xl font-bold text-gray-800">{editing ? 'Edit Department' : 'Add Department'}</h2>
                <form onSubmit={submit} noValidate className="space-y-4">
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium text-gray-700">Department name *</span>
                    <input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-11 w-full rounded-lg border border-gray-300 px-3 text-gray-900" placeholder="e.g. Kitchen" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium text-gray-700">Description</span>
                    <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900" />
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="h-4 w-4 rounded border-gray-300" />
                    <span className="text-sm text-gray-700">Active</span>
                  </label>
                  <div className="flex gap-3 pt-2">
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
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Department</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Staff</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Status</th>
                  {canManage && <th className="px-6 py-4 text-right text-sm font-semibold text-gray-700">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {departments.map((d) => (
                  <tr key={d.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <p className="font-medium text-gray-900">{d.name}</p>
                      {d.description && <p className="text-xs text-gray-500">{d.description}</p>}
                    </td>
                    <td className="px-6 py-4 text-gray-700">{d.staff_count ?? 0}</td>
                    <td className="px-6 py-4">
                      <span className={`rounded-full px-3 py-1 text-xs font-medium ${d.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>{d.is_active ? 'Active' : 'Inactive'}</span>
                    </td>
                    {canManage && (
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => openEdit(d)} className="rounded-lg p-2 text-blue-600 hover:bg-blue-50"><Edit className="h-4 w-4" /></button>
                          <button onClick={() => remove(d)} className="rounded-lg p-2 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && departments.length === 0 && (
              <div className="py-12 text-center"><Building2 className="mx-auto mb-4 h-12 w-12 text-gray-400" /><p className="text-gray-700">No departments yet. Add one like Kitchen or Service.</p></div>
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
