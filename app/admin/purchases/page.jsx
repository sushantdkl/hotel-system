'use client';

/**
 * Purchases — real `purchases` header rows in a table, with a detail drawer.
 * Nothing here reconstructs a timeline from stock movements any more.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import AdminLayout from '@/components/admin/admin-layout';
import { Ban, Pencil, Truck, Upload, Users } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { friendlyFromError } from '@/lib/friendly-message';
import { apiJson } from '@/lib/authed-fetch';
import DataGrid, { StatusBadge } from '@/components/admin/data-grid';
import useServerList from '@/lib/use-server-list';
import AttentionBar from '@/components/admin/attention-bar';
import { formatNepalDate } from '@/lib/time-utils';
import { KpiCards } from '@/components/admin/report-kit';
import ReceiveDeliveryModal from '@/components/purchases/receive-delivery-modal';
import PurchaseDrawer, { PURCHASE_STATUS } from '@/components/purchases/purchase-drawer';
import { useCapabilities } from '@/lib/use-capabilities.js';
import DateInput from '@/components/ui/date-input.jsx';
import { PAYMENT_FILTER_OPTIONS } from '@/lib/report-scope.js';
import { formatCurrency } from '@/lib/currency';
import { resolvePeriodRange } from '@/lib/report-dates.js';
import { useCalendarSystem } from '@/lib/calendar-context.jsx';
import { isAdminLike } from '@/lib/roles.js';

function paymentMethodLabel(method) {
  const m = String(method || 'cash').toLowerCase().trim();
  if (m === 'cash') return 'Cash';
  if (m === 'credit' || m === 'due' || m === 'unpaid') return 'Credit';
  if (['bank', 'bank_transfer', 'cheque', 'card', 'qr', 'fonepay', 'esewa', 'khalti', 'online'].includes(m)) return 'Online';
  if (m === 'business_funding') return 'Business Funding';
  if (m === 'owner_pocket') return 'Owner Pocket';
  if (!m) return 'Cash';
  return m.replace(/_/g, ' ');
}

/** Credit purchases settled later through Accounts Payable say so. */
function paidByLabel(r) {
  const label = paymentMethodLabel(r.payment_method);
  if (r.credit_due == null) return label;
  const due = Number(r.credit_due);
  if (due <= 0.009) return `${label} · Paid`;
  if (due < Number(r.total || 0) - 0.009) return `${label} · Rs ${due.toFixed(2)} due`;
  return label;
}

