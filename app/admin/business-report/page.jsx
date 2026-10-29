'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, Printer, RefreshCw } from 'lucide-react';
import AdminLayout from '@/components/admin/admin-layout';
import { KpiCards } from '@/components/admin/report-kit';
import { apiJson, authedRequest } from '@/lib/authed-fetch';
import { nepalDateString } from '@/lib/report-dates';

const SCOPES = [['combined', 'Combined'], ['restaurant', 'Restaurant'], ['hotel', 'Hotel']];
const money = (n) => `Rs ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function BusinessReportPage() {
  const today = nepalDateString(new Date());
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [scope, setScope] = useState('combined');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await apiJson(`/api/admin/business-report?from=${from}&to=${to}`)); setError(''); }
    catch (err) { setError(err.error || 'Could not build the report.'); }
    finally { setLoading(false); }
  }, [from, to]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const downloadCsv = async () => {
    const response = await authedRequest(`/api/admin/business-report?from=${from}&to=${to}&format=csv`);
    if (!response.ok) { setError('Could not export the report.'); return; }
    const url = URL.createObjectURL(await response.blob());
    const link = Object.assign(document.createElement('a'), { href: url, download: `business-report-${from}-to-${to}.csv` });
    link.click();
    URL.revokeObjectURL(url);
  };

  const p = data?.pnl;
  const k = data?.hotelKpis;
  const segments = scope === 'combined' ? [['Restaurant', p?.restaurant], ['Hotel', p?.hotel], ['Shared costs', p?.shared], ['Combined', p?.combined]] : [[scope === 'hotel' ? 'Hotel' : 'Restaurant', p?.[scope]]];
  return (
    <AdminLayout>
      <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8 print:p-0">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">Business report</h1>
            <p className="mt-1 text-sm text-gray-500">Profit & loss by business and hotel performance · {from} to {to}</p>
          </div>
          <div className="flex flex-wrap items-end gap-2 print:hidden">
            <label className="text-xs font-semibold text-gray-600">From<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="mt-1 block rounded-lg border border-gray-300 px-2 py-2 text-sm" /></label>
            <label className="text-xs font-semibold text-gray-600">To<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="mt-1 block rounded-lg border border-gray-300 px-2 py-2 text-sm" /></label>
            <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
            <button type="button" onClick={downloadCsv} disabled={!data} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"><Download className="h-4 w-4" /> CSV</button>
            <button type="button" onClick={() => window.print()} disabled={!data} className="inline-flex items-center gap-2 rounded-lg bg-gray-950 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800"><Printer className="h-4 w-4" /> Print / PDF</button>
          </div>
        </header>
        <div role="group" aria-label="Report scope" className="inline-grid grid-cols-3 gap-1 rounded-xl bg-gray-100 p-1 print:hidden">
          {SCOPES.map(([id, label]) => <button key={id} type="button" aria-pressed={scope === id} onClick={() => setScope(id)} className={`rounded-lg px-4 py-1.5 text-sm font-semibold ${scope === id ? 'bg-white text-gray-950 shadow-sm' : 'text-gray-600'}`}>{label}</button>)}
        </div>
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {data && <>
          <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <h2 className="border-b border-gray-200 px-5 py-4 font-bold text-gray-950">Profit & loss</h2>
            <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-5 py-3">Business</th><th className="px-5 py-3 text-right">Revenue</th><th className="px-5 py-3 text-right">Expenses</th><th className="px-5 py-3 text-right">Net</th></tr></thead>
              <tbody className="divide-y divide-gray-100">{segments.map(([name, s]) => <tr key={name} className={name === 'Combined' ? 'bg-gray-50 font-bold' : ''}><td className="px-5 py-3">{name}</td><td className="px-5 py-3 text-right tabular-nums">{money(s.revenue)}</td><td className="px-5 py-3 text-right tabular-nums">{money(s.expenses)}</td><td className={`px-5 py-3 text-right tabular-nums ${s.net < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{money(s.net)}</td></tr>)}</tbody>
            </table></div>
            <p className="px-5 py-3 text-xs text-gray-500">From the shared ledger. Expenses follow each expense category’s business (set under Finance → Expense Categories); purchases and wastage count as restaurant; untagged costs (payroll, other) are shared.{scope !== 'combined' && ` Shared costs this period: ${money(p.shared.expenses)}.`}</p>
          </section>
          {scope !== 'restaurant' && <section>
            <h2 className="mb-3 font-bold text-gray-950">Hotel performance</h2>
            <KpiCards kpis={[
              { key: 'occ', label: 'Occupancy', value: k.occupancyPercent, format: 'percent', sub: `${k.roomNightsSold} of ${k.availableRoomNights} room-nights`, highlight: true },
              { key: 'adr', label: 'ADR', value: k.adr, format: 'currency', hint: 'Average daily rate: room revenue ÷ room-nights sold (before tax).' },
              { key: 'revpar', label: 'RevPAR', value: k.revpar, format: 'currency', hint: 'Revenue per available room-night: room revenue ÷ available room-nights.' },
              { key: 'rev', label: 'Room revenue', value: k.roomRevenue, format: 'currency' },
              { key: 'ns', label: 'No-shows', value: k.noShows, format: 'number' },
              { key: 'ota', label: 'OTA commission', value: k.otaCommission, format: 'currency', sub: `${k.otaBookings} OTA booking(s)`, hint: 'Commission owed to booking channels for stays arriving in this period. Not yet posted as an expense.' },
            ]} />
          </section>}
          <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <h2 className="border-b border-gray-200 px-5 py-4 font-bold text-gray-950">Daily</h2>
            <div className="max-h-[480px] overflow-auto print:max-h-none"><table className="w-full min-w-[560px] text-sm">
              <thead className="sticky top-0 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-5 py-3">Date</th>{scope !== 'hotel' && <th className="px-5 py-3 text-right">Restaurant revenue</th>}{scope !== 'restaurant' && <><th className="px-5 py-3 text-right">Hotel revenue</th><th className="px-5 py-3 text-right">Room-nights</th><th className="px-5 py-3 text-right">Room revenue (by night)</th></>}</tr></thead>
              <tbody className="divide-y divide-gray-100">{data.daily.map((d) => <tr key={d.date}><td className="px-5 py-2.5">{d.date}</td>{scope !== 'hotel' && <td className="px-5 py-2.5 text-right tabular-nums">{money(d.restaurantRevenue)}</td>}{scope !== 'restaurant' && <><td className="px-5 py-2.5 text-right tabular-nums">{money(d.hotelRevenue)}</td><td className="px-5 py-2.5 text-right tabular-nums">{d.roomNights}</td><td className="px-5 py-2.5 text-right tabular-nums">{money(d.roomRevenue)}</td></>}</tr>)}</tbody>
            </table>{!data.daily.length && <p className="p-8 text-center text-sm text-gray-500">No activity in this period.</p>}</div>
          </section>
        </>}
      </div>
    </AdminLayout>
  );
}
