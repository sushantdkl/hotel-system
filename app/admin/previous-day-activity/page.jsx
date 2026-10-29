'use client';

import { useEffect, useState } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import { History, X } from 'lucide-react';
import { apiJson } from '@/lib/authed-fetch';
import { money } from '@/components/accounting/ledger-table';
import { formatNepalTime } from '@/lib/time-utils';
import { formatNepalDisplay } from '@/lib/report-dates';

export default function PreviousDayActivityPage() {
  const [activity, setActivity] = useState({ records: [], changes: [] });
  const [detail, setDetail] = useState(null);
  const [filters, setFilters] = useState({ from: '', to: '' });
  const [loading, setLoading] = useState(true);

  const load = (next = filters) => {
    const query = new URLSearchParams();
    if (next.from) query.set('from', next.from);
    if (next.to) query.set('to', next.to);
    const url = `/api/admin/historical-activity${query.size ? `?${query}` : ''}`;
    setLoading(true);
    return apiJson(url)
      .then((data) => setActivity(data || { records: [], changes: [] }))
      .catch(() => setActivity({ records: [], changes: [] }))
      .finally(() => setLoading(false));
  };

  // Initial report intentionally uses the blank (all earlier dates) range.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load({ from: '', to: '' }); }, []);

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-indigo-50 p-2 text-indigo-700"><History className="h-5 w-5" /></div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Previous-day activity</h1>
            <p className="mt-1 text-sm text-gray-500">Records belong to the effective day; changes show when an older day was touched later.</p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-end gap-2">
          <Field label="From"><input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} className="h-10 rounded-lg border border-gray-300 px-3 text-sm" /></Field>
          <Field label="To"><input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} className="h-10 rounded-lg border border-gray-300 px-3 text-sm" /></Field>
          <button type="button" onClick={() => load(filters)} className="h-10 rounded-lg bg-gray-900 px-4 text-sm font-semibold text-white hover:bg-gray-800">Apply</button>
        </div>
      </header>

      <div className="space-y-5 bg-gray-50 p-4 sm:p-6 lg:p-8">
        {loading && (
          <p className="rounded-2xl border border-gray-200 bg-white px-5 py-3 text-sm text-gray-500">Loading previous-day activity…</p>
        )}
        <ActivityTable
          title={`Earlier-date records (${activity.records?.length || 0})`}
          empty="No earlier purchases or expenses in this range."
          rows={activity.records || []}
          kind="records"
          onOpen={setDetail}
        />
        <ActivityTable
          title={`Later changes to earlier dates (${activity.changes?.length || 0})`}
          empty="No later changes to earlier dates in this range."
          rows={activity.changes || []}
          kind="changes"
          onOpen={setDetail}
        />
        {activity.truncated && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-800">
            Showing the newest 500 matching rows. Narrow the date range to review older activity.
          </p>
        )}
      </div>
      {detail && <ActivityDetail row={detail.row} kind={detail.kind} onClose={() => setDetail(null)} />}
    </AdminLayout>
  );
}