export default function PurchasesPage() {
  const { calendarSystem } = useCalendarSystem();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isCashierPanel = pathname?.startsWith('/cashier');
  const { can } = useCapabilities();
  const canCreate = can('purchases.create');
  const canImport = can('purchases.import');
  const canEdit = can('purchases.edit');
  const canCorrectPayment = can('purchases.payment_method_correct');
  const canVoid = can('purchases.void');
  const canViewSuppliers = can('suppliers.view');
  const { addToast } = useToast();
  const [items, setItems] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [employees, setEmployees] = useState([]);

  const [supplierFilter, setSupplierFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState({ calendarSystem: null, from: '', to: '' });
  const defaultDateRange = useMemo(
    () => resolvePeriodRange('this_month', null, null, { calendarSystem }),
    [calendarSystem]
  );
  const from = dateFilter.calendarSystem === calendarSystem ? dateFilter.from : defaultDateRange.start;
  const to = dateFilter.calendarSystem === calendarSystem ? dateFilter.to : defaultDateRange.end;
  const setFrom = useCallback(
    (value) => setDateFilter({ calendarSystem, from: value, to }),
    [calendarSystem, to]
  );
  const setTo = useCallback(
    (value) => setDateFilter({ calendarSystem, from, to: value }),
    [calendarSystem, from]
  );

  const [drawerId, setDrawerId] = useState(null);
  const [formPurchase, setFormPurchase] = useState(null); // {} for new

  useEffect(() => {
    const requestedPurchase = Number(searchParams.get('purchase'));
    if (requestedPurchase > 0) queueMicrotask(() => setDrawerId(requestedPurchase));
  }, [searchParams]);

  const filters = useMemo(
    () => ({ supplier_id: supplierFilter, status: statusFilter, payment_method: paymentFilter, from, to }),
    [supplierFilter, statusFilter, paymentFilter, from, to]
  );

  const {
    rows: purchases,
    extra,
    server,
    loading,
    reload: reloadPurchases,
  } = useServerList({
    url: '/api/admin/purchases',
    key: 'purchases',
    filters,
    initialSort: { key: 'invoice_date', dir: 'desc' },
    onError: (error) => addToast(friendlyFromError(error, 'load_failed')),
  });

  // Reference data for the drawer and the filter dropdowns — small, fixed lists
  // rather than anything that grows per order. Bumping refreshKey re-reads them
  // after a delivery is saved; the state writes stay inside promise callbacks.
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let currentUser = {};
    try { currentUser = JSON.parse(localStorage.getItem('pos_user') || '{}'); } catch { /* ignore */ }
    Promise.all([
      apiJson('/api/admin/inventory'),
      apiJson('/api/admin/suppliers?export=1').catch(() => ({ suppliers: [] })),
      isAdminLike(currentUser.role)
        ? apiJson('/api/admin/employees').catch(() => ({ employees: [] }))
        : Promise.resolve({ employees: [] }),
    ])
      .then(([inv, sup, emp]) => {
        if (cancelled) return;
        setItems(inv.items || []);
        setSuppliers(sup.suppliers || []);
        const activeEmployees = (emp.employees || []).filter((e) => e.is_active !== false);
        if (activeEmployees.length) {
          setEmployees(activeEmployees);
        } else {
          try {
            const me = JSON.parse(localStorage.getItem('pos_user') || '{}');
            setEmployees(me?.id ? [me] : []);
          } catch {
            setEmployees([]);
          }
        }
      })
      .catch((error) => {
        if (!cancelled) addToast(friendlyFromError(error, 'load_failed'));
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, addToast]);

  const fetchAll = useCallback(() => {
    reloadPurchases();
    setRefreshKey((k) => k + 1);
  }, [reloadPurchases]);

  // Tiles describe the whole filtered range and are summed in SQL.
  const summary = extra.summary;
  const spend = summary?.spend || 0;
  const partials = summary?.partials || 0;
  const voided = summary?.voided || 0;
  const liveCount = summary?.live || 0;
  const paymentTotals = summary?.paymentTotals || { cash: 0, digital: 0, credit: 0 };

  const columns = useMemo(
    () => [
      {
        key: 'invoice_number',
        label: 'Invoice',
        className: 'text-gray-900 font-medium',
        value: (r) => r.invoice_number || `#${r.id}`,
        render: (r) => (
          <button type="button" onClick={() => setDrawerId(r.id)} className="hover:underline">
            {r.invoice_number || `Purchase #${r.id}`}
          </button>
        ),
      },
      {
        key: 'invoice_date',
        label: 'Date',
        value: (r) => r.invoice_date || r.created_at || '',
        render: (r) => formatNepalDate(r.invoice_date || r.created_at),
      },
      { key: 'supplier', label: 'Supplier', value: (r) => r.supplier_name || r.supplier || '', render: (r) => r.supplier_name || r.supplier || <span className="text-gray-300">Not recorded</span> },
      { key: 'line_count', label: 'Lines', align: 'right', numeric: true, value: (r) => Number(r.line_count || 0) },
      {
        key: 'total',
        label: 'Total',
        align: 'right',
        numeric: true,
        className: 'text-gray-900 font-medium',
        value: (r) => Number(r.total || 0),
        render: (r) => `Rs ${Number(r.total || 0).toFixed(2)}`,
      },
      {
        key: 'payment_method',
        label: 'Paid by',
        value: (r) => paidByLabel(r),
        render: (r) => (
          <StatusBadge tone={r.credit_due == null ? 'gray' : Number(r.credit_due) > 0.009 ? 'amber' : 'green'}>
            {paidByLabel(r)}
          </StatusBadge>
        ),
      },
      {
        key: 'status',
        label: 'Status',
        value: (r) => (PURCHASE_STATUS[r.status] || {}).label || r.status,
        render: (r) => {
          const meta = PURCHASE_STATUS[r.status] || { label: r.status, tone: 'gray' };
          return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>;
        },
      },
      { key: 'received_by_name', label: 'Received by', render: (r) => r.received_by_name || <span className="text-gray-300">—</span> },
    ],
    []
  );

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Purchases</h1>
            <p className="mt-1 text-sm text-gray-500 sm:text-base">
              Every delivery you have received, what it cost, and the expense it created.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {canViewSuppliers && <Link href={isCashierPanel ? '/cashier/suppliers' : '/admin/suppliers'} className={BTN_SECONDARY}>
              <Users className="h-4 w-4" /> Suppliers
            </Link>}
            {canImport && <Link href={isCashierPanel ? '/cashier/purchases/import' : '/admin/purchases/import'} className={BTN_SECONDARY}>
              <Upload className="h-4 w-4" /> Import purchases
            </Link>}
            {canCreate && <button type="button" onClick={() => setFormPurchase({})} className={BTN_PRIMARY}>
              <Truck className="h-4 w-4" /> Receive delivery
            </button>}
          </div>
        </div>
      </header>

      <div className="space-y-5 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <KpiCards
          kpis={[
            { key: 'spend', label: 'Purchase spend', value: spend, format: 'currency', sub: `${liveCount} live purchases` },
            { key: 'partial', label: 'Partial deliveries', value: partials, format: 'number', sub: 'Still owed stock' },
            { key: 'suppliers', label: 'Suppliers used', value: summary?.suppliers_used || 0, format: 'number' },
            { key: 'voided', label: 'Voided', value: voided, format: 'number', sub: 'Stock and expense reversed' },
          ]}
        />

        {partials > 0 && (
          <AttentionBar
            tone="amber"
            title={`${partials} delivery${partials === 1 ? '' : 'ies'} arrived short`}
            body="Open one and edit it when the rest turns up — the stock difference is applied at that point, not before."
            action={
              <button
                type="button"
                onClick={() => setStatusFilter('partial')}
                className="h-9 shrink-0 rounded-lg border border-amber-300 bg-white px-3 text-sm font-medium text-amber-800 hover:bg-amber-50"
              >
                Show them
              </button>
            }
          />
        )}

        <DataGrid
          title="Purchase history"
          columns={columns}
          rows={purchases}
          server={server}
          csvName="purchases"
          onRowClick={(row) => setDrawerId(row.id)}
          searchPlaceholder="Search invoice, supplier…"
          empty={
            loading
              ? 'Loading purchases…'
              : 'No purchases match these filters. Receive a delivery to start building the history.'
          }
          footNote="Click any row for its lines, the stock it moved and the expense it generated."
          footer={
            <div className="flex flex-wrap items-baseline gap-x-8 gap-y-1">
              <span>TOTAL&nbsp;&nbsp;{formatCurrency(spend)}</span>
              <span className="tabular-nums">Cash&nbsp;&nbsp;{formatCurrency(paymentTotals.cash || 0)}</span>
              <span className="tabular-nums">Online&nbsp;&nbsp;{formatCurrency(paymentTotals.digital || 0)}</span>
              <span className="tabular-nums">Funding&nbsp;&nbsp;{formatCurrency(paymentTotals.funding || 0)}</span>
              <span className="tabular-nums">Credit&nbsp;&nbsp;{formatCurrency(paymentTotals.credit || 0)}</span>
            </div>
          }
          toolbar={
            <>
              <select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)} className={SELECT}>
                <option value="all">All suppliers</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={SELECT}>
                <option value="all">Any status</option>
                <option value="received">Received</option>
                <option value="partial">Partial</option>
                <option value="voided">Voided</option>
              </select>
              <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)} className={SELECT}>
                <option value="all">All payment methods</option>
                {PAYMENT_FILTER_OPTIONS.map((method) => (
                  <option key={method.id} value={method.id}>{method.label}</option>
                ))}
              </select>
              <DateInput value={from} onChange={setFrom} className={SELECT} aria-label="From date" />
              <DateInput value={to} onChange={setTo} className={SELECT} aria-label="To date" />
            </>
          }
          renderActions={(row) =>
            row.status === 'voided' ? (
              <span className="inline-flex items-center gap-1 px-2 text-xs text-gray-400">
                <Ban className="h-3.5 w-3.5" /> Voided
              </span>
            ) : canEdit ? (
              <button
                type="button"
                title="Edit purchase"
                aria-label="Edit purchase"
                onClick={() => setFormPurchase({ id: row.id })}
                className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-900"
              >
                <Pencil className="h-4 w-4" />
              </button>
            ) : null
          }
        />
      </div>

      {drawerId && (
        <PurchaseDrawer
          purchaseId={drawerId}
          canEdit={canEdit}
          canCorrectPayment={canCorrectPayment}
          canVoid={canVoid}
          onClose={() => setDrawerId(null)}
          onChanged={fetchAll}
          onEdit={(p) => {
            setDrawerId(null);
            setFormPurchase(p);
          }}
        />
      )}

      {formPurchase && (formPurchase.id ? canEdit : canCreate) && (
        <PurchaseFormLoader
          purchaseId={formPurchase.id}
          seed={formPurchase}
          items={items}
          suppliers={suppliers}
          employees={employees}
          onClose={() => setFormPurchase(null)}
          onSaved={fetchAll}
        />
      )}
    </AdminLayout>
  );
}

