'use client';

import { useEffect, useState } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import { Plus, Trash2, CalendarHeart } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import { apiJson } from '@/lib/authed-fetch';
import { useCapabilities } from '@/lib/use-capabilities';
import { formatCalendarDate } from '@/lib/calendar-system.js';
import DateInput from '@/components/ui/date-input.jsx';

const formatDate = (value) => formatCalendarDate(value);

export default function HolidaysPage() {
  const { addToast } = useToast();
  const { confirm } = useConfirm();
  const { can } = useCapabilities();
  const canManage = can('hrm.holidays.manage');
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ holiday_date: '', name: '', note: '' });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try { const d = await apiJson('/api/admin/hrm/holidays'); setHolidays(d.holidays || []); }
    catch (error) { addToast(friendlyFromError(error, 'load_failed')); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const openCreate = () => { setForm({ holiday_date: '', name: '', note: '' }); setShowForm(true); };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.holiday_date || !form.name.trim()) { addToast(friendlyMessage('validation', { description: 'Enter a date and a name for the holiday.' })); return; }
    setSaving(true);
    try {
      await apiJson('/api/admin/hrm/holidays', { method: 'POST', body: JSON.stringify(form) });
      addToast(friendlyMessage('save_success', { description: 'Holiday added.' }));
      setShowForm(false); load();
    } catch (error) { addToast(friendlyFromError(error, 'save_failed')); }
    finally { setSaving(false); }
  };

  const remove = async (h) => {
    const ok = await confirm({ title: `Remove "${h.name}"?`, tone: 'delete' });
    if (!ok) return;
    try { await apiJson(`/api/admin/hrm/holidays?id=${h.id}`, { method: 'DELETE' }); load(); }
    catch (error) { addToast(friendlyFromError(error, 'delete_failed')); }
  };

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = holidays.filter((h) => h.holiday_date >= today);
  const past = holidays.filter((h) => h.holiday_date < today);

  return (
    <AdminLayout>
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mx-auto w-full max-w-3xl">
          <div className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-800 sm:text-3xl">Holidays</h1>
              <p className="mt-1 text-gray-700">The restaurant&apos;s holiday calendar.</p>
            </div>
            {canManage && (
              <button onClick={openCreate} className="flex items-center gap-2 rounded-lg bg-gray-900 px-6 py-3 text-white hover:bg-gray-800">
                <Plus className="h-5 w-5" /> <span>Add Holiday</span>
              </button>
            )}
          </div>

          {showForm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="w-full max-w-lg rounded-2xl bg-white p-6 sm:p-8">
                <h2 className="mb-5 text-xl font-bold text-gray-800">Add Holiday</h2>
                <form onSubmit={submit} noValidate className="space-y-4">
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium text-gray-700">Date *</span>
                    <DateInput autoFocus value={form.holiday_date} onChange={(holiday_date) => setForm({ ...form, holiday_date })} className="h-11 w-full rounded-lg border border-gray-300 px-3 text-gray-900" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium text-gray-700">Name *</span>
                    <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-11 w-full rounded-lg border border-gray-300 px-3 text-gray-900" placeholder="e.g. Dashain" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium text-gray-700">Note</span>
                    <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900" />
                  </label>
                  <div className="flex gap-3 pt-2">
                    <button type="submit" disabled={saving} className="flex-1 rounded-lg bg-gray-900 px-6 py-3 text-white hover:bg-gray-800 disabled:opacity-50">{saving ? 'Saving…' : 'Create'}</button>
                    <button type="button" onClick={() => setShowForm(false)} className="flex-1 rounded-lg bg-gray-200 px-6 py-3 text-gray-700 hover:bg-gray-300">Cancel</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {[['Upcoming', upcoming], ['Past', past]].map(([label, rows]) => rows.length > 0 && (
            <div key={label} className="mb-6 overflow-hidden rounded-2xl border border-gray-200 bg-white">
              <div className="border-b border-gray-200 px-6 py-3"><h2 className="text-sm font-semibold text-gray-700">{label}</h2></div>
              <table className="w-full">
                <tbody className="divide-y divide-gray-200">
                  {rows.map((h) => (
                    <tr key={h.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-gray-700">{formatDate(h.holiday_date)}</td>
                      <td className="px-6 py-4">
                        <p className="font-medium text-gray-900">{h.name}</p>
                        {h.note && <p className="text-xs text-gray-500">{h.note}</p>}
                      </td>
                      {canManage && (
                        <td className="px-6 py-4 text-right">
                          <button onClick={() => remove(h)} className="rounded-lg p-2 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {!loading && holidays.length === 0 && (
            <div className="rounded-2xl border border-gray-200 bg-white py-12 text-center"><CalendarHeart className="mx-auto mb-4 h-12 w-12 text-gray-400" /><p className="text-gray-700">No holidays added yet.</p></div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
