'use client';

import { Printer, Check, X } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { compactBillNumber, compactOrderNumber } from '@/lib/document-display.js';
import { formatCalendarDate, formatCalendarDateTime } from '@/lib/calendar-system.js';

/**
 * Pre-complete bill confirmation sheet.
 */
export default function BillConfirmModal({
  open,
  onCancel,
  onConfirm,
  onPrint,
  confirming = false,
  bill,
}) {
  if (!open || !bill) return null;

  const {
    restaurant_name = 'Restaurant',
    restaurant_address = '',
    bill_number,
    order_number,
    customer_name,
    customer_phone,
    customer_mode,
    items = [],
    subtotal = 0,
    discount = 0,
    tax = 0,
    tax_percent = 13,
    service_charge = 0,
    delivery_fee = 0,
    total = 0,
    payment_method = 'cash',
    allocations = [],
    amount_paid,
    change = 0,
    date,
  } = bill;

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[92dvh] flex flex-col overflow-hidden">
        <div className="px-5 pt-4 pb-3 border-b border-stone-100 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Confirm sale</p>
            <h3 className="text-lg font-bold text-stone-900">Review bill</h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={confirming}
            className="p-1.5 rounded-lg text-stone-500 hover:bg-stone-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 p-4 font-mono text-sm text-stone-900">
            <div className="text-center mb-3">
              <p className="font-bold text-base">{restaurant_name}</p>
              {restaurant_address && (
                <p className="text-xs text-stone-600 mt-0.5">{restaurant_address}</p>
              )}
              <p className="text-xs text-stone-500 mt-2">{formatCalendarDateTime(date)}</p>
            </div>

            <div className="border-t border-b border-stone-300 py-2 space-y-0.5 text-xs mb-3">
              {bill_number && <p>Bill: {compactBillNumber(bill_number)}</p>}
              {order_number && <p>Order: {compactOrderNumber(order_number)}</p>}
              <p>
                Customer:{' '}
                <span className="font-bold">
                  {customer_name || (customer_mode === 'walkin' ? 'Walk-in Customer' : '—')}
                </span>
              </p>
              {customer_phone && <p>Phone: {customer_phone}</p>}
              <p>Payment: {allocations.length > 1 ? 'SPLIT' : String(payment_method).toUpperCase()}</p>
            </div>

            <div className="space-y-1.5 mb-3">
              {items.map((item, idx) => (
                <div key={idx} className="flex justify-between gap-2 text-xs">
                  <span className="flex-1 truncate">
                    {item.quantity}× {item.name || item.item_name}
                  </span>
                  <span className="shrink-0 font-semibold">
                    {formatCurrency(item.subtotal ?? (item.price || 0) * (item.quantity || 1))}
                  </span>
                </div>
              ))}
            </div>

            <div className="border-t border-stone-300 pt-2 space-y-1 text-xs">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>{formatCurrency(subtotal)}</span>
              </div>
              {discount > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>Discount</span>
                  <span>- {formatCurrency(discount)}</span>
                </div>
              )}
              {service_charge > 0 && (
                <div className="flex justify-between">
                  <span>Service</span>
                  <span>{formatCurrency(service_charge)}</span>
                </div>
              )}
              {delivery_fee > 0 && (
                <div className="flex justify-between">
                  <span>Delivery</span>
                  <span>{formatCurrency(delivery_fee)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>Tax ({tax_percent}%)</span>
                <span>{formatCurrency(tax)}</span>
              </div>
              <div className="flex justify-between text-sm font-bold pt-1 border-t border-stone-300">
                <span>Total</span>
                <span>{formatCurrency(total)}</span>
              </div>
              {allocations.map((allocation, index) => (
                <div key={`${allocation.method}-${index}`} className="pt-1">
                  <div className="flex justify-between">
                    <span className="capitalize">{allocation.method === 'credit' ? 'Credit / Due' : allocation.method}</span>
                    <span>{formatCurrency(allocation.amount)}</span>
                  </div>
                  {allocation.method === 'qr' && allocation.reference && <p className="text-[11px] text-stone-500">QR reference: {allocation.reference}</p>}
                  {allocation.method === 'credit' && allocation.due_date && <p className="text-[11px] text-stone-500">Due date: {formatCalendarDate(allocation.due_date)}</p>}
                </div>
              ))}
              {amount_paid != null && (
                <>
                  <div className="flex justify-between pt-1">
                    <span>Amount received</span>
                    <span>{formatCurrency(amount_paid)}</span>
                  </div>
                  {total - amount_paid > 0 && (
                    <div className="flex justify-between font-semibold text-amber-700">
                      <span>Outstanding</span>
                      <span>{formatCurrency(total - amount_paid)}</span>
                    </div>
                  )}
                  {change >= 0 && (
                    <div className="flex justify-between">
                      <span>Change</span>
                      <span>{formatCurrency(change)}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-stone-100 grid grid-cols-3 gap-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onCancel}
            disabled={confirming}
            className="py-3 rounded-xl border-2 border-stone-200 text-stone-700 font-bold text-sm hover:bg-stone-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onPrint}
            disabled={confirming}
            className="py-3 rounded-xl border-2 border-blue-200 text-blue-700 font-bold text-sm hover:bg-blue-50 disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
          >
            <Printer className="w-4 h-4" />
            Print
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirming}
            className="py-3 rounded-xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
          >
            <Check className="w-4 h-4" />
            {confirming ? 'Saving…' : 'Complete'}
          </button>
        </div>
      </div>
    </div>
  );
}
