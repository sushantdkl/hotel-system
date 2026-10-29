'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, BedDouble, Check, ChefHat, ChevronDown, ConciergeBell, ChevronRight, History, Minus, RefreshCw, RotateCcw, Save, Search, ShieldCheck, UserCheck, UserCog, Users, X } from 'lucide-react';
import AdminLayout from '@/components/admin/admin-layout';
import { apiJson } from '@/lib/authed-fetch';
import { friendlyFromError, friendlyMessage } from '@/lib/friendly-message';
import { useToast } from '@/components/ui/toast';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useConfirm } from '@/components/ui/confirm';
import { formatNepalTime } from '@/lib/time-utils';
import { useCapabilities } from '@/lib/use-capabilities';

const ROLES = {
  cashier: { label: 'Cashier', description: 'Billing, customer service and day-to-day restaurant operations.', icon: UserCog, tone: 'bg-blue-600 text-white' },
  waiter: { label: 'Waiter', description: 'Table service, orders and guest-facing actions.', icon: Users, tone: 'bg-violet-600 text-white' },
  kitchen: { label: 'Kitchen', description: 'Kitchen tickets, preparation and stock visibility.', icon: ChefHat, tone: 'bg-amber-500 text-white' },
  receptionist: { label: 'Receptionist', description: 'Hotel front desk: reservations, check-in, guest folios and checkout.', icon: ConciergeBell, tone: 'bg-teal-600 text-white' },
  housekeeping: { label: 'Housekeeping', description: 'Hotel room cleaning, inspection and readiness.', icon: BedDouble, tone: 'bg-emerald-600 text-white' },
  maintenance: { label: 'Maintenance', description: 'Repair tickets and out-of-order rooms.', icon: UserCog, tone: 'bg-slate-600 text-white' },
  watchman: { label: 'Watchman / Security', description: 'Gate log, patrols, security emergencies and CCTV.', icon: ShieldCheck, tone: 'bg-stone-600 text-white' },
};

const PERMISSION_MODULES = [
  { id: 'dashboard', label: 'Dashboard', description: 'Dashboard, analytics and owner summaries.', matches: (key) => ['dashboard.view', 'analytics.view', 'summary.view'].includes(key) },
  { id: 'reports', label: 'Reports', description: 'Reports access and every individual report.', matches: (key) => key === 'reports.view' || key.startsWith('report.') },
  { id: 'menu', label: 'Menu', description: 'Menu setup, recipes, categories, offers and combos.', matches: (key) => key.startsWith('menu.') || key.startsWith('recipes.') || key.startsWith('promotions.') || key.startsWith('combos.') },
  { id: 'pos_orders', label: 'POS & Orders', description: 'POS access, order desk and order actions.', matches: (key) => key.startsWith('pos.') || key.startsWith('order_desk.') || key.startsWith('orders.') },
  { id: 'billing', label: 'Billing', description: 'Bills, checkout, receipts, refunds and credit actions.', matches: (key) => key.startsWith('bills.') || key.startsWith('credit.') },
  { id: 'operations', label: 'Operations', description: 'Tables, KOTs, reservations, delivery and service tools.', matches: (key) => key.startsWith('tables.') || key.startsWith('kots.') || key.startsWith('kot_history.') || key.startsWith('delivery.') || key.startsWith('waiter_calls.') || key.startsWith('online_orders.') || key.startsWith('reservations.') || key === 'reviews.access' || key.startsWith('host_desk.') || key.startsWith('kitchen_analytics.') || key.startsWith('payments.') },
  { id: 'inventory', label: 'Inventory', description: 'Stock, movements, purchases, suppliers and wastage.', matches: (key) => key.startsWith('inventory.') || key.startsWith('purchases.') || key.startsWith('suppliers.') || key.startsWith('wastage.') },
  { id: 'customers', label: 'Customers', description: 'Customer records and customer ledger access.', matches: (key) => key.startsWith('customers.') || key.startsWith('customer_ledger.') },
  { id: 'finance', label: 'Finance & Accounting', description: 'Expenses, cash, opening/closing, ledgers and banking.', matches: (key) => key.startsWith('expenses.') || key.startsWith('expense_categories.') || key.startsWith('business_funding.') || key.startsWith('savings.') || key.startsWith('cash_') || key.startsWith('business_days.') || key.startsWith('corrections.') || key.startsWith('general_ledger.') || key.startsWith('finance_dashboard.') || key.startsWith('chart_of_accounts.') || key.startsWith('bank') || key.startsWith('financial_reports.') || key.startsWith('supplier_ledger.') },
  { id: 'hrm', label: 'HRM & Payroll', description: 'Staff, attendance, departments, holidays and payroll.', matches: (key) => key.startsWith('hrm.') || key.startsWith('employees.') || key.startsWith('employee_performance.') || key.startsWith('payroll.') },
  { id: 'administration', label: 'Administration', description: 'Website, settings, verification and review management.', matches: (key) => key.startsWith('cms.') || key.startsWith('settings.') || key.startsWith('cancellation_verifications.') || key === 'reviews.manage' },
  { id: 'cctv', label: 'CCTV', description: 'Live cameras and PTZ control.', matches: (key) => key.startsWith('cctv.') },
  { id: 'hotel', label: 'Hotel', description: 'Front desk, guest folios, housekeeping and hotel setup.', matches: (key) => key.startsWith('hotel.') },
  { id: 'other', label: 'Other', description: 'Additional access controls.', matches: () => true },
];

