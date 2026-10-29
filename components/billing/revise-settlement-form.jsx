'use client';

/**
 * Edit customer + payment method on an already-paid bill (no cart reopen).
 */

import { useEffect, useMemo, useState } from 'react';
import CustomerModePicker, {
  emptyCustomerSelection,
  validateCustomerSelection,
} from '@/components/billing/customer-mode-picker';
import SplitPaymentFields, { emptySplitPayment } from '@/components/billing/split-payment-fields';
import { formatCurrency } from '@/lib/currency';

export default function ReviseSettlementForm({
  billTotal = 0,
  initialCustomer = null,
  settings = {},
  busy = false,
  onCancel,
  onSubmit,
}) {
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState('cash');
  const [amountPaid, setAmountPaid] = useState(String(billTotal || ''));
  const [split, setSplit] = useState({
    ...emptySplitPayment,
    cash: String(billTotal || ''),
    cashTendered: String(billTotal || ''),
    qrVerified: true,
  });
  const [customerSelection, setCustomerSelection] = useState(() => (
    initialCustomer?.id
      ? {
          mode: 'customer',
          phone: initialCustomer.phone || '',
          name: initialCustomer.name || '',
          address: initialCustomer.address || '',
          customer: initialCustomer,
          isNew: false,
        }
      : emptyCustomerSelection
  ));

  useEffect(() => {
    setAmountPaid(String(billTotal || ''));
    setSplit((prev) => ({
      ...prev,
      cash: String(billTotal || ''),
      cashTendered: String(billTotal || ''),
    }));
  }, [billTotal]);

  const change = useMemo(() => {
    const paid = parseFloat(amountPaid) || 0;
    return Math.round((paid - Number(billTotal || 0)) * 100) / 100;
  }, [amountPaid, billTotal]);

  const buildAllocations = () => {
    const total = Number(billTotal || 0);
    const amount = (v) => Math.round((Number(v) || 0) * 100) / 100;
    if (method === 'cash') {
      return [{ method: 'cash', amount: total, cash_tendered: amountPaid || total }];
    }
    if (method === 'online') {
      return [{ method: 'online', amount: total, verified: true }];
    }
    if (method === 'credit') {
      return [{ method: 'credit', amount: total, due_date: split.creditDueDate || undefined }];
    }
    return [
      { method: 'cash', amount: amount(split.cash), cash_tendered: split.cashTendered || split.cash },
      { method: 'online', amount: amount(split.qr), verified: true },
      { method: 'credit', amount: amount(split.credit), due_date: split.creditDueDate || undefined },
    ].filter((row) => row.amount > 0);
  };

  const handleSubmit = () => {
    if (!String(reason || '').trim()) {
      onSubmit?.({ error: 'Enter a reason for this edit.' });
      return;
    }
    const check = validateCustomerSelection(customerSelection);
    if (method === 'credit' || customerSelection.mode === 'customer') {
      if (!check.ok && method === 'credit') {
        onSubmit?.({ error: check.message });
        return;
      }
    }
    let allocations;
    try {
      allocations = buildAllocations();
      const sum = allocations.reduce((s, a) => s + Math.round(Number(a.amount || 0) * 100), 0);
      if (sum !== Math.round(Number(billTotal || 0) * 100)) {
        throw new Error('Cash + Online + Credit must equal the bill total.');
      }
      const cash = allocations.find((a) => a.method === 'cash');
      if (cash && Math.round(Number(cash.cash_tendered || 0) * 100) < Math.round(cash.amount * 100)) {
        throw new Error('Cash received must cover the cash portion.');
      }
      if (allocations.some((a) => a.method === 'credit') && !customerSelection.customer?.id) {
        throw new Error('Credit requires an existing identified customer.');
      }
    } catch (e) {
      onSubmit?.({ error: e.message });
      return;
    }

    onSubmit?.({
      ok: true,
      reason: String(reason).trim(),
      allocations,
      customer_id: customerSelection.customer?.id || null,
      customer_name: customerSelection.mode === 'customer'
        ? (customerSelection.customer?.name || customerSelection.name || null)
        : (customerSelection.name || 'Walk-in Customer'),
      customer_phone: customerSelection.mode === 'customer'
        ? (customerSelection.customer?.phone || customerSelection.phone || null)
        : null,
    });
  };

  return (
    <div className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3">
      <p className="text-sm font-semibold text-indigo-950">Edit payment & customer</p>
      <p className="text-xs text-indigo-800">
        Fixes how this bill was recorded (method / customer). Does not change items or totals.
      </p>

      <CustomerModePicker value={customerSelection} onChange={setCustomerSelection} />

      <div>
        <label className="mb-1 block text-xs font-bold text-slate-800">Payment method</label>
        <div className="grid grid-cols-4 gap-1.5">
          {[
            { id: 'cash', label: 'Cash' },
            { id: 'online', label: 'Online' },
            { id: 'credit', label: 'Credit' },
            { id: 'split', label: 'Split' },
          ].map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                setMethod(m.id);
                if (m.id === 'credit') {
                  setCustomerSelection((prev) => ({ ...prev, mode: 'customer' }));
                }
                if (m.id === 'cash') setAmountPaid(String(billTotal || ''));
              }}
              className={`rounded-lg border px-2 py-2 text-xs font-semibold ${
                method === m.id
                  ? 'border-indigo-600 bg-indigo-600 text-white'
                  : 'border-indigo-200 bg-white text-slate-700'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {method === 'cash' && (
        <div className="space-y-1">
          <label className="block text-xs font-bold text-slate-800">
            Amount received
            <input
              type="text"
              inputMode="decimal"
              value={amountPaid}
              onChange={(e) => setAmountPaid(e.target.value.replace(/[^\d.]/g, ''))}
              onFocus={(e) => e.target.select()}
              className="mt-1 w-full rounded-lg border border-indigo-200 bg-white px-2 py-2 text-sm font-bold tabular-nums"
            />
          </label>
          {amountPaid !== '' && (
            change >= -0.009
              ? <p className="text-xs font-semibold text-emerald-700">Change: {formatCurrency(Math.max(0, change))}</p>
              : <p className="text-xs font-semibold text-amber-700">Still short by {formatCurrency(Math.abs(change))}</p>
          )}
        </div>
      )}

      {method === 'online' && <p className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs text-slate-600">All digital and bank receipts are recorded as Online.</p>}

      {method === 'credit' && (
        <p className="text-xs text-amber-800">
          {customerSelection.customer
            ? `Credit for ${customerSelection.customer.name}`
            : 'Select an existing customer above for credit.'}
        </p>
      )}

      {method === 'split' && (
        <SplitPaymentFields
          total={billTotal}
          value={split}
          onChange={setSplit}
          customer={customerSelection.customer}
          settings={settings}
        />
      )}

      <label className="block text-xs font-bold text-slate-800">
        Reason (required)
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="e.g. Recorded as cash but guest paid Online"
          className="mt-1 w-full rounded-lg border border-indigo-200 bg-white px-2 py-2 text-sm"
        />
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={handleSubmit}
          className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
