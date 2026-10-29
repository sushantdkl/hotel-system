'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BedDouble, Download, Printer, RefreshCw, UtensilsCrossed } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import AdminLayout from '@/components/admin/admin-layout';
import { KpiCards } from '@/components/admin/report-kit';
import { apiJson, authedRequest } from '@/lib/authed-fetch';
import { nepalDateString } from '@/lib/report-dates';

const money = (n) => `Rs ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
const shiftDate = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const BUSINESS = { restaurant: ['Restaurant', 'bg-amber-500', 'text-amber-700'], hotel: ['Hotel', 'bg-emerald-600', 'text-emerald-700'], shared: ['Shared', 'bg-gray-400', 'text-gray-600'] };

function presets(today) {
  const monthStart = `${today.slice(0, 8)}01`;
  const lastMonthEnd = shiftDate(monthStart, -1);
  return [
    ['today', 'Today', today, today],
    ['yesterday', 'Yesterday', shiftDate(today, -1), shiftDate(today, -1)],
    ['7d', 'Last 7 days', shiftDate(today, -6), today],
    ['month', 'This month', monthStart, today],
    ['last_month', 'Last month', `${lastMonthEnd.slice(0, 8)}01`, lastMonthEnd],
  ];
}

function Card({ title, action, children, className = '' }) {
  return <section className={`overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm ${className}`}>
    <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-5 py-4"><h2 className="font-bold text-gray-950">{title}</h2>{action}</div>
    {children}
  </section>;
}

function Row({ label, value, strong, tone = '' }) {
  return <div className={`flex items-center justify-between gap-3 py-1.5 text-sm ${strong ? 'font-bold text-gray-950' : 'text-gray-700'}`}><span>{label}</span><span className={`tabular-nums ${tone}`}>{value}</span></div>;
}

/** Restaurant or hotel column: its revenue lines, its own costs and its profit. */
function BusinessCard({ id, icon: Icon, segment, lines, extra, share }) {
  const [label, bar, text] = BUSINESS[id];
  return <Card title={<span className="flex items-center gap-2"><Icon className={`h-5 w-5 ${text}`} />{label}</span>} action={<span className={`text-sm font-semibold ${text}`}>{share}% of revenue</span>}>
    <div className="space-y-4 p-5">
      <div><p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Revenue</p><p className="text-3xl font-bold tabular-nums text-gray-950">{money(segment.revenue)}</p><div className="mt-2 h-1.5 rounded-full bg-gray-100"><div className={`h-1.5 rounded-full ${bar}`} style={{ width: `${share}%` }} /></div></div>
      <div className="divide-y divide-gray-100">
        {lines.map((l) => <Row key={l.label} label={l.label} value={money(l.amount)} />)}
        {!lines.length && <p className="py-2 text-sm text-gray-500">No sales in this period.</p>}
      </div>
      <div className="rounded-xl bg-gray-50 px-4 py-2">
        {extra.map(([k, v]) => <Row key={k} label={k} value={v} />)}
      </div>
      <div className="border-t border-gray-200 pt-2">
        <Row label="Own expenses" value={`− ${money(segment.expenses)}`} />
        <Row label={`${label} profit (before shared costs)`} value={money(segment.net)} strong tone={segment.net < 0 ? 'text-rose-700' : 'text-emerald-700'} />
      </div>
    </div>
  </Card>;
}

export default function CombinedReportPage() {
  const today = nepalDateString(new Date());
  const ranges = useMemo(() => presets(today), [today]);
  const [range, setRange] = useState('today');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [report, setReport] = useState(null);
  const [live, setLive] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, l] = await Promise.all([apiJson(`/api/admin/business-report?from=${from}&to=${to}`), apiJson('/api/admin/overview')]);
      setReport(r); setLive(l); setError('');
    } catch (err) {
      setError(err.error || err.message || 'Could not build the combined report.');
    } finally { setLoading(false); }
  }, [from, to]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const pick = (id) => { const [, , f, t] = ranges.find((r) => r[0] === id); setRange(id); setFrom(f); setTo(t); };
  const custom = (setter) => (e) => { setRange('custom'); setter(e.target.value); };

  const downloadCsv = async () => {
    const response = await authedRequest(`/api/admin/business-report?from=${from}&to=${to}&format=csv`);
    if (!response.ok) { setError('Could not export the report.'); return; }
    const url = URL.createObjectURL(await response.blob());
    Object.assign(document.createElement('a'), { href: url, download: `combined-report-${from}-to-${to}.csv` }).click();
    URL.revokeObjectURL(url);
  };

  const p = report?.pnl;
  const k = report?.hotelKpis;
  const collected = report?.collections.reduce((s, c) => ({ restaurant: s.restaurant + c.restaurant, hotel: s.hotel + c.hotel, total: s.total + c.total }), { restaurant: 0, hotel: 0, total: 0 });
  const linesFor = (kind, id) => (report?.[kind] || []).filter((l) => l.business === id);
  const rangeLabel = from === to ? from : `${from} → ${to}`;

  return (
    <AdminLayout>
      <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8 print:p-0">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-400">Restaurant + hotel</p>
            <h1 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">Combined report</h1>
            <p className="mt-1 text-sm text-gray-500">Both businesses together · {rangeLabel}</p>
          </div>
          <div className="flex flex-wrap gap-2 print:hidden">
            <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
            <button type="button" onClick={downloadCsv} disabled={!report} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"><Download className="h-4 w-4" /> CSV</button>
            <button type="button" onClick={() => window.print()} disabled={!report} className="inline-flex items-center gap-2 rounded-lg bg-gray-950 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800"><Printer className="h-4 w-4" /> Print / PDF</button>
          </div>
        </header>

        <div className="flex flex-wrap items-end gap-3 print:hidden">
          <div role="group" aria-label="Period" className="flex flex-wrap gap-1 rounded-xl bg-gray-100 p-1">
            {ranges.map(([id, label]) => <button key={id} type="button" aria-pressed={range === id} onClick={() => pick(id)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${range === id ? 'bg-white text-gray-950 shadow-sm' : 'text-gray-600'}`}>{label}</button>)}
          </div>
          <label className="text-xs font-semibold text-gray-600">From<input type="date" value={from} max={to} onChange={custom(setFrom)} className="mt-1 block rounded-lg border border-gray-300 px-2 py-1.5 text-sm" /></label>
          <label className="text-xs font-semibold text-gray-600">To<input type="date" value={to} min={from} max={today} onChange={custom(setTo)} className="mt-1 block rounded-lg border border-gray-300 px-2 py-1.5 text-sm" /></label>
        </div>

        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {!report ? !error && <div className="h-64 animate-pulse rounded-2xl bg-gray-100" /> : <>
          <KpiCards
            groups={[{ id: 'totals', title: 'Totals', caption: 'Restaurant and hotel together, from the shared ledger.', keys: ['revenue', 'expenses', 'net', 'collected', 'restaurant', 'hotel', 'bills', 'occupancy'] }]}
            kpis={[
              { key: 'revenue', label: 'Total revenue', value: p.combined.revenue, format: 'currency', highlight: true, sub: `Restaurant ${money(p.restaurant.revenue)} · Hotel ${money(p.hotel.revenue)}` },
              { key: 'expenses', label: 'Total expenses', value: p.combined.expenses, format: 'currency', sub: `Restaurant ${money(p.restaurant.expenses)} · Hotel ${money(p.hotel.expenses)} · Shared ${money(p.shared.expenses)}` },
              { key: 'net', label: 'Net profit', value: p.combined.net, format: 'currency', highlight: true, sub: `${pct(p.combined.net, p.combined.revenue)}% margin` },
              { key: 'collected', label: 'Money collected', value: collected.total, format: 'currency', sub: `Restaurant ${money(collected.restaurant)} · Hotel ${money(collected.hotel)}`, hint: 'Cash, bank, card and wallet payments received, less refunds. Credit sales, room-charged bills and unpaid guest balances are not included.' },
              { key: 'restaurant', label: 'Restaurant sales', value: p.restaurant.revenue, format: 'currency', sub: `${pct(p.restaurant.revenue, p.combined.revenue)}% of revenue` },
              { key: 'hotel', label: 'Hotel sales', value: p.hotel.revenue, format: 'currency', sub: `${pct(p.hotel.revenue, p.combined.revenue)}% of revenue` },
              { key: 'bills', label: 'Restaurant bills', value: report.restaurantKpis.bills, format: 'number', sub: `Average ${money(report.restaurantKpis.avgBill)}` },
              { key: 'occupancy', label: 'Hotel occupancy', value: k.occupancyPercent, format: 'percent', sub: `${k.roomNightsSold} of ${k.availableRoomNights} room-nights` },
            ]}
          />

          <div className="grid gap-6 lg:grid-cols-2">
            <BusinessCard id="restaurant" icon={UtensilsCrossed} segment={p.restaurant} lines={linesFor('revenueLines', 'restaurant')} share={pct(p.restaurant.revenue, p.combined.revenue)}
              extra={[['Bills settled', report.restaurantKpis.bills], ['Average bill', money(report.restaurantKpis.avgBill)], ['Money collected', money(collected.restaurant)]]} />
            <BusinessCard id="hotel" icon={BedDouble} segment={p.hotel} lines={linesFor('revenueLines', 'hotel')} share={pct(p.hotel.revenue, p.combined.revenue)}
              extra={[['Room-nights sold', `${k.roomNightsSold} · ${k.occupancyPercent}% occupancy`], ['ADR / RevPAR', `${money(k.adr)} / ${money(k.revpar)}`], ['Check-ins / check-outs', `${report.stays.checkIns} / ${report.stays.checkOuts}`], ['Money collected', money(collected.hotel)], ['OTA commission owed', money(k.otaCommission)]]} />
          </div>

          <Card title="Profit & loss, combined">
            <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-5 py-3" /><th className="px-5 py-3 text-right">Restaurant</th><th className="px-5 py-3 text-right">Hotel</th><th className="px-5 py-3 text-right">Shared</th><th className="px-5 py-3 text-right">Total</th></tr></thead>
              <tbody className="divide-y divide-gray-100 tabular-nums">
                <tr><td className="px-5 py-3 font-medium">Revenue</td><td className="px-5 py-3 text-right">{money(p.restaurant.revenue)}</td><td className="px-5 py-3 text-right">{money(p.hotel.revenue)}</td><td className="px-5 py-3 text-right text-gray-400">—</td><td className="px-5 py-3 text-right font-semibold">{money(p.combined.revenue)}</td></tr>
                <tr><td className="px-5 py-3 font-medium">Expenses</td><td className="px-5 py-3 text-right">{money(p.restaurant.expenses)}</td><td className="px-5 py-3 text-right">{money(p.hotel.expenses)}</td><td className="px-5 py-3 text-right">{money(p.shared.expenses)}</td><td className="px-5 py-3 text-right font-semibold">{money(p.combined.expenses)}</td></tr>
                <tr className="bg-gray-50 font-bold"><td className="px-5 py-3">Net profit</td>{[p.restaurant.net, p.hotel.net, -p.shared.expenses, p.combined.net].map((n, i) => <td key={i} className={`px-5 py-3 text-right ${n < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{money(n)}</td>)}</tr>
              </tbody>
            </table></div>
            <p className="px-5 py-3 text-xs text-gray-500">Expenses follow each expense category’s business (Finance → Expense Categories). Purchases and wastage are restaurant. Payroll and untagged costs are shared and only come off the total.</p>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Where the money went">
              <div className="divide-y divide-gray-100 px-5 py-2">
                {report.expenseLines.map((l) => <div key={`${l.business}-${l.label}`} className="flex items-center justify-between gap-3 py-2 text-sm"><span className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${BUSINESS[l.business][1]}`} />{l.label}<span className="text-xs text-gray-400">{BUSINESS[l.business][0]}</span></span><span className="tabular-nums">{money(l.amount)}</span></div>)}
                {!report.expenseLines.length && <p className="py-6 text-center text-sm text-gray-500">No expenses in this period.</p>}
              </div>
            </Card>
            <Card title="Money collected by method">
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-5 py-3">Method</th><th className="px-5 py-3 text-right">Restaurant</th><th className="px-5 py-3 text-right">Hotel</th><th className="px-5 py-3 text-right">Total</th></tr></thead>
                <tbody className="divide-y divide-gray-100 tabular-nums">
                  {report.collections.map((c) => <tr key={c.method}><td className="px-5 py-2.5">{c.method}</td><td className="px-5 py-2.5 text-right">{money(c.restaurant)}</td><td className="px-5 py-2.5 text-right">{money(c.hotel)}</td><td className="px-5 py-2.5 text-right font-semibold">{money(c.total)}</td></tr>)}
                  {report.collections.length > 0 && <tr className="bg-gray-50 font-bold"><td className="px-5 py-2.5">Total</td><td className="px-5 py-2.5 text-right">{money(collected.restaurant)}</td><td className="px-5 py-2.5 text-right">{money(collected.hotel)}</td><td className="px-5 py-2.5 text-right">{money(collected.total)}</td></tr>}
                </tbody>
              </table>{!report.collections.length && <p className="p-6 text-center text-sm text-gray-500">No payments received in this period.</p>}</div>
            </Card>
          </div>

          {report.daily.length > 1 && <Card title="Revenue by day">
            <div className="h-72 p-4"><ResponsiveContainer width="100%" height="100%">
              <BarChart data={report.daily}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" /><XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} fontSize={12} /><YAxis fontSize={12} width={70} /><Tooltip formatter={(v) => money(v)} /><Legend />
                <Bar dataKey="restaurantRevenue" name="Restaurant" stackId="r" fill="#f59e0b" /><Bar dataKey="hotelRevenue" name="Hotel" stackId="r" fill="#059669" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer></div>
          </Card>}

          <Card title="Daily">
            <div className="max-h-[480px] overflow-auto print:max-h-none"><table className="w-full min-w-[640px] text-sm">
              <thead className="sticky top-0 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-5 py-3">Date</th><th className="px-5 py-3 text-right">Restaurant</th><th className="px-5 py-3 text-right">Hotel</th><th className="px-5 py-3 text-right">Total revenue</th><th className="px-5 py-3 text-right">Expenses</th><th className="px-5 py-3 text-right">Net</th><th className="px-5 py-3 text-right">Room-nights</th></tr></thead>
              <tbody className="divide-y divide-gray-100 tabular-nums">{report.daily.map((d) => { const total = d.restaurantRevenue + d.hotelRevenue; const net = total - d.expenses; return <tr key={d.date}><td className="px-5 py-2.5">{d.date}</td><td className="px-5 py-2.5 text-right">{money(d.restaurantRevenue)}</td><td className="px-5 py-2.5 text-right">{money(d.hotelRevenue)}</td><td className="px-5 py-2.5 text-right font-semibold">{money(total)}</td><td className="px-5 py-2.5 text-right">{money(d.expenses)}</td><td className={`px-5 py-2.5 text-right ${net < 0 ? 'text-rose-700' : ''}`}>{money(net)}</td><td className="px-5 py-2.5 text-right">{d.roomNights}</td></tr>; })}</tbody>
            </table>{!report.daily.length && <p className="p-8 text-center text-sm text-gray-500">No activity in this period.</p>}</div>
          </Card>
        </>}

        {live && <section className="print:hidden">
          <KpiCards
            groups={[{ id: 'live', title: 'Right now', caption: `Live status · business date ${live.date}`, keys: ['occupancy', 'in_house', 'arrivals', 'departures', 'dirty', 'tables', 'orders', 'balance', 'staff'] }]}
            kpis={[
              { key: 'occupancy', label: 'Hotel occupancy', value: live.hotel.occupancy, format: 'percent', sub: `${live.hotel.occupied} of ${live.hotel.sellable} sellable rooms`, highlight: true },
              { key: 'in_house', label: 'In-house stays', value: live.hotel.occupied, format: 'number' },
              { key: 'arrivals', label: 'Arrivals today', value: live.hotel.arrivals, format: 'number' },
              { key: 'departures', label: 'Due out', value: live.hotel.departures, format: 'number' },
              { key: 'dirty', label: 'Rooms not ready', value: live.hotel.dirty, format: 'number' },
              { key: 'tables', label: 'Active tables', value: live.restaurant.activeTables, format: 'number', sub: `of ${live.restaurant.totalTables} tables` },
              { key: 'orders', label: 'Live orders', value: live.restaurant.liveOrders, format: 'number' },
              { key: 'balance', label: 'Open guest balances', value: live.hotel.openBalance, format: 'currency' },
              { key: 'staff', label: 'Staff on duty', value: live.staffOnDuty, format: 'number', sub: live.managerOnDuty ? 'Manager clocked in' : 'Manager not clocked in' },
            ]}
          />
          <p className="mt-3 text-xs text-gray-500">Detail: <Link href="/admin/business-report" className="underline">Business report</Link> · <Link href="/admin/financial-reports" className="underline">Financial reports</Link> · <Link href="/admin/reports" className="underline">Restaurant sales report</Link></p>
        </section>}
      </div>
    </AdminLayout>
  );
}
