'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { BanknoteArrowDown, Download, Search, WalletCards } from 'lucide-react';
import AdminLayout from '@/components/admin/admin-layout';
import PayrollDrawer from '@/components/employees/payroll-drawer';
import { KpiCards } from '@/components/admin/report-kit';
import { useToast } from '@/components/ui/toast';
import { friendlyFromError, friendlyMessage } from '@/lib/friendly-message';
import { apiJson } from '@/lib/authed-fetch';
import { useCapabilities } from '@/lib/use-capabilities';
import { toCsv } from '@/lib/csv';

const money = (value) => `Rs ${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function PayrollPage() {
  const pathname = usePathname();
  const isCashier = pathname?.startsWith('/cashier');
  const { can, loading: permissionsLoading } = useCapabilities();
  const { addToast } = useToast();
  const [data, setData] = useState({ employees: [], advances: [], payments: [] });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [onlyOutstanding, setOnlyOutstanding] = useState(false);
  const [selected, setSelected] = useState(null);
  const [selectedAction, setSelectedAction] = useState('salary');
  const [staffId, setStaffId] = useState('');

  const canView = can('payroll.view');
  const canGiveAdvance = can('payroll.advances.create');

  const openEmployee = (action) => {
    const employee = (data.employees || []).find((row) => String(row.id) === String(staffId));
    if (!employee) {
      addToast(friendlyMessage('validation', { description: 'Choose an employee from Staff first.' }));
      return;
    }
    setSelectedAction(action);
    setSelected(employee);
  };

  const load = async () => {
    setLoading(true);
    try {
      const result = await apiJson('/api/admin/payroll');
      setData(result);
    } catch (error) {
      addToast(friendlyFromError(error, 'load_failed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (permissionsLoading || !canView) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permissionsLoading, canView]);

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data.employees || []).filter((employee) => {
      if (onlyOutstanding && Number(employee.advance_outstanding || 0) <= 0) return false;
      return !query || `${employee.full_name || ''} ${employee.username || ''} ${employee.role || ''}`.toLowerCase().includes(query);
    });
  }, [data.employees, onlyOutstanding, search]);

  const totals = useMemo(() => (data.employees || []).reduce((result, employee) => ({
    advanced: result.advanced + Number(employee.total_advanced || 0),
    deducted: result.deducted + Number(employee.total_deducted || 0),
    outstanding: result.outstanding + Number(employee.advance_outstanding || 0),
    staffWithBalance: result.staffWithBalance + (Number(employee.advance_outstanding || 0) > 0 ? 1 : 0),
  }), { advanced: 0, deducted: 0, outstanding: 0, staffWithBalance: 0 }), [data.employees]);

  const exportAdvances = () => {
    const headers = ['Employee', 'Advance Date', 'Amount', 'Method', 'Given By', 'Note'];
    const csv = toCsv(headers, (data.advances || []).map((row) => ({
      Employee: row.employee_name || row.employee_username || '',
      'Advance Date': String(row.advanced_on || '').slice(0, 10),
      Amount: Number(row.amount || 0),
      Method: row.method || '',
      'Given By': row.given_by_name || '',
      Note: row.note || '',
    })));
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `salary-advances-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!permissionsLoading && !canView) {
    return <AdminLayout><div className="p-8 text-sm text-gray-600">You do not have permission to view salary and advances.</div></AdminLayout>;
  }

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Salary &amp; Advances</h1>
            <p className="mt-1 text-sm text-gray-500">See salary payments, advances, deductions and the amount each employee still owes.</p>
          </div>
          <button type="button" onClick={exportAdvances} disabled={!data.advances?.length} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">
            <Download className="h-4 w-4" /> Export advance report
          </button>
        </div>
      </header>

      <main className="space-y-5 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <label className="min-w-0 flex-1">
              <span className="mb-1.5 block text-sm font-semibold text-gray-800">Choose employee from Staff</span>
              <select value={staffId} onChange={(event) => setStaffId(event.target.value)} className="h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm text-gray-900">
                <option value="">Select an employee...</option>
                {(data.employees || []).map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.full_name || employee.username} - {employee.position || employee.role}{Number(employee.is_active) === 1 ? '' : ' (inactive)'}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-2">
              {!isCashier && (
                <button type="button" onClick={() => openEmployee('salary')} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 text-sm font-semibold text-white hover:bg-gray-800 hover:text-white">
                  <WalletCards className="h-4 w-4" /> Pay salary
                </button>
              )}
              {canGiveAdvance && (
                <button type="button" onClick={() => openEmployee('advance')} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50 hover:text-gray-900">
                  <BanknoteArrowDown className="h-4 w-4" /> Give advance
                </button>
              )}
            </div>
          </div>
          <p className="mt-2 text-xs text-gray-500">The selected employee&apos;s salary, outstanding advances and full payment history will open together.</p>
        </section>

        <KpiCards kpis={[
          { key: 'advanced', label: 'Total advanced', value: totals.advanced, format: 'currency', icon: 'wallet' },
          { key: 'deducted', label: 'Recovered in payroll', value: totals.deducted, format: 'currency', icon: 'positive' },
          { key: 'outstanding', label: 'Outstanding', value: totals.outstanding, format: 'currency', icon: 'warn' },
          { key: 'staff', label: 'Staff with balance', value: totals.staffWithBalance, format: 'number', icon: 'info' },
        ]} />

        <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="flex flex-col gap-3 border-b border-gray-200 p-4 sm:flex-row sm:items-center">
            <label className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} className="h-10 w-full rounded-lg border border-gray-300 pl-9 pr-3 text-sm" placeholder="Search employee…" />
            </label>
            <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-gray-300 px-3 text-sm text-gray-700">
              <input type="checkbox" checked={onlyOutstanding} onChange={(event) => setOnlyOutstanding(event.target.checked)} /> Outstanding only
            </label>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Employee</th>
                  <th className="px-5 py-3 font-semibold">Monthly salary</th>
                  <th className="px-5 py-3 text-right font-semibold">Total advanced</th>
                  <th className="px-5 py-3 text-right font-semibold">Deducted</th>
                  <th className="px-5 py-3 text-right font-semibold">Outstanding</th>
                  <th className="px-5 py-3 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((employee) => (
                  <tr key={employee.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3"><p className="font-medium text-gray-900">{employee.full_name || employee.username}</p><p className="text-xs capitalize text-gray-500">{employee.position || employee.role}</p></td>
                    <td className="px-5 py-3 text-gray-700">{employee.salary == null ? '—' : money(employee.salary)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{money(employee.total_advanced)}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-emerald-700">{money(employee.total_deducted)}</td>
                    <td className={`px-5 py-3 text-right font-semibold tabular-nums ${Number(employee.advance_outstanding) > 0 ? 'text-amber-700' : 'text-gray-400'}`}>{money(employee.advance_outstanding)}</td>
                    <td className="px-5 py-3 text-right"><button type="button" onClick={() => { setSelectedAction(isCashier ? 'advance' : 'salary'); setStaffId(String(employee.id)); setSelected(employee); }} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 active:scale-[0.98]">{canGiveAdvance ? <BanknoteArrowDown className="h-3.5 w-3.5" /> : <WalletCards className="h-3.5 w-3.5" />}{isCashier ? (canGiveAdvance ? 'View / advance' : 'View') : 'Manage'}</button></td>
                  </tr>
                ))}
                {!loading && rows.length === 0 && <tr><td colSpan={6} className="px-5 py-12 text-center text-gray-500">No employees match these filters.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {selected && <PayrollDrawer employee={selected} initialAction={selectedAction} onClose={() => { setSelected(null); load(); }} canRecordSalary={!isCashier} canGiveAdvance={canGiveAdvance} canDelete={!isCashier} />}
    </AdminLayout>
  );
}
