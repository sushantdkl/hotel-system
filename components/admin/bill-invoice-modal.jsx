'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { Bike, ChefHat, Globe, History, LayoutGrid, LoaderCircle, MessageCircle, ReceiptText, ShoppingBag, X } from 'lucide-react';
import { formatValue } from '@/components/admin/report-kit.jsx';
import { formatNepalDateTime } from '@/lib/report-dates.js';
import { compactBillNumber, compactOrderNumber } from '@/lib/document-display.js';
import { latestReopenChanges, buildChangeIndex } from '@/lib/reopen-diff.js';
import KotPopup from '@/components/admin/kot-popup.jsx';
import { SittingTime } from '@/components/tables/table-open-duration.jsx';
import { billPaymentHistory } from '@/lib/bill-payment-history.js';
import { billMessage, openWhatsapp } from '@/lib/whatsapp.js';

const KOT_BADGE = {
  pending: 'bg-amber-100 text-amber-700',
  preparing: 'bg-sky-100 text-sky-700',
  completed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
  voided: 'bg-red-100 text-red-700',
};

const PAY_BADGE = {
  paid: 'bg-emerald-100 text-emerald-700',
  partial: 'bg-amber-100 text-amber-700',
  unpaid: 'bg-red-100 text-red-700',
};

const BILL_BADGE = {
  open_order: 'bg-sky-100 text-sky-700', open: 'bg-sky-100 text-sky-700',
  unpaid: 'bg-amber-100 text-amber-700', paid: 'bg-emerald-100 text-emerald-700',
  partially_paid: 'bg-amber-100 text-amber-700', reopened: 'bg-blue-100 text-blue-700',
  voided: 'bg-red-100 text-red-700', void: 'bg-red-100 text-red-700',
  cancelled: 'bg-red-100 text-red-700', canceled: 'bg-red-100 text-red-700',
};

const CHANNEL_BADGE = {
  counter: 'bg-slate-100 text-slate-700', takeaway: 'bg-sky-100 text-sky-700',
  delivery: 'bg-orange-100 text-orange-700', online: 'bg-indigo-100 text-indigo-700',
};
const CHANNEL_LABEL = { counter: 'Table', takeaway: 'Takeaway', delivery: 'Delivery', online: 'Online' };
const CHANNEL_ICON = { counter: LayoutGrid, takeaway: ShoppingBag, delivery: Bike, online: Globe };

