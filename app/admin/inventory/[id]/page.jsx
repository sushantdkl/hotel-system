'use client';

import { useState, useEffect } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import AdminLayout from '@/components/admin/admin-layout';
import {
  ArrowLeft, Package, TrendingUp, TrendingDown, AlertTriangle, ChefHat,
  Truck, Trash, Wrench, Repeat, Pencil,
} from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { friendlyFromError } from '@/lib/friendly-message';
import QuickRestockModal from '@/components/inventory/quick-restock-modal';
import ItemFormModal from '@/components/inventory/item-form-modal';
import { formatNepalDate, formatNepalTime } from '@/lib/time-utils';
import { useCapabilities } from '@/lib/use-capabilities.js';
import { isAdminLike } from '@/lib/roles.js';

function authedRequest(url, options = {}) {
  const token = localStorage.getItem('pos_token');
  return fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...options.headers },
  });
}

const MOVEMENT_META = {
  purchase_receipt: { label: 'Purchase / Restock', icon: Truck, color: 'text-emerald-600 bg-emerald-50' },
  manual_restock: { label: 'Purchase / Restock', icon: Truck, color: 'text-emerald-600 bg-emerald-50' },
  opening_balance: { label: 'Opening Balance', icon: Truck, color: 'text-indigo-600 bg-indigo-50' },
  order_deduction: { label: 'Sale consumption (−)', icon: Repeat, color: 'text-sky-600 bg-sky-50' },
  order_void: { label: 'Cancel / void restore (+)', icon: Repeat, color: 'text-emerald-600 bg-emerald-50' },
  transfer: { label: 'Transfer', icon: Repeat, color: 'text-cyan-600 bg-cyan-50' },
  wastage: { label: 'Wastage', icon: Trash, color: 'text-red-600 bg-red-50' },
  manual_adjustment: { label: 'Manual Adjustment', icon: Wrench, color: 'text-amber-600 bg-amber-50' },
  adjustment: { label: 'Manual Adjustment', icon: Wrench, color: 'text-amber-600 bg-amber-50' },
};

/** 'manual_restock' is the pre-008 name for 'purchase_receipt'. */
const RECEIPT_TYPES = ['purchase_receipt', 'manual_restock', 'opening_balance'];

function statusOf(item) {
  const qty = Number(item.quantity ?? 0);
  const min = Number(item.min_stock_level ?? 0);
  if (qty <= 0) return 'out';
  if (min > 0 && qty <= min) return 'low';
  return 'optimal';
}

