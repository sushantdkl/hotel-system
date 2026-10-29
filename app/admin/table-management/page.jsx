'use client';

/**
 * Table Management — the structural side of tables (floors, types, roster).
 * The live floor status board stays at /admin/tables. Floors and types are
 * managed lists; tables store the chosen names. position_x/y already exist on
 * each table, so a drag-and-drop layout can be layered on later without a
 * schema change.
 */

import { useEffect, useMemo, useState } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import { Plus, Pencil, Trash2, Layers, Tag, LayoutGrid, QrCode, Printer } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import { apiJson, authedRequest } from '@/lib/authed-fetch';
import { printTableQr } from '@/components/tables/table-qr-modal';

const TABLE_STATUSES = ['available', 'reserved', 'out_of_service'];
const STATUS_LABEL = { available: 'Available', reserved: 'Reserved', out_of_service: 'Out of service', occupied: 'Running' };

export default function TableManagementPage() {
  const { addToast } = useToast();
  const [floors, setFloors] = useState([]);
  const [types, setTypes] = useState([]);
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tableModal, setTableModal] = useState(null); // {} create | table edit
  const [qr, setQr] = useState(null); // { table_number, url, svg } | 'loading'
  const [printSettings, setPrintSettings] = useState({});

  const openQr = async (t) => {
    setQr('loading');
    try {
      setQr(await apiJson(`/api/admin/table-qr?id=${t.id}`));
    } catch (error) {
      setQr(null);
      addToast(friendlyFromError(error, 'load_failed'));
    }
  };

  const printQr = () => {
    if (!qr || qr === 'loading') return;
    printTableQr(qr, printSettings);
  };

  const load = async () => {
    try {
      const [f, ty, t, config] = await Promise.all([
        apiJson('/api/admin/table-floors'),
        apiJson('/api/admin/table-types'),
        apiJson('/api/admin/tables?includeInactive=true'),
        apiJson('/api/admin/settings').catch(() => ({ settings: {} })),
      ]);
      setFloors(f.floors || []);
      setTypes(ty.types || []);
      setTables((t.tables || []).filter((x) => Number(x.is_active) !== 0));
      setPrintSettings(config.settings || {});
    } catch (error) {
      addToast(friendlyFromError(error, 'load_failed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const byFloor = useMemo(() => {
    const groups = new Map();
    for (const t of tables) {
      const key = t.floor || 'Unassigned';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    }
    return Array.from(groups, ([floor, rows]) => ({ floor, rows }));
  }, [tables]);

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Table Management</h1>
            <p className="mt-1 text-sm text-gray-500">Floors, table types, and the table roster. The live status board is under Tables.</p>
          </div>
          <button onClick={() => setTableModal({})} className="inline-flex items-center gap-1.5 self-start rounded-xl bg-gray-900 px-3.5 py-2.5 text-sm font-semibold text-white hover:bg-gray-800">
            <Plus className="h-4 w-4" /> Add table
          </button>
        </div>
      </header>

      <div className="space-y-6 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <TaxonomyCard
            title="Floors"
            icon={Layers}
            rows={floors}
            columns={[{ key: 'name', label: 'Floor' }, { key: 'table_count', label: 'Tables', align: 'right' }]}
            fields={[{ key: 'name', label: 'Floor name', required: true, placeholder: 'e.g. Ground, Rooftop' }, { key: 'sort_order', label: 'Sort order', type: 'number', placeholder: '0' }]}
            endpoint="/api/admin/table-floors"
            onChange={load}
          />
          <TaxonomyCard
            title="Table Types"
            icon={Tag}
            rows={types}
            columns={[
              { key: 'name', label: 'Type', render: (r) => (<span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ background: r.color || '#3b82f6' }} />{r.name}</span>) },
              { key: 'default_capacity', label: 'Default seats', align: 'right' },
              { key: 'table_count', label: 'Tables', align: 'right' },
            ]}
            fields={[
              { key: 'name', label: 'Type name', required: true, placeholder: 'e.g. VIP, Outdoor, Family' },
              { key: 'default_capacity', label: 'Default seats', type: 'number', placeholder: '4' },
              { key: 'color', label: 'Colour', type: 'color', placeholder: '#3b82f6' },
            ]}
            endpoint="/api/admin/table-types"
            onChange={load}
          />
        </div>

        <section className="rounded-2xl border border-gray-200 bg-white">
          <div className="flex items-center gap-2 border-b border-gray-200 px-5 py-4">
            <LayoutGrid className="h-5 w-5 text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-900">Tables ({tables.length})</h2>
          </div>
          {loading ? (
            <p className="p-8 text-center text-sm text-gray-500">Loading…</p>
          ) : tables.length === 0 ? (
            <p className="p-8 text-center text-sm text-gray-500">No tables yet. Add one to get started.</p>
          ) : (
            <div className="space-y-6 p-5">
              {byFloor.map(({ floor, rows }) => (
                <div key={floor}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{floor}</h3>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {rows.map((t) => (
                      <div key={t.id} className="relative rounded-xl border border-gray-200 hover:border-gray-400 hover:shadow-sm">
                        <button
                          type="button"
                          onClick={() => openQr(t)}
                          className="absolute right-2 top-2 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-900"
                          title="Table QR code"
                          aria-label="Table QR code"
                        >
                          <QrCode className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => setTableModal(t)} className="block w-full p-3 pr-9 text-left">
                          <span className="text-lg font-bold text-gray-900">{t.table_number}</span>
                          <p className="mt-0.5 text-xs text-gray-500 capitalize">{t.table_type || 'regular'}</p>
                          <p className="mt-1 text-xs text-gray-600">{t.capacity} seats</p>
                          <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusTone(t.status)}`}>
                            {STATUS_LABEL[t.status] || t.status}
                          </span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {tableModal && (
        <TableModal
          table={tableModal.id ? tableModal : null}
          floors={floors}
          types={types}
          onClose={() => setTableModal(null)}
          onSaved={() => {
            setTableModal(null);
            load();
          }}
          addToast={addToast}
        />
      )}

      {qr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center">
            {qr === 'loading' ? (
              <p className="py-10 text-sm text-gray-500">Generating QR…</p>
            ) : (
              <>
                <h3 className="text-lg font-bold text-gray-900">Table {qr.table_number}</h3>
                <p className="mb-3 text-xs text-gray-500">Customers scan this to view the menu and order.</p>
                <div className="mx-auto w-64" dangerouslySetInnerHTML={{ __html: qr.svg }} />
                <p className="mt-2 break-all text-[11px] text-gray-400">{qr.url}</p>
                <div className="mt-5 flex gap-3">
                  <button onClick={printQr} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800"><Printer className="h-4 w-4" /> Print</button>
                  <button onClick={() => setQr(null)} className="flex-1 rounded-lg bg-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-300">Close</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

function typeColor(types, name) {
  const t = types.find((x) => String(x.name).toLowerCase() === String(name || '').toLowerCase());
  return t?.color || '#94a3b8';
}
function statusTone(status) {
  if (status === 'occupied') return 'bg-blue-100 text-blue-800';
  if (status === 'reserved') return 'bg-red-100 text-red-800';
  if (status === 'out_of_service') return 'bg-gray-200 text-gray-700';
  return 'bg-emerald-100 text-emerald-800';
}

/* ------------------------------------------------ managed-list card (floor/type) */

function TaxonomyCard({ title, icon: Icon, rows, columns, fields, endpoint, onChange }) {
  const { addToast } = useToast();
  const { confirm } = useConfirm();
  const [editing, setEditing] = useState(null); // row | {} | null
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  const open = (row) => {
    setEditing(row || {});
    setForm(row ? { ...row } : Object.fromEntries(fields.map((f) => [f.key, f.type === 'color' ? '#3b82f6' : ''])));
  };

  const save = async () => {
    if (fields.some((f) => f.required && !String(form[f.key] || '').trim())) {
      addToast(friendlyMessage('validation', { description: `${fields.find((f) => f.required).label} is required.` }));
      return;
    }
    setSaving(true);
    try {
      await apiJson(endpoint, {
        method: editing.id ? 'PUT' : 'POST',
        body: JSON.stringify({ ...form, id: editing.id }),
      });
      addToast(friendlyMessage('save_success', { description: `${title} saved.` }));
      setEditing(null);
      onChange();
    } catch (error) {
      addToast(friendlyFromError(error, 'save_failed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row) => {
    const ok = await confirm({
      title: `Delete "${row.name}"?`,
      tone: 'delete',
    });
    if (!ok) return;
    try {
      await apiJson(`${endpoint}?id=${row.id}`, { method: 'DELETE' });
      onChange();
    } catch (error) {
      addToast(friendlyFromError(error, 'delete_failed'));
    }
  };

  return (
    <section className="rounded-2xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        </div>
        <button type="button" onClick={() => open(null)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50">
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      </div>

      <div className="divide-y divide-gray-100">
        {rows.length === 0 && <p className="p-5 text-sm text-gray-500">None yet.</p>}
        {rows.map((row) => (
          <div key={row.id} className="flex items-center gap-3 px-5 py-3">
            <div className="flex-1 text-sm text-gray-900">
              {(columns[0].render ? columns[0].render(row) : row[columns[0].key])}
            </div>
            {columns.slice(1).map((c) => (
              <div key={c.key} className="w-24 text-right text-sm text-gray-500">{row[c.key] ?? 0}</div>
            ))}
            <button type="button" onClick={() => open(row)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-900"><Pencil className="h-4 w-4" /></button>
            <button type="button" onClick={() => remove(row)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 sm:p-8">
            <h3 className="mb-4 text-lg font-bold text-gray-900">{editing.id ? `Edit ${title.replace(/s$/, '')}` : `Add ${title.replace(/s$/, '')}`}</h3>
            <div className="space-y-3">
              {fields.map((f) => (
                <label key={f.key} className="block">
                  <span className="mb-1 block text-sm font-medium text-gray-700">{f.label}{f.required && <span className="text-red-600"> *</span>}</span>
                  <input
                    type={f.type === 'number' ? 'number' : f.type === 'color' ? 'color' : 'text'}
                    value={form[f.key] ?? ''}
                    onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    className={f.type === 'color' ? 'h-10 w-16 rounded border border-gray-300' : 'h-10 w-full rounded-lg border border-gray-300 px-3 text-gray-900'}
                  />
                </label>
              ))}
            </div>
            <div className="mt-5 flex gap-3">
              <button type="button" disabled={saving} onClick={save} className="flex-1 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
              <button type="button" onClick={() => setEditing(null)} className="flex-1 rounded-lg bg-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-300">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------- table add/edit */

function TableModal({ table, floors, types, onClose, onSaved, addToast }) {
  const { confirm } = useConfirm();
  const editing = Boolean(table?.id);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    table_number: table?.table_number || '',
    floor: table?.floor || floors[0]?.name || '',
    section: table?.section || '',
    table_type: table?.table_type || types[0]?.name || 'regular',
    capacity: table?.capacity ?? 4,
    min_capacity: table?.min_capacity ?? 1,
    status: table?.status || 'available',
  });
  const occupied = table?.status === 'occupied' || table?.current_order_id;

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const pickType = (name) => {
    const t = types.find((x) => x.name === name);
    set({ table_type: name, capacity: t?.default_capacity && !editing ? t.default_capacity : form.capacity });
  };

  const save = async () => {
    if (!String(form.table_number).trim()) {
      addToast(friendlyMessage('validation', { description: 'Table number is required.' }));
      return;
    }
    setSaving(true);
    try {
      const body = {
        ...form,
        capacity: Number(form.capacity) || 1,
        min_capacity: Number(form.min_capacity) || 1,
      };
      const res = await authedRequest('/api/admin/tables', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(editing ? { id: table.id, ...body } : body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw data;
      addToast(friendlyMessage('save_success', { description: `Table ${form.table_number} saved.` }));
      onSaved();
    } catch (error) {
      addToast(friendlyFromError(error, 'save_failed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Delete table ${form.table_number}?`,
      tone: 'delete',
    });
    if (!ok) return;
    try {
      const res = await authedRequest(`/api/admin/tables?id=${table.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw data;
      onSaved();
    } catch (error) {
      addToast(friendlyFromError(error, 'delete_failed'));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-6 sm:p-8">
        <h3 className="mb-5 text-lg font-bold text-gray-900">{editing ? `Edit table ${table.table_number}` : 'Add table'}</h3>
        {occupied && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">This table is occupied. Changes here will not disturb the open order.</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Table number" required>
            <input value={form.table_number} onChange={(e) => set({ table_number: e.target.value })} className={INPUT} placeholder="e.g. 12, A-3" />
          </Field>
          <Field label="Floor">
            <select value={form.floor} onChange={(e) => set({ floor: e.target.value })} className={INPUT}>
              {floors.length === 0 && <option value="">No floors — add one first</option>}
              {floors.map((f) => <option key={f.id} value={f.name}>{f.name}</option>)}
            </select>
          </Field>
          <Field label="Room / section">
            <input value={form.section} onChange={(e) => set({ section: e.target.value })} className={INPUT} placeholder="e.g. Ground Floor, Cabin, Terrace" />
          </Field>
          <Field label="Type">
            <select value={form.table_type} onChange={(e) => pickType(e.target.value)} className={INPUT}>
              {types.length === 0 && <option value="regular">regular</option>}
              {types.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select value={form.status} onChange={(e) => set({ status: e.target.value })} className={INPUT} disabled={occupied}>
              {TABLE_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </Field>
          <Field label="Capacity (seats)">
            <input type="number" min="1" value={form.capacity} onChange={(e) => set({ capacity: e.target.value })} className={INPUT} />
          </Field>
          <Field label="Min capacity">
            <input type="number" min="1" value={form.min_capacity} onChange={(e) => set({ min_capacity: e.target.value })} className={INPUT} />
          </Field>
        </div>
        <div className="mt-5 flex gap-3">
          <button type="button" disabled={saving} onClick={save} className="flex-1 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
          {editing && <button type="button" onClick={remove} className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-red-600">Delete</button>}
          <button type="button" onClick={onClose} className="flex-1 rounded-lg bg-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-300">Cancel</button>
        </div>
      </div>
    </div>
  );
}

const INPUT = 'h-10 w-full rounded-lg border border-gray-300 px-3 text-sm text-gray-900';

function Field({ label, required, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}{required && <span className="text-red-600"> *</span>}</span>
      {children}
    </label>
  );
}
