'use client';

import { useState } from 'react';
import { formatCurrency } from '@/lib/currency';
import QrEnlargeModal from '@/components/billing/qr-enlarge-modal';
import DateInput from '@/components/ui/date-input.jsx';
import { usePaymentQr } from '@/lib/payment-qr.js';

export const emptySplitPayment = {
  cash: '', qr: '', credit: '', cashTendered: '', qrProvider: 'Fonepay',
  qrReference: '', qrVerified: true, creditDueDate: '', notes: '',
};

const cents = (value) => Math.round((Number(value) || 0) * 100);

export default function SplitPaymentFields({
  total,
  value,
  onChange,
  customer,
  allowCredit = true,
  settings = {},
}) {
  const [qrModal, setQrModal] = useState({ open: false, title: '', image: '' });
  const { image: paymentCode, amountInQr } = usePaymentQr(settings, value.qr);
  const set = (key, next) => onChange({ ...value, [key]: next });
  const totalCents = cents(total);
  const allocatedCents = cents(value.cash) + cents(value.qr) + (allowCredit ? cents(value.credit) : 0);
  const unallocated = (totalCents - allocatedCents) / 100;
  const cashChange = Math.max(0, (cents(value.cashTendered) - cents(value.cash)) / 100);
  const creditAvailable = customer
    ? Math.max(0, Number(customer.credit_limit || 0) - Number(customer.current_credit || 0))
    : 0;

  return (
    <div className="space-y-3 rounded-xl border border-blue-200 bg-white p-3">
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Summary label="Invoice total" value={total} />
        <Summary label="Allocated" value={allocatedCents / 100} />
        <Summary label="Unallocated" value={unallocated} warn={unallocated !== 0} />
        <Summary label="Cash change" value={cashChange} />
      </div>

      <div className={`grid ${allowCredit ? 'grid-cols-3' : 'grid-cols-2'} gap-2`}>
        <MoneyField label="Cash" value={value.cash} onChange={(v) => set('cash', v)} />
        <MoneyField label="Online" value={value.qr} onChange={(v) => set('qr', v)} />
        {allowCredit && <MoneyField label="Credit / Due" value={value.credit} onChange={(v) => set('credit', v)} />}
      </div>

      {cents(value.cash) > 0 && (
        <MoneyField
          label="Cash tendered (amount received)"
          value={value.cashTendered}
          onChange={(v) => set('cashTendered', v)}
        />
      )}

      {cents(value.qr) > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-600">All digital and bank receipts are one Online payment. No provider selection or settlement is required.</p>
          <p className="text-xs text-slate-500">Confirm the Online payment before completing the bill.</p>
          {paymentCode ? (
            <button
              type="button"
              onClick={() => setQrModal({ open: true, title: 'Online payment', image: paymentCode })}
              className="w-full rounded-lg border border-blue-200 bg-white p-2 text-center hover:border-blue-400"
            >
              <p className="mb-1 text-xs font-bold text-slate-900">Online</p>
              <img src={paymentCode} alt="Online payment code" className="mx-auto h-24 w-24 object-contain" />
              {amountInQr && <p className="mt-1 text-[11px] font-semibold text-slate-700">{formatCurrency(value.qr)} is set in this QR</p>}
              <p className="mt-1 text-[11px] font-semibold text-blue-600">Tap to enlarge</p>
            </button>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-center text-xs text-amber-800">
              No Online payment code configured in Settings
            </div>
          )}
        </div>
      )}

      {allowCredit && cents(value.credit) > 0 && (
        <div className="space-y-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
          <p className="font-semibold">
            {customer
              ? `Customer: ${customer.name} · Available credit ${formatCurrency(creditAvailable)}`
              : 'Pick an existing customer above, or enter a new name + 10-digit phone to create one. Walk-in (no customer) credit is not allowed.'}
          </p>
          <label className="block font-semibold">
            Due date (optional)
            <DateInput
              value={value.creditDueDate}
              onChange={(v) => set('creditDueDate', v)}
              className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-2 py-2 text-sm"
            />
          </label>
        </div>
      )}

      <label className="block text-xs font-semibold text-slate-700">
        Payment notes (optional)
        <textarea
          rows={2}
          value={value.notes}
          onChange={(e) => set('notes', e.target.value)}
          className="mt-1 w-full resize-none rounded-lg border border-blue-200 px-2 py-2 text-sm"
        />
      </label>

      <QrEnlargeModal
        open={qrModal.open}
        title={qrModal.title}
        image={qrModal.image}
        onClose={() => setQrModal({ open: false, title: '', image: '' })}
      />
    </div>
  );
}

function MoneyField({ label, value, onChange }) {
  return (
    <label className="text-xs font-semibold text-slate-700">
      {label}
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^\d.]/g, '');
          const parts = raw.split('.');
          onChange(parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : raw);
        }}
        onFocus={(e) => e.target.select()}
        placeholder="0.00"
        className="mt-1 w-full rounded-lg border border-blue-200 px-2 py-2 text-sm tabular-nums"
      />
    </label>
  );
}

function Summary({ label, value, warn }) {
  return (
    <div className={`rounded-lg p-2 ${warn ? 'bg-amber-50 text-amber-800' : 'bg-slate-50 text-slate-700'}`}>
      <span>{label}</span>
      <strong className="float-right tabular-nums">{formatCurrency(value)}</strong>
    </div>
  );
}
