'use client';

/**
 * Bill Payment container — the real checkout modal for Admin POS.
 * Customer selection, payment methods, split, discount confirmation.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, X, Wallet, QrCode, Building2, Sparkles, Receipt, Truck, Bike, Search, BedDouble } from 'lucide-react';
import { apiJson } from '@/lib/authed-fetch';
import { formatCurrency } from '@/lib/currency';
import CustomerModePicker, {
  emptyCustomerSelection,
  validateCustomerSelection,
} from '@/components/billing/customer-mode-picker';
import SplitPaymentFields, { emptySplitPayment } from '@/components/billing/split-payment-fields';
import ServiceChargeField from '@/components/billing/service-charge-field';
import DateInput from '@/components/ui/date-input.jsx';
import QrEnlargeModal from '@/components/billing/qr-enlarge-modal';
import { usePaymentQr } from '@/lib/payment-qr.js';

function QrCodeButtons({ settings, amount, onOpen }) {
  const { image, amountInQr } = usePaymentQr(settings, amount);
  if (!image) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-center text-xs text-amber-800">
        No Online payment code configured in Settings
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-2">
      <button
        type="button"
        onClick={() => onOpen({ open: true, title: 'Online payment', image })}
        className="rounded-lg border border-emerald-200 bg-white p-2 text-center hover:border-emerald-400"
      >
        <p className="mb-1 text-xs font-bold text-slate-900">Online</p>
        <img src={image} alt="Online payment code" className="mx-auto h-28 w-28 object-contain" />
        {amountInQr && <p className="mt-1 text-[11px] font-semibold text-slate-700">{formatCurrency(amount)} is set in this QR</p>}
        <p className="mt-1 text-[11px] font-semibold text-emerald-600">Tap to enlarge</p>
      </button>
    </div>
  );
}

export default function BillPaymentPanel({
  open,
  onClose,
  onConfirm,
  busy = false,
  totals,
  alreadyPaid = 0,
  isReopened = false,
  settings = {},
  discount = 0,
  onDiscountChange,
  discountMode = 'percent',
  onDiscountModeChange,
  promotion = null,
  couponCode = '',
  onCouponChange,
  couponBusy = false,
  onApplyCoupon,
  customerSelection,
  onCustomerChange,
  paymentMethod,
  onPaymentMethodChange,
  roomStayId = '',
  onRoomStayChange,
  amountPaid,
  onAmountPaidChange,
  splitPayment,
  onSplitPaymentChange,
  canSetDelivery = false,
  serviceCharge = { enabled: false, mode: 'percent', value: '' },
  onServiceChargeChange,
  deliveryEnabled = false,
  onDeliveryEnabledChange,
  deliveryFee = '',
  onDeliveryFeeChange,
  executives = [],
  deliveryExecutiveId = null,
  onDeliveryExecutiveChange,
}) {
  const [qrModal, setQrModal] = useState({ open: false, title: '', image: '' });
  const [executiveSearch, setExecutiveSearch] = useState('');
  // In-house hotel guests; null = not allowed / unavailable, so no Room option.
  const [stays, setStays] = useState(null);
  const [stayQuery, setStayQuery] = useState('');
  const customerSectionRef = useRef(null);

  const selectedExecutive = executives.find((ex) => ex.id === deliveryExecutiveId) || null;
  const matchingExecutives = useMemo(() => {
    const q = executiveSearch.trim().toLowerCase();
    if (!q) return executives;
    return executives.filter((ex) => ex.name?.toLowerCase().includes(q) || String(ex.phone || '').includes(q));
  }, [executives, executiveSearch]);

  const amountDue = useMemo(
    () => Math.round((Number(totals?.total || 0) - Number(alreadyPaid || 0)) * 100) / 100,
    [totals, alreadyPaid]
  );

  const collectAmount = isReopened ? Math.max(0, amountDue) : Number(totals?.total || 0);

  const change = useMemo(() => {
    const paid = parseFloat(amountPaid) || 0;
    return Math.round((paid - collectAmount) * 100) / 100;
  }, [amountPaid, collectAmount]);

  // Prefill cash tendered with the amount due whenever the panel opens on cash.
  useEffect(() => {
    if (!open || paymentMethod !== 'cash') return;
    onAmountPaidChange?.(String(collectAmount || ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when opening / method / due changes
  }, [open, paymentMethod, collectAmount]);

  // Room charging is for first-time checkout only, not extra due on a reopened bill.
  useEffect(() => {
    if (!open || isReopened) return undefined;
    let cancelled = false;
    apiJson('/api/hotel/stays')
      .then((data) => { if (!cancelled) setStays(data.stays || []); })
      .catch(() => { if (!cancelled) setStays(null); });
    return () => { cancelled = true; };
  }, [open, isReopened]);

  if (!open) return null;

  const methods = [
    { id: 'cash', label: 'Cash', Icon: Wallet },
    { id: 'online', label: 'Online', Icon: QrCode },
    { id: 'credit', label: 'Credit', Icon: Building2 },
    ...(stays && !isReopened ? [{ id: 'room', label: 'Room', Icon: BedDouble }] : []),
    { id: 'split', label: 'Split', Icon: Sparkles },
  ];
  const selectedStay = stays?.find((stay) => stay.id === roomStayId) || null;
  const stayNeedle = stayQuery.trim().toLowerCase();
  const filteredStays = (stays || []).filter((stay) => !stayNeedle || `${stay.room} ${stay.guest} ${stay.id} ${stay.phone || ''}`.toLowerCase().includes(stayNeedle) || stay.id === roomStayId);

  const selectMethod = (id) => {
    onPaymentMethodChange?.(id);
    if (id === 'cash') {
      onAmountPaidChange?.(String(collectAmount || ''));
    }
    if (id === 'credit') {
      const next = {
        ...(customerSelection || emptyCustomerSelection),
        mode: 'customer',
        name: customerSelection?.mode === 'customer' ? (customerSelection.name || '') : '',
        phone: customerSelection?.mode === 'customer' ? (customerSelection.phone || '') : '',
        address: customerSelection?.mode === 'customer' ? (customerSelection.address || '') : '',
        customer: customerSelection?.mode === 'customer' ? (customerSelection.customer || null) : null,
        isNew: customerSelection?.mode === 'customer' ? !!customerSelection.isNew : false,
      };
      onCustomerChange?.(next);
      requestAnimationFrame(() => {
        customerSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
    if (id === 'online' || id === 'split') {
      onSplitPaymentChange?.({
        ...(splitPayment || emptySplitPayment),
        qrVerified: true,
      });
    }
  };

  const handleConfirm = () => {
    const check = validateCustomerSelection(customerSelection);
    if (!check.ok) {
      onConfirm({ error: check.message });
      return;
    }
    if (paymentMethod === 'cash') {
      const tendered = parseFloat(amountPaid);
      if (!Number.isFinite(tendered) || tendered < collectAmount - 0.009) {
        onConfirm({ error: `Cash received must be at least ${formatCurrency(collectAmount)}.` });
        return;
      }
    }
    onConfirm({ ok: true });
  };

  const showPayMethods = amountDue > 0.009 || !isReopened;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <button type="button" aria-label="Close" className="absolute inset-0" onClick={onClose} />
      <div className="relative z-10 flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-emerald-100 bg-gradient-to-r from-emerald-50 to-white px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2">
            <div className="rounded-xl bg-emerald-600 p-2 text-white">
              <Receipt className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">{isReopened ? 'Settle Reopened Bill' : 'Bill Payment'}</h2>
              <p className="text-xs text-slate-500">
                {isReopened ? 'Review the revision and settle only the difference' : 'Choose customer and collect payment'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close payment"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
          <div ref={customerSectionRef}>
            <CustomerModePicker
              value={customerSelection || emptyCustomerSelection}
              onChange={onCustomerChange}
            />
          </div>

          <div>
            <div className="mb-3 rounded-xl border border-violet-200 bg-violet-50/60 p-3">
              <label className="text-xs font-bold text-slate-900">Offer / coupon</label>
              <div className="mt-1.5 flex gap-2">
                <input value={couponCode} onChange={(e) => onCouponChange?.(e.target.value.toUpperCase().replace(/\s/g, ''))} className="min-w-0 flex-1 rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm font-bold uppercase outline-none focus:border-violet-500" placeholder="Coupon code" />
                <button type="button" disabled={couponBusy || !couponCode.trim()} onClick={onApplyCoupon} className="rounded-lg bg-violet-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{couponBusy ? 'Checking…' : 'Apply'}</button>
              </div>
              {promotion && <p className="mt-2 flex items-center gap-1.5 text-xs font-bold text-emerald-700"><Sparkles className="h-3.5 w-3.5" />{promotion.name} · save {formatCurrency(promotion.discount)}</p>}
            </div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label className="block text-xs font-bold text-slate-900">Manual discount</label>
              <div className="flex rounded-lg bg-slate-100 p-0.5">
                {[
                  { id: 'percent', label: '%' },
                  { id: 'amount', label: 'Rs' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      onDiscountModeChange?.(opt.id);
                      onDiscountChange?.(0);
                    }}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-bold ${
                      discountMode === opt.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                {discountMode === 'amount' ? 'Rs' : '%'}
              </span>
              <input
                type="number"
                min="0"
                max={discountMode === 'percent' ? 100 : undefined}
                step={discountMode === 'amount' ? '0.01' : '1'}
                value={discount || ''}
                onChange={(e) => onDiscountChange?.(parseFloat(e.target.value) || 0)}
                className="w-full rounded-lg border-2 border-emerald-200 py-2 pl-9 pr-3 text-sm font-semibold text-slate-900"
                placeholder="0"
              />
            </div>
          </div>

          {/* Optional per-bill service / extra / custom charge. The same control
              the walk-in and cashier screens use, so all three price alike. */}
          <ServiceChargeField value={serviceCharge} onChange={onServiceChargeChange} />

          {canSetDelivery && (
            <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-3">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={deliveryEnabled}
                  onChange={(e) => onDeliveryEnabledChange?.(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-sky-300 text-sky-600"
                />
                <span>
                  <span className="flex items-center gap-1.5 text-sm font-bold text-slate-900"><Truck className="h-4 w-4 text-sky-700" /> Deliver this takeaway</span>
                  <span className="mt-0.5 block text-xs text-slate-600">Marks this table-less order as Delivery and adds the charge to this bill.</span>
                </span>
              </label>
              {deliveryEnabled && (
                <>
                  <label className="mt-3 block text-xs font-bold text-slate-900">
                    Delivery charge (Rs)
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={deliveryFee}
                      onChange={(e) => onDeliveryFeeChange?.(e.target.value)}
                      className="mt-1 w-full rounded-lg border-2 border-sky-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                      placeholder="0.00"
                    />
                  </label>

                  <div className="mt-3">
                    <label className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                      <Bike className="h-3.5 w-3.5 text-sky-700" /> Delivery executive
                    </label>
                    {selectedExecutive ? (
                      <div className="mt-1 flex items-center justify-between rounded-lg border-2 border-sky-300 bg-white px-3 py-2">
                        <span className="text-sm font-semibold text-slate-900">
                          {selectedExecutive.name}{selectedExecutive.phone ? ` · ${selectedExecutive.phone}` : ''}
                        </span>
                        <button
                          type="button"
                          onClick={() => onDeliveryExecutiveChange?.(null)}
                          className="text-xs font-bold text-sky-700 hover:underline"
                        >
                          Change
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="relative mt-1">
                          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                          <input
                            type="text"
                            value={executiveSearch}
                            onChange={(e) => setExecutiveSearch(e.target.value)}
                            placeholder="Search by name..."
                            className="w-full rounded-lg border-2 border-sky-200 bg-white py-2 pl-8 pr-3 text-sm font-medium text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                          />
                        </div>
                        <div className="mt-1.5 max-h-32 space-y-1 overflow-y-auto">
                          {matchingExecutives.length === 0 ? (
                            <p className="px-1 py-1 text-xs text-slate-500">
                              {executives.length === 0 ? 'No delivery executives added yet — self / unassigned.' : 'No match.'}
                            </p>
                          ) : (
                            matchingExecutives.map((ex) => (
                              <button
                                key={ex.id}
                                type="button"
                                onClick={() => onDeliveryExecutiveChange?.(ex.id)}
                                className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-left text-sm hover:border-sky-400 hover:bg-sky-50"
                              >
                                <span className="font-medium text-slate-900">{ex.name}</span>
                                <span className="text-xs text-slate-500">{ex.phone || ''}</span>
                              </button>
                            ))
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          <div className="space-y-1 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-700">Subtotal</span>
              <span className="font-bold text-slate-900">{formatCurrency(totals?.subtotal || 0)}</span>
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Discount ({discount}%)</span>
                <span className="font-bold">- {formatCurrency(totals?.discount || 0)}</span>
              </div>
            )}
            {Number(totals?.serviceCharge || 0) > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-700">
                  Service{Number(totals?.servicePercent || 0) > 0 ? ` (${Number(totals.servicePercent)}%)` : ''}
                </span>
                <span className="font-bold text-slate-900">{formatCurrency(totals.serviceCharge)}</span>
              </div>
            )}
            {Number(settings.vat_percentage) > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-700">Tax ({Number(settings.vat_percentage)}%)</span>
                <span className="font-bold text-slate-900">{formatCurrency(totals?.tax || 0)}</span>
              </div>
            )}
            {Number(totals?.deliveryFee || 0) > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-700">Delivery</span>
                <span className="font-bold text-slate-900">{formatCurrency(totals.deliveryFee)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-emerald-200 pt-1.5 text-base font-bold">
              <span className="text-slate-900">Total</span>
              <span className="text-emerald-700">{formatCurrency(totals?.total || 0)}</span>
            </div>
            {isReopened && (
              <>
                <div className="flex justify-between text-sm text-emerald-700">
                  <span>Already paid</span>
                  <span className="font-bold">- {formatCurrency(alreadyPaid)}</span>
                </div>
                <div className={`flex justify-between text-base font-bold ${amountDue < -0.009 ? 'text-amber-700' : 'text-slate-900'}`}>
                  <span>{amountDue < -0.009 ? 'Refund due' : 'Due now'}</span>
                  <span>{formatCurrency(Math.abs(amountDue))}</span>
                </div>
                <p className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-medium text-violet-800">
                  {amountDue > 0.009
                    ? 'Collect only the extra amount—the original payment remains recorded.'
                    : amountDue < -0.009
                      ? 'Completing this will record the refund due from the reduced bill.'
                      : 'No money changes hands. Complete to close the revision.'}
                </p>
              </>
            )}
          </div>

          {showPayMethods && (
            <>
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-900">
                  Payment{isReopened ? ' (extra due)' : ''}
                </label>
                <div className={`grid gap-2 ${methods.length > 4 ? 'grid-cols-5' : 'grid-cols-4'}`}>
                  {methods.map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => selectMethod(id)}
                      className={`rounded-xl border-2 p-2.5 transition-colors ${
                        paymentMethod === id
                          ? 'border-emerald-600 bg-emerald-600 text-white'
                          : 'border-emerald-200 bg-white text-slate-700 hover:border-emerald-400'
                      }`}
                    >
                      <Icon className="mx-auto mb-0.5 h-5 w-5" />
                      <span className="text-xs font-bold">{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {paymentMethod === 'cash' && (
                <div className="space-y-2 rounded-xl border border-emerald-200 bg-white p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">Amount due</span>
                    <span className="font-bold tabular-nums text-slate-900">{formatCurrency(collectAmount)}</span>
                  </div>
                  <label className="block text-xs font-bold text-slate-900">
                    Amount received
                    <input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={amountPaid ?? ''}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^\d.]/g, '');
                        const parts = raw.split('.');
                        const next = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : raw;
                        onAmountPaidChange?.(next);
                      }}
                      onFocus={(e) => e.target.select()}
                      className="mt-1 w-full rounded-lg border-2 border-emerald-200 px-3 py-2.5 text-lg font-bold tabular-nums text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                      placeholder={String(collectAmount || '0.00')}
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onAmountPaidChange?.(String(collectAmount))}
                      className="rounded-lg border border-emerald-200 px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-50"
                    >
                      Exact
                    </button>
                    {[50, 100, 500, 1000].map((n) => {
                      const rounded = Math.ceil(collectAmount / n) * n;
                      if (rounded <= collectAmount) return null;
                      return (
                        <button
                          key={n}
                          type="button"
                          onClick={() => onAmountPaidChange?.(String(rounded))}
                          className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          {formatCurrency(rounded)}
                        </button>
                      );
                    })}
                  </div>
                  {amountPaid !== '' && amountPaid != null && (
                    change >= -0.009 ? (
                      <p className="text-sm font-semibold text-green-800">
                        Change: {formatCurrency(Math.max(0, change))}
                      </p>
                    ) : (
                      <p className="text-sm font-semibold text-amber-700">
                        Still short by {formatCurrency(Math.abs(change))}
                      </p>
                    )
                  )}
                </div>
              )}

              {paymentMethod === 'online' && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-slate-600">Confirm the Online payment, then complete the bill. No provider or settlement selection is required.</p>
                  <QrCodeButtons settings={settings} amount={collectAmount} onOpen={setQrModal} />
                </div>
              )}

              {paymentMethod === 'credit' && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="font-semibold">
                    {customerSelection?.customer
                      ? `Credit customer: ${customerSelection.customer.name}`
                      : customerSelection?.isNew && String(customerSelection?.name || '').trim()
                        ? `New credit customer: ${customerSelection.name.trim()} — created when you complete the bill.`
                        : 'Customer section above — pick an existing customer, or enter a new name + 10-digit phone to create one.'}
                  </p>
                  <label className="mt-2 block text-xs">
                    Due date (optional)
                    <DateInput
                      value={splitPayment?.creditDueDate || ''}
                      onChange={(v) => onSplitPaymentChange?.({ ...splitPayment, creditDueDate: v })}
                      className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-2 py-2"
                    />
                  </label>
                </div>
              )}

              {paymentMethod === 'room' && (
                <div className="space-y-2 rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-950">
                  <label className="block text-xs font-bold">
                    Find guest (room, name, phone or reservation)
                    <input
                      value={stayQuery}
                      onChange={(e) => setStayQuery(e.target.value)}
                      placeholder="e.g. 203 or Sharma"
                      className="mt-1 w-full rounded-lg border border-teal-200 bg-white px-2 py-2 text-sm"
                    />
                  </label>
                  <label className="block text-xs font-bold">
                    Charge to in-house guest
                    <select
                      value={roomStayId}
                      onChange={(e) => onRoomStayChange?.(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-teal-200 bg-white px-2 py-2.5 text-sm font-semibold text-slate-900"
                    >
                      <option value="">{stays?.length ? 'Choose room and guest' : 'No guests are checked in'}</option>
                      {filteredStays.map((stay) => (
                        <option key={stay.id} value={stay.id} disabled={stay.chargeable === false}>Room {stay.room} · {stay.guest}{stay.chargeable === false ? ' (not chargeable)' : ''}</option>
                      ))}
                    </select>
                  </label>
                  {selectedStay ? (
                    <div className="space-y-1 text-xs">
                      <p>Confirm the guest is <strong>{selectedStay.guest}</strong> · room {selectedStay.room} · checked in · departs {selectedStay.departure}.</p>
                      <p>Plan: <strong>{selectedStay.meal}</strong> · current folio {formatCurrency(selectedStay.folioBalance || 0)}{selectedStay.creditLimit != null ? ` · credit limit ${formatCurrency(selectedStay.creditLimit)}` : ''}</p>
                      {selectedStay.allowance?.some((a) => a.eligible) && (
                        <p className="rounded-lg bg-white/70 px-2 py-1">Meal allowance now: {selectedStay.allowance.filter((a) => a.eligible).map((a) => `${a.label} ${formatCurrency(a.remaining)}`).join(' · ')}. It is applied first; only the rest goes to the folio.</p>
                      )}
                      {selectedStay.chargeable === false && <p className="font-semibold text-red-700">{selectedStay.reason}</p>}
                      <label className="flex items-center gap-2"><input type="checkbox" checked={splitPayment?.usePackage !== false} onChange={(e) => onSplitPaymentChange?.({ ...splitPayment, usePackage: e.target.checked })} />Use the meal-plan allowance</label>
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <label>Paid now in cash<input type="number" min="0" step="0.01" value={splitPayment?.roomCash || ''} onChange={(e) => onSplitPaymentChange?.({ ...splitPayment, roomCash: e.target.value })} className="mt-1 w-full rounded-lg border border-teal-200 bg-white px-2 py-1.5" /></label>
                        <label>Paid now online<input type="number" min="0" step="0.01" value={splitPayment?.roomOnline || ''} onChange={(e) => onSplitPaymentChange?.({ ...splitPayment, roomOnline: e.target.value })} className="mt-1 w-full rounded-lg border border-teal-200 bg-white px-2 py-1.5" /></label>
                      </div>
                      <p>To the room: <strong>{formatCurrency(Math.max(0, collectAmount - (Number(splitPayment?.roomCash) || 0) - (Number(splitPayment?.roomOnline) || 0)))}</strong>, collected at hotel checkout. The restaurant bill stays a restaurant bill and its revenue is counted once.</p>
                    </div>
                  ) : (
                    <p className="text-xs">The bill is added to the guest’s hotel folio. Part can be paid now in cash or online.</p>
                  )}
                </div>
              )}

              {paymentMethod === 'split' && (
                <SplitPaymentFields
                  total={collectAmount}
                  value={splitPayment || emptySplitPayment}
                  onChange={onSplitPaymentChange}
                  customer={customerSelection?.customer}
                  settings={settings}
                />
              )}
            </>
          )}
        </div>

        <div className="flex shrink-0 gap-2 border-t border-emerald-100 bg-white p-4 sm:p-5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 rounded-xl border-2 border-slate-200 py-3 font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            className="flex-[1.6] flex items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isReopened
              ? (amountDue > 0.009
                ? `Collect ${formatCurrency(amountDue)}`
                : amountDue < -0.009
                  ? `Refund ${formatCurrency(Math.abs(amountDue))}`
                  : 'Close bill')
              : `Pay ${formatCurrency(totals?.total || 0)}`}
          </button>
        </div>
      </div>

      <QrEnlargeModal
        open={qrModal.open}
        title={qrModal.title}
        image={qrModal.image}
        onClose={() => setQrModal({ open: false, title: '', image: '' })}
      />
    </div>
  );
}
