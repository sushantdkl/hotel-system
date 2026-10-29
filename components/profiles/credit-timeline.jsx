'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, CreditCard, PackageCheck, ReceiptText, RotateCcw, UserRoundPlus, WalletCards } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { formatCalendarDate, formatCalendarDateTime } from '@/lib/calendar-system.js';

const ICONS = { profile: UserRoundPlus, bill: ReceiptText, purchase: PackageCheck, payment: WalletCards, adjustment: RotateCcw, credit: CreditCard };

function toneClasses(tone) {
  if (tone === 'charge') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (tone === 'payment') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  return 'border-gray-200 bg-gray-50 text-gray-600';
}

export default function CreditTimeline({ events, empty = 'No timeline activity recorded.', onOpenBill, onOpenPurchase }) {
  const [expanded, setExpanded] = useState({});
  if (!events.length) return <p className="py-14 text-center text-sm text-gray-400">{empty}</p>;

  return <div className="px-4 py-5 sm:px-6"><ol className="relative ml-4 border-l border-gray-200">
    {events.map((event) => {
      const Icon = ICONS[event.kind] || CreditCard;
      const openRecord = event.billId && onOpenBill ? () => onOpenBill(event.billId) : event.purchaseId && onOpenPurchase ? () => onOpenPurchase(event.purchaseId) : null;
      const hasAllocations = event.allocations?.length > 0;
      const isExpanded = Boolean(expanded[event.id]);
      const content = <article className={`rounded-xl border p-4 transition-colors ${(event.href || openRecord) ? 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50' : 'border-gray-200 bg-white'}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-gray-950">{event.title}</h3>{event.status ? <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase text-gray-600">{String(event.status).replaceAll('_', ' ')}</span> : null}</div>
            <p className="mt-1 text-sm leading-6 text-gray-600">{event.description}</p>
            {event.meta?.length ? <p className="mt-2 text-xs capitalize text-gray-400">{event.meta.join(' · ').replaceAll('_', ' ')}</p> : null}
            {event.actionLabel && openRecord ? <p className="mt-2 text-xs font-semibold text-blue-700">{event.actionLabel}</p> : null}
          </div>
          {event.amount > 0 ? <div className="shrink-0 text-right"><p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{event.amountLabel || 'Amount'}</p><p className={`mt-0.5 font-bold tabular-nums ${event.tone === 'charge' ? 'text-rose-700' : event.tone === 'payment' ? 'text-emerald-700' : 'text-gray-950'}`}>{formatCurrency(event.amount)}</p>{event.balanceLabel ? <p className="mt-1 text-xs text-gray-500">{event.balanceLabel}: <span className="font-semibold tabular-nums text-gray-700">{formatCurrency(event.balance)}</span></p> : null}</div> : null}
        </div>
        {hasAllocations ? <div className="mt-3 border-t border-gray-100 pt-3">
          <button type="button" onClick={(e) => { e.stopPropagation(); setExpanded((current) => ({ ...current, [event.id]: !current[event.id] })); }} className="flex w-full items-center justify-between text-left text-sm font-semibold text-gray-700"><span>{event.allocations.length} bill{event.allocations.length === 1 ? '' : 's'} covered</span><ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} /></button>
          {isExpanded ? <div className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-100 bg-gray-50">{event.allocations.map((allocation) => {
            const openAllocation = allocation.billId && onOpenBill ? () => onOpenBill(allocation.billId) : allocation.purchaseId && onOpenPurchase ? () => onOpenPurchase(allocation.purchaseId) : null;
            return <button key={allocation.id} type="button" disabled={!openAllocation} onClick={(e) => { e.stopPropagation(); openAllocation?.(); }} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-white disabled:cursor-default"><span className="font-medium text-blue-700">{allocation.label}</span><span className="font-semibold tabular-nums text-gray-800">{formatCurrency(allocation.amount)}</span></button>;
          })}</div> : null}
        </div> : null}
      </article>;

      return <li key={event.id} className="relative mb-6 ml-7 last:mb-0">
        <span className={`absolute -left-[2.78rem] top-0.5 flex h-8 w-8 items-center justify-center rounded-full border-4 border-white ${toneClasses(event.tone)}`}><Icon className="h-3.5 w-3.5" /></span>
        <time className="mb-2 block text-xs font-semibold text-gray-500">{formatCalendarDateTime(event.at)}</time>
        {event.effectiveDate ? <p className="mb-2 text-[11px] text-gray-400">{event.effectiveLabel || 'Effective date'}: {formatCalendarDate(event.effectiveDate)}</p> : null}
        {openRecord ? <button type="button" onClick={openRecord} className="block w-full text-left">{content}</button> : event.href ? <Link href={event.href}>{content}</Link> : content}
      </li>;
    })}
  </ol></div>;
}