/**
 * The list rows carry no lines, so editing fetches the full purchase first.
 * Creating skips straight through with an empty shell.
 */
function PurchaseFormLoader({ purchaseId, seed, items, suppliers, employees, onClose, onSaved }) {
  const { addToast } = useToast();
  const [purchase, setPurchase] = useState(seed?.items ? seed : null);
  const [ready, setReady] = useState(!purchaseId || Boolean(seed?.items));

  useEffect(() => {
    if (ready) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await apiJson(`/api/admin/purchases/${purchaseId}`);
        if (!cancelled) setPurchase(data.purchase);
      } catch (error) {
        addToast(friendlyFromError(error, 'load_failed'));
        onClose();
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseId]);

  if (!ready) return null;

  return (
    <ReceiveDeliveryModal
      purchase={purchaseId ? purchase : null}
      items={items}
      suppliers={suppliers}
      employees={employees}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

const BTN_PRIMARY =
  'inline-flex items-center gap-1.5 rounded-xl bg-gray-900 px-3.5 py-2.5 text-sm font-semibold text-white hover:bg-gray-800';
const BTN_SECONDARY =
  'inline-flex items-center gap-1.5 rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50';
const SELECT = 'h-10 rounded-lg border border-gray-300 px-3 text-sm text-gray-700';
