'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ExternalLink, Paperclip, Pencil, ReceiptText, Trash2, Truck, WalletCards, X } from 'lucide-react';
import { StatusBadge } from '@/components/admin/data-grid.jsx';
import { formatNepalDate, formatNepalTime } from '@/lib/time-utils.js';
import PaymentMethodCorrectionDialog from '@/components/expenses/payment-method-correction-dialog.jsx';

const SOURCE_META = {
  purchase: { label: 'Purchase', Icon: Truck },
  wastage: { label: 'Wastage', Icon: Trash2 },
};

function paymentLabel(value) {
  const method = String(value || 'cash').trim().toLowerCase();
  if (['bank', 'bank_transfer', 'cheque', 'card', 'qr', 'fonepay', 'esewa', 'khalti', 'online'].includes(method)) return 'Online';
  if (method === 'business_funding') return 'Business Funding';
  if (method === 'owner_pocket') return 'Owner Pocket';
  return method.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function Detail({ label, children }) {
  return <div className="min-w-0"><dt className="text-xs font-medium text-gray-500">{label}</dt><dd className="mt-1 break-words text-sm text-gray-900">{children || '—'}</dd></div>;
}

export default function ExpenseDrawer({ expense, category, onClose, onEdit, onChanged, canCorrectPayment = false }) {
  const [correctingPayment, setCorrectingPayment] = useState(false);
  const pathname = usePathname();
  const cashier = pathname?.startsWith('/cashier');
  const source = SOURCE_META[expense?.source_type];
  const sourceBase = cashier ? '/cashier' : '/admin';
  const sourceHref = expense?.source_type === 'purchase'
    ? `${sourceBase}/purchases?purchase=${expense.source_id}`
    : expense?.source_type === 'wastage' ? `${sourceBase}/wastage` : null;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose(); };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  if (!expense) return null;

  return (
    <div className="fixed inset-0 z-[80] flex justify-end">
      <button type="button" aria-label="Close expense details" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside role="dialog" aria-modal="true" aria-labelledby="expense-detail-title" className="relative z-10 flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-white shadow-2xl animate-in fade-in duration-200 motion-reduce:animate-none">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-gray-200 bg-white px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Expense #{expense.id}</p>
            <h2 id="expense-detail-title" className="mt-0.5 break-words text-lg font-semibold text-gray-950 sm:text-xl">{expense.description || 'Expense record'}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge tone={expense.source_type ? 'violet' : 'gray'}>{expense.source_type ? 'Automatic' : 'Manual'}</StatusBadge>
              <StatusBadge tone={expense.status === 'voided' ? 'red' : 'green'}>{expense.status === 'voided' ? 'Voided' : 'Active'}</StatusBadge>
              {expense.business_day_status === 'closed' ? <StatusBadge tone="amber">Closed day</StatusBadge> : null}
            </div>
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-900" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 space-y-6 p-5 sm:p-6">
          <section className="grid overflow-hidden rounded-xl border border-gray-200 bg-white sm:grid-cols-2">
            <div className="border-b border-gray-100 p-4 sm:border-b-0 sm:border-r">
              <p className="text-xs font-medium text-gray-500">Amount</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-gray-950">Rs {Number(expense.amount || 0).toFixed(2)}</p>
            </div>
            <div className="p-4">
              <p className="text-xs font-medium text-gray-500">Expense date</p>
              <p className="mt-1 text-base font-semibold text-gray-950">{formatNepalDate(expense.purchase_date || expense.expense_date)}</p>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 sm:px-5">
              <ReceiptText className="h-4 w-4 text-gray-400" />
              <h3 className="text-sm font-semibold text-gray-950">Expense details</h3>
            </div>
            <dl className="grid gap-5 p-4 sm:grid-cols-2 sm:p-5">
              <Detail label="Category">{category}</Detail>
              <Detail label="Payment method">{paymentLabel(expense.payment_method)}</Detail>
              <Detail label="Supplier / paid to">{expense.supplier}</Detail>
              <Detail label="Logged by">{expense.logged_by_name || 'System'}</Detail>
              <Detail label="Recorded at">{expense.created_at ? formatNepalTime(expense.created_at) : '—'}</Detail>
              <Detail label="Origin">{source ? `${source.label} #${expense.source_id}` : 'Entered manually'}</Detail>
            </dl>
          </section>

          {expense.notes ? <section className="rounded-xl border border-gray-200 bg-gray-50 p-4 sm:p-5"><h3 className="text-sm font-semibold text-gray-950">Notes</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-600">{expense.notes}</p></section> : null}

          {expense.receipt_url ? <a href={expense.receipt_url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-gray-300 px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50"><Paperclip className="h-4 w-4" /> Open receipt / attachment <ExternalLink className="h-3.5 w-3.5" /></a> : null}

          {source && sourceHref ? <section className="rounded-xl border border-blue-200 bg-blue-50 p-4 sm:p-5"><div className="flex items-start gap-3"><source.Icon className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" /><div><h3 className="text-sm font-semibold text-blue-950">Generated from {source.label} #{expense.source_id}</h3><p className="mt-1 text-sm text-blue-800">This expense is controlled by its source record so the financial and stock audit trails stay together.</p><Link href={sourceHref} onClick={onClose} className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-900 underline">Open complete {source.label.toLowerCase()} record <ExternalLink className="h-3.5 w-3.5" /></Link></div></div></section> : null}
        </div>

        <footer className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-gray-200 bg-white px-5 py-4 sm:px-6">
          {!expense.source_type && canCorrectPayment && expense.status !== 'voided' ? <button type="button" onClick={() => setCorrectingPayment(true)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-gray-300 px-4 text-sm font-semibold text-gray-700"><WalletCards className="h-4 w-4" /> Correct payment</button> : null}
          {!expense.source_type && onEdit ? <button type="button" onClick={() => onEdit(expense)} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-gray-950 px-4 text-sm font-semibold text-white"><Pencil className="h-4 w-4" /> {expense.business_day_status === 'closed' ? 'Correct expense' : 'Edit expense'}</button> : null}
          <button type="button" onClick={onClose} className="min-h-10 rounded-lg border border-gray-300 px-4 text-sm font-semibold text-gray-700">Close</button>
        </footer>
        <PaymentMethodCorrectionDialog
          open={correctingPayment}
          onOpenChange={setCorrectingPayment}
          endpoint="/api/admin/expenses"
          recordId={expense.id}
          currentMethod={expense.payment_method}
          onSaved={async () => { await onChanged?.(); onClose(); }}
        />
      </aside>
    </div>
  );
}
