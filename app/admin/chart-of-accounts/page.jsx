'use client';

import { useEffect, useMemo, useState } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import { Plus, Pencil, Trash2, Lock } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import { apiJson } from '@/lib/authed-fetch';
import { money } from '@/components/accounting/ledger-table';

const TYPES = ['asset', 'liability', 'equity', 'income', 'expense'];
const TYPE_TONE = {
  asset: 'bg-blue-100 text-blue-800',
  liability: 'bg-amber-100 text-amber-800',
  equity: 'bg-purple-100 text-purple-800',
  income: 'bg-emerald-100 text-emerald-800',
  expense: 'bg-rose-100 text-rose-800',
};

export default function ChartOfAccountsPage() {
  const { addToast } = useToast();
  const { confirm } = useConfirm();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('all');
  const [modal, setModal] = useState(null); // account | {} | null

  const load = async () => {
    try {
      const data = await apiJson('/api/admin/accounts');
      setAccounts(data.accounts || []);
    } catch (error) {
      addToast(friendlyFromError(error, 'load_failed'));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const rows = useMemo(
    () => (typeFilter === 'all' ? accounts : accounts.filter((a) => a.type === typeFilter)),
    [accounts, typeFilter]
  );

  const remove = async (a) => {
    const ok = await confirm({
      title: `Delete account ${a.code}?`,
      message: `Delete account ${a.code} ${a.name}?`,
      tone: 'delete',
    });
    if (!ok) return;
    try { await apiJson(`/api/admin/accounts?id=${a.id}`, { method: 'DELETE' }); load(); }
    catch (error) { addToast(friendlyFromError(error, 'delete_failed')); }
  };

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Chart of Accounts</h1>
            <p className="mt-1 text-sm text-gray-500">Every account the ledger posts to. System accounts drive the engine and cannot be deleted.</p>
          </div>
          <button onClick={() => setModal({})} className="inline-flex items-center gap-1.5 self-start rounded-xl bg-gray-900 px-3.5 py-2.5 text-sm font-semibold text-white hover:bg-gray-800">
            <Plus className="h-4 w-4" /> New account
          </button>
        </div>
      </header>

      <div className="space-y-5 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="flex flex-wrap gap-2">
          {['all', ...TYPES].map((t) => (
            <button key={t} onClick={() => setTypeFilter(t)} className={`rounded-full border px-3 py-1.5 text-sm font-medium capitalize ${typeFilter === t ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
              {t === 'all' ? 'All' : t}
            </button>
          ))}
        </div>

        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Code</th>
                  <th className="px-4 py-3 font-semibold">Account</th>
                  <th className="px-4 py-3 font-semibold">Type</th>
                  <th className="px-4 py-3 text-right font-semibold">Balance</th>
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((a) => (
                  <tr key={a.id} className={`hover:bg-gray-50 ${!a.parent_id ? 'bg-gray-50/40 font-semibold' : ''}`}>
                    <td className="px-4 py-2.5 tabular-nums text-gray-500">{a.code}</td>
                    <td className="px-4 py-2.5 text-gray-900">
                      {a.parent_id && <span className="text-gray-300">— </span>}{a.name}
                      {Number(a.is_system) === 1 && <Lock className="ml-1.5 inline h-3 w-3 text-gray-400" />}
                    </td>
                    <td className="px-4 py-2.5"><span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${TYPE_TONE[a.type]}`}>{a.type}</span></td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-900">{money(a.balance)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setModal(a)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-900"><Pencil className="h-4 w-4" /></button>
                        {Number(a.is_system) !== 1 && (
                          <button onClick={() => remove(a)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && rows.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-500">No accounts.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {modal && <AccountModal account={modal.id ? modal : null} accounts={accounts} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} addToast={addToast} />}
    </AdminLayout>
  );
}

function AccountModal({ account, accounts, onClose, onSaved, addToast }) {
  const editing = Boolean(account?.id);
  const isSystem = Number(account?.is_system) === 1;
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    code: account?.code || '',
    name: account?.name || '',
    type: account?.type || 'asset',
    subtype: account?.subtype || '',
    parent_id: account?.parent_id || '',
    is_active: account ? Number(account.is_active) !== 0 : true,
  });
  const set = (p) => setForm((f) => ({ ...f, ...p }));

  const save = async () => {
    if (!form.code.trim() || !form.name.trim()) { addToast(friendlyMessage('validation', { description: 'Code and name are required.' })); return; }
    setSaving(true);
    try {
      await apiJson('/api/admin/accounts', { method: editing ? 'PUT' : 'POST', body: JSON.stringify({ ...form, id: account?.id, parent_id: form.parent_id || null }) });
      addToast(friendlyMessage('save_success', { description: 'Account saved.' }));
      onSaved();
    } catch (error) { addToast(friendlyFromError(error, 'save_failed')); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 sm:p-8">
        <h3 className="mb-5 text-lg font-bold text-gray-900">{editing ? `Edit ${account.code}` : 'New account'}</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Code"><input value={form.code} disabled={isSystem} onChange={(e) => set({ code: e.target.value })} className={INPUT} placeholder="e.g. 5070" /></Field>
          <Field label="Type">
            <select value={form.type} disabled={isSystem} onChange={(e) => set({ type: e.target.value })} className={INPUT}>
              {TYPES.map((t) => <option key={t} value={t} className="capitalize">{t}</option>)}
            </select>
          </Field>
          <div className="sm:col-span-2"><Field label="Name"><input value={form.name} onChange={(e) => set({ name: e.target.value })} className={INPUT} placeholder="Account name" /></Field></div>
          <Field label="Subtype (optional)"><input value={form.subtype} onChange={(e) => set({ subtype: e.target.value })} className={INPUT} placeholder="e.g. clearing" /></Field>
          <Field label="Parent (optional)">
            <select value={form.parent_id} onChange={(e) => set({ parent_id: e.target.value })} className={INPUT}>
              <option value="">None</option>
              {accounts.filter((a) => a.id !== account?.id).map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
            </select>
          </Field>
          <label className="flex items-center gap-2 sm:col-span-2">
            <input type="checkbox" checked={form.is_active} onChange={(e) => set({ is_active: e.target.checked })} className="h-4 w-4 rounded border-gray-300" />
            <span className="text-sm text-gray-700">Active</span>
          </label>
        </div>
        {isSystem && <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">System account — code and type are locked because the engine posts to them.</p>}
        <div className="mt-6 flex gap-3">
          <button disabled={saving} onClick={save} className="flex-1 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
          <button onClick={onClose} className="flex-1 rounded-lg bg-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-300">Cancel</button>
        </div>
      </div>
    </div>
  );
}

const INPUT = 'h-11 w-full rounded-lg border border-gray-300 px-3 text-sm text-gray-900';
function Field({ label, children }) {
  return <label className="block"><span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>{children}</label>;
}
