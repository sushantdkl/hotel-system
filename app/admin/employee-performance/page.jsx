'use client';

/**
 * Employee Performance — metrics the POS can honestly produce from real
 * activity (orders, bills, wastage). There is no attendance clock in the
 * system, so "active days" (distinct days an employee took an order) stands in
 * for attendance rather than inventing shift data.
 */

import { useEffect, useMemo, useState } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import { useToast } from '@/components/ui/toast';
import { friendlyFromError } from '@/lib/friendly-message';
import { apiJson } from '@/lib/authed-fetch';
import { KpiCards } from '@/components/admin/report-kit';
import { formatNepalDate } from '@/lib/time-utils';

const money = (n) => `Rs ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const ROLE_TONE = {
  admin: 'bg-gray-200 text-gray-800',
  waiter: 'bg-blue-100 text-blue-800',
  cashier: 'bg-teal-100 text-teal-800',
  kitchen: 'bg-orange-100 text-orange-800',
};

export default function EmployeePerformancePage() {
  const { addToast } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [roleFilter, setRoleFilter] = useState('all');

  useEffect(() => {
    (async () => {
      try {
        const data = await apiJson('/api/admin/employee-performance');
        setRows(data.performance || []);
      } catch (error) {
        addToast(friendlyFromError(error, 'load_failed'));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(
    () => (roleFilter === 'all' ? rows : rows.filter((r) => r.role === roleFilter)),
    [rows, roleFilter]
  );

  const totals = useMemo(
    () =>
      rows.reduce(
        (a, r) => ({
          sales: a.sales + r.sales,
          revenue: a.revenue + r.revenue,
          wastage: a.wastage + r.wastage_cost,
        }),
        { sales: 0, revenue: 0, wastage: 0 }
      ),
    [rows]
  );

  const topWaiter = useMemo(
    () => [...rows].filter((r) => r.orders_handled > 0).sort((a, b) => b.sales - a.sales)[0],
    [rows]
  );

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Employee Performance</h1>
            <p className="mt-1 text-sm text-gray-500">Orders, sales, billing and wastage per employee — from live POS data.</p>
          </div>
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="h-10 self-start rounded-lg border border-gray-300 px-3 text-sm text-gray-700">
            <option value="all">All roles</option>
            <option value="waiter">Waiters</option>
            <option value="cashier">Cashiers</option>
            <option value="kitchen">Kitchen</option>
            <option value="admin">Admins</option>
          </select>
        </div>
      </header>

      <div className="space-y-5 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <KpiCards
          kpis={[
            { key: 'staff', label: 'Employees', value: rows.length, format: 'number' },
            { key: 'sales', label: 'Waiter sales', value: totals.sales, format: 'currency' },
            { key: 'revenue', label: 'Cashier revenue', value: totals.revenue, format: 'currency' },
            { key: 'top', label: 'Top waiter', value: topWaiter?.full_name || '—', sub: topWaiter ? money(topWaiter.sales) : undefined },
          ]}
        />

        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Employee</th>
                  <th className="px-5 py-3 font-semibold">Role</th>
                  <th className="px-5 py-3 text-right font-semibold">Orders</th>
                  <th className="px-5 py-3 text-right font-semibold">Sales</th>
                  <th className="px-5 py-3 text-right font-semibold">Active days</th>
                  <th className="px-5 py-3 text-right font-semibold">Bills</th>
                  <th className="px-5 py-3 text-right font-semibold">Revenue</th>
                  <th className="px-5 py-3 text-right font-semibold">Wastage</th>
                  <th className="px-5 py-3 font-semibold">Last active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3">
                      <div className="font-medium text-gray-900">{r.full_name}</div>
                      {r.position && <div className="text-xs text-gray-500">{r.position}</div>}
                    </td>
                    <td className="px-5 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${ROLE_TONE[r.role] || 'bg-gray-100 text-gray-700'}`}>{r.role}</span></td>
                    <td className="px-5 py-3 text-right tabular-nums text-gray-900">{r.orders_handled}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-medium text-gray-900">{money(r.sales)}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-gray-600">{r.active_days}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-gray-900">{r.bills_settled}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-medium text-gray-900">{money(r.revenue)}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-gray-600">
                      {r.wastage_entries ? <span className="text-rose-700">{money(r.wastage_cost)}</span> : '—'}
                    </td>
                    <td className="px-5 py-3 text-gray-500">{r.last_order_at ? formatNepalDate(r.last_order_at) : '—'}</td>
                  </tr>
                ))}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={9} className="px-5 py-10 text-center text-gray-500">No employees to show.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="border-t border-gray-100 px-5 py-3 text-xs text-gray-400">
            Sales come from orders taken (waiter); revenue from paid bills (cashier); wastage from logged entries. Attendance is not tracked by the system — “Active days” counts distinct days an employee took an order.
          </p>
        </div>
      </div>
    </AdminLayout>
  );
}
