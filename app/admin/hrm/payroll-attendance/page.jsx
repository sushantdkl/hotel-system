'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AdminLayout from '@/components/admin/admin-layout';
import { apiJson } from '@/lib/authed-fetch';
import { ROLE_LABELS } from '@/lib/roles';
import { nepalDateString } from '@/lib/report-dates';

const money = (n) => `Rs ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function PayrollAttendancePage() {
  const [month, setMonth] = useState(nepalDateString(new Date()).slice(0, 7));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { setData(await apiJson(`/api/admin/hrm/payroll-attendance?month=${month}`)); setError(''); }
    catch (err) { setError(err.error || 'Could not build the summary.'); }
  }, [month]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  return (
    <AdminLayout>
      <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">Attendance payroll</h1>
            <p className="mt-1 max-w-3xl text-sm text-gray-500">Suggested pay from attendance. Paid days = present + half days ÷ 2 + approved leave; days with no attendance record are unpaid. Overtime (over {data?.standardDayHours ?? 8} h a day) is paid at the plain hourly rate. Record actual payments on the <Link href="/admin/payroll" className="underline">Payroll</Link> page.</p>
          </div>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </header>
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {data && <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500"><tr>{['Staff', 'Monthly salary', 'Present', 'Half', 'Leave', 'Absent', 'Paid days', 'Hours', 'OT h', 'Base pay', 'OT pay', 'Advance due', 'Suggested net'].map((h) => <th key={h} className="px-3 py-3">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-100">{data.rows.map((r) => <tr key={r.id} className="tabular-nums">
              <td className="px-3 py-2.5"><p className="font-semibold text-gray-950">{r.name}</p><p className="text-xs text-gray-500">{ROLE_LABELS[r.role] || r.role}</p></td>
              <td className="px-3 py-2.5">{r.salary ? money(r.salary) : <span className="text-gray-400">Not set</span>}</td>
              <td className="px-3 py-2.5">{r.present}</td><td className="px-3 py-2.5">{r.halfDay}</td><td className="px-3 py-2.5">{r.leave}</td><td className="px-3 py-2.5">{r.absent}</td>
              <td className="px-3 py-2.5 font-semibold">{r.paidDays} / {data.daysInMonth}</td><td className="px-3 py-2.5">{r.hours}</td><td className="px-3 py-2.5">{r.overtime}</td>
              <td className="px-3 py-2.5">{money(r.basePay)}</td><td className="px-3 py-2.5">{money(r.overtimePay)}</td><td className="px-3 py-2.5 text-rose-700">{r.advanceOutstanding ? `−${money(r.advanceOutstanding)}` : '—'}</td>
              <td className="px-3 py-2.5 font-bold text-gray-950">{money(r.suggestedNet)}</td>
            </tr>)}</tbody>
          </table></div>
        </section>}
      </div>
    </AdminLayout>
  );
}
