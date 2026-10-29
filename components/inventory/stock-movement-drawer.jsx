'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowDownUp, ExternalLink, Package, X } from 'lucide-react';
import { StatusBadge } from '@/components/admin/data-grid.jsx';
import { formatNepalDate, formatNepalTime } from '@/lib/time-utils.js';

const LABELS = {
  manual_adjustment: 'Manual correction', purchase_receipt: 'Purchase receipt', wastage: 'Wastage',
  order_deduction: 'Sale consumption (−)', order_void: 'Cancel / void restore (+)', transfer: 'Transfer',
  opening_balance: 'Opening balance', manual_restock: 'Legacy purchase', adjustment: 'Legacy adjustment',
  stock_count: 'Stock count', correction: 'Correction',
};
const ADJUSTMENTS = new Set(['manual_adjustment', 'adjustment', 'stock_count', 'correction']);
const qty = (value) => value == null ? '—' : Number(value).toLocaleString('en-IN', { maximumFractionDigits: 4 });

function Detail({ label, children }) {
  return <div className="min-w-0"><dt className="text-xs font-medium text-gray-500">{label}</dt><dd className="mt-1 break-words text-sm text-gray-900">{children ?? '—'}</dd></div>;
}

export default function StockMovementDrawer({ movement, onClose }) {
  const pathname = usePathname();
  const root = pathname?.startsWith('/cashier') ? '/cashier' : '/admin';
  const type = movement?.change_type;
  const sourceHref = ['purchase_receipt', 'manual_restock'].includes(type)
    ? `${root}/purchases?purchase=${movement?.reference_id}`
    : ['order_deduction', 'order_void'].includes(type)
      ? `${root}/orders/${movement?.reference_id}`
      : type === 'wastage' ? `${root}/wastage` : null;
  const movementValue = movement?.unit_cost == null ? null : Math.abs(Number(movement.quantity_changed || 0) * Number(movement.unit_cost || 0));

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => { if (event.key === 'Escape') onClose(); };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose]);

  if (!movement) return null;
  const change = Number(movement.quantity_changed || 0);

  return (
    <div className="fixed inset-0 z-[100] flex justify-end">
      <button type="button" aria-label="Close stock movement details" className="absolute inset-0 bg-gray-950/50 backdrop-blur-[1px]" onClick={onClose} />
      <aside role="dialog" aria-modal="true" aria-labelledby="movement-detail-title" className="relative z-10 flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-white shadow-2xl animate-in slide-in-from-right-4 duration-200 motion-reduce:animate-none">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-gray-200 bg-white px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-400">Stock movement #{movement.id}</p>
            <h2 id="movement-detail-title" className="mt-1 break-words text-xl font-bold text-gray-950 sm:text-2xl">{movement.item_name || `Inventory item ${movement.inventory_item_id}`}</h2>
            <div className="mt-2 flex flex-wrap gap-2"><StatusBadge tone={ADJUSTMENTS.has(type) ? 'violet' : change < 0 ? 'red' : 'blue'}>{LABELS[type] || String(type || '').replace(/_/g, ' ')}</StatusBadge></div>
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-950" aria-label="Close"><X className="h-5 w-5" /></button>
        </header>

        <div className="flex-1 space-y-5 bg-gray-50/60 p-4 sm:p-6">
          <section className="grid overflow-hidden rounded-xl border border-gray-200 bg-white sm:grid-cols-3">
            {[['Before', qty(movement.balance_before)], ['Change', `${change > 0 ? '+' : ''}${qty(change)}`], ['After', qty(movement.balance_after)]].map(([label, value], index) => (
              <div key={label} className={`p-4 ${index < 2 ? 'border-b border-gray-100 sm:border-b-0 sm:border-r' : ''}`}><p className="text-xs font-medium text-gray-500">{label}</p><p className={`mt-1 text-xl font-bold tabular-nums ${label === 'Change' ? (change < 0 ? 'text-red-700' : 'text-emerald-700') : 'text-gray-950'}`}>{value} <span className="text-xs font-medium text-gray-400">{movement.unit || ''}</span></p></div>
            ))}
          </section>

          <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 sm:px-5"><ArrowDownUp className="h-4 w-4 text-gray-400" /><h3 className="text-sm font-semibold text-gray-950">Movement details</h3></div>
            <dl className="grid gap-5 p-4 sm:grid-cols-2 sm:p-5">
              <Detail label="Report date">{formatNepalDate(movement.report_date)}</Detail>
              <Detail label="Recorded timestamp">{formatNepalTime(movement.created_at)}</Detail>
              <Detail label="Performed by">{movement.performed_by_name || (movement.performed_by ? `User ${movement.performed_by}` : 'Not recorded')}</Detail>
              <Detail label="Business day">{movement.business_date ? formatNepalDate(movement.business_date) : 'Not attributed'}</Detail>
              <Detail label="Unit cost">{movement.unit_cost == null ? 'Not recorded' : `Rs ${Number(movement.unit_cost).toFixed(2)}`}</Detail>
              <Detail label="Movement value">{movementValue == null ? 'Not recorded' : `Rs ${movementValue.toFixed(2)}`}</Detail>
              <Detail label="Reference">{movement.reference_id || 'Not linked'}</Detail>
              <Detail label="Movement code">{type || 'Not recorded'}</Detail>
            </dl>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5"><h3 className="text-sm font-semibold text-gray-950">Reason / audit note</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-600">{movement.reason || 'No reason was recorded for this movement.'}</p>{type === 'order_void' ? <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-900">Green (+) restore: stock returned because an order line was cancelled, voided, or reduced — not because a sale increased inventory.</p> : null}{type === 'order_deduction' ? <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-900">Red (−) consumption: inventory used when the dish/pack was added to an order (or walk-in sale completed).</p> : null}</section>

          <div className="flex flex-wrap gap-2">
            <Link href={`${root}/inventory/${movement.inventory_item_id}`} onClick={onClose} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50"><Package className="h-4 w-4" /> Open inventory item</Link>
            {sourceHref && movement.reference_id ? <Link href={sourceHref} onClick={onClose} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-gray-950 px-4 text-sm font-semibold text-white">Open source record <ExternalLink className="h-4 w-4" /></Link> : null}
          </div>
        </div>

        <footer className="sticky bottom-0 flex justify-end border-t border-gray-200 bg-white px-5 py-3 sm:px-6"><button type="button" onClick={onClose} className="min-h-10 rounded-lg border border-gray-300 px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50">Close</button></footer>
      </aside>
    </div>
  );
}
