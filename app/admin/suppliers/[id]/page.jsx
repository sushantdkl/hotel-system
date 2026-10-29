'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Boxes, Building2, CreditCard, History, Loader2, Mail, MapPin, Phone, ReceiptText, Truck } from 'lucide-react';
import AdminLayout from '@/components/admin/admin-layout';
import CreditTimeline from '@/components/profiles/credit-timeline';
import { apiJson } from '@/lib/authed-fetch';
import { formatCurrency } from '@/lib/currency';
import { formatNepalDate } from '@/lib/time-utils';
import { buildSupplierCreditTimeline } from '@/lib/credit-timeline';
import PurchaseDrawer from '@/components/purchases/purchase-drawer';
import ProfileTabActions from '@/components/profiles/profile-tab-actions';

function suppliersPath() {
  return typeof window !== 'undefined' && window.location.pathname.startsWith('/cashier') ? '/cashier/suppliers' : '/admin/suppliers';
}

function paymentMethodLabel(method) {
  if (method === 'business_funding') return 'Business Funding';
  if (method === 'cash') return 'Cash';
  if (method === 'online') return 'Online';
  return '—';
}

export default function SupplierProfilePage() {
  const { id } = useParams();
  const router = useRouter();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('purchases');
  const [purchaseDrawerId, setPurchaseDrawerId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await apiJson(`/api/admin/suppliers/${id}/profile`)); }
    catch (err) { setError(err.error || err.message || 'Could not load supplier.'); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <AdminLayout><div className="flex min-h-[60vh] items-center justify-center text-gray-500"><Loader2 className="mr-2 h-5 w-5 animate-spin"/>Loading supplier…</div></AdminLayout>;
  if (error || !data?.supplier) return <AdminLayout><div className="p-8 text-center"><p className="text-red-600">{error || 'Supplier not found.'}</p><button onClick={() => router.push(suppliersPath())} className="mt-4 text-sm text-blue-700 underline">Back to suppliers</button></div></AdminLayout>;

  const { supplier, summary, purchases, items, ledger, payments, open_invoices: openInvoices } = data;
  const timeline = buildSupplierCreditTimeline({ supplier, purchases, ledger });
  const tabs = [
    ['timeline', `Timeline (${timeline.length})`, History],
    ['purchases', `Purchases (${purchases.length})`, Truck],
    ['items', `Items supplied (${items.length})`, Boxes],
    ['ledger', 'Payable ledger', ReceiptText],
    ['payments', `Payments (${payments.length})`, CreditCard],
  ];
  const exportsByTab = {
    timeline: {
      label: 'Credit timeline',
      headers: ['Date', 'Activity', 'Description', 'Amount', 'Balance', 'Status'],
      rows: timeline.map((event) => [formatNepalDate(event.at), event.title, event.description, event.amount > 0 ? formatCurrency(event.amount) : '', event.balanceLabel ? formatCurrency(event.balance) : '', String(event.status || '').replaceAll('_', ' ')]),
    },
    purchases: {
      label: 'Purchases',
      headers: ['Date', 'Invoice', 'Payment', 'Received by', 'Status', 'Total'],
      rows: purchases.map((row) => [formatNepalDate(row.invoice_date || row.created_at), row.invoice_number || `Purchase #${row.id}`, String(row.payment_method || 'cash').replaceAll('_', ' '), row.received_by_name || '—', String(row.status || 'received').replaceAll('_', ' '), formatCurrency(row.total)]),
    },
    items: {
      label: 'Items supplied',
      headers: ['Item', 'Purchase unit', 'Deliveries', 'Quantity received', 'Total value', 'Last received'],
      rows: items.map((row) => [row.item_name, row.purchase_unit || row.consumption_unit || '—', row.purchase_count, Number(row.quantity_received).toLocaleString('en-IN'), formatCurrency(row.total_value), formatNepalDate(row.last_received)]),
    },
    ledger: {
      label: 'Payable ledger',
      headers: ['Date', 'Activity', 'Debit / paid', 'Credit / charged', 'Running payable', 'Memo'],
      rows: ledger.map((row) => [formatNepalDate(row.entry_date), String(row.source_type || 'entry').replaceAll('_', ' '), row.debit ? formatCurrency(row.debit) : '—', row.credit ? formatCurrency(row.credit) : '—', formatCurrency(row.running_balance), row.memo || '—']),
    },
    payments: {
      label: 'Payments',
      headers: ['Date', 'Activity', 'Method', 'Amount', 'Memo'],
      rows: payments.map((row) => [formatNepalDate(row.entry_date), row.source_type === 'reversal' ? 'Payment reversed' : 'Payment', paymentMethodLabel(row.payment_method), formatCurrency(row.debit || row.credit), row.memo || '—']),
    },
  };
  const activeExport = exportsByTab[tab];

  return <AdminLayout><main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
    <button onClick={() => router.push(suppliersPath())} className="mb-4 inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-950"><ArrowLeft className="h-4 w-4"/>Suppliers</button>
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-5"><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-wide text-teal-700">Supplier #{supplier.id}</p><h1 className="mt-1 text-2xl font-bold text-gray-950">{supplier.name}</h1><p className="mt-1 text-sm text-gray-500">Registered {formatNepalDate(supplier.created_at)}</p><div className="mt-4 space-y-1.5 text-sm text-gray-700">{supplier.phone && <p className="flex items-center gap-2"><Phone className="h-4 w-4 text-gray-400"/>{supplier.phone}</p>}{supplier.email && <p className="flex items-center gap-2"><Mail className="h-4 w-4 text-gray-400"/>{supplier.email}</p>}{supplier.address && <p className="flex items-center gap-2"><MapPin className="h-4 w-4 text-gray-400"/>{supplier.address}</p>}{!supplier.phone && !supplier.email && !supplier.address && <p className="flex items-center gap-2 text-gray-400"><Building2 className="h-4 w-4"/>No contact details recorded</p>}</div>{supplier.notes && <p className="mt-4 rounded-xl bg-gray-50 p-3 text-sm text-gray-600">{supplier.notes}</p>}</div>
        <div className="grid w-full grid-cols-2 gap-3 sm:w-auto sm:min-w-[400px] sm:grid-cols-3"><Stat label="Total spend" value={formatCurrency(summary.total_spend)}/><Stat label="Outstanding" value={formatCurrency(summary.outstanding_payable)} tone={summary.outstanding_payable > 0 ? 'red' : 'green'}/><Stat label="Total paid" value={formatCurrency(summary.total_paid)}/><Stat label="Purchases" value={summary.purchases}/><Stat label="Open invoices" value={summary.open_invoices}/><Stat label="Items supplied" value={summary.supplied_items}/></div></div>
      {openInvoices.length > 0 && <div className="mt-5 border-t border-gray-100 pt-4"><p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{openInvoices.length} invoice(s) remain open · {formatCurrency(summary.outstanding_payable)} payable.</p></div>}
    </section>
    <nav className="mt-5 flex flex-wrap gap-2 border-b border-gray-200 pb-2">{tabs.map(([key,label,Icon]) => <button key={key} onClick={() => setTab(key)} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium ${tab === key ? 'bg-gray-950 text-white' : 'text-gray-600 hover:bg-gray-100'}`}><Icon className="h-4 w-4"/>{label}</button>)}</nav>
    <section className="mt-4 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <ProfileTabActions entity={supplier.name} tab={activeExport.label} headers={activeExport.headers} rows={activeExport.rows} />
      {tab === 'timeline' && <CreditTimeline events={timeline} onOpenPurchase={setPurchaseDrawerId} empty="No supplier-credit activity recorded." />}
      {tab === 'purchases' && <Table onRowClick={(index) => setPurchaseDrawerId(purchases[index].id)} empty="No purchases from this supplier." headers={['Date','Invoice','Payment','Received by','Status','Total']} rows={purchases.map((row) => [formatNepalDate(row.invoice_date || row.created_at),row.invoice_number || `Purchase #${row.id}`,String(row.payment_method || 'cash').replaceAll('_',' '),row.received_by_name || '—',<Status key="s" value={row.status}/>,formatCurrency(row.total)])}/>}
      {tab === 'items' && <Table empty="No supplied items." headers={['Item','Purchase unit','Deliveries','Quantity received','Total value','Last received']} rows={items.map((row) => [row.item_name,row.purchase_unit || row.consumption_unit || '—',row.purchase_count,Number(row.quantity_received).toLocaleString('en-IN'),formatCurrency(row.total_value),formatNepalDate(row.last_received)])}/>}
      {tab === 'ledger' && <Table empty="No payable-ledger entries." headers={['Date','Activity','Debit / paid','Credit / charged','Running payable','Memo']} rows={ledger.map((row) => [formatNepalDate(row.entry_date),String(row.source_type || 'entry').replaceAll('_',' '),row.debit ? formatCurrency(row.debit) : '—',row.credit ? formatCurrency(row.credit) : '—',formatCurrency(row.running_balance),row.memo || '—'])}/>}
      {tab === 'payments' && <Table empty="No supplier payments." headers={['Date','Activity','Method','Amount','Memo']} rows={payments.map((row) => [formatNepalDate(row.entry_date),row.source_type === 'reversal' ? 'Payment reversed' : 'Payment',paymentMethodLabel(row.payment_method),formatCurrency(row.debit || row.credit),row.memo || '—'])}/>}
    </section>
    {purchaseDrawerId ? <PurchaseDrawer purchaseId={purchaseDrawerId} onClose={() => setPurchaseDrawerId(null)} onChanged={load} canEdit={false} canVoid={false} /> : null}
  </main></AdminLayout>;
}

function Stat({ label, value, tone }) { const color=tone==='red'?'text-red-700':tone==='green'?'text-emerald-700':'text-gray-950'; return <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2"><p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p><p className={`mt-1 font-bold tabular-nums ${color}`}>{value}</p></div>; }
function Status({ value }) { return <span className={`rounded-full px-2 py-1 text-xs font-semibold capitalize ${value === 'voided' ? 'bg-gray-100 text-gray-500' : value === 'partial' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>{String(value || 'received').replaceAll('_',' ')}</span>; }
function Table({ headers, rows, empty, onRowClick }) { if (!rows.length) return <p className="py-14 text-center text-sm text-gray-400">{empty}</p>; return <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase text-gray-500"><tr>{headers.map((header) => <th key={header} className="px-4 py-3 font-semibold">{header}</th>)}</tr></thead><tbody className="divide-y divide-gray-100">{rows.map((row,index) => <tr key={index} onClick={onRowClick ? () => onRowClick(index) : undefined} className={`hover:bg-gray-50 ${onRowClick ? 'cursor-pointer' : ''}`}>{row.map((cell,cellIndex) => <td key={cellIndex} className="px-4 py-3 text-gray-700">{cell}</td>)}</tr>)}</tbody></table></div>; }