export default function BillInvoiceModal({ billId, onClose }) {
  const pathname = usePathname();
  const router = useRouter();
  const [bill, setBill] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [kotPopupId, setKotPopupId] = useState(null);
  const [settings, setSettings] = useState({});

  // Restaurant name for the WhatsApp bill; it is left out if this fails.
  useEffect(() => {
    fetch('/api/admin/settings', { headers: { Authorization: `Bearer ${localStorage.getItem('pos_token')}` } })
      .then((res) => (res.ok ? res.json() : {}))
      .then((data) => setSettings(data.settings || {}))
      .catch(() => {});
  }, []);

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/bills/${billId}`, {
        signal,
        headers: { Authorization: `Bearer ${localStorage.getItem('pos_token')}` },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'The bill could not be loaded.');
      setBill(body.bill || null);
    } catch (loadError) {
      if (loadError.name !== 'AbortError') setError(loadError.message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [billId]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => { if (event.key === 'Escape') onClose(); };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      controller.abort();
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [load, onClose]);

  if (!billId || typeof document === 'undefined') return null;

  const paymentHistory = bill ? billPaymentHistory(bill.payments, bill.allocations) : [];

  return createPortal(
    <div className="fixed inset-0 z-[110] flex justify-end">
      <button type="button" className="absolute inset-0 bg-black/30" onClick={onClose} aria-label="Close bill details" />
      <section className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label="Bill details">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-5 py-4">
          <h2 className="flex items-center gap-2 font-semibold text-gray-900"><ReceiptText className="h-5 w-5 text-emerald-600" /> Bill details</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 hover:bg-gray-100" aria-label="Close bill details"><X className="h-5 w-5" /></button>
        </div>

        {loading ? (
          <div className="flex min-h-96 items-center justify-center p-5"><LoaderCircle className="h-6 w-6 animate-spin text-gray-400" /></div>
        ) : error ? (
          <div className="p-5 text-sm text-red-600">{error}</div>
        ) : !bill ? null : (
          <div className="space-y-5 p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-lg font-bold text-gray-900">{compactBillNumber(bill.billNumber)}</p>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-400">
                  {bill.orderId ? <button type="button" onClick={() => { onClose(); router.push(`${pathname?.startsWith('/cashier') ? '/cashier' : '/admin'}/orders/${bill.orderId}`); }} className="font-semibold text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900" title="Open order details">{compactOrderNumber(bill.orderNumber)}</button> : compactOrderNumber(bill.orderNumber)}
                  <span>·</span><ChannelBadge channel={bill.channel} />
                </p>
              </div>
              <div className="text-right">
                <span className={`rounded-full px-2 py-0.5 text-xs capitalize ${BILL_BADGE[bill.billStatus] || 'bg-gray-100 text-gray-700'}`}>{prettyStatus(bill.billStatus)}</span>
                <span className={`ml-1 rounded-full px-2 py-0.5 text-xs capitalize ${PAY_BADGE[bill.paymentStatus] || PAY_BADGE.unpaid}`}>{bill.paymentStatus}</span>
                <p className="mt-1 text-xs text-gray-400">{formatNepalDateTime(bill.createdAt)}</p>
              </div>
            </div>

            {bill.voided?.reason && <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700"><span className="font-semibold">Void reason:</span> {bill.voided.reason}{bill.voided.at && <span className="block text-xs text-red-600/80">Voided {formatNepalDateTime(bill.voided.at)}</span>}</div>}
            {bill.customer && <p className="text-sm text-gray-600">Customer: <span className="font-medium">{bill.customer.name}</span>{bill.customer.phone ? ` · ${bill.customer.phone}` : ''}</p>}
            <button type="button" onClick={() => openWhatsapp(bill.customer?.phone, billMessage(bill, settings.restaurant_name))} className="inline-flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 px-3 py-1.5 text-sm font-medium text-green-800 hover:bg-green-100">
              <MessageCircle className="h-4 w-4" /> WhatsApp bill
            </button>
            {(bill.legacy.tableNumber || bill.legacy.cashierName) && <p className="text-xs text-gray-400">Legacy: {bill.legacy.tableNumber ? `Table ${bill.legacy.tableNumber}` : ''} {bill.legacy.cashierName ? `· ${bill.legacy.cashierName}` : ''}</p>}
            {bill.legacy.tableNumber && (
              <p className="text-xs text-gray-500">
                Sitting time: <SittingTime
                  openedAt={bill.openedAt || bill.createdAt}
                  closedAt={bill.paidAt}
                  status={bill.orderStatus || bill.billStatus}
                  dineIn
                />
                {bill.openedAt ? ` · opened ${formatNepalDateTime(bill.openedAt)}` : ''}
                {bill.paidAt ? ` · paid ${formatNepalDateTime(bill.paidAt)}` : ''}
              </p>
            )}

            <BillItemsSection bill={bill} />

            <Section title="Kitchen tickets (KOT)">
              {bill.kots?.length ? (
                <div className="divide-y divide-gray-100">
                  {bill.kots.map((kot) => (
                    <button
                      key={kot.id}
                      type="button"
                      onClick={() => setKotPopupId(kot.id)}
                      className="flex w-full items-center justify-between gap-2 py-2 text-left text-sm hover:bg-gray-50"
                    >
                      <span className="flex items-center gap-2 font-medium text-blue-700 underline decoration-blue-300 underline-offset-2">
                        <ChefHat className="h-3.5 w-3.5 shrink-0 text-gray-400" />{kot.kotNumber}
                      </span>
                      <span className="flex items-center gap-2 text-xs text-gray-500">
                        {kot.quantity} item{kot.quantity === 1 ? '' : 's'}
                        {kot.status && <span className={`rounded-full px-2 py-0.5 font-medium capitalize ${KOT_BADGE[String(kot.status).toLowerCase()] || 'bg-gray-100 text-gray-700'}`}>{kot.status}</span>}
                      </span>
                    </button>
                  ))}
                </div>
              ) : <p className="text-sm text-gray-400">No kitchen ticket was generated for this order.</p>}
            </Section>

            <Section title="Totals">
              <Row label="Subtotal" value={bill.totals.subtotal} />
              {bill.totals.deliveryFee > 0 && <Row label="Delivery" value={bill.totals.deliveryFee} />}
              {bill.totals.discount > 0 && <Row label={bill.promotion ? `${bill.promotion.name}${bill.promotion.code ? ` (${bill.promotion.code})` : ''}` : bill.discountLabel || 'Discount'} value={-bill.totals.discount} />}
              {bill.totals.tax > 0 && <Row label="Tax / VAT" value={bill.totals.tax} />}
              {bill.totals.serviceCharge > 0 && <Row label="Service charge" value={bill.totals.serviceCharge} />}
              <Row label="Grand total" value={bill.totals.grandTotal} bold />
              <Row label="Paid" value={bill.totals.paid} />
              {bill.totals.balance > 0 && <Row label="Balance" value={bill.totals.balance} amber />}
            </Section>

            <Section title="Payment history">
              {paymentHistory.length ? paymentHistory.map((payment) => <div key={`${payment.method}-${payment.id}`} className="flex items-center justify-between py-1 text-sm"><span className="text-gray-600">{payment.method === 'cash' ? 'Cash' : payment.method === 'credit' ? 'Credit / Due' : 'Online'}{payment.reference ? ` · ${payment.reference}` : ''}</span><span className="tabular-nums">{formatValue(payment.amount, 'currency')}</span></div>) : <p className="text-sm text-gray-400">No payments recorded.</p>}
            </Section>

            <Section title="Activity timeline">
              {bill.activity.length ? bill.activity.map((activity) => <div key={activity.id} className="flex items-start gap-2 py-1.5 text-xs"><History className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-300" /><div className="min-w-0 flex-1"><p className="text-gray-700">{String(activity.event).replaceAll('_', ' ')}{activity.actor ? ` · ${activity.actor}` : ''}</p>{activity.reason && <p className="text-gray-400">“{activity.reason}”</p>}<p className="text-gray-300">{formatNepalDateTime(activity.createdAt)}</p></div></div>) : <p className="text-sm text-gray-400">No activity recorded.</p>}
            </Section>
          </div>
        )}
      </section>
      {kotPopupId && <KotPopup kotId={kotPopupId} onClose={() => setKotPopupId(null)} />}
    </div>,
    document.body
  );
}

function ChannelBadge({ channel }) {
  const Icon = CHANNEL_ICON[channel] || ShoppingBag;
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${CHANNEL_BADGE[channel] || 'bg-gray-100 text-gray-700'}`}><Icon className="h-3 w-3" /> {CHANNEL_LABEL[channel] || channel}</span>;
}

