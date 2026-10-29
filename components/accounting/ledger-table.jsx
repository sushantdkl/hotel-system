'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { formatNepalDate, formatNepalTime } from '@/lib/time-utils';

/**
 * Debit/credit table with a running balance, shared by the General Ledger,
 * Cash Book and Bank Book. `lines` are oldest-first; the balance runs down.
 * `debitNormal` flips the sign so asset/expense books read naturally.
 */

export function money(n) {
  const v = Number(n || 0);
  return `Rs ${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Pure: attach a running balance to each line. Kept out of the component body
// so there is no across-render mutation for the compiler to flag.
function withRunningBalance(lines, debitNormal, opening) {
  let bal = Number(opening) || 0;
  const rows = lines.map((l) => {
    bal += debitNormal ? Number(l.debit || 0) - Number(l.credit || 0) : Number(l.credit || 0) - Number(l.debit || 0);
    return { ...l, _balance: bal };
  });
  return { rows, closing: bal };
}

export default function LedgerTable({ lines = [], debitNormal = true, opening = 0, loading = false, empty = 'No entries.' }) {
  const [selected, setSelected] = useState(null);
  const { rows, closing: bal } = withRunningBalance(lines, debitNormal, opening);
  const totalDr = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCr = lines.reduce((s, l) => s + Number(l.credit || 0), 0);

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Date</th>
              <th className="px-4 py-3 font-semibold">Details</th>
              <th className="px-4 py-3 text-right font-semibold">{debitNormal ? 'Added (Debit)' : 'Removed (Debit)'}</th>
              <th className="px-4 py-3 text-right font-semibold">{debitNormal ? 'Removed (Credit)' : 'Added (Credit)'}</th>
              <th className="px-4 py-3 text-right font-semibold">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {opening !== 0 && (
              <tr className="bg-gray-50/60 text-gray-500">
                <td className="px-4 py-2" colSpan={4}>Opening balance</td>
                <td className="px-4 py-2 text-right tabular-nums">{money(opening)}</td>
              </tr>
            )}
            {rows.map((l, i) => (
              <tr key={i} tabIndex={0} role="button" onClick={() => setSelected(l)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setSelected(l); }} className="cursor-pointer hover:bg-gray-50 focus:bg-gray-50 focus:outline-none">
                <td className="px-4 py-2 text-gray-600">{l.entry_date ? formatNepalDate(l.entry_date) : '—'}</td>
                <td className="px-4 py-2">
                  <span className="text-gray-900">{l.memo || l.line_memo || '—'}</span>
                  {l.source_type && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase text-gray-500">{l.source_type}</span>}
                </td>
                <td className={`px-4 py-2 text-right tabular-nums font-medium ${debitNormal ? 'text-emerald-700' : 'text-rose-700'}`}>{Number(l.debit) ? money(l.debit) : ''}</td>
                <td className={`px-4 py-2 text-right tabular-nums font-medium ${debitNormal ? 'text-rose-700' : 'text-emerald-700'}`}>{Number(l.credit) ? money(l.credit) : ''}</td>
                <td className={`px-4 py-2 text-right tabular-nums font-semibold ${Number(l._balance) < 0 ? 'text-rose-700' : Number(l._balance) > 0 ? 'text-emerald-700' : 'text-gray-500'}`}>{money(l._balance)}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-500">{empty}</td></tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t border-gray-200 bg-gray-50 font-semibold text-gray-900">
              <tr>
                <td className="px-4 py-3" colSpan={2}>Totals</td>
                <td className="px-4 py-3 text-right tabular-nums">{money(totalDr)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{money(totalCr)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{money(bal)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {selected && <LedgerDetail line={selected} debitNormal={debitNormal} onClose={() => setSelected(null)} />}
    </div>
  );
}

function LedgerDetail({ line, debitNormal, onClose }) {
  const debit = Number(line.debit || 0);
  const credit = Number(line.credit || 0);
  const impact = debitNormal ? debit - credit : credit - debit;
  return <div className="fixed inset-0 z-[110] flex items-center justify-center bg-gray-950/50 p-4" role="dialog" aria-modal="true" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white shadow-2xl">
      <div className="flex items-start justify-between border-b border-gray-200 px-5 py-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Journal #{line.journal_id || '—'}</p><h3 className="mt-1 text-base font-bold text-gray-950">{line.memo || line.line_memo || 'Ledger movement'}</h3></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"><X className="h-4 w-4"/></button></div>
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <Detail label="Date" value={line.created_at ? formatNepalTime(line.created_at) : formatNepalDate(line.entry_date)} />
        <Detail label="Recorded by" value={line.created_by_name || 'Not recorded'} />
        <Detail label="Source" value={String(line.source_type || 'manual').replaceAll('_', ' ')} />
        <Detail label="Source record" value={line.source_id ? `#${line.source_id}` : '—'} />
        <Detail label={debitNormal ? 'Added' : 'Removed'} value={debit ? money(debit) : '—'} tone={debit ? (debitNormal ? 'green' : 'red') : ''}/>
        <Detail label={debitNormal ? 'Removed' : 'Added'} value={credit ? money(credit) : '—'} tone={credit ? (debitNormal ? 'red' : 'green') : ''}/>
      </div>
      <div className={`border-t px-5 py-4 ${impact < 0 ? 'border-rose-200 bg-rose-50 text-rose-800' : impact > 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-gray-200 bg-gray-50 text-gray-700'}`}><p className="text-xs font-semibold uppercase">Account impact</p><p className="mt-1 text-xl font-bold tabular-nums">{impact > 0 ? '+' : impact < 0 ? '−' : ''}{money(Math.abs(impact))}</p></div>
    </div>
  </div>;
}

function Detail({ label, value, tone = '' }) {
  return <div><p className="text-xs font-medium text-gray-500">{label}</p><p className={`mt-1 text-sm font-semibold ${tone === 'green' ? 'text-emerald-700' : tone === 'red' ? 'text-rose-700' : 'text-gray-900'}`}>{value}</p></div>;
}
