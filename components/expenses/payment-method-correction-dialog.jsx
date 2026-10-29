'use client';

import { useEffect, useState } from 'react';
import { WalletCards } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog.jsx';
import { adminBtnPrimary, adminBtnSecondary, adminInputClass, adminTextareaClass } from '@/components/ui/admin-form.jsx';
import { useToast } from '@/components/ui/toast.jsx';
import { friendlyFromError, friendlyMessage } from '@/lib/friendly-message.js';
import { apiJson } from '@/lib/authed-fetch.js';

const OPTIONS = [
  { value: 'cash', label: 'Business Cash' },
  { value: 'online', label: 'Online / Bank' },
  { value: 'business_funding', label: 'Business Funding Balance' },
  { value: 'owner_pocket', label: 'Owner Pocket (personal money)' },
];

const normalizeMethod = (value) => {
  const method = String(value || 'cash').trim().toLowerCase();
  return ['bank', 'bank_transfer', 'cheque', 'card', 'qr', 'fonepay', 'esewa', 'khalti'].includes(method) ? 'online' : method;
};

export default function PaymentMethodCorrectionDialog({
  open, onOpenChange, endpoint, recordId, recordLabel = 'expense', currentMethod = 'cash', allowCredit = false, onSaved,
}) {
  const { addToast } = useToast();
  const normalizedCurrent = normalizeMethod(currentMethod);
  const [method, setMethod] = useState(normalizedCurrent);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMethod(normalizedCurrent);
    setReason('');
  }, [open, normalizedCurrent]);

  async function save() {
    if (method === normalizedCurrent) {
      addToast(friendlyMessage('validation', { description: 'Choose a different payment method.' }));
      return;
    }
    if (reason.trim().length < 3) {
      addToast(friendlyMessage('validation', { description: 'Enter a clear reason for this correction.' }));
      return;
    }
    setSaving(true);
    try {
      const data = await apiJson(endpoint, {
        method: 'PATCH',
        body: JSON.stringify({
          id: recordId,
          payment_method: method,
          reason: reason.trim(),
          request_key: globalThis.crypto?.randomUUID?.() || String(Date.now()),
        }),
      });
      addToast(friendlyMessage('save_success', { description: data.message || 'Payment method corrected.' }));
      onOpenChange(false);
      await onSaved?.(data);
    } catch (error) {
      addToast(friendlyFromError(error, 'save_failed'));
    } finally {
      setSaving(false);
    }
  }

  const options = allowCredit ? [...OPTIONS, { value: 'credit', label: 'On Credit / Supplier Payable' }] : OPTIONS;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><WalletCards className="h-5 w-5" />Correct payment method</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
            This changes only how the {recordLabel} was paid. Its date, amount, stock and original journal stay intact; a separate accounting correction records the difference.
          </p>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-gray-800">Correct payment method</span>
            <select value={method} onChange={(event) => setMethod(event.target.value)} className={adminInputClass}>
              {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-gray-800">Reason <span className="text-red-600">*</span></span>
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={500} className={adminTextareaClass} placeholder="Example: Bank statement confirms this was paid online" />
            <span className="mt-1 block text-xs text-gray-500">The reason and staff member are kept in the accounting audit trail.</span>
          </label>
        </div>
        <DialogFooter>
          <button type="button" onClick={() => onOpenChange(false)} className={adminBtnSecondary}>Cancel</button>
          <button type="button" disabled={saving || method === normalizedCurrent || reason.trim().length < 3} onClick={save} className={adminBtnPrimary}>
            {saving ? 'Correcting…' : 'Save correction'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
