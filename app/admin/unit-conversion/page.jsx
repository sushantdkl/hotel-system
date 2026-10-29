'use client';

import { useState, useEffect } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import UnitSelect from '@/components/ui/unit-select';
import { Plus, Edit, Trash2, ArrowRight, Ruler } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import { apiJson } from '@/lib/authed-fetch';
import { unitLabel } from '@/lib/units';

const emptyForm = { from_unit: '', to_unit: '', factor: '', note: '' };

export default function UnitConversionPage() {
  const { addToast } = useToast();
  const { confirm } = useConfirm();
  const [conversions, setConversions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const data = await apiJson('/api/admin/unit-conversions');
      setConversions(data.conversions || []);
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
    setForm({ ...emptyForm });
    setShowForm(true);
  };

  const openEdit = (c) => {
    setEditing(c);
    setForm({ from_unit: c.from_unit, to_unit: c.to_unit, factor: String(c.factor), note: c.note || '' });
    setShowForm(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.from_unit || !form.to_unit || !form.factor) {
      addToast(friendlyMessage('validation', { description: 'Pick both units and enter a factor.' }));
      return;
    }
    setSaving(true);
    try {
      await apiJson('/api/admin/unit-conversions', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify({ ...form, factor: Number(form.factor), id: editing?.id }),
      });
      addToast(friendlyMessage('save_success', { description: editing ? 'Conversion updated.' : 'Conversion added.' }));
      setShowForm(false);
      setEditing(null);
      setForm({ ...emptyForm });
      load();
    } catch (error) {
      addToast(friendlyFromError(error, 'save_failed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (c) => {
    const ok = await confirm({
      title: 'Delete conversion?',
      message: `Delete the ${unitLabel(c.from_unit)} → ${unitLabel(c.to_unit)} conversion?`,
      tone: 'delete',
    });
    if (!ok) return;
    try {
      await apiJson(`/api/admin/unit-conversions?id=${c.id}`, { method: 'DELETE' });
      load();
    } catch (error) {
      addToast(friendlyFromError(error, 'delete_failed'));
    }
  };

  return (
    <AdminLayout>
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mx-auto w-full max-w-5xl">
          <div className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-800 sm:text-3xl">Unit Conversion</h1>
              <p className="mt-1 text-gray-700">
                Record supplier pack sizes the app can&apos;t derive — 1 Box = 24 Bottles, 1 Sack = 25 Kg. These fill in
                conversion factors automatically on inventory items.
              </p>
            </div>
            <button
              onClick={openCreate}
              className="flex items-center gap-2 rounded-lg bg-gray-900 px-6 py-3 text-white hover:bg-gray-800"
            >
              <Plus className="h-5 w-5" />
              <span>Add Conversion</span>
            </button>
          </div>

          {showForm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="w-full max-w-2xl rounded-2xl bg-white">
                <div className="border-b border-gray-200 p-6 sm:px-8">
                  <h2 className="text-xl font-bold text-gray-800">{editing ? 'Edit Conversion' : 'Add Conversion'}</h2>
                </div>
                <form onSubmit={submit} className="space-y-5 p-6 sm:p-8" noValidate>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
                    <label className="block">
                      <span className="mb-1 block text-sm font-medium text-gray-700">1 of this unit *</span>
                      <UnitSelect
                        value={form.from_unit}
                        onChange={(v) => setForm({ ...form, from_unit: v })}
                        placeholder="box"
                      />
                    </label>
                    <div className="hidden pb-2 text-gray-400 sm:block">
                      <ArrowRight className="h-5 w-5" />
                    </div>
                    <label className="block">
                      <span className="mb-1 block text-sm font-medium text-gray-700">equals this unit *</span>
                      <UnitSelect
                        value={form.to_unit}
                        onChange={(v) => setForm({ ...form, to_unit: v })}
                        placeholder="bottle"
                      />
                    </label>
                  </div>

                  <label className="block">
                    <span className="mb-1 block text-sm font-medium text-gray-700">How many? *</span>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={form.factor}
                      onChange={(e) => setForm({ ...form, factor: e.target.value })}
                      className="h-10 w-full rounded-lg border border-gray-300 px-3 text-gray-900"
                      placeholder="24"
                    />
                    {form.from_unit && form.to_unit && form.factor && (
                      <span className="mt-1 block text-xs text-gray-500">
                        1 {unitLabel(form.from_unit)} = {form.factor} {unitLabel(form.to_unit)}
                      </span>
                    )}
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-sm font-medium text-gray-700">Note</span>
                    <input
                      value={form.note}
                      onChange={(e) => setForm({ ...form, note: e.target.value })}
                      className="h-10 w-full rounded-lg border border-gray-300 px-3 text-gray-900"
                      placeholder="Optional"
                    />
                  </label>

                  <div className="flex gap-3 pt-2">
                    <button
                      type="submit"
                      disabled={saving}
                      className="flex-1 rounded-lg bg-gray-900 px-6 py-3 text-white hover:bg-gray-800 disabled:opacity-50"
                    >
                      {saving ? 'Saving…' : editing ? 'Update' : 'Create'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowForm(false);
                        setEditing(null);
                      }}
                      className="flex-1 rounded-lg bg-gray-200 px-6 py-3 text-gray-700 hover:bg-gray-300"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px]">
                <thead className="border-b border-gray-200 bg-gray-50">
                  <tr>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Conversion</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Note</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {conversions.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 font-medium text-gray-900">
                        1 {unitLabel(c.from_unit)} = {c.factor} {unitLabel(c.to_unit)}
                      </td>
                      <td className="px-6 py-4 text-gray-700">{c.note || '-'}</td>
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
            {!loading && conversions.length === 0 && (
              <div className="py-12 text-center">
                <Ruler className="mx-auto mb-4 h-12 w-12 text-gray-400" />
                <p className="text-gray-700">No conversions yet. Add one like 1 Box = 24 Bottles.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