function BillItemsSection({ bill }) {
  const changes = latestReopenChanges(bill.activity);
  const { map, removed, changeKey } = buildChangeIndex(changes);
  return <Section title="Items"><div className="divide-y divide-gray-100">{bill.items.map((item, index) => {
    const change = map.get(changeKey(item));
    return <div key={index} className="flex items-center justify-between gap-2 py-2 text-sm"><span className="flex flex-wrap items-center gap-1.5 text-gray-700"><span>{item.quantity}× {item.name}{item.variant ? ` (${item.variant})` : ''}</span>{change?.kind === 'added' && <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">Added</span>}{change?.kind === 'increased' && <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">+{change.deltaQty} ({change.fromQty}→{change.toQty})</span>}{change?.kind === 'decreased' && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Cut {change.fromQty}→{change.toQty}</span>}</span><span className="tabular-nums text-gray-600">{formatValue(item.total, 'currency')}</span></div>;
  })}{removed.map((item, index) => <div key={`removed-${index}`} className="flex items-center justify-between gap-2 py-2 text-sm text-red-500"><span className="flex flex-wrap items-center gap-1.5"><span className="line-through">{item.fromQty}× {item.name}{item.variant ? ` (${item.variant})` : ''}</span><span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">Removed</span></span><span className="tabular-nums line-through">{formatValue(item.total, 'currency')}</span></div>)}</div></Section>;
}

function Section({ title, children }) {
  return <div className="rounded-xl border border-gray-200 p-4"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</p>{children}</div>;
}

function Row({ label, value, bold, amber }) {
  return <div className="flex items-center justify-between py-0.5 text-sm"><span className={bold ? 'font-semibold text-gray-900' : 'text-gray-500'}>{label}</span><span className={`tabular-nums ${bold ? 'font-semibold text-gray-900' : amber ? 'text-amber-600' : 'text-gray-600'}`}>{formatValue(value, 'currency')}</span></div>;
}

function prettyStatus(value) {
  return String(value || '').replaceAll('_', ' ');
}
