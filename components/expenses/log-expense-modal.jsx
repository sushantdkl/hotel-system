'use client';

import { useState, useEffect } from 'react';
import { Paperclip, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  AdminField,
  adminInputClass,
  adminTextareaClass,
  adminDialogMd,
  adminBtnPrimary,
  adminBtnSecondary,
  adminFieldStackClass,
} from '@/components/ui/admin-form';
import { useToast } from '@/components/ui/toast';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import { nepalDateString } from '@/lib/report-dates.js';
import DateInput from '@/components/ui/date-input.jsx';
import { useConfirm } from '@/components/ui/confirm';

function authedRequest(url, options = {}) {
  const token = localStorage.getItem('pos_token');
  return fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
  });
}

export const EXPENSE_CATEGORIES = [
  { value: 'salaries', label: 'Salary' },
  { value: 'infrastructure', label: 'Infrastructure & Assets' },
  { value: 'deposits', label: 'Deposits & Advances' },
  { value: 'utilities', label: 'Utilities & Operating' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'raw_materials', label: 'Raw Materials' },
  { value: 'packaging', label: 'Packaging' },
  { value: 'beverages', label: 'Beverages' },
  { value: 'other', label: 'Other' },
];

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Business Cash' },
  { value: 'online', label: 'Online' },
  { value: 'business_funding', label: 'Business Funding Balance' },
  { value: 'owner_pocket', label: 'Owner Pocket (personal money)' },
];

