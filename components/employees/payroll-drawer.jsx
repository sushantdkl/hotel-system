'use client';

import { useEffect, useMemo, useState } from 'react';
import { BanknoteArrowDown, Plus, Trash2, X } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import { apiJson } from '@/lib/authed-fetch';
import { nepalDateString } from '@/lib/report-dates.js';
import DateInput from '@/components/ui/date-input.jsx';
import { formatCalendarDate, formatCalendarMonth } from '@/lib/calendar-system.js';

const money = (n) => `Rs ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const METHODS = ['cash', 'online'];
const today = () => nepalDateString();
const currentPeriod = () => formatCalendarMonth();

export default function PayrollDrawer({
  employee,
  onClose,
  initialAction,
  canRecordSalary = true,
  canGiveAdvance = true,
  canDelete = true,
}) {
  const { addToast } = useToast();
  const { confirm } = useConfirm();
  const [payments, setPayments] = useState([]);
  const [advances, setAdvances] = useState([]);
  const [outstanding, setOutstanding] = useState(Number(employee.advance_outstanding || 0));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const allowedInitialAction = initialAction === 'advance' && canGiveAdvance
    ? 'advance'
    : canRecordSalary ? 'salary' : 'advance';
  const [action, setAction] = useState(allowedInitialAction);
  const [payment, setPayment] = useState({
    gross_amount: employee.salary ?? '',
    advance_deduction: '',
    period_label: currentPeriod(),
    paid_on: today(),
    method: 'cash',
    note: '',
  });
  const [advance, setAdvance] = useState({ amount: '', advanced_on: today(), method: 'cash', note: '' });

  const load = async () => {
    try {
      const data = await apiJson(`/api/admin/payroll?employee_id=${employee.id}`);
      setPayments(data.payments || []);
      setAdvances(data.advances || []);
      setOutstanding(Number(data.outstanding || 0));
    } catch (error) {
      addToast(friendlyFromError(error, 'load_failed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setAction(allowedInitialAction);
    setPayment((current) => ({ ...current, gross_amount: employee.salary ?? '', advance_deduction: '' }));
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee.id, initialAction]);

  const deduction = Math.max(0, Number(payment.advance_deduction || 0));
  const gross = Math.max(0, Number(payment.gross_amount || 0));
  const netPay = Math.max(0, gross - deduction);
  const totalPaid = useMemo(
    () => payments.reduce((sum, row) => sum + Number(row.gross_amount ?? row.amount ?? 0), 0),
    [payments]
  );

  const recordSalary = async (event) => {
    event.preventDefault();
    if (!(gross > 0)) return addToast(friendlyMessage('validation', { description: 'Enter the gross salary.' }));
    if (deduction > outstanding || deduction > gross) {
      return addToast(friendlyMessage('validation', { description: 'Advance deduction cannot exceed the salary or outstanding advance.' }));
    }
    setSaving(true);
    try {
      await apiJson('/api/admin/payroll', {
        method: 'POST',
        body: JSON.stringify({
          ...payment,
          employee_id: employee.id,
          gross_amount: gross,
          advance_deduction: deduction,
          amount: netPay,
        }),
      });
      addToast(friendlyMessage('save_success', { description: 'Salary payment recorded.' }));
      setPayment((current) => ({ ...current, note: '', advance_deduction: '' }));
      load();
    } catch (error) {
      addToast(friendlyFromError(error, 'save_failed'));
    } finally {
      setSaving(false);
    }
  };

  const recordAdvance = async (event) => {
    event.preventDefault();
    if (!(Number(advance.amount) > 0)) return addToast(friendlyMessage('validation', { description: 'Enter the advance amount.' }));
    setSaving(true);
    try {
      await apiJson('/api/admin/payroll', {
        method: 'POST',
        body: JSON.stringify({ ...advance, type: 'advance', employee_id: employee.id, amount: Number(advance.amount) }),
      });
      addToast(friendlyMessage('save_success', { description: 'Salary advance recorded.' }));
      setAdvance((current) => ({ ...current, amount: '', note: '' }));
      load();
    } catch (error) {
      addToast(friendlyFromError(error, 'save_failed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id, type) => {
    const ok = await confirm({
      title: `Delete this ${type}?`,
      message: `This removes the ${type} and reverses its accounting entry.`,
      confirmLabel: 'Delete',
      tone: 'delete',
    });
    if (!ok) return;
    try {
      await apiJson(`/api/admin/payroll?id=${id}${type === 'advance' ? '&type=advance' : ''}`, { method: 'DELETE' });
      load();
    } catch (error) {
      addToast(friendlyFromError(error, 'delete_failed'));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="relative z-10 flex h-full w-full max-w-xl flex-col overflow-y-auto bg-white shadow-xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-5 py-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Salary &amp; advances</p>
            <h2 className="text-lg font-semibold text-gray-900">{employee.full_name || employee.username}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100" aria-label="Close"><X className="h-5 w-5" /></button>
        </header>

        <div className="space-y-5 p-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Monthly salary" value={employee.salary != null ? money(employee.salary) : '—'} />
            <Stat label="Advance due" value={money(outstanding)} tone={outstanding > 0 ? 'amber' : 'default'} />
            <Stat label="Salary recorded" value={money(totalPaid)} />
            <Stat label="Advance records" value={String(advances.length)} />
          </div>

          {(canRecordSalary || canGiveAdvance) && (
            <div className="rounded-xl border border-gray-200 p-4">
              {canRecordSalary && canGiveAdvance && (
                <div className="mb-4 grid grid-cols-2 rounded-lg bg-gray-100 p-1">
                  <ActionTab active={action === 'salary'} onClick={() => setAction('salary')}>Pay salary</ActionTab>
                  <ActionTab active={action === 'advance'} onClick={() => setAction('advance')}>Give advance</ActionTab>
                </div>
              )}

              {action === 'salary' && canRecordSalary ? (
                <form onSubmit={recordSalary}>
                  <p className="mb-3 text-sm font-semibold text-gray-900">Record salary payment</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Gross salary (Rs)"><input type="number" min="0" step="any" value={payment.gross_amount} onChange={(e) => setPayment({ ...payment, gross_amount: e.target.value })} className={INPUT} /></Field>
                    <Field label={`Advance deduction (due ${money(outstanding)})`}><input type="number" min="0" max={Math.min(gross, outstanding)} step="any" value={payment.advance_deduction} onChange={(e) => setPayment({ ...payment, advance_deduction: e.target.value })} className={INPUT} placeholder="0" /></Field>
                    <Field label="Paid on"><DateInput value={payment.paid_on} onChange={(v) => setPayment({ ...payment, paid_on: v })} className={INPUT} /></Field>
                    <Field label="Period"><input value={payment.period_label} onChange={(e) => setPayment({ ...payment, period_label: e.target.value })} className={INPUT} placeholder="e.g. Bhadra 2083 BS" /></Field>
                    <Field label="Method"><select value={payment.method} onChange={(e) => setPayment({ ...payment, method: e.target.value })} className={INPUT}>{METHODS.map((method) => <option key={method} value={method}>{method}</option>)}</select></Field>
                    <Field label="Paid now"><div className="flex h-10 items-center rounded-lg bg-emerald-50 px-3 text-sm font-semibold text-emerald-800">{money(netPay)}</div></Field>
                  </div>
                  <Field label="Note"><input value={payment.note} onChange={(e) => setPayment({ ...payment, note: e.target.value })} className={INPUT} placeholder="Optional" /></Field>
                  <button type="submit" disabled={saving} className={PRIMARY}><Plus className="h-4 w-4" /> {saving ? 'Saving…' : 'Record salary'}</button>
                </form>
              ) : canGiveAdvance ? (
                <form onSubmit={recordAdvance}>
                  <p className="mb-1 text-sm font-semibold text-gray-900">Give salary advance</p>
                  <p className="mb-3 text-xs text-gray-500">This is deducted from a future salary payment and remains visible until settled.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Amount (Rs)"><input type="number" min="0" step="any" value={advance.amount} onChange={(e) => setAdvance({ ...advance, amount: e.target.value })} className={INPUT} /></Field>
                    <Field label="Date"><DateInput value={advance.advanced_on} onChange={(v) => setAdvance({ ...advance, advanced_on: v })} className={INPUT} /></Field>
                    <Field label="Method"><select value={advance.method} onChange={(e) => setAdvance({ ...advance, method: e.target.value })} className={INPUT}>{METHODS.map((method) => <option key={method} value={method}>{method}</option>)}</select></Field>
                    <Field label="Note"><input value={advance.note} onChange={(e) => setAdvance({ ...advance, note: e.target.value })} className={INPUT} placeholder="Optional reason" /></Field>
                  </div>
                  <button type="submit" disabled={saving} className={PRIMARY}><BanknoteArrowDown className="h-4 w-4" /> {saving ? 'Saving…' : 'Give advance'}</button>
                </form>
              ) : null}
            </div>
          )}

          <History title="Advance history" empty="No advances recorded." loading={loading}>
            {advances.map((row) => (
              <HistoryRow key={`a-${row.id}`} amount={row.amount} date={row.advanced_on} method={row.method} note={row.note} label="Advance" tone="amber">
                {canDelete && <DeleteButton onClick={() => remove(row.id, 'advance')} />}
              </HistoryRow>
            ))}
          </History>

          <History title="Salary payment history" empty="No salary payments recorded." loading={loading}>
            {payments.map((row) => (
              <HistoryRow key={`p-${row.id}`} amount={row.gross_amount ?? row.amount} date={row.paid_on} method={row.method} note={row.note} label={row.period_label || 'Salary'}>
                <div className="flex items-center gap-2">
                  {Number(row.advance_deduction || 0) > 0 && <span className="text-xs text-amber-700">{money(row.advance_deduction)} deducted</span>}
                  {canDelete && <DeleteButton onClick={() => remove(row.id, 'payment')} />}
                </div>
              </HistoryRow>
            ))}
          </History>
        </div>
      </aside>
    </div>
  );
}

const INPUT = 'mt-1 h-10 w-full rounded-lg border border-gray-300 px-3 text-sm text-gray-900';
const PRIMARY = 'mt-3 inline-flex h-10 items-center gap-1.5 rounded-lg bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800 active:scale-[0.98] disabled:opacity-50';

function Field({ label, children }) { return <label className="block"><span className="text-sm font-medium text-gray-700">{label}</span>{children}</label>; }
function ActionTab({ active, onClick, children }) { return <button type="button" onClick={onClick} className={`rounded-md px-3 py-2 text-sm font-medium ${active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>{children}</button>; }
function Stat({ label, value, tone = 'default' }) { return <div className={`rounded-xl border p-3 ${tone === 'amber' ? 'border-amber-200 bg-amber-50' : 'border-gray-200'}`}><p className="text-xs font-medium text-gray-500">{label}</p><p className="mt-1 truncate text-base font-bold text-gray-900">{value}</p></div>; }
function History({ title, empty, loading, children }) { const rows = Array.isArray(children) ? children : [children]; return <section><p className="mb-2 text-sm font-semibold text-gray-900">{title}</p>{loading ? <p className="text-sm text-gray-500">Loading…</p> : rows.filter(Boolean).length === 0 ? <p className="rounded-lg bg-gray-50 px-3 py-4 text-center text-sm text-gray-500">{empty}</p> : <div className="divide-y divide-gray-100 rounded-xl border border-gray-200">{children}</div>}</section>; }
function HistoryRow({ amount, date, method, note, label, tone, children }) { return <div className="flex items-center gap-3 px-4 py-3"><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="text-sm font-semibold text-gray-900">{money(amount)}</p><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tone === 'amber' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-700'}`}>{label}</span></div><p className="text-xs capitalize text-gray-500">{formatCalendarDate(String(date).slice(0, 10))} · {method}</p>{note && <p className="truncate text-xs text-gray-400">{note}</p>}</div>{children}</div>; }
function DeleteButton({ onClick }) { return <button type="button" onClick={onClick} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-red-600" aria-label="Delete"><Trash2 className="h-4 w-4" /></button>; }