export default function InventoryItemDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const cashierPanel = pathname?.startsWith('/cashier');
  const inventoryBase = cashierPanel ? '/cashier/inventory' : '/admin/inventory';
  const recipeBase = cashierPanel ? '/cashier/recipes' : '/admin/recipes';
  const { role, can } = useCapabilities();
  const canManage = isAdminLike(role) || can('inventory.manage');
  const { addToast } = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showRestock, setShowRestock] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [suppliers, setSuppliers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [menuItems, setMenuItems] = useState([]);

  useEffect(() => {
    fetchData();
    // Edit picklists — same source the inventory list page uses.
    authedRequest('/api/admin/suppliers').then((r) => r.json()).then((d) => setSuppliers(d.suppliers || [])).catch(() => {});
    authedRequest('/api/admin/inventory-categories').then((r) => r.json()).then((d) => setCategories((d.categories || []).map((c) => c.name).filter(Boolean))).catch(() => {});
    authedRequest('/api/admin/products').then((r) => r.json()).then((d) => setMenuItems(d.products || [])).catch(() => {});
  }, [id]);

  async function fetchData() {
    setLoading(true);
    try {
      const res = await authedRequest(`/api/admin/inventory/${id}`);
      const json = await res.json();
      if (!res.ok) throw json;
      setData(json);
    } catch (error) {
      addToast(friendlyFromError(error, 'load_failed'));
    } finally {
      setLoading(false);
    }
  }

  if (loading || !data) {
    return (
      <AdminLayout>
        <div className="p-8 text-center text-gray-400">Loading raw material…</div>
      </AdminLayout>
    );
  }

  const { item, movements, recipesUsing, wastageEntries, lastPurchaseDate, purchases: purchaseInvoices = [] } = data;
  const status = statusOf(item);
  const purchases = movements.filter((m) => RECEIPT_TYPES.includes(m.change_type));
  const consumption = movements.filter((m) => m.change_type === 'order_deduction');
  const stockValue = Number(item.quantity || 0) * Number(item.cost_per_unit || 0);
  const purchasesBase = cashierPanel ? '/cashier/purchases' : '/admin/purchases';

  return (
    <AdminLayout>
      <header className="bg-white border-b border-gray-200 px-4 sm:px-6 lg:px-8 py-5 sm:py-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => router.push(inventoryBase)} className="p-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 shrink-0">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900 truncate">{item.item_name}</h1>
              <p className="text-gray-500 text-sm">{item.category || 'Uncategorized raw material'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {canManage && <button
              onClick={() => setShowEdit(true)}
              className="flex items-center gap-1.5 px-3 py-2.5 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 font-semibold text-sm"
            >
              <Pencil className="w-4 h-4" /> Edit
            </button>}
            <button
              onClick={() => setShowRestock(true)}
              className="flex items-center gap-1.5 px-3 py-2.5 bg-gray-900 text-white rounded-xl hover:bg-gray-800 font-semibold text-sm"
            >
              <Truck className="w-4 h-4" /> Restock
            </button>
          </div>
        </div>
      </header>

      <div className="p-4 sm:p-6 lg:p-8 bg-gray-50 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
          <StatCard label="Current Stock" value={`${item.quantity} ${item.consumption_unit || item.unit}`} icon={Package} color="blue" />
          <StatCard
            label="Stock Health"
            value={status === 'out' ? 'Out of Stock' : status === 'low' ? 'Low Stock' : 'Optimal'}
            icon={AlertTriangle}
            color={status === 'out' ? 'red' : status === 'low' ? 'amber' : 'emerald'}
          />
          <StatCard label="Cost / Unit" value={`Rs ${Number(item.cost_per_unit || 0).toFixed(2)}`} icon={TrendingUp} color="violet" />
          <StatCard label="Total Stock Value" value={`Rs ${stockValue.toFixed(0)}`} icon={TrendingDown} color="teal" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-2 text-sm">
            <h2 className="font-semibold text-gray-800 mb-2">Details</h2>
            <Row label="Min stock level" value={`${item.min_stock_level ?? '—'} ${item.consumption_unit || item.unit || ''}`} />
            <Row label="Unit" value={item.consumption_unit || item.unit || '—'} />
            {item.purchase_unit && item.purchase_unit !== (item.consumption_unit || item.unit) && (
              <Row label="Purchased as" value={`1 ${item.purchase_unit} = ${item.conversion_factor || 1} ${item.consumption_unit || item.unit}`} />
            )}
            <Row label="Supplier" value={item.supplier || '—'} />
            <Row label="Last purchase" value={lastPurchaseDate ? formatNepalDate(lastPurchaseDate) : 'Never'} />
            <Row label="Notes" value={item.notes || '—'} />
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <ChefHat className="w-4 h-4 text-rose-500" /> Recipes using this ingredient
            </h2>
            <div className="space-y-2">
              {recipesUsing.map((r) => (
                <Link
                  key={r.id}
                  href={`${recipeBase}/${r.id}`}
                  className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-sm hover:bg-gray-50"
                >
                  <span className="font-medium text-gray-800">{r.menu_item_name || r.name}</span>
                  <span className="text-gray-500">{r.quantity} {r.unit}</span>
                </Link>
              ))}
              {!recipesUsing.length && <p className="text-sm text-gray-400">Not used in any recipe yet.</p>}
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="font-semibold text-gray-800 mb-3">Purchase &amp; Wastage Summary</h2>
            <div className="space-y-2 text-sm">
              <Row label="Purchases logged" value={Math.max(purchases.length, purchaseInvoices.length)} />
              <Row label="Consumption events" value={consumption.length} />
              <Row label="Wastage entries" value={wastageEntries.length} />
              <Row
                label="Total wasted qty"
                value={`${wastageEntries.reduce((s, w) => s + Number(w.quantity || 0), 0).toFixed(2)} ${item.consumption_unit || item.unit || ''}`}
              />
            </div>
            {purchaseInvoices.length > 0 && (
              <div className="mt-4 border-t border-gray-100 pt-3 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Purchase invoices</p>
                {purchaseInvoices.slice(0, 8).map((p) => (
                  <Link
                    key={p.id}
                    href={purchasesBase}
                    className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2 text-sm hover:bg-gray-50"
                  >
                    <span className="min-w-0 truncate font-medium text-gray-800">
                      #{p.id}{p.invoice_number ? ` · ${p.invoice_number}` : ''}{p.supplier ? ` · ${p.supplier}` : ''}
                    </span>
                    <span className="shrink-0 tabular-nums text-gray-500">
                      {Number(p.quantity_received || 0)} · Rs {Number(p.line_total || 0).toFixed(0)}
                    </span>
                  </Link>
                ))}
                <Link href={purchasesBase} className="inline-block text-xs font-semibold text-gray-700 underline">
                  Open all purchases
                </Link>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="font-semibold text-gray-800 mb-4">Stock Movement Timeline</h2>
          <div className="space-y-0 max-h-[520px] overflow-y-auto">
            {movements.map((m, idx) => {
              const meta = MOVEMENT_META[m.change_type] || { label: m.change_type, icon: Package, color: 'text-gray-600 bg-gray-50' };
              const Icon = meta.icon;
              return (
                <div key={m.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${meta.color}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    {idx < movements.length - 1 && <div className="w-px flex-1 bg-gray-200" />}
                  </div>
                  <div className="pb-5 min-w-0">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium text-gray-800">{meta.label}</span>
                      <span className={`font-semibold ${Number(m.quantity_changed) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                        {Number(m.quantity_changed) > 0 ? '+' : ''}{m.quantity_changed} {item.consumption_unit || item.unit}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {formatNepalTime(m.created_at)} · {m.performed_by_name || 'System'}
                      {m.reason ? ` · ${m.reason}` : ''}
                      {RECEIPT_TYPES.includes(m.change_type) && m.reference_id ? (
                        <>
                          {' · '}
                          <Link href={purchasesBase} className="font-semibold text-gray-700 underline">
                            Purchase #{m.reference_id}
                          </Link>
                        </>
                      ) : null}
                    </p>
                  </div>
                </div>
              );
            })}
            {!movements.length && <p className="text-sm text-gray-400">No stock movements recorded yet.</p>}
          </div>
        </div>
      </div>

      {showRestock && (
        <QuickRestockModal
          item={item}
          onClose={() => setShowRestock(false)}
          onRestocked={() => {
            setShowRestock(false);
            fetchData();
          }}
        />
      )}
      {showEdit && (
        <ItemFormModal
          item={item}
          suppliers={suppliers}
          categories={categories}
          menuItems={menuItems}
          onClose={() => setShowEdit(false)}
          onSaved={() => {
            setShowEdit(false);
            fetchData();
          }}
        />
      )}
    </AdminLayout>
  );
}

const STAT_CHIP_COLORS = {
  blue: 'bg-blue-50 text-blue-600',
  red: 'bg-red-50 text-red-600',
  amber: 'bg-amber-50 text-amber-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  violet: 'bg-violet-50 text-violet-600',
  teal: 'bg-teal-50 text-teal-600',
};

function StatCard({ label, value, icon: Icon, color }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-6 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-gray-500 text-xs sm:text-sm font-medium">{label}</p>
          <h3 className="text-lg sm:text-2xl font-bold text-gray-900 mt-1 truncate">{value}</h3>
        </div>
        <div className={`p-2 sm:p-3 rounded-lg shrink-0 ${STAT_CHIP_COLORS[color] || 'bg-gray-50 text-gray-600'}`}>
          <Icon className="w-5 h-5 sm:w-6 sm:h-6" />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-800 text-right">{value}</span>
    </div>
  );
}
