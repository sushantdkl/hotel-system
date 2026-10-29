'use client';

/**
 * Inventory — the source of truth, as a data table.
 *
 * Deliberately table-first: cards only carry the KPI strip. Quantity is never
 * editable inline; it goes through StockAdjustmentModal because the ledger
 * requires a reason for every manual change.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import AdminLayout from '@/components/admin/admin-layout';
import {
  ArchiveRestore, Archive, ChefHat, Copy, ExternalLink, Pencil, Plus,
  Scale, Truck, Upload, Users, Trash2,
} from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { formatNepalDate } from '@/lib/time-utils';
import { friendlyFromError, friendlyMessage } from '@/lib/friendly-message';
import { apiJson, authedRequest } from '@/lib/authed-fetch';
import DataGrid, { InlineEdit, StatusBadge } from '@/components/admin/data-grid';
import AttentionBar from '@/components/admin/attention-bar';
import { KpiCards } from '@/components/admin/report-kit';
import ItemFormModal from '@/components/inventory/item-form-modal';
import StockAdjustmentModal from '@/components/inventory/stock-adjustment-modal';
import WastageModal from '@/components/inventory/wastage-modal';

function statusOf(item) {
  if (Number(item.is_archived) === 1) return 'archived';
  const qty = Number(item.quantity ?? 0);
  const min = Number(item.min_stock_level ?? 0);
  if (qty <= 0) return 'out';
  if (min > 0 && qty <= min) return 'low';
  return 'optimal';
}

const STATUS_META = {
  out: { label: 'Out of stock', tone: 'red' },
  low: { label: 'Low stock', tone: 'amber' },
  optimal: { label: 'In stock', tone: 'green' },
  archived: { label: 'Archived', tone: 'gray' },
};

export default function InventoryPage() {
  const pathname = usePathname();
  const cashierPanel = pathname?.startsWith('/cashier');
  const inventoryBase = cashierPanel ? '/cashier/inventory' : '/admin/inventory';
  const suppliersPath = cashierPanel ? '/cashier/suppliers' : '/admin/suppliers';
  const recipesPath = cashierPanel ? '/cashier/recipes' : '/admin/recipes';
  const purchasesPath = cashierPanel ? '/cashier/purchases' : '/admin/purchases';
  const { addToast } = useToast();
  const [items, setItems] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [managedCategories, setManagedCategories] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [movements, setMovements] = useState([]);
  const [wastageSummary, setWastageSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState([]);

  const [formItem, setFormItem] = useState(null); // {} for create
  const [adjustItem, setAdjustItem] = useState(null);
  const [wastageFor, setWastageFor] = useState(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [inv, sup, mov, waste, cats, menu] = await Promise.all([
        apiJson('/api/admin/inventory?include_archived=1'),
        apiJson('/api/admin/suppliers').catch(() => ({ suppliers: [] })),
        // Only the counts that disagreed, filtered in SQL — this list shows 20.
        apiJson('/api/admin/stock-movements?variance_only=1&page_size=20').catch(() => ({ movements: [] })),
        // Only the aggregate is needed here, so ask for one row and read the
        // server's own rolling totals rather than summing the whole log.
        apiJson('/api/admin/wastage?page_size=1').catch(() => ({ summary: null })),
        apiJson('/api/admin/inventory-categories').catch(() => ({ categories: [] })),
        apiJson('/api/admin/products').catch(() => ({ products: [] })),
      ]);
      setItems(inv.items || []);
      setSuppliers(sup.suppliers || []);
      setManagedCategories(cats.categories || []);
      setMenuItems(menu.products || []);
      setMovements(mov.movements || []);
      setWastageSummary(waste.summary || null);
    } catch (error) {
      addToast(friendlyFromError(error, 'load_failed'));
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Managed categories (the source of truth) unioned with any still-typed on
  // items, so the picker offers the vocabulary and the filter never hides a row.
  const categories = useMemo(
    () =>
      Array.from(
        new Set([
          ...managedCategories.map((c) => c.name).filter(Boolean),
          ...items.map((i) => i.category).filter(Boolean),
        ])
      ).sort(),
    [items, managedCategories]
  );

  const active = useMemo(() => items.filter((i) => Number(i.is_archived) !== 1), [items]);

  const rows = useMemo(
    () =>
      items.filter((i) => {
        const archived = Number(i.is_archived) === 1;
        if (archived !== showArchived) return false;
        if (categoryFilter !== 'all' && i.category !== categoryFilter) return false;
        if (supplierFilter !== 'all' && String(i.supplier || '') !== supplierFilter) return false;
        if (statusFilter !== 'all' && statusOf(i) !== statusFilter) return false;
        return true;
      }),
    [items, showArchived, categoryFilter, supplierFilter, statusFilter]
  );

  const totalValue = active.reduce((s, i) => s + Number(i.quantity ?? 0) * Number(i.cost_per_unit ?? 0), 0);
  const outCount = active.filter((i) => statusOf(i) === 'out').length;
  const lowCount = active.filter((i) => statusOf(i) === 'low').length;
  // Rolling 30 days, bucketed server-side. It used to be a calendar month
  // summed from every wastage row the page had fetched.
  const wastageCost = wastageSummary?.windows?.month?.cost || 0;

  // The ledger records a shortfall on the movement whenever an order tried to
  // deduct more than was on hand. Those are the events worth chasing.
  const varianceEvents = movements;

  /** Inline edits never touch quantity — passing the current value keeps the ledger out of it. */
  const patchItem = useCallback(
    async (item, patch) => {
      try {
        await apiJson('/api/admin/inventory', {
          method: 'PUT',
          body: JSON.stringify({ ...item, ...patch, id: item.id, quantity: item.quantity }),
        });
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, ...patch } : i)));
      } catch (error) {
        addToast(friendlyFromError(error, 'save_failed'));
        fetchAll();
      }
    },
    [addToast, fetchAll]
  );

  const runAction = useCallback(
    async (id, action, extra = {}) => {
      const res = await authedRequest(`/api/admin/inventory/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw data;
      return data;
    },
    []
  );

  async function archiveItems(ids, action) {
    try {
      for (const id of ids) await runAction(id, action);
      addToast(
        friendlyMessage('save_success', {
          description:
            action === 'archive'
              ? `${ids.length} item(s) archived. History, recipes and reports still resolve them.`
              : `${ids.length} item(s) restored.`,
        })
      );
      setSelected([]);
      fetchAll();
    } catch (error) {
      addToast(friendlyFromError(error, 'save_failed'));
    }
  }

  async function duplicateItem(item) {
    try {
      await runAction(item.id, 'duplicate');
      addToast(friendlyMessage('save_success', { description: `Copied ${item.item_name}. The copy starts with zero stock.` }));
      fetchAll();
    } catch (error) {
      addToast(friendlyFromError(error, 'save_failed'));
    }
  }

  const columns = useMemo(
    () => [
      {
        key: 'item_name',
        label: 'Item name',
        className: 'text-gray-900 font-medium',
        render: (row) => (
          <Link href={`${inventoryBase}/${row.id}`} className="inline-flex items-center gap-1.5 hover:underline">
            {row.item_name}
            <ExternalLink className="h-3 w-3 text-gray-300" />
          </Link>
        ),
      },
      {
        key: 'quantity',
        label: 'Current stock',
        align: 'right',
        numeric: true,
        value: (row) => Number(row.quantity ?? 0),
        render: (row) => (
          <button
            type="button"
            onClick={() => setAdjustItem(row)}
            title="Adjust stock (a reason is required)"
            className="tabular-nums font-medium text-gray-900 hover:underline"
          >
            {Number(row.quantity ?? 0)} <span className="text-xs font-normal text-gray-400">{row.consumption_unit || row.unit}</span>
          </button>
        ),
      },
      {
        key: 'unit',
        label: 'Unit',
        render: (row) => {
          const unit = row.consumption_unit || row.unit || '—';
          const differentPurchaseUnit = row.purchase_unit && row.purchase_unit !== unit;
          return (
            <div>
              <p className="text-gray-900">{unit}</p>
              {differentPurchaseUnit && <p className="text-xs text-gray-400">Bought as {row.purchase_unit} · 1 = {Number(row.conversion_factor || 1)} {unit}</p>}
            </div>
          );
        },
      },
      {
        key: 'cost_per_unit',
        label: 'Cost / unit',
        align: 'right',
        numeric: true,
        value: (row) => Number(row.cost_per_unit ?? 0),
        render: (row) => (
          <InlineEdit
            type="number"
            prefix="Rs "
            className="tabular-nums text-gray-900"
            value={Number(row.cost_per_unit ?? 0).toFixed(2)}
            onCommit={(v) => patchItem(row, { cost_per_unit: Number(v) })}
          />
        ),
      },
      {
        key: 'supplier',
        label: 'Supplier',
        render: (row) => (
          <InlineEdit
            value={row.supplier || ''}
            placeholder="Add supplier"
            onCommit={(v) => patchItem(row, { supplier: v })}
          />
        ),
      },
      {
        key: 'linked_menu_item_name',
        label: 'Menu link',
        render: (row) => row.linked_menu_item_name
          ? <StatusBadge tone="blue">{row.linked_menu_item_name}</StatusBadge>
          : <span className="text-xs text-gray-400">Recipe / not linked</span>,
      },
      {
        key: 'min_stock_level',
        label: 'Min stock',
        align: 'right',
        numeric: true,
        render: (row) => (
          <InlineEdit
            type="number"
            className="tabular-nums text-gray-900"
            value={row.min_stock_level ?? ''}
            onCommit={(v) => patchItem(row, { min_stock_level: Number(v) })}
          />
        ),
      },
      {
        key: 'status',
        label: 'Stock status',
        value: (row) => STATUS_META[statusOf(row)].label,
        render: (row) => {
          const meta = STATUS_META[statusOf(row)];
          return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>;
        },
      },
      {
        key: 'updated_at',
        label: 'Last updated',
        value: (row) => row.updated_at || '',
        render: (row) => (row.updated_at ? formatNepalDate(row.updated_at) : '—'),
      },
    ],
    [patchItem, inventoryBase]
  );

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Inventory</h1>
            <p className="mt-1 text-sm text-gray-500 sm:text-base">
              Every raw material, what it costs, and what needs attention today.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Link href={suppliersPath} className={BTN_SECONDARY}>
              <Users className="h-4 w-4" /> Suppliers
            </Link>
            <Link href={recipesPath} className={BTN_SECONDARY}>
              <ChefHat className="h-4 w-4" /> Recipes
            </Link>
            {!cashierPanel && <Link href="/admin/stock/import" className={BTN_SECONDARY}>
              <Upload className="h-4 w-4" /> Import
            </Link>}
            <Link href={`${inventoryBase}/movements`} className={BTN_SECONDARY}>Stock movements</Link>
            <Link href={purchasesPath} className={BTN_SECONDARY}>
              <Truck className="h-4 w-4" /> Receive delivery
            </Link>
            <button type="button" onClick={() => setFormItem({})} className={BTN_PRIMARY}>
              <Plus className="h-4 w-4" /> Add item
            </button>
          </div>
        </div>
      </header>

      <div className="space-y-5 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <KpiCards
          kpis={[
            { key: 'value', label: 'Stock on hand', value: totalValue, format: 'currency', sub: `${active.length} active items` },
            { key: 'low', label: 'Low stock', value: lowCount, format: 'number', sub: 'At or below minimum' },
            { key: 'out', label: 'Out of stock', value: outCount, format: 'number', sub: 'Nothing left to sell' },
            { key: 'waste', label: 'Wastage (30 days)', value: wastageCost, format: 'currency', sub: 'Posted as inventory loss' },
          ]}
        />

        {(lowCount + outCount > 0 || varianceEvents.length > 0) && (
          <div className="space-y-3">
            {lowCount + outCount > 0 && (
              <AttentionBar
                tone="amber"
                title={
                  lowCount + outCount === 1
                    ? '1 item needs restocking'
                    : `${lowCount + outCount} items need restocking`
                }
                body="Filter to Low stock or Out of stock below, then receive a delivery to top them up."
                action={
                  <button
                    type="button"
                    onClick={() => {
                      setShowArchived(false);
                      setStatusFilter('low');
                    }}
                    className="h-9 shrink-0 rounded-lg border border-amber-300 bg-white px-3 text-sm font-medium text-amber-800 hover:bg-amber-50"
                  >
                    Show them
                  </button>
                }
              />
            )}
            {varianceEvents.length > 0 && (
              <AttentionBar
                tone="red"
                title={`${varianceEvents.length} oversell${varianceEvents.length === 1 ? ' was' : 's were'} recorded`}
                body={`Orders deducted more than was on hand — most recently ${varianceEvents[0].item_name || 'an item'}. Stock was floored at zero and the shortfall recorded, so a stock count is worth doing.`}
              />
            )}
          </div>
        )}

        <DataGrid
          title={showArchived ? 'Archived items' : 'Inventory items'}
          columns={columns}
          rows={rows}
          csvName={showArchived ? 'inventory-archived' : 'inventory'}
          selected={selected}
          onSelectionChange={setSelected}
          searchPlaceholder="Search items, suppliers, categories…"
          defaultSort={{ key: 'item_name', dir: 'asc' }}
          empty={
            loading
              ? 'Loading inventory…'
              : showArchived
                ? 'Nothing is archived. Archived items stay out of pickers but keep their history.'
                : items.length
                  ? 'No items match these filters. Widen the category or status filter to see more.'
                  : 'No inventory items yet — add your first one, or import a supplier price list as CSV.'
          }
          footNote="Cost, supplier and minimum stock are editable in place. Quantity changes go through the adjustment flow so the reason is always recorded."
          rowClassName={(row) => (statusOf(row) === 'out' ? 'bg-red-50/40' : '')}
          toolbar={
            <>
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className={SELECT}>
                <option value="all">All categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={SELECT}>
                <option value="all">Any status</option>
                <option value="out">Out of stock</option>
                <option value="low">Low stock</option>
                <option value="optimal">In stock</option>
              </select>
              <select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)} className={SELECT}>
                <option value="all">All suppliers</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.name}>{s.name}</option>
                ))}
              </select>
              <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-gray-300 px-3 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(e) => {
                    setShowArchived(e.target.checked);
                    setSelected([]);
                  }}
                  className="h-4 w-4 rounded border-gray-300"
                />
                Archived
              </label>
            </>
          }
          bulkActions={
            showArchived ? (
              <button type="button" onClick={() => archiveItems(selected, 'unarchive')} className={BTN_BULK}>
                <ArchiveRestore className="h-3.5 w-3.5" /> Unarchive
              </button>
            ) : (
              <button type="button" onClick={() => archiveItems(selected, 'archive')} className={BTN_BULK}>
                <Archive className="h-3.5 w-3.5" /> Archive
              </button>
            )
          }
          renderActions={(row) => (
            <>
              <IconButton title="Adjust stock" onClick={() => setAdjustItem(row)}>
                <Scale className="h-4 w-4" />
              </IconButton>
              <IconButton title="Edit item" onClick={() => setFormItem(row)}>
                <Pencil className="h-4 w-4" />
              </IconButton>
              <IconButton title="Duplicate" onClick={() => duplicateItem(row)}>
                <Copy className="h-4 w-4" />
              </IconButton>
              <IconButton title="Log wastage" onClick={() => setWastageFor(row)}>
                <Trash2 className="h-4 w-4" />
              </IconButton>
              {Number(row.is_archived) === 1 ? (
                <IconButton title="Unarchive" onClick={() => archiveItems([row.id], 'unarchive')}>
                  <ArchiveRestore className="h-4 w-4" />
                </IconButton>
              ) : (
                <IconButton title="Archive" onClick={() => archiveItems([row.id], 'archive')}>
                  <Archive className="h-4 w-4" />
                </IconButton>
              )}
            </>
          )}
        />
      </div>

      {formItem && (
        <ItemFormModal
          item={formItem.id ? formItem : null}
          suppliers={suppliers}
          categories={categories}
          menuItems={menuItems}
          onClose={() => setFormItem(null)}
          onSaved={fetchAll}
        />
      )}
      {adjustItem && (
        <StockAdjustmentModal
          item={adjustItem}
          suppliers={suppliers}
          onClose={() => setAdjustItem(null)}
          onDone={fetchAll}
          onWastage={(item) => setWastageFor(item)}
        />
      )}
      {wastageFor && (
        <WastageModal
          request={authedRequest}
          presetItem={wastageFor.id ? wastageFor : null}
          onClose={() => setWastageFor(null)}
          onLogged={fetchAll}
        />
      )}
    </AdminLayout>
  );
}

const BTN_PRIMARY =
  'inline-flex items-center gap-1.5 rounded-xl bg-gray-900 px-3.5 py-2.5 text-sm font-semibold text-white hover:bg-gray-800';
const BTN_SECONDARY =
  'inline-flex items-center gap-1.5 rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50';
const BTN_BULK =
  'inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50';
const SELECT = 'h-10 rounded-lg border border-gray-300 px-3 text-sm text-gray-700';

function IconButton({ title, onClick, children }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-900"
    >
      {children}
    </button>
  );
}