function moduleForPermission(item) {
  return PERMISSION_MODULES.find((section) => section.matches(item.key)) || PERMISSION_MODULES.at(-1);
}

export default function PermissionsPage() {
  const { addToast } = useToast();
  const [data, setData] = useState(null);
  const [audit, setAudit] = useState([]);
  const [view, setView] = useState('permissions');
  const [activeRole, setActiveRole] = useState('cashier');
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [newRole, setNewRole] = useState(null); // { label, baseRole } while the dialog is open
  const { confirm } = useConfirm();
  const { role: myRole } = useCapabilities();
  const [expanded, setExpanded] = useState({ dashboard: true, reports: true, menu: true });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await apiJson('/api/admin/permissions'));
      setPending({});
    } catch (error) {
      addToast(friendlyFromError(error, 'load_failed'));
    } finally { setLoading(false); }
  }, [addToast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (new URLSearchParams(window.location.search).get('user')) void Promise.resolve().then(() => setView('staff')); }, []);

  const openHistory = async () => {
    setView('history');
    if (audit.length) return;
    setAuditLoading(true);
    try {
      const result = await apiJson('/api/admin/permissions?view=audit');
      setAudit(result.audit || []);
    } catch (error) {
      addToast(friendlyFromError(error, 'load_failed'));
    } finally { setAuditLoading(false); }
  };

  const baseValue = (role, key) => Boolean(data?.matrix?.[role]?.[key]);
  const valueFor = (role, key) => {
    const id = `${role}:${key}`;
    return id in pending ? pending[id] : baseValue(role, key);
  };
  const setValue = (role, key, allowed) => {
    const id = `${role}:${key}`;
    setPending((current) => {
      const next = { ...current };
      if (allowed === baseValue(role, key)) delete next[id];
      else next[id] = allowed;
      return next;
    });
  };

  // A custom role offers the permissions of the built-in role it was created from.
  const customMeta = useMemo(() => new Map((data?.customRoles || []).map((r) => [r.key, r])), [data]);
  const baseRole = data?.roleBase?.[activeRole] || activeRole;
  const readOnly = myRole === 'manager' && !customMeta.has(activeRole);
  const availableForRole = useMemo(() => (data?.catalog || []).filter((item) => !item.roles || item.roles.includes(baseRole)), [data, baseRole]);
  const roleAction = async (body, message) => {
    setSaving(true);
    try {
      const result = await apiJson('/api/admin/permissions', { method: 'POST', body: JSON.stringify(body) });
      setData(result);
      setPending({});
      if (result.key) setActiveRole(result.key);
      else if (body.action === 'delete_role') setActiveRole('cashier');
      addToast(friendlyMessage('save_success', { description: message || result.message }));
      return true;
    } catch (error) {
      addToast(friendlyFromError(error, 'save_failed'));
      return false;
    } finally { setSaving(false); }
  };
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return availableForRole;
    return availableForRole.filter((item) => `${item.label} ${item.description} ${item.category}`.toLowerCase().includes(needle));
  }, [availableForRole, query]);
  const grouped = useMemo(() => {
    const groups = new Map();
    for (const item of filtered) {
      const section = moduleForPermission(item);
      if (!groups.has(section.id)) groups.set(section.id, { section, items: [] });
      groups.get(section.id).items.push(item);
    }
    return PERMISSION_MODULES.map((section) => groups.get(section.id)).filter(Boolean);
  }, [filtered]);
  const dirtyEntries = Object.entries(pending);
  const roleDirtyCount = dirtyEntries.filter(([id]) => id.startsWith(`${activeRole}:`)).length;
  const allowedCount = availableForRole.filter((item) => valueFor(activeRole, item.key)).length;

  const setAllForRole = (allowed) => {
    setPending((current) => {
      const next = { ...current };
      for (const item of availableForRole) {
        const id = `${activeRole}:${item.key}`;
        if (allowed === baseValue(activeRole, item.key)) delete next[id];
        else next[id] = allowed;
      }
      return next;
    });
  };

  const setModuleForRole = (items, allowed) => {
    setPending((current) => {
      const next = { ...current };
      for (const item of items) {
        const id = `${activeRole}:${item.key}`;
        if (allowed === baseValue(activeRole, item.key)) delete next[id];
        else next[id] = allowed;
      }
      return next;
    });
  };

  const save = async () => {
    if (!dirtyEntries.length) return;
    setSaving(true);
    try {
      const updates = dirtyEntries.map(([id, allowed]) => {
        const separator = id.indexOf(':');
        return { role: id.slice(0, separator), key: id.slice(separator + 1), allowed };
      });
      const result = await apiJson('/api/admin/permissions', { method: 'PUT', body: JSON.stringify({ updates }) });
      setData(result);
      setPending({});
      setAudit([]);
      addToast(friendlyMessage('save_success', { description: `${updates.length} permission${updates.length === 1 ? '' : 's'} updated.` }));
    } catch (error) {
      addToast(friendlyFromError(error, 'save_failed'));
    } finally { setSaving(false); }
  };

  const catalogByKey = useMemo(() => new Map((data?.catalog || []).map((item) => [item.key, item])), [data]);
  const roleInfo = customMeta.has(activeRole)
    ? { label: customMeta.get(activeRole).label, description: `Custom role based on ${ROLES[baseRole]?.label || baseRole}. Staff with this role use the ${ROLES[baseRole]?.label || baseRole} screens.`, icon: UserCog, tone: 'bg-gray-800 text-white' }
    : ROLES[activeRole] || ROLES.cashier;
  const RoleIcon = roleInfo.icon;

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gray-950 text-white shadow-sm"><ShieldCheck className="h-5 w-5" /></div>
            <div><h1 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">Staff permissions</h1><p className="mt-1 max-w-2xl text-sm text-gray-500">Set access for a whole role, or allow and block any permission for one staff member. The owner and managers always keep full access.</p></div>
          </div>
          <div className="flex rounded-xl border border-gray-200 bg-gray-50 p-1">
            <TopTab active={view === 'permissions'} onClick={() => setView('permissions')} icon={ShieldCheck}>By role</TopTab>
            <TopTab active={view === 'staff'} onClick={() => setView('staff')} icon={UserCheck}>By staff member</TopTab>
            <TopTab active={view === 'history'} onClick={openHistory} icon={History}>Change history</TopTab>
          </div>
        </div>
      </header>

      <main className={`min-h-[calc(100vh-10rem)] bg-gray-50 px-4 py-6 sm:px-6 lg:px-8 ${dirtyEntries.length ? 'pb-32' : ''}`}>
        <div className="mx-auto max-w-7xl">
          {loading ? <PermissionsSkeleton /> : view === 'history' ? (
            <HistoryView rows={audit} loading={auditLoading} catalogByKey={catalogByKey} onBack={() => setView('permissions')} />
          ) : view === 'staff' ? (
            <StaffView customMeta={customMeta} onSaved={() => setAudit([])} />
          ) : (
            <>
              <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                <div className="border-b border-gray-200 px-4 pt-4 sm:px-5">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-gray-400">Editing role</p>
                  <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Staff role">
                    {(data?.roles || []).map((role) => {
                      const info = customMeta.has(role) ? { label: customMeta.get(role).label, icon: UserCog } : ROLES[role] || { label: role, icon: Users };
                      const Icon = info.icon;
                      const changed = dirtyEntries.filter(([id]) => id.startsWith(`${role}:`)).length;
                      const active = activeRole === role;
                      return <button key={role} type="button" role="tab" aria-selected={active} onClick={() => { setActiveRole(role); setQuery(''); }} className={`relative inline-flex min-w-max items-center gap-2 rounded-t-lg border-b-2 px-4 py-3 text-sm font-semibold transition-[color,border-color,background-color,transform] duration-150 ease-out active:scale-[0.97] ${active ? 'border-gray-950 bg-gray-50 text-gray-950' : 'border-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-800'}`}><Icon className="h-4 w-4" /> {info.label}{changed > 0 && <span className="min-w-5 rounded-full bg-amber-100 px-1.5 py-0.5 text-center text-[10px] font-bold text-amber-800">{changed}</span>}</button>;
                    })}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-gray-50 px-4 py-3 sm:px-5">
                  <button type="button" disabled={saving} onClick={() => setNewRole({ label: '', baseRole: 'waiter' })} className="h-9 rounded-lg bg-gray-950 px-3 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-40">New custom role</button>
                  {customMeta.has(activeRole) && <button type="button" disabled={saving || customMeta.get(activeRole).users > 0} title={customMeta.get(activeRole).users ? 'Move its staff to another role first' : ''} onClick={async () => { const r = customMeta.get(activeRole); if (await confirm({ title: `Delete ${r.label}?`, message: 'The role and its permission settings are removed. This cannot be undone.', confirmLabel: 'Delete role', tone: 'delete' })) await roleAction({ action: 'delete_role', key: activeRole }); }} className="ml-auto h-9 rounded-lg border border-rose-200 bg-white px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-40">Delete {customMeta.get(activeRole).label}{customMeta.get(activeRole).users ? ` (${customMeta.get(activeRole).users} staff)` : ''}</button>}
                </div>
                <Dialog open={Boolean(newRole)} onOpenChange={(open) => { if (!open) setNewRole(null); }}><DialogContent onClose={() => setNewRole(null)} className="sm:max-w-lg">
                  <DialogHeader><DialogTitle>New custom role</DialogTitle><DialogDescription>Staff with this role use the screens of the role it starts from. Pick its permissions after creating it.</DialogDescription></DialogHeader>
                  {newRole && <form className="mt-6 space-y-4" onSubmit={async (event) => { event.preventDefault(); if (!newRole.label.trim()) return; if (await roleAction({ action: 'create_role', ...newRole })) setNewRole(null); }}>
                    <label className="block text-sm font-medium text-gray-700">Role name<input autoFocus required value={newRole.label} onChange={(e) => setNewRole({ ...newRole, label: e.target.value })} maxLength={40} placeholder="e.g. Bellboy, Accountant" className="mt-1 block h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900" /></label>
                    <label className="block text-sm font-medium text-gray-700">Start from<select value={newRole.baseRole} onChange={(e) => setNewRole({ ...newRole, baseRole: e.target.value })} className="mt-1 block h-11 w-full rounded-lg border border-gray-300 bg-white px-2 text-sm text-gray-900">{(data?.roles || []).filter((r) => !customMeta.has(r)).map((r) => <option key={r} value={r}>{ROLES[r]?.label || r}</option>)}</select></label>
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => setNewRole(null)} className="h-10 rounded-lg border border-gray-300 px-4 text-sm font-semibold text-gray-700">Cancel</button>
                      <button disabled={saving || !newRole.label.trim()} className="h-10 rounded-lg bg-gray-950 px-4 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-40">{saving ? 'Creating…' : 'Create role'}</button>
                    </div>
                  </form>}
                </DialogContent></Dialog>
                {readOnly && <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 sm:px-5">Built-in roles can only be changed by the owner. Create a custom role to adjust access.</p>}
                <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[1fr_auto] lg:items-center">
                  <div className="flex min-w-0 items-center gap-3"><div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${roleInfo.tone}`}><RoleIcon className="h-5 w-5" /></div><div className="min-w-0"><h2 className="font-bold text-gray-950">{roleInfo.label} access</h2><p className="mt-0.5 text-sm text-gray-500">{roleInfo.description}</p></div></div>
                  <div className="grid grid-cols-3 divide-x divide-gray-200 rounded-xl border border-gray-200 bg-gray-50"><Stat label="Allowed" value={allowedCount} tone="text-emerald-700" /><Stat label="Blocked" value={availableForRole.length - allowedCount} tone="text-rose-700" /><Stat label="Available" value={availableForRole.length} tone="text-gray-900" /></div>
                </div>
              </section>

              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
                <label className="relative block min-w-0 flex-1"><Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${roleInfo.label.toLowerCase()} permissions…`} className="h-11 w-full rounded-xl border border-gray-300 bg-white pl-10 pr-10 text-sm text-gray-900 outline-none transition-[border-color,box-shadow] duration-150 focus:border-gray-500 focus:ring-4 focus:ring-gray-200/70" />{query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 active:scale-[0.97]"><X className="h-4 w-4" /></button>}</label>
                <div className="flex gap-2"><button type="button" onClick={() => setAllForRole(true)} className="inline-flex h-11 items-center gap-2 rounded-xl border border-gray-300 bg-white px-3.5 text-sm font-semibold text-gray-700 transition-[background-color,transform] duration-150 ease-out hover:bg-gray-50 active:scale-[0.97]"><Check className="h-4 w-4 text-emerald-600" /> Allow all</button><button type="button" onClick={() => setAllForRole(false)} className="inline-flex h-11 items-center gap-2 rounded-xl border border-gray-300 bg-white px-3.5 text-sm font-semibold text-gray-700 transition-[background-color,transform] duration-150 ease-out hover:bg-gray-50 active:scale-[0.97]"><Ban className="h-4 w-4 text-rose-600" /> Block all</button><button type="button" onClick={load} disabled={dirtyEntries.length > 0} title={dirtyEntries.length ? 'Save or discard changes before reloading' : 'Reload saved permissions'} aria-label="Reload saved permissions" className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-gray-300 bg-white text-gray-600 transition-[background-color,transform] duration-150 ease-out hover:bg-gray-50 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"><RefreshCw className="h-4 w-4" /></button></div>
              </div>

              <div className="mt-5 space-y-3">
                {grouped.map(({ section, items }) => {
                  const allowed = items.filter((item) => valueFor(activeRole, item.key)).length;
                  const allAllowed = allowed === items.length;
                  const mixed = allowed > 0 && !allAllowed;
                  const isOpen = Boolean(query.trim()) || expanded[section.id];
                  return <section key={section.id} className={`overflow-hidden rounded-2xl border bg-white shadow-sm transition-colors ${mixed ? 'border-amber-200' : allAllowed ? 'border-emerald-200' : 'border-gray-200'}`}>
                    <div className="flex flex-col gap-3 bg-gray-50/80 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                      <button type="button" onClick={() => setExpanded((current) => ({ ...current, [section.id]: !current[section.id] }))} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500">{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span>
                        <span className="min-w-0"><span className="block text-base font-bold text-gray-950">{section.label}</span><span className="mt-0.5 block text-xs text-gray-500">{section.description}</span></span>
                      </button>
                      <div className="flex items-center justify-between gap-3 sm:justify-end"><span className="whitespace-nowrap text-xs font-semibold tabular-nums text-gray-500">{allowed} of {items.length} allowed</span><ModuleToggle checked={allAllowed} mixed={mixed} onChange={() => setModuleForRole(items, !allAllowed)} label={section.label} /></div>
                    </div>
                    {isOpen && <div className="divide-y divide-gray-100 border-t border-gray-200">{items.map((item) => { const allowedNow = valueFor(activeRole, item.key); const changed = `${activeRole}:${item.key}` in pending; return <div key={item.key} className={`flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-5 ${changed ? 'bg-amber-50/50' : ''}`}><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h4 className="text-sm font-semibold text-gray-950">{item.label}</h4>{changed && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">Changed</span>}</div><p className="mt-1 max-w-3xl text-sm leading-5 text-gray-500">{item.description}</p></div><PermissionToggle checked={allowedNow} onChange={(next) => setValue(activeRole, item.key, next)} label={item.label} /></div>; })}</div>}
                  </section>;
                })}
                {!grouped.length && <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-14 text-center"><Search className="mx-auto h-6 w-6 text-gray-300" /><p className="mt-3 text-sm font-semibold text-gray-800">No permissions match “{query}”</p><button type="button" onClick={() => setQuery('')} className="mt-2 text-sm font-semibold text-blue-700 hover:text-blue-900">Clear search</button></div>}
              </div>

              {dirtyEntries.length > 0 && <div className="fixed bottom-4 left-1/2 z-[70] flex w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 flex-col gap-3 rounded-2xl border border-gray-700 bg-gray-950 p-3 text-white shadow-2xl shadow-gray-950/30 sm:flex-row sm:items-center sm:justify-between sm:px-4"><div className="flex items-center gap-3"><span className="flex h-9 min-w-9 items-center justify-center rounded-lg bg-amber-400 px-2 text-sm font-black text-gray-950">{dirtyEntries.length}</span><div><p className="text-sm font-semibold">Unsaved permission changes</p><p className="text-xs text-gray-400">{roleDirtyCount} affect the {roleInfo.label.toLowerCase()} role.</p></div></div><div className="flex gap-2"><button type="button" disabled={saving} onClick={() => setPending({})} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold text-gray-300 transition-[background-color,transform] duration-150 ease-out hover:bg-white/10 active:scale-[0.97] disabled:opacity-50 sm:flex-none"><RotateCcw className="h-4 w-4" /> Discard</button><button type="button" disabled={saving} onClick={save} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-white px-4 text-sm font-bold text-gray-950 transition-[background-color,transform] duration-150 ease-out hover:bg-gray-100 active:scale-[0.97] disabled:opacity-50 sm:flex-none"><Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save changes'}</button></div></div>}
            </>
          )}
        </div>
      </main>
    </AdminLayout>
  );
}

const OVERRIDE_OPTIONS = [['role', 'Role default'], ['allow', 'Allow'], ['block', 'Block']];
const overrideValue = (p) => (p.override == null ? 'role' : p.override ? 'allow' : 'block');

// Per-person overrides: any permission in the catalog, on top of the person's role.
function StaffView({ customMeta, onSaved }) {
  const { addToast } = useToast();
  const { confirm } = useConfirm();
  const [staff, setStaff] = useState(null);
  const [userId, setUserId] = useState(() => (typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('user') || ''));
  const [detail, setDetail] = useState(null);
  const [pending, setPending] = useState({});
  const [query, setQuery] = useState('');
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { apiJson('/api/admin/permissions?view=staff').then((r) => setStaff(r.staff || [])).catch((error) => addToast(friendlyFromError(error, 'load_failed'))); }, [addToast]);
  useEffect(() => {
    if (!userId) return undefined;
    let live = true;
    apiJson(`/api/admin/permissions?userId=${encodeURIComponent(userId)}`).then((r) => { if (live) { setDetail(r); setPending({}); } }).catch((error) => addToast(friendlyFromError(error, 'load_failed')));
    return () => { live = false; };
  }, [userId, addToast]);
  const stateOf = (key) => (key in pending ? pending[key] : overrideValue(detail.permissions[key]));
  const effective = (key) => { const v = stateOf(key); return v === 'role' ? detail.permissions[key].role : v === 'allow'; };
  const choose = (key, value) => setPending((current) => {
    const next = { ...current };
    if (value === overrideValue(detail.permissions[key])) delete next[key]; else next[key] = value;
    return next;
  });
  const needle = query.trim().toLowerCase();
  const items = (detail?.catalog || []).filter((item) => (!onlyChanged || stateOf(item.key) !== 'role') && `${item.label} ${item.description} ${item.category}`.toLowerCase().includes(needle));
  const groups = PERMISSION_MODULES.map((section) => ({ section, items: items.filter((item) => moduleForPermission(item) === section) })).filter((g) => g.items.length);
  const save = async () => {
    setSaving(true);
    try {
      const result = await apiJson('/api/admin/permissions', { method: 'PUT', body: JSON.stringify({ userId, updates: Object.entries(pending).map(([key, value]) => ({ key, value })) }) });
      setDetail(result); setPending({}); onSaved();
      const count = Object.values(result.permissions).filter((p) => p.override != null).length;
      setStaff((list) => list.map((u) => (String(u.id) === String(userId) ? { ...u, overrides: count } : u)));
      addToast(friendlyMessage('save_success', { description: result.message }));
    } catch (error) { addToast(friendlyFromError(error, 'save_failed')); } finally { setSaving(false); }
  };
  const roleLabel = (u) => customMeta.get(u.custom_role || u.customRole)?.label || ROLES[u.role]?.label || u.role;
  const dirty = Object.keys(pending).length;
  return <div className="space-y-5">
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
      <label className="block text-sm font-semibold text-gray-800">Staff member
        <select value={userId} onChange={async (e) => { const next = e.target.value; if (!dirty || await confirm({ title: 'Discard unsaved changes?', message: `${dirty} change${dirty === 1 ? '' : 's'} for ${detail?.user.name} will be lost.`, confirmLabel: 'Discard', tone: 'warning' })) { setUserId(next); setDetail(null); } }} className="mt-1 block h-11 w-full max-w-md rounded-xl border border-gray-300 bg-white px-3 text-sm text-gray-900">
          <option value="">Choose a staff member</option>
          {(staff || []).map((u) => <option key={u.id} value={u.id}>{u.full_name || u.username} · {roleLabel(u)}{Number(u.overrides) ? ` · ${u.overrides} personal` : ''}</option>)}
        </select>
      </label>
      <p className="mt-2 text-sm text-gray-500">Role default follows the person’s role. Allow or Block applies to this person only and wins over the role. Which app and screens they open still follows their role (a waiter keeps the waiter app). Job titles are the designation on the staff profile.</p>
    </section>
    {userId && !detail && <PermissionsSkeleton />}
    {detail && <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative block min-w-0 flex-1"><Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search permissions for ${detail.user.name}…`} className="h-11 w-full rounded-xl border border-gray-300 bg-white pl-10 pr-3 text-sm text-gray-900" /></label>
        <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700"><input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} /> Only personal changes</label>
      </div>
      {groups.map(({ section, items: rows }) => <section key={section.id} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="bg-gray-50/80 px-4 py-3 sm:px-5"><h3 className="text-base font-bold text-gray-950">{section.label}</h3><p className="text-xs text-gray-500">{section.description}</p></div>
        <div className="divide-y divide-gray-100 border-t border-gray-200">{rows.map((item) => { const value = stateOf(item.key); const on = effective(item.key); return <div key={item.key} className={`flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:px-5 ${item.key in pending ? 'bg-amber-50/50' : ''}`}>
          <div className="min-w-0 flex-1"><h4 className="text-sm font-semibold text-gray-950">{item.label}</h4><p className="mt-0.5 text-sm text-gray-500">{item.description}</p><p className={`mt-1 text-xs font-semibold ${on ? 'text-emerald-700' : 'text-gray-500'}`}>{on ? 'Has access' : 'No access'}{value === 'role' ? ` · from role (${roleLabel(detail.user)})` : ' · set for this person'}</p></div>
          <div role="radiogroup" aria-label={item.label} className="inline-flex shrink-0 rounded-xl border border-gray-200 bg-gray-50 p-1">{OVERRIDE_OPTIONS.map(([v, label]) => <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => choose(item.key, v)} className={`h-8 rounded-lg px-3 text-xs font-bold ${value === v ? (v === 'allow' ? 'bg-emerald-600 text-white' : v === 'block' ? 'bg-rose-600 text-white' : 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200') : 'text-gray-500 hover:text-gray-800'}`}>{label}</button>)}</div>
        </div>; })}</div>
      </section>)}
      {!groups.length && <p className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center text-sm text-gray-500">No permissions match.</p>}
      {dirty > 0 && <div className="fixed bottom-4 left-1/2 z-[70] flex w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 items-center justify-between gap-3 rounded-2xl bg-gray-950 p-3 text-white shadow-2xl sm:px-4"><p className="text-sm font-semibold">{dirty} unsaved change{dirty === 1 ? '' : 's'} for {detail.user.name}</p><div className="flex gap-2"><button type="button" disabled={saving} onClick={() => setPending({})} className="h-10 rounded-lg px-3 text-sm font-semibold text-gray-300 hover:bg-white/10">Discard</button><button type="button" disabled={saving} onClick={save} className="h-10 rounded-lg bg-white px-4 text-sm font-bold text-gray-950 hover:bg-gray-100">{saving ? 'Saving…' : 'Save changes'}</button></div></div>}
    </>}
  </div>;
}

function TopTab({ active, onClick, icon: Icon, children }) {
  return <button type="button" onClick={onClick} className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97] ${active ? 'bg-white text-gray-950 shadow-sm ring-1 ring-gray-200' : 'text-gray-500 hover:text-gray-800'}`}><Icon className="h-4 w-4" />{children}</button>;
}
function Stat({ label, value, tone }) {
  return <div className="min-w-20 px-3 py-2.5 text-center"><p className={`text-lg font-black tabular-nums ${tone}`}>{value}</p><p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</p></div>;
}
function PermissionToggle({ checked, onChange, label }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={`${checked ? 'Block' : 'Allow'} ${label}`} onClick={() => onChange(!checked)} className={`inline-flex h-10 w-full shrink-0 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-bold transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.97] sm:w-28 ${checked ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100' : 'border-gray-200 bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{checked ? <Check className="h-4 w-4" /> : <Ban className="h-4 w-4" />}{checked ? 'Allowed' : 'Blocked'}</button>;
}
function ModuleToggle({ checked, mixed, onChange, label }) {
  const stateLabel = checked ? 'All on' : mixed ? 'Mixed' : 'All off';
  return <button type="button" role="checkbox" aria-checked={mixed ? 'mixed' : checked} aria-label={`${stateLabel} for ${label}. Click to ${checked ? 'turn all off' : 'turn all on'}.`} onClick={onChange} className={`inline-flex h-10 min-w-28 shrink-0 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-bold transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.97] ${checked ? 'border-emerald-300 bg-emerald-100 text-emerald-800 hover:bg-emerald-200' : mixed ? 'border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-200' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-100'}`}><span className={`flex h-5 w-5 items-center justify-center rounded border ${checked ? 'border-emerald-600 bg-emerald-600 text-white' : mixed ? 'border-amber-500 bg-amber-500 text-white' : 'border-gray-400 bg-white'}`}>{checked ? <Check className="h-3.5 w-3.5" /> : mixed ? <Minus className="h-3.5 w-3.5" /> : null}</span>{stateLabel}</button>;
}
function HistoryView({ rows, loading, catalogByKey, onBack }) {
  return <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-4 sm:px-5"><div><h2 className="font-bold text-gray-950">Permission change history</h2><p className="mt-0.5 text-sm text-gray-500">A permanent record of who changed staff access and when.</p></div><button type="button" onClick={onBack} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 transition-[background-color,transform] duration-150 ease-out hover:bg-gray-50 active:scale-[0.97]">Back to permissions</button></div>{loading ? <div className="h-52 animate-pulse bg-gray-50" /> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500"><tr>{['When', 'Role', 'Permission', 'Change', 'Changed by'].map((heading) => <th key={heading} className="px-4 py-3 font-semibold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-gray-100">{rows.map((row) => { const item = catalogByKey.get(row.permission_key); return <tr key={row.id} className="hover:bg-gray-50/70"><td className="whitespace-nowrap px-4 py-3 text-gray-500">{formatNepalTime(row.created_at)}</td><td className="px-4 py-3 font-semibold text-gray-800">{row.role.startsWith('user:') ? `Staff #${row.role.slice(5)}` : ROLES[row.role]?.label || row.role}</td><td className="px-4 py-3"><p className="font-medium text-gray-950">{item?.label || row.permission_key}</p><p className="mt-0.5 text-xs text-gray-400">{item?.category}</p></td><td className="px-4 py-3"><span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${row.new_value ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{row.new_value ? <Check className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}{row.new_value ? 'Allowed' : 'Blocked'}</span></td><td className="px-4 py-3 text-gray-600">{row.actor_name || 'Administrator'}</td></tr>; })}{!rows.length && <tr><td colSpan={5} className="px-6 py-14 text-center text-gray-500">No permission changes have been recorded yet.</td></tr>}</tbody></table></div>}</section>;
}
function PermissionsSkeleton() {
  return <div className="space-y-5"><div className="h-48 animate-pulse rounded-2xl border border-gray-200 bg-white" /><div className="h-11 animate-pulse rounded-xl bg-gray-200" /><div className="h-72 animate-pulse rounded-2xl border border-gray-200 bg-white" /></div>;
}
