'use client';

import { useEffect, useRef, useState } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import { RotateCcw, Ban, Undo2, AlertTriangle, Loader2, ReceiptText, X } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { friendlyMessage, friendlyFromError } from '@/lib/friendly-message';
import { apiJson } from '@/lib/authed-fetch';
import { money } from '@/components/accounting/ledger-table';
import { formatNepalTime } from '@/lib/time-utils';

const METHODS = ['cash', 'online'];

export default function CorrectionsPage() {
  const { addToast } = useToast();
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [refundForm, setRefundForm] = useState({ bill_number: '', full: true, amount: '', method: 'cash', reason: '' });
  const [voidForm, setVoidForm] = useState({ bill_number: '', reason: '', restock: true });
  const [reverseForm, setReverseForm] = useState({ journal_id: '', reason: '' });
  const [journalPreview, setJournalPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const [historyDetail, setHistoryDetail] = useState(null);
  const keyRef = useRef(newKey());

  const load = () => apiJson('/api/admin/corrections').then((d) => {
    const billHistory = (d.bill_corrections || []).map((row) => ({
      ...row,
      history_id: `bill-${row.id}`,
      reference: row.bill_number || '—',
    }));
    // Refunds already have a richer bill-level history row. Include standalone
    // reversals and payment-source reclassifications from the journal feed.
    const reversalHistory = (d.corrections || [])
      .filter((row) => ['reversal', 'expense_payment_method_correction', 'expense_edit_correction', 'payment_method_correction'].includes(row.source_type))
      .map((row) => ({
        ...row,
        history_id: `journal-${row.id}`,
        journal_id: row.id,
        type: row.source_type === 'reversal'
          ? 'reversal'
          : row.source_type === 'expense_edit_correction'
            ? 'edit correction'
            : 'payment correction',
        reference: row.source_type === 'reversal' ? `Journal #${row.source_id}` : `Journal #${row.id}`,
        reason: row.memo || (
          row.source_type === 'reversal'
            ? 'Journal reversal'
            : row.source_type === 'expense_edit_correction'
              ? 'Closed-day amount correction'
              : 'Payment method correction'
        ),
      }));
    setHistory([...billHistory, ...reversalHistory].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))));
  }).catch(() => {});
  useEffect(() => { load(); }, []);

  useEffect(() => {
    const journalId = Number(reverseForm.journal_id);
    if (!Number.isInteger(journalId) || journalId <= 0) {
      setJournalPreview(null);
      setPreviewError('');
      setPreviewLoading(false);
      return undefined;
    }
    let active = true;
    setPreviewLoading(true);
    setPreviewError('');
    const timer = setTimeout(() => {
      apiJson(`/api/admin/corrections?journal_id=${journalId}`)
        .then((data) => { if (active) setJournalPreview(data); })
        .catch((error) => {
          if (!active) return;
          setJournalPreview(null);
          setPreviewError(error?.message || 'Could not load that journal.');
        })
        .finally(() => { if (active) setPreviewLoading(false); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [reverseForm.journal_id]);

  const post = async (body, done) => {
    setBusy(true);
    try {
      await apiJson('/api/admin/corrections', { method: 'POST', body: JSON.stringify(body) });
      addToast(friendlyMessage('save_success', { description: 'Posted to the ledger.' }));
      setConfirmation(null);
      done?.();
      load();
    } catch (error) { addToast(friendlyFromError(error, 'save_failed')); }
    finally { setBusy(false); }
  };

  const openHistory = async (row) => {
    const journalId = Number(row.type === 'reversal' ? row.id : row.journal_id);
    setHistoryDetail({ row, data: null, loading: Boolean(journalId), error: '' });
    if (!journalId) return;
    try {
      const data = await apiJson(`/api/admin/corrections?journal_id=${journalId}`);
      setHistoryDetail((current) => current?.row?.history_id === row.history_id ? { row, data, loading: false, error: '' } : current);
    } catch (error) {
      setHistoryDetail((current) => current?.row?.history_id === row.history_id ? { row, data: null, loading: false, error: error?.message || 'Could not load journal details.' } : current);
    }
  };

  const doRefund = () => {
    if (!refundForm.bill_number.trim()) { addToast(friendlyMessage('validation', { description: 'Enter the bill number.' })); return; }
    if (!refundForm.full && !(Number(refundForm.amount) > 0)) { addToast(friendlyMessage('validation', { description: 'Enter a refund amount.' })); return; }
    if (!refundForm.reason.trim()) { addToast(friendlyMessage('validation', { description: 'A reason is required.' })); return; }
    setConfirmation({
      title: 'Confirm customer refund',
      description: refundForm.full
        ? `Refund the complete remaining balance from bill ${refundForm.bill_number.trim()} by ${refundForm.method}.`
        : `Refund ${money(refundForm.amount)} from bill ${refundForm.bill_number.trim()} by ${refundForm.method}.`,
      confirmLabel: 'Yes, post refund',
      tone: 'amber',
      body: { action: 'refund', bill_number: refundForm.bill_number.trim(), full: refundForm.full, amount: refundForm.full ? undefined : Number(refundForm.amount), method: refundForm.method, reason: refundForm.reason },
      done: () => { keyRef.current = newKey(); setRefundForm((f) => ({ ...f, bill_number: '', amount: '', reason: '' })); },
    });
  };
  const doVoid = () => {
    if (!voidForm.bill_number.trim()) { addToast(friendlyMessage('validation', { description: 'Enter the bill number.' })); return; }
    if (!voidForm.reason.trim()) { addToast(friendlyMessage('validation', { description: 'A reason is required.' })); return; }
    setConfirmation({
      title: 'Confirm complete bill void',
      description: `Void bill ${voidForm.bill_number.trim()}. Its sale, payments and customer credit will be reversed${voidForm.restock ? ', and its items returned to stock' : ''}.`,
      confirmLabel: 'Yes, void entire bill',
      tone: 'rose',
      body: { action: 'void_bill', bill_number: voidForm.bill_number.trim(), reason: voidForm.reason, restock: voidForm.restock },
      done: () => setVoidForm({ bill_number: '', reason: '', restock: true }),
    });
  };
  const doReverse = () => {
    if (!reverseForm.journal_id) { addToast(friendlyMessage('validation', { description: 'Enter the journal id.' })); return; }
    if (!reverseForm.reason.trim()) { addToast(friendlyMessage('validation', { description: 'A reason is required.' })); return; }
    if (previewLoading) { addToast(friendlyMessage('validation', { description: 'Wait for the journal details to load.' })); return; }
    if (!journalPreview || previewError) { addToast(friendlyMessage('validation', { description: 'Load a valid journal before reversing it.' })); return; }
    const linkedBill = journalPreview.bill;
    const action = journalPreview.action;
    const actionCopy = {
      void_bill: {
        title: 'This will void the entire bill',
        description: `Journal #${reverseForm.journal_id} belongs to bill ${linkedBill?.bill_number}. The bill, payments, customer credit and operational records will all be reversed together.`,
        label: 'Yes, void bill and credit', tone: 'rose',
      },
      reverse_credit_collection: {
        title: 'Reverse this customer collection',
        description: `This reopens only the amount collected by journal #${reverseForm.journal_id} on bill ${linkedBill?.bill_number}; it does not void the sale.`,
        label: 'Yes, reopen credit', tone: 'amber',
      },
      reverse_credit_writeoff: {
        title: 'Reverse this customer write-off',
        description: `This restores only the written-off amount on bill ${linkedBill?.bill_number}; it does not void the sale.`,
        label: 'Yes, restore credit', tone: 'amber',
      },
      void_purchase: {
        title: 'Void this purchase',
        description: 'This reverses the supplier payable and linked expense, restores the stock movement, and marks the purchase voided.',
        label: 'Yes, void purchase', tone: 'rose',
      },
      void_expense: {
        title: 'Void this expense',
        description: 'This marks the expense voided and posts the opposite ledger entry. The audit record remains.',
        label: 'Yes, void expense', tone: 'amber',
      },
      void_wastage: {
        title: 'Void this wastage entry',
        description: 'This restores the deducted stock, voids the linked loss expense, and keeps the original record for audit.',
        label: 'Yes, void wastage', tone: 'rose',
      },
      reverse_supplier_payment: {
        title: 'Reverse this supplier payment',
        description: 'This restores the supplier payable and reverses the cash or bank movement.',
        label: 'Yes, reverse payment', tone: 'amber',
      },
      reverse_refund: {
        title: 'Reverse this refund',
        description: `This reverses only the selected refund on bill ${linkedBill?.bill_number} and restores its refundable balance.`,
        label: 'Yes, reverse refund', tone: 'amber',
      },
    }[action] || {
      title: 'Confirm journal reversal',
      description: `Post the exact opposite of journal #${reverseForm.journal_id}. The original journal will remain in the audit history.`,
      label: 'Yes, reverse journal', tone: 'amber',
    };
    setConfirmation({
      title: actionCopy.title,
      description: actionCopy.description,
      confirmLabel: actionCopy.label,
      tone: actionCopy.tone,
      body: { action: 'reverse', journal_id: Number(reverseForm.journal_id), reason: reverseForm.reason, restock: true },
      done: () => { setReverseForm({ journal_id: '', reason: '' }); setJournalPreview(null); },
    });
  };

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Corrections &amp; Reversals</h1>
        <p className="mt-1 text-sm text-gray-500">Refunds, bill voids and journal reversals — each posts a proper contra entry. Nothing is deleted.</p>
      </header>

      <div className="space-y-6 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-3">
          <Card icon={Undo2} title="Refund" hint="Return money for a served bill. Full or partial; over-refund is blocked. Stock stays consumed.">
            <Field label="Bill number"><input value={refundForm.bill_number} onChange={(e) => setRefundForm((f) => ({ ...f, bill_number: e.target.value }))} className={INPUT} placeholder="e.g. BILL-000123" /></Field>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={refundForm.full} onChange={(e) => setRefundForm((f) => ({ ...f, full: e.target.checked }))} className="h-4 w-4 rounded border-gray-300" /> Full refund
            </label>
            {!refundForm.full && <Field label="Amount"><input type="number" min="0" step="any" value={refundForm.amount} onChange={(e) => setRefundForm((f) => ({ ...f, amount: e.target.value }))} className={INPUT} /></Field>}
            <Field label="Method">
              <select value={refundForm.method} onChange={(e) => setRefundForm((f) => ({ ...f, method: e.target.value }))} className={INPUT}>
                {METHODS.map((m) => <option key={m} value={m} className="capitalize">{m}</option>)}
              </select>
            </Field>
            <Field label="Reason"><input value={refundForm.reason} onChange={(e) => setRefundForm((f) => ({ ...f, reason: e.target.value }))} className={INPUT} placeholder="required" /></Field>
            <button disabled={busy} onClick={doRefund} className={BTN}>Post refund</button>
          </Card>

          <Card icon={Ban} title="Void Bill" hint="Undo a paid bill entirely — reverses sale, payment & tax, cancels the order, frees the table.">
            <Field label="Bill number"><input value={voidForm.bill_number} onChange={(e) => setVoidForm((f) => ({ ...f, bill_number: e.target.value }))} className={INPUT} placeholder="e.g. BILL-000123" /></Field>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={voidForm.restock} onChange={(e) => setVoidForm((f) => ({ ...f, restock: e.target.checked }))} className="h-4 w-4 rounded border-gray-300" /> Return items to inventory
            </label>
            <Field label="Reason"><input value={voidForm.reason} onChange={(e) => setVoidForm((f) => ({ ...f, reason: e.target.value }))} className={INPUT} placeholder="required" /></Field>
            <p className="text-xs text-gray-400">To void an order before payment, cancel it from Orders — that already restores stock.</p>
            <button disabled={busy} onClick={doVoid} className={BTN}>Void bill</button>
          </Card>

          <Card icon={RotateCcw} title="Reverse Journal" hint="Post the exact opposite of any journal by its id.">
            <Field label="Journal id"><input type="number" value={reverseForm.journal_id} onChange={(e) => setReverseForm((f) => ({ ...f, journal_id: e.target.value }))} className={INPUT} placeholder="from General Ledger → Journal" /></Field>
            <JournalPreview data={journalPreview} loading={previewLoading} error={previewError} />
            <Field label="Reason"><input value={reverseForm.reason} onChange={(e) => setReverseForm((f) => ({ ...f, reason: e.target.value }))} className={INPUT} /></Field>
            <button disabled={busy} onClick={doReverse} className={BTN}>Reverse</button>
          </Card>
        </div>

        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-5 py-4"><h2 className="text-sm font-semibold text-gray-900">Correction history</h2><p className="mt-0.5 text-xs text-gray-500">Refunds, bill voids, payment-method corrections and journal reversals.</p></div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {history.map((h) => (
                <tr key={h.history_id} tabIndex={0} role="button" onClick={() => openHistory(h)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') openHistory(h); }} className="cursor-pointer hover:bg-gray-50 focus:bg-gray-50 focus:outline-none">
                  <td className="px-5 py-2.5">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${h.type === 'void' ? 'bg-rose-100 text-rose-700' : h.type === 'reversal' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>{h.type}</span>
                  </td>
                  <td className="px-5 py-2.5 font-medium text-gray-900">{h.reference}</td>
                  <td className="px-5 py-2.5 text-gray-600">{h.reason}{h.restocked ? ' · restocked' : ''}</td>
                  <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-blue-700">{money(Math.abs(Number(h.amount || 0)))}</td>
                  <td className="px-5 py-2.5 text-right text-xs text-gray-500">{formatNepalTime(h.created_at)}{h.by_name ? ` · ${h.by_name}` : ''}</td>
                </tr>
              ))}
              {history.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-500">No corrections or reversals yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {confirmation && <ConfirmationDialog
        confirmation={confirmation}
        busy={busy}
        onCancel={() => !busy && setConfirmation(null)}
        onConfirm={() => post(confirmation.body, confirmation.done)}
      />}
      {historyDetail && <HistoryDetail detail={historyDetail} onClose={() => setHistoryDetail(null)} />}
    </AdminLayout>
  );
}

function HistoryDetail({ detail, onClose }) {
  const { row, data, loading, error } = detail;
  return <div className="fixed inset-0 z-[110] flex items-center justify-center bg-gray-950/50 p-4" role="dialog" aria-modal="true" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-gray-200 bg-white shadow-2xl">
      <div className="sticky top-0 z-10 flex items-start justify-between border-b border-gray-200 bg-white px-5 py-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{row.reference}</p><h3 className="mt-1 text-lg font-bold text-gray-950">Correction details</h3></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"><X className="h-4 w-4"/></button></div>
      <div className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-3"><PreviewValue label="Type" value={String(row.type || 'correction').replaceAll('_', ' ')} /><PreviewValue label="Amount affected" value={money(Math.abs(Number(row.amount || 0)))} /><PreviewValue label="When" value={formatNepalTime(row.created_at)} /><PreviewValue label="Performed by" value={row.by_name || 'Not recorded'} /><PreviewValue label="Restocked" value={row.restocked ? 'Yes' : 'No / not applicable'} /></div>
        <div className="rounded-xl bg-gray-50 p-4 text-sm leading-6 text-gray-800"><p className="text-xs font-semibold uppercase text-gray-500">Reason</p><p className="mt-1">{row.reason || 'No reason recorded'}</p></div>
        <JournalPreview data={data} loading={detail.loading} error={error} />
      </div>
    </div>
  </div>;
}

function Card({ icon: Icon, title, hint, children }) {
  return (
    <div className="min-w-0 rounded-2xl border border-gray-200 bg-white p-5">
      <div className="mb-3 flex items-center gap-2"><Icon className="h-5 w-5 text-gray-500" /><h3 className="text-sm font-semibold text-gray-900">{title}</h3></div>
      <p className="mb-4 text-xs text-gray-500">{hint}</p>
      <div className="space-y-3">{children}</div>
    </div>
  );
}
function Field({ label, children }) {
  return <label className="block"><span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>{children}</label>;
}
const INPUT = 'h-11 w-full rounded-lg border border-gray-300 px-3 text-sm text-gray-900';
const BTN = 'mt-1 h-11 w-full rounded-lg bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50';
function newKey() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.random()}`;
}

function JournalPreview({ data, loading, error }) {
  if (loading) return <div className="flex h-20 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-xs text-gray-500"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading journal…</div>;
  if (error) return <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</div>;
  if (!data?.journal) return null;
  const { journal, bill, action } = data;
  const actionLabels = {
    void_bill: bill ? `Linked to ${bill.bill_number} — complete bill void` : 'Complete bill void',
    reverse_credit_collection: `Reopen this customer collection only${bill ? ` — ${bill.bill_number}` : ''}`,
    reverse_credit_writeoff: `Restore this customer write-off only${bill ? ` — ${bill.bill_number}` : ''}`,
    void_purchase: 'Void purchase, stock and linked expense',
    void_expense: 'Void linked expense',
    void_wastage: 'Void wastage, restore stock and linked expense',
    reverse_supplier_payment: 'Reverse supplier payment and payable',
    reverse_refund: 'Reverse this refund only',
    reverse_journal: 'Standalone journal reversal',
  };
  const destructiveBill = action === 'void_bill';
  return (
    <div className="w-full min-w-0 overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
      <div className={`border-b px-3 py-2 ${destructiveBill ? 'border-rose-200 bg-rose-50' : 'border-gray-200 bg-white'}`}>
        <div className="flex items-start gap-2">
          {destructiveBill ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" /> : <ReceiptText className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />}
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-gray-900">#{journal.id} · {journal.memo || 'Journal'}</p>
            <p className="mt-0.5 text-[11px] text-gray-500">{actionLabels[action] || 'Journal reversal'}.</p>
            {journal.reversal_id && <p className="mt-1 text-[11px] font-semibold text-rose-700">Already reversed by journal #{journal.reversal_id}</p>}
          </div>
        </div>
      </div>
      <div className="max-h-72 w-full overflow-auto">
        {bill && <div className="grid min-w-[520px] grid-cols-3 gap-3 border-b border-gray-200 px-3 py-2 text-[11px]">
          <PreviewValue label="Bill" value={bill.bill_number} />
          <PreviewValue label="Total" value={money(bill.grand_total)} />
          <PreviewValue label="Status" value={`${bill.status || '—'} / ${bill.payment_status || '—'}`} />
          <PreviewValue label="Order" value={bill.order?.order_number || '—'} />
          <PreviewValue label="Order type" value={bill.order?.order_type || '—'} />
          <PreviewValue label="Outstanding on bill" value={money(bill.outstanding_amount)} />
          <PreviewValue label="Customer credit charged" value={money(bill.credit?.charged)} />
          <PreviewValue label="Credit cleared" value={money(bill.credit?.cleared)} />
          <PreviewValue label="Credit outstanding" value={money(Math.max(0, Number(bill.credit?.outstanding || 0)))} />
        </div>}
        {!!bill?.items?.length && <table className="w-full min-w-[520px] text-[11px]"><thead className="sticky top-0 bg-gray-100 text-gray-500"><tr><th className="px-3 py-1.5 text-left">Item</th><th className="px-3 py-1.5 text-right">Qty</th><th className="px-3 py-1.5 text-right">Price</th><th className="px-3 py-1.5 text-right">Total</th></tr></thead><tbody>{bill.items.map((item, index) => <tr key={`${item.name}-${index}`} className="border-t border-gray-200"><td className="px-3 py-1.5 text-gray-700">{item.name}</td><td className="px-3 py-1.5 text-right">{item.quantity}</td><td className="px-3 py-1.5 text-right">{money(item.unit_price)}</td><td className="px-3 py-1.5 text-right font-medium">{money(item.total_price)}</td></tr>)}</tbody></table>}
        {!!bill?.payments?.length && <table className="w-full min-w-[520px] text-[11px]"><thead className="bg-gray-100 text-gray-500"><tr><th className="px-3 py-1.5 text-left">Payment method</th><th className="px-3 py-1.5 text-left">Record status</th><th className="px-3 py-1.5 text-right">Amount</th></tr></thead><tbody>{bill.payments.map((payment, index) => <tr key={`${payment.payment_method}-${index}`} className="border-t border-gray-200"><td className="px-3 py-1.5 text-gray-700">{payment.payment_method === 'cash' ? 'Cash' : payment.payment_method === 'credit' ? 'Credit' : 'Online'}</td><td className="px-3 py-1.5 capitalize text-gray-600">{payment.settlement_status || 'received'}</td><td className="px-3 py-1.5 text-right font-medium">{money(payment.amount)}</td></tr>)}</tbody></table>}
        <table className="w-full min-w-[520px] text-[11px]"><thead className="bg-gray-100 text-gray-500"><tr><th className="px-3 py-1.5 text-left">Account</th><th className="px-3 py-1.5 text-right">Debit</th><th className="px-3 py-1.5 text-right">Credit</th></tr></thead><tbody>{journal.lines.map((line) => <tr key={line.id} className="border-t border-gray-200"><td className="px-3 py-1.5 text-gray-700">{line.account_code} · {line.account_name}</td><td className="px-3 py-1.5 text-right">{money(line.debit)}</td><td className="px-3 py-1.5 text-right">{money(line.credit)}</td></tr>)}</tbody></table>
      </div>
    </div>
  );
}

function PreviewValue({ label, value }) {
  return <div><p className="text-gray-400">{label}</p><p className="mt-0.5 truncate font-semibold text-gray-800">{value}</p></div>;
}

function ConfirmationDialog({ confirmation, busy, onCancel, onConfirm }) {
  const rose = confirmation.tone === 'rose';
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="correction-confirm-title">
    <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
      <div className="flex items-start justify-between gap-3"><div className={`rounded-xl p-2 ${rose ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}><AlertTriangle className="h-5 w-5" /></div><button type="button" disabled={busy} onClick={onCancel} aria-label="Close confirmation" className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X className="h-5 w-5" /></button></div>
      <h2 id="correction-confirm-title" className="mt-4 text-lg font-bold text-gray-950">{confirmation.title}</h2>
      <p className="mt-2 text-sm leading-6 text-gray-600">{confirmation.description}</p>
      <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">Reason: <span className="font-medium text-gray-700">{confirmation.body.reason}</span></p>
      <div className="mt-5 flex gap-3"><button type="button" disabled={busy} onClick={onCancel} className="h-11 flex-1 rounded-lg border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">Cancel</button><button type="button" disabled={busy} onClick={onConfirm} className={`h-11 flex-1 rounded-lg text-sm font-semibold text-white disabled:opacity-50 ${rose ? 'bg-rose-700 hover:bg-rose-800' : 'bg-gray-900 hover:bg-gray-800'}`}>{busy ? 'Working…' : confirmation.confirmLabel}</button></div>
    </div>
  </div>;
}