export default function LogExpenseModal({ editingExpense, initialCategory, payrollMode = false, onClose, onSaved }) {
  const { addToast } = useToast();
  const { confirm } = useConfirm();
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const closedCorrection = editingExpense?.business_day_status === 'closed';
  const [correctionReason, setCorrectionReason] = useState('');
  const [requestKey] = useState(() => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `expense-correction-${Date.now()}`);
  const [form, setForm] = useState({
    description: editingExpense?.description || '',
    category: editingExpense?.category || initialCategory || (payrollMode ? 'salaries' : 'raw_materials'),
    amount: editingExpense?.amount ?? '',
    purchase_date: editingExpense?.purchase_date || nepalDateString(),
    payment_method: editingExpense?.payment_method || 'cash',
    supplier: editingExpense?.supplier || '',
    notes: editingExpense?.notes || '',
    receipt_url: editingExpense?.receipt_url || '',
  });
  // Managed expense categories (from the Expense Categories page), merged with
  // the built-in set so both the fixed vocabulary and custom ones are pickable.
  const [managedCats, setManagedCats] = useState([]);
  useEffect(() => {
    authedRequest('/api/admin/expense-categories')
      .then((r) => (r.ok ? r.json() : { categories: [] }))
      .then((d) => setManagedCats(d.categories || []))
      .catch(() => {});
  }, []);
  const extraCats = managedCats
    .map((c) => c.name)
    .filter((n) => n && !EXPENSE_CATEGORIES.some((c) => c.value === n || c.label === n));

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await authedRequest('/api/uploads/receipts', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) throw data;
      setForm((f) => ({ ...f, receipt_url: data.url }));
    } catch (error) {
      addToast(friendlyFromError(error, 'upload_failed'));
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e, useBusinessFunding = false) {
    e?.preventDefault?.();
    if (!form.description.trim()) {
      addToast(friendlyMessage('validation', { description: 'Enter a title/description.' }));
      return;
    }
    if (!form.amount || Number(form.amount) <= 0) {
      addToast(friendlyMessage('validation', { description: 'Amount must be greater than zero.' }));
      return;
    }
    if (closedCorrection && correctionReason.trim().length < 3) {
      addToast(friendlyMessage('validation', { description: 'Enter a clear reason for correcting this closed expense.' }));
      return;
    }

    setSaving(true);
    try {
      const url = editingExpense ? '/api/admin/expenses' : '/api/admin/expenses';
      const method = editingExpense ? 'PUT' : 'POST';
      const res = await authedRequest(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, id: editingExpense?.id, amount: Number(form.amount), use_business_funding: useBusinessFunding, correction_reason: closedCorrection ? correctionReason.trim() : undefined, request_key: closedCorrection ? requestKey : undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw data;
      addToast(friendlyMessage('save_success', { description: 'Expense saved.' }));
      onSaved?.(data.expense);
      onClose();
    } catch (error) {
      if (error?.code === 'business_funding_required') {
        setSaving(false);
        const approved = await confirm({
          title: 'Use Business Funding?',
          message: `${error.error || error.message}\n\nAvailable in Business Funding on that date: Rs ${Number(error.available || 0).toFixed(2)}.`,
          confirmLabel: `Use Rs ${Number(error.shortfall || 0).toFixed(2)}`,
          tone: 'warning',
        });
        if (approved) await handleSubmit(null, true);
        return;
      }
      addToast(friendlyFromError(error, 'save_failed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent onClose={onClose} className={adminDialogMd}>
        <DialogHeader>
          <DialogTitle>{closedCorrection ? 'Correct Closed Expense' : payrollMode ? 'Add Salary' : editingExpense ? 'Edit Expense' : 'Log New Expense'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className={`mt-6 ${adminFieldStackClass}`}>
          <AdminField label={payrollMode ? 'Salary Title (e.g. "October salary - Bikash")' : 'Expense Title'}>
            <input
              type="text"
              autoFocus
              className={adminInputClass}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </AdminField>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <AdminField label="Category">
              <select className={adminInputClass} value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
                {extraCats.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </AdminField>
            <AdminField label="Amount">
              <input type="number" step="any" className={adminInputClass} value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
            </AdminField>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <AdminField label="Date">
              <DateInput disabled={Boolean(editingExpense)} className={adminInputClass} value={form.purchase_date} onChange={(v) => setForm((f) => ({ ...f, purchase_date: v }))} />
              {editingExpense ? <p className="mt-1.5 text-xs text-gray-500">Expense dates cannot be moved between business days. Use a dedicated reversal and re-entry for a wrong date.</p> : null}
            </AdminField>
            <AdminField label="Payment Method">
              <select disabled={closedCorrection} className={adminInputClass} value={form.payment_method} onChange={(e) => setForm((f) => ({ ...f, payment_method: e.target.value }))}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-gray-500">Owner Pocket records owner equity directly; it does not create fake Cash In.</p>
            </AdminField>
          </div>

          <AdminField label={payrollMode ? 'Employee Name' : 'Paid To / Vendor Name'}>
            <input type="text" className={adminInputClass} value={form.supplier} onChange={(e) => setForm((f) => ({ ...f, supplier: e.target.value }))} />
          </AdminField>

          <AdminField label="Notes / Reference No">
            <textarea className={adminTextareaClass} rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </AdminField>
          {closedCorrection ? <AdminField label="Correction reason" hint="Required. The original closed-day journal remains intact and the difference is posted as an audited adjustment."><textarea className={adminTextareaClass} rows={3} value={correctionReason} onChange={(e) => setCorrectionReason(e.target.value)} placeholder="Why is this closed expense being corrected?" /></AdminField> : null}

          <AdminField label="Upload Receipt / Attachment (optional)">
            {form.receipt_url ? (
              <div className="flex min-h-11 items-center gap-2 text-sm text-gray-600">
                <Paperclip className="h-4 w-4" />
                <a href={form.receipt_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Receipt attached</a>
                <button type="button" onClick={() => setForm((f) => ({ ...f, receipt_url: '' }))} className="text-gray-400 hover:text-red-600"><X className="h-3.5 w-3.5" /></button>
              </div>
            ) : (
              <input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={handleFileChange} disabled={uploading} className="min-h-11 w-full text-sm" />
            )}
            {uploading && <p className="mt-2 text-xs text-gray-400">Uploading…</p>}
          </AdminField>
        </form>
        <DialogFooter>
          <button type="button" onClick={onClose} className={adminBtnSecondary}>Cancel</button>
          <button type="button" disabled={saving || uploading} onClick={handleSubmit} className={adminBtnPrimary}>{saving ? 'Saving…' : closedCorrection ? 'Save correction' : 'Save'}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
