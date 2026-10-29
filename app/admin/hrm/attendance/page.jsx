'use client';

import { useEffect, useMemo, useState } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import { CalendarCheck2, Save } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import { apiJson } from '@/lib/authed-fetch';
import { useCapabilities } from '@/lib/use-capabilities';
import DateInput from '@/components/ui/date-input.jsx';
import { nepalDateString } from '@/lib/report-dates.js';

const STATUSES = [
  { value: 'present', label: 'Present', cls: 'bg-green-100 text-green-800 border-green-300' },
  { value: 'half_day', label: 'Half day', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  { value: 'leave', label: 'Leave', cls: 'bg-blue-100 text-blue-800 border-blue-300' },
  { value: 'absent', label: 'Absent', cls: 'bg-red-100 text-red-800 border-red-300' },
];
const todayIso = () => nepalDateString();

export default function AttendancePage() {
  const { addToast } = useToast();
  const { can, loading: permissionsLoading } = useCapabilities();
  const canManage = can('hrm.attendance.manage');
  const [date, setDate] = useState(todayIso());
  const [register, setRegister] = useState({ staff: [], holiday: null });
  const [statuses, setStatuses] = useState({});
  const [notes, setNotes] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async (d) => {
    setLoading(true);
    try {
      const data = await apiJson(`/api/admin/hrm/attendance?date=${d}`);
      setRegister(data);
      const nextStatuses = {};
      const nextNotes = {};
      for (const s of data.staff || []) {
        nextStatuses[s.user_id] = s.status || 'present';
        nextNotes[s.user_id] = s.note || '';
      }
      setStatuses(nextStatuses);
      setNotes(nextNotes);
    } catch (error) { addToast(friendlyFromError(error, 'load_failed')); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (!permissionsLoading && canManage) load(date); }, [date, permissionsLoading, canManage]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    const c = { present: 0, half_day: 0, leave: 0, absent: 0 };
    for (const status of Object.values(statuses)) if (c[status] != null) c[status] += 1;
    return c;
  }, [statuses]);

  const markAll = (status) => {
    const next = {};
    for (const s of register.staff || []) next[s.user_id] = status;
    setStatuses(next);
  };

  const save = async () => {
    setSaving(true);
    try {
      const entries = (register.staff || []).map((s) => ({ user_id: s.user_id, status: statuses[s.user_id] || 'present', note: notes[s.user_id] || '' }));
      const data = await apiJson('/api/admin/hrm/attendance', { method: 'POST', body: JSON.stringify({ business_date: date, entries }) });
      setRegister(data);
      addToast(friendlyMessage('save_success', { description: 'Attendance saved.' }));
    } catch (error) { addToast(friendlyFromError(error, 'save_failed')); }
    finally { setSaving(false); }
  };

  if (!permissionsLoading && !canManage) {
    return <AdminLayout><div className="p-8 text-sm text-gray-600">You do not have permission to view staff attendance.</div></AdminLayout>;
  }

  return (
    <AdminLayout>
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mx-auto w-full max-w-4xl">
          <div className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-800 sm:text-3xl">Attendance</h1>
              <p className="mt-1 text-gray-700">Daily staff attendance register.</p>
            </div>
            <DateInput value={date} max={todayIso()} onChange={setDate} className="h-11 rounded-lg border border-gray-300 px-3 text-gray-900" />
          </div>

          {register.holiday && (
            <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
              <strong>{register.holiday}</strong> is marked as a holiday on this date.
            </div>
          )}

          <div className="mb-4 flex flex-wrap items-center gap-2">
            {STATUSES.map((s) => (
              <button key={s.value} type="button" onClick={() => markAll(s.value)} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${s.cls}`}>
                Mark all {s.label} ({counts[s.value]})
              </button>
            ))}
          </div>

          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
            <table className="w-full">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Staff</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Status</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {(register.staff || []).map((s) => (
                  <tr key={s.user_id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <p className="font-medium text-gray-900">{s.full_name || s.username}</p>
                      <p className="text-xs text-gray-500">{[s.designation_name, s.department_name].filter(Boolean).join(' · ') || s.role}</p>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1.5">
                        {STATUSES.map((st) => (
                          <button
                            key={st.value}
                            type="button"
                            onClick={() => setStatuses((prev) => ({ ...prev, [s.user_id]: st.value }))}
                            className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${statuses[s.user_id] === st.value ? st.cls : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'}`}
                          >
                            {st.label}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <input
                        value={notes[s.user_id] || ''}
                        onChange={(e) => setNotes((prev) => ({ ...prev, [s.user_id]: e.target.value }))}
                        placeholder="optional note"
                        className="h-9 w-full rounded-lg border border-gray-200 px-2.5 text-sm text-gray-900"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && (register.staff || []).length === 0 && (
              <div className="py-12 text-center"><CalendarCheck2 className="mx-auto mb-4 h-12 w-12 text-gray-400" /><p className="text-gray-700">No active staff to mark.</p></div>
            )}
          </div>

          <div className="mt-5 flex justify-end">
            <button onClick={save} disabled={saving || loading || !(register.staff || []).length} className="flex items-center gap-2 rounded-lg bg-gray-900 px-6 py-3 text-white hover:bg-gray-800 disabled:opacity-50">
              <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save attendance'}
            </button>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