function ActivityTable({ title, rows, kind, empty, onOpen }) {
  const open = (row) => onOpen?.({ row, kind });
  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <h3 className="border-b border-gray-100 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] table-fixed text-sm">
          <colgroup>
            <col className="w-[140px]" />
            <col className="w-[180px]" />
            <col />
            <col className="w-[120px]" />
            <col className="w-[170px]" />
          </colgroup>
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">Effective day</th>
              <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">{kind === 'changes' ? 'Action' : 'Record'}</th>
              <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">Reference</th>
              <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">Amount</th>
              <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">{kind === 'changes' ? 'Actually changed' : 'Entered'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row) => (
              <tr
                key={row.change_id || `${row.record_type}-${row.record_id}`}
                tabIndex={0}
                role="button"
                onClick={() => open(row)}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') open(row); }}
                className="cursor-pointer hover:bg-indigo-50/40 focus:bg-indigo-50/40 focus:outline-none"
              >
                <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-800">{formatNepalDisplay(row.effective_date)}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex whitespace-nowrap rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase text-gray-700">
                      {kind === 'changes' ? String(row.action).replaceAll('_', ' ') : row.record_type}
                    </span>
                    {kind === 'records' && row.status ? (
                      <span className="whitespace-nowrap capitalize text-xs text-gray-500">{row.status}</span>
                    ) : null}
                  </div>
                </td>
                <td className="truncate px-4 py-3 text-gray-700" title={row.party || row.reference}>
                  {row.reference}{row.party ? ` · ${row.party}` : ''}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-gray-800">
                  {row.amount == null ? '—' : money(row.amount)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right text-xs text-gray-500">
                  <div>{formatNepalTime(row.created_at)}</div>
                  {row.by_name ? <div className="truncate">{row.by_name}</div> : null}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-gray-500">{empty}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ActivityDetail({ row, kind, onClose }) {
  const isChange = kind === 'changes' || Boolean(row.action && (row.before_data || row.after_data || row.change_id));
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-gray-950/50 p-4" role="dialog" aria-modal="true" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl border border-gray-200 bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-gray-200 bg-white px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
              {isChange ? String(row.action || 'change').replaceAll('_', ' ') : String(row.record_type || 'record')}
            </p>
            <h3 className="mt-1 text-lg font-bold text-gray-950">{row.reference}</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 p-5">
          {isChange ? (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <PreviewValue label="Effective business day" value={formatNepalDisplay(row.effective_date)} />
                <PreviewValue label="Action performed" value={formatNepalTime(row.created_at)} />
                <PreviewValue label="Performed by" value={row.by_name || 'Not recorded'} />
              </div>
              {row.note && (
                <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
                  <p className="text-xs font-semibold uppercase text-amber-700">Note</p>
                  <p className="mt-1">{row.note}</p>
                </div>
              )}
              {(row.before_data || row.after_data) && (
                <div className="grid gap-4 md:grid-cols-2">
                  <Snapshot title="Before" data={row.before_data} />
                  <Snapshot title="After" data={row.after_data} />
                </div>
              )}
            </>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              <PreviewValue label="Effective business day" value={formatNepalDisplay(row.effective_date)} />
              <PreviewValue label="Record type" value={String(row.record_type || '—')} />
              <PreviewValue label="Status" value={row.status || '—'} />
              <PreviewValue label="Party" value={row.party || '—'} />
              <PreviewValue label="Amount" value={row.amount == null ? '—' : money(row.amount)} />
              <PreviewValue label="Payment" value={row.payment_method || '—'} />
              <PreviewValue label="Entered" value={formatNepalTime(row.created_at)} />
              <PreviewValue label="Reference" value={row.reference || '—'} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Snapshot({ title, data }) {
  if (!data) {
    return (
      <div className="rounded-xl border border-gray-200 p-4">
        <p className="text-xs font-semibold uppercase text-gray-500">{title}</p>
        <p className="mt-3 text-sm text-gray-400">No record</p>
      </div>
    );
  }
  const fields = [
    ['Invoice', data.invoice_number],
    ['Invoice date', data.invoice_date],
    ['Supplier', data.supplier],
    ['Total', data.total == null ? null : money(data.total)],
    ['Status', data.status],
    ['Payment', data.payment_method || data.expense?.payment_method],
    ['Notes', data.notes],
    ['Items', Array.isArray(data.items) ? `${data.items.length} line(s)` : null],
  ].filter(([, value]) => value !== null && value !== undefined && value !== '');
  return (
    <div className="rounded-xl border border-gray-200 p-4">
      <p className="text-xs font-semibold uppercase text-gray-500">{title}</p>
      <dl className="mt-3 space-y-2">
        {fields.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 text-sm">
            <dt className="text-gray-500">{label}</dt>
            <dd className="max-w-[65%] text-right font-medium text-gray-800">{String(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Field({ label, children }) {
  return <label className="block"><span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>{children}</label>;
}

function PreviewValue({ label, value }) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className="mt-0.5 truncate text-sm font-semibold capitalize text-gray-800">{value}</p>
    </div>
  );
}
