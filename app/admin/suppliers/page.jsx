'use client';

/**
 * Suppliers: list, create, edit, and merge duplicates.
 *
 * Merge matters here — the 008 backfill created one supplier per distinct
 * free-text spelling, so near-duplicates ("Fresh Traders" / "fresh traders
 * pvt") exist in real data. Merging repoints purchases and inventory, rewrites
 * the legacy text columns and deletes the loser (lib/purchases.js).
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import AdminLayout from '@/components/admin/admin-layout';
import { Combine, Pencil, Plus, X } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { friendlyFromError, friendlyMessage } from '@/lib/friendly-message';
import { formatNepalDate } from '@/lib/time-utils';
import { apiJson } from '@/lib/authed-fetch';
import DataGrid from '@/components/admin/data-grid';
import useServerList from '@/lib/use-server-list';
import AttentionBar from '@/components/admin/attention-bar';
import { KpiCards } from '@/components/admin/report-kit';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  AdminField,
  adminInputClass,
  adminTextareaClass,
  adminDialogMd,
  adminBtnPrimary,
  adminBtnSecondary,
  adminFieldStackClass,
} from '@/components/ui/admin-form';
import { useCapabilities } from '@/lib/use-capabilities.js';
import { isAdminLike } from '@/lib/roles.js';

/** Rough duplicate sniff: same first word, or one name contained in the other. */
function looksDuplicated(suppliers) {
  const groups = new Map();
  for (const s of suppliers) {
    const key = String(s.name || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ')[0];
    if (!key) continue;
    groups.set(key, [...(groups.get(key) || []), s]);
  }
  return Array.from(groups.values()).filter((g) => g.length > 1);
}

export default function SuppliersPage() {
  const pathname = usePathname();
  const isCashierPanel = pathname?.startsWith('/cashier');
  const { role, can } = useCapabilities();
  const canManage = can('suppliers.manage');
  const canMerge = isAdminLike(role);
  const canViewPurchases = can('purchases.view');
  const { addToast } = useToast();
  const [selected, setSelected] = useState([]);
  const [editing, setEditing] = useState(null); // {} for new
  const [merging, setMerging] = useState(false);
  const [detail, setDetail] = useState(null);

  const {
    rows: suppliers,
    server,
    loading,
    reload: fetchAll,
  } = useServerList({
    url: '/api/admin/suppliers',
    key: 'suppliers',
    initialSort: { key: 'name', dir: 'asc' },
    onError: (error) => addToast(friendlyFromError(error, 'load_failed')),
  });

  // Spend, purchase count and last delivery all arrive costed from SQL. This
  // used to pull 500 purchases and add them up here, which silently undercounted
  // any supplier past that cap.
  const rows = useMemo(
    () =>
      suppliers.map((s) => ({
        ...s,
        spend: Number(s.total_spend || 0),
        purchases: Number(s.purchase_count || 0),
        last_purchase: s.last_purchase_at || null,
      })),
    [suppliers]
  );

  // Near-duplicate detection compares the names on this page only.
  const duplicateGroups = useMemo(() => looksDuplicated(suppliers), [suppliers]);
  const totalSpend = rows.reduce((s, r) => s + r.spend, 0);

  const columns = useMemo(
    () => [
      {
        key: 'name',
        label: 'Supplier',
        className: 'text-gray-900 font-medium',
        render: (r) => <Link href={`${isCashierPanel ? '/cashier' : '/admin'}/suppliers/${r.id}`} className="text-blue-700 hover:underline">{r.name}</Link>,
      },
      { key: 'phone', label: 'Phone', render: (r) => r.phone || <span className="text-gray-300">—</span> },
      { key: 'email', label: 'Email', render: (r) => r.email || <span className="text-gray-300">—</span> },
      { key: 'purchases', label: 'Purchases', align: 'right', numeric: true },
      {
        key: 'spend',
        label: 'Total spend',
        align: 'right',
        numeric: true,
        className: 'text-gray-900 font-medium',
        render: (r) => `Rs ${r.spend.toFixed(2)}`,
      },
      { key: 'item_count', label: 'Items supplied', align: 'right', numeric: true, value: (r) => Number(r.item_count || 0) },
      {
        key: 'last_purchase',
        label: 'Last delivery',
        value: (r) => r.last_purchase || '',
        render: (r) => (r.last_purchase ? formatNepalDate(r.last_purchase) : <span className="text-gray-300">Never</span>),
      },
    ],
    [isCashierPanel]
  );

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Suppliers</h1>
            <p className="mt-1 text-sm text-gray-500 sm:text-base">Who you buy from, what you spend with them, and where the duplicates are.</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {canViewPurchases && <Link href={isCashierPanel ? '/cashier/purchases' : '/admin/purchases'} className="inline-flex items-center gap-1.5 rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
              Purchases
            </Link>}
            {canManage && <button type="button" onClick={() => setEditing({})} className="inline-flex items-center gap-1.5 rounded-xl bg-gray-900 px-3.5 py-2.5 text-sm font-semibold text-white hover:bg-gray-800">
              <Plus className="h-4 w-4" /> Add supplier
            </button>}
          </div>
        </div>
      </header>

      <div className="space-y-5 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <KpiCards
          kpis={[
            { key: 'count', label: 'Suppliers', value: suppliers.length, format: 'number' },
            { key: 'spend', label: 'Total spend', value: totalSpend, format: 'currency', sub: 'Excludes voided purchases' },
            { key: 'active', label: 'Used this history', value: rows.filter((r) => r.purchases > 0).length, format: 'number' },
            { key: 'dupes', label: 'Possible duplicates', value: duplicateGroups.reduce((s, g) => s + g.length, 0), format: 'number' },
          ]}
        />

        {canMerge && duplicateGroups.length > 0 && (
          <AttentionBar
            tone="amber"
            title={`${duplicateGroups.length} group${duplicateGroups.length === 1 ? '' : 's'} of suppliers look like the same business`}
            body={`For example: ${duplicateGroups[0].map((s) => s.name).join(' / ')}. Tick them below and merge — purchases, items and spend all move to the one you keep.`}
          />
        )}

        <DataGrid
          title="Supplier list"
          columns={columns}
          rows={rows}
          server={server}
          csvName="suppliers"
          selected={canMerge ? selected : undefined}
          onSelectionChange={canMerge ? setSelected : undefined}
          searchPlaceholder="Search suppliers…"
          empty={loading ? 'Loading suppliers…' : 'No suppliers yet. Add one, or just type a new name when you receive a delivery.'}
          footNote="Click a supplier for its purchase history."
          bulkActions={canMerge ? (
            <button
              type="button"
              onClick={() => (selected.length >= 2 ? setMerging(true) : addToast(friendlyMessage('validation', { description: 'Pick at least two suppliers to merge.' })))}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <Combine className="h-3.5 w-3.5" /> Merge selected
            </button>
          ) : null}
          renderActions={(row) => canManage ? (
            <button
              type="button"
              title="Edit supplier"
              aria-label="Edit supplier"
              onClick={() => setEditing(row)}
              className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-900"
            >
              <Pencil className="h-4 w-4" />
            </button>
          ) : null}
        />
      </div>

      {canManage && editing && <SupplierFormModal supplier={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={fetchAll} />}
      {canMerge && merging && (
        <MergeModal
          candidates={rows.filter((r) => selected.includes(r.id))}
          onClose={() => setMerging(false)}
          onMerged={() => {
            setSelected([]);
            fetchAll();
          }}
        />
      )}
      {detail && (
        <SupplierDetail supplier={detail} canViewPurchases={canViewPurchases} onClose={() => setDetail(null)} />
      )}
    </AdminLayout>
  );
}

function SupplierFormModal({ supplier, onClose, onSaved }) {
  const { addToast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: supplier?.name || '',
    phone: supplier?.phone || '',
    email: supplier?.email || '',
    address: supplier?.address || '',
    notes: supplier?.notes || '',
  });

  async function submit() {
    if (!form.name.trim()) {
      addToast(friendlyMessage('validation', { description: 'A supplier needs a name.' }));
      return;
    }
    setSaving(true);
    try {
      if (supplier?.id) {
        await apiJson('/api/admin/suppliers', { method: 'PUT', body: JSON.stringify({ ...form, id: supplier.id }) });
      } else {
        await apiJson('/api/admin/suppliers', { method: 'POST', body: JSON.stringify(form) });
      }
      addToast(friendlyMessage('save_success', { description: `${form.name} saved.` }));
      onSaved?.();
      onClose();
    } catch (error) {
      addToast(friendlyFromError(error, 'save_failed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent onClose={onClose} className={adminDialogMd}>
        <DialogHeader>
          <DialogTitle>{supplier ? `Edit ${supplier.name}` : 'Add supplier'}</DialogTitle>
        </DialogHeader>
        <div className={`mt-6 ${adminFieldStackClass}`}>
          {[
            { key: 'name', label: 'Name', required: true },
            { key: 'phone', label: 'Phone' },
            { key: 'email', label: 'Email', type: 'email' },
            { key: 'address', label: 'Address' },
          ].map((f) => (
            <AdminField key={f.key} label={f.label} required={f.required}>
              <input
                type={f.type || 'text'}
                autoFocus={f.key === 'name'}
                value={form[f.key]}
                onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
                className={adminInputClass}
              />
            </AdminField>
          ))}
          <AdminField label="Notes">
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              className={adminTextareaClass}
            />
          </AdminField>
        </div>
        <DialogFooter>
          <button type="button" onClick={onClose} className={adminBtnSecondary}>
            Cancel
          </button>
          <button type="button" disabled={saving} onClick={submit} className={adminBtnPrimary}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MergeModal({ candidates, onClose, onMerged }) {
  const { addToast } = useToast();
  const [targetId, setTargetId] = useState(candidates[0]?.id);
  const [saving, setSaving] = useState(false);
  const target = candidates.find((c) => c.id === targetId);
  const losers = candidates.filter((c) => c.id !== targetId);

  async function submit() {
    setSaving(true);
    try {
      await apiJson('/api/admin/suppliers', {
        method: 'PUT',
        body: JSON.stringify({ action: 'merge', target_id: targetId, source_ids: losers.map((l) => l.id) }),
      });
      addToast(friendlyMessage('save_success', { description: `Merged into ${target?.name}.` }));
      onMerged?.();
      onClose();
    } catch (error) {
      addToast(friendlyFromError(error, 'save_failed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>Merge {candidates.length} suppliers</DialogTitle>
        </DialogHeader>
        <div className="mt-4 space-y-4">
          <p className="text-sm text-gray-600">Which name do you want to keep? Everything else folds into it.</p>
          <div className="space-y-2">
            {candidates.map((c) => (
              <label key={c.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${targetId === c.id ? 'border-gray-900 bg-gray-50' : 'border-gray-200'}`}>
                <input type="radio" name="merge-target" checked={targetId === c.id} onChange={() => setTargetId(c.id)} className="h-4 w-4" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-gray-900">{c.name}</span>
                  <span className="block text-xs text-gray-500">
                    {c.purchases} purchase(s) · Rs {c.spend.toFixed(2)} · {c.item_count || 0} item(s)
                  </span>
                </span>
              </label>
            ))}
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-semibold">This cannot be undone.</p>
            <p className="mt-1">
              {losers.map((l) => l.name).join(', ')} will be deleted. Their purchases, inventory items and expense
              records are re-pointed at {target?.name} first, so no history is lost — only the duplicate names go.
            </p>
          </div>
        </div>
        <DialogFooter>
          <button type="button" onClick={onClose} className="h-10 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-700">
            Cancel
          </button>
          <button type="button" disabled={saving || !losers.length} onClick={submit} className="h-10 rounded-lg bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">
            {saving ? 'Merging…' : `Merge into ${target?.name || ''}`}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SupplierDetail({ supplier, canViewPurchases, onClose }) {
  // This supplier's own deliveries, asked for by supplier_id. The page used to
  // hold 500 purchases for every supplier just so this drawer could filter them.
  const [purchases, setPurchases] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!canViewPurchases) {
      return undefined;
    }
    let cancelled = false;
    apiJson(`/api/admin/purchases?supplier_id=${supplier.id}&page_size=200`)
      .then((body) => {
        if (!cancelled) setPurchases(body.purchases || []);
      })
      .catch(() => {
        if (!cancelled) setPurchases([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supplier.id, canViewPurchases]);

  const spend = purchases.filter((p) => p.status !== 'voided').reduce((s, p) => s + Number(p.total || 0), 0);
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="relative z-10 flex h-full w-full max-w-lg flex-col overflow-y-auto bg-white shadow-xl">
        <header className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Supplier</p>
            <h2 className="truncate text-lg font-semibold text-gray-900">{supplier.name}</h2>
            <p className="mt-1 text-sm text-gray-500">
              {[supplier.phone, supplier.email].filter(Boolean).join(' · ') || 'No contact details recorded'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="space-y-5 p-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-gray-200 p-4">
              <p className="text-xs font-medium text-gray-500">Total spend</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-gray-900">Rs {spend.toFixed(2)}</p>
            </div>
            <div className="rounded-xl border border-gray-200 p-4">
              <p className="text-xs font-medium text-gray-500">Deliveries</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-gray-900">{purchases.length}</p>
            </div>
          </div>

          <section>
            <h3 className="mb-3 text-sm font-semibold text-gray-900">Purchase history</h3>
            {!canViewPurchases ? (
              <p className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
                Purchase-history access has not been granted for this account.
              </p>
            ) : loading ? (
              <p className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
                Loading purchase history…
              </p>
            ) : purchases.length ? (
              <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
                {purchases.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-gray-900">{p.invoice_number || `Purchase #${p.id}`}</p>
                      <p className="text-xs text-gray-500">
                        {formatNepalDate(p.invoice_date || p.created_at)} · {p.status}
                      </p>
                    </div>
                    <span className="shrink-0 tabular-nums font-medium text-gray-900">Rs {Number(p.total || 0).toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
                Nothing has been received from {supplier.name} yet. Their first delivery will show up here.
              </p>
            )}
          </section>

          {supplier.address && (
            <section>
              <h3 className="mb-1 text-sm font-semibold text-gray-900">Address</h3>
              <p className="text-sm text-gray-600">{supplier.address}</p>
            </section>
          )}
          {supplier.notes && (
            <section>
              <h3 className="mb-1 text-sm font-semibold text-gray-900">Notes</h3>
              <p className="text-sm text-gray-600">{supplier.notes}</p>
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}
