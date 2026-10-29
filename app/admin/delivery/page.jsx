'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import AdminLayout from '@/components/admin/admin-layout';
import { Search, Download, Plus, X, ChevronRight, Bike } from 'lucide-react';
import { apiJson } from '@/lib/authed-fetch';
import { useToast } from '@/components/ui/toast';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import { adminInputClass } from '@/components/ui/admin-form';
import { toCsv } from '@/lib/csv';
import { formatCurrency } from '@/lib/currency';
import { formatNepalDateTime } from '@/lib/report-dates.js';
import { orderTypeLabel } from '@/lib/order-types.js';

const INPUT = adminInputClass;
const STATUS_LABEL = { available: 'Available', busy: 'Busy', off_duty: 'Off duty' };
const STATUS_CLASS = {
  available: 'bg-emerald-100 text-emerald-800',
  busy: 'bg-amber-100 text-amber-800',
  off_duty: 'bg-gray-100 text-gray-600',
};

export default function DeliveryExecutivesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const orderBase = pathname?.startsWith('/cashier') ? '/cashier/orders' : '/admin/orders';
  const { addToast } = useToast();

  const [executives, setExecutives] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  const [formFor, setFormFor] = useState(null); // { mode: 'add'|'edit', target }
  const [form, setForm] = useState({ name: '', phone: '', email: '', status: 'available' });
  const [busy, setBusy] = useState(false);

  const [selected, setSelected] = useState(null); // executive whose orders popup is open
  const [orders, setOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await apiJson('/api/admin/delivery-executives');
      setExecutives(r.executives || []);
    } catch (error) { addToast(friendlyFromError(error, 'load_failed')); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return executives;
    return executives.filter((e) =>
      e.name?.toLowerCase().includes(q) || String(e.phone || '').includes(q) || e.email?.toLowerCase().includes(q)
    );
  }, [executives, query]);

  const openAdd = () => { setFormFor({ mode: 'add' }); setForm({ name: '', phone: '', email: '', status: 'available' }); };
  const openEdit = (exec) => { setFormFor({ mode: 'edit', target: exec }); setForm({ name: exec.name, phone: exec.phone || '', email: exec.email || '', status: exec.status }); };

  const submitForm = async () => {
    if (!form.name.trim()) { addToast(friendlyMessage('validation', { description: 'Enter a name.' })); return; }
    setBusy(true);
    try {
      if (formFor.mode === 'add') {
        await apiJson('/api/admin/delivery-executives', { method: 'POST', body: JSON.stringify(form) });
        addToast(friendlyMessage('save_success', { description: 'Delivery executive added.' }));
      } else {
        await apiJson(`/api/admin/delivery-executives/${formFor.target.id}`, { method: 'PATCH', body: JSON.stringify(form) });
        addToast(friendlyMessage('save_success', { description: 'Delivery executive updated.' }));
      }
      setFormFor(null);
      await load();
    } catch (error) { addToast(friendlyFromError(error, 'save_failed')); }
    finally { setBusy(false); }
  };

  const openOrders = async (exec) => {
    setSelected(exec);
    setOrders([]);
    setLoadingOrders(true);
    try {
      const r = await apiJson(`/api/admin/delivery-executives/${exec.id}/orders`);
      setOrders(r.orders || []);
    } catch (error) { addToast(friendlyFromError(error, 'load_failed')); }
    finally { setLoadingOrders(false); }
  };

  const exportCsv = () => {
    const headers = ['Name', 'Phone', 'Email', 'Total Orders', 'Status'];
    const rows = visible.map((e) => ({
      Name: e.name, Phone: e.phone || '', Email: e.email || '',
      'Total Orders': e.total_orders, Status: STATUS_LABEL[e.status] || e.status,
    }));
    const blob = new Blob([toCsv(headers, rows)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'delivery-executives.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Delivery Executives</h1>
            <p className="mt-1 text-sm text-gray-500">Manage delivery staff and see what each of them has delivered.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              <Download className="h-4 w-4" /> Export
            </button>
            <button type="button" onClick={openAdd} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800">
              <Plus className="h-4 w-4" /> Add Executive
            </button>
          </div>
        </div>
      </header>

      <div className="space-y-6 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="relative rounded-2xl border border-gray-200 bg-white p-4">
          <Search className="pointer-events-none absolute left-7 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, email or phone number"
            className={`${INPUT} pl-9`}
          />
        </div>

        {!loading && visible.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white px-6 py-16 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100">
              <Bike className="h-6 w-6 text-gray-400" />
            </div>
            <h3 className="text-base font-bold text-gray-900">{query ? 'No match' : 'No delivery executives yet'}</h3>
            <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">
              {query ? 'No executive matches that search.' : 'Add your first delivery executive to start assigning orders.'}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Staff Name</th>
                    <th className="px-5 py-3 font-semibold">Phone</th>
                    <th className="px-5 py-3 font-semibold">Total Orders</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                    <th className="px-5 py-3 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {visible.map((e) => (
                    <tr key={e.id} className="hover:bg-gray-50">
                      <td className="cursor-pointer px-5 py-3.5" onClick={() => openOrders(e)}>
                        <span className="flex items-center gap-1.5 font-medium text-gray-900">
                          {e.name} <ChevronRight className="h-3.5 w-3.5 text-gray-300" />
                        </span>
                      </td>
                      <td className="cursor-pointer px-5 py-3.5 text-gray-600" onClick={() => openOrders(e)}>{e.phone || '—'}</td>
                      <td className="cursor-pointer px-5 py-3.5 text-gray-600" onClick={() => openOrders(e)}>{e.total_orders} Orders</td>
                      <td className="px-5 py-3.5">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASS[e.status] || 'bg-gray-100 text-gray-600'}`}>
                          {STATUS_LABEL[e.status] || e.status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <button type="button" onClick={() => openEdit(e)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">
                          Update
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Add / Edit form */}
      {formFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6">
            <h3 className="mb-4 text-lg font-bold text-gray-900">{formFor.mode === 'add' ? 'Add delivery executive' : `Update ${formFor.target.name}`}</h3>
            <div className="space-y-3">
              <Field label="Name">
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={INPUT} />
              </Field>
              <Field label="Phone">
                <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className={INPUT} placeholder="98XXXXXXXX" />
              </Field>
              <Field label="Email (optional)">
                <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className={INPUT} />
              </Field>
              <Field label="Status">
                <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} className={INPUT}>
                  <option value="available">Available</option>
                  <option value="busy">Busy</option>
                  <option value="off_duty">Off duty</option>
                </select>
              </Field>
            </div>
            <div className="mt-6 flex gap-3">
              <button disabled={busy} onClick={submitForm} className="flex-1 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
                {busy ? 'Saving…' : formFor.mode === 'add' ? 'Add executive' : 'Save changes'}
              </button>
              <button type="button" onClick={() => setFormFor(null)} className="flex-1 rounded-lg bg-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-300">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Orders delivered by this executive */}
      {selected && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{selected.name}</h2>
                <p className="text-sm text-gray-500">{orders.length} order{orders.length === 1 ? '' : 's'}</p>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {loadingOrders ? (
                <p className="py-10 text-center text-sm text-gray-500">Loading orders…</p>
              ) : orders.length === 0 ? (
                <p className="py-10 text-center text-sm text-gray-500">No orders assigned yet.</p>
              ) : (
                <div className="divide-y divide-gray-100">
                  {orders.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => router.push(`${orderBase}/${o.id}`)}
                      className="flex w-full flex-wrap items-center gap-3 px-5 py-3 text-left hover:bg-gray-50"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-gray-900">{o.order_number}</span>
                        <span className="block text-xs text-gray-400">{o.customer_name || 'Walk-in'} · {formatNepalDateTime(o.created_at)}</span>
                      </span>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase text-gray-600">{orderTypeLabel(o)}</span>
                      <span className="capitalize text-xs text-gray-500">{String(o.status || '').replace(/_/g, ' ')}</span>
                      <span className="text-sm font-semibold tabular-nums text-gray-900">{formatCurrency(o.total || 0)}</span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

function Field({ label, children }) {
  return <label className="block"><span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>{children}</label>;
}
