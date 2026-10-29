'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, BedDouble, Banknote, CalendarHeart, RefreshCw, Users, UtensilsCrossed } from 'lucide-react';
import AdminLayout from '@/components/admin/admin-layout';
import { apiJson } from '@/lib/authed-fetch';

const money = (n) => `Rs ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const SEV = { high: 'border-l-red-600 bg-red-50/40', medium: 'border-l-amber-500 bg-amber-50/40', low: 'border-l-gray-300' };

function Tile({ label, value, hint, href }) {
  const body = <div className="rounded-xl border border-gray-200 bg-white p-4"><p className="text-xs text-gray-500">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums text-gray-950">{value}</p>{hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}</div>;
  return href ? <Link href={href} className="block hover:opacity-90">{body}</Link> : body;
}

function Section({ icon: Icon, title, action, children }) {
  return <section className="rounded-2xl border border-gray-200 bg-gray-50/60 p-4">
    <div className="mb-3 flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 font-bold text-gray-950"><Icon className="h-4 w-4" />{title}</h2>{action}</div>
    {children}
  </section>;
}

/**
 * Owner / general manager control center (Combined workspace): what happened,
 * what needs attention, what was earned and what is unpaid, across rooms,
 * restaurant and finance. Revenue is from the ledger, so a restaurant bill
 * charged to a room is counted once.
 */
export default function ControlCenterPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { setData(await apiJson('/api/admin/control-center')); setError(''); } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { void Promise.resolve().then(load); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);
  const h = data?.hotel; const r = data?.restaurant; const f = data?.finance;
  return <AdminLayout><div className="mx-auto max-w-[1500px] space-y-5 p-4 sm:p-6">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="text-xs font-bold uppercase tracking-widest text-gray-500">Combined · {data?.date || ''}</p><h1 className="text-2xl font-semibold text-gray-950 sm:text-3xl">Control center</h1><p className="mt-1 text-sm text-gray-600">Rooms, restaurant and money in one view. Figures follow your permissions and the ledger.</p></div>
      <div className="flex gap-2"><Link href="/admin/business-report" className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold">Business report</Link><Link href="/admin/hotel/reports" className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold">Hotel reports</Link><button onClick={load} className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold"><RefreshCw className="h-4 w-4" />Refresh</button></div>
    </header>
    {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
    {!data ? <div className="h-96 animate-pulse rounded-2xl bg-gray-100" /> : <>
      <Section icon={AlertTriangle} title={`Needs attention (${data.alerts.length})`} action={<Link className="text-sm font-semibold text-red-700" href="/admin/alerts">Owner alerts{data.openOwnerAlerts ? ` · ${data.openOwnerAlerts} open` : ''}</Link>}>
        {!data.alerts.length ? <p className="text-sm text-gray-600">Nothing needs action right now.</p> : <ul className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white">{data.alerts.slice(0, 15).map((a, i) => <li key={i} className={`flex items-center justify-between gap-3 border-l-4 px-4 py-2.5 text-sm ${SEV[a.severity]}`}><span><span className="mr-2 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-semibold text-gray-600">{a.area}</span>{a.text}</span>{a.link && <Link className="shrink-0 text-xs font-semibold text-gray-700 underline" href={a.link}>Open</Link>}</li>)}</ul>}
      </Section>
      <div className="grid gap-5 xl:grid-cols-2">
        <Section icon={BedDouble} title="Hotel today" action={<Link className="text-sm font-semibold text-emerald-700" href="/admin/hotel">Front desk</Link>}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Occupancy" value={`${h.occupancy}%`} hint={`${h.roomsSold} of ${h.roomsAvailable} rooms`} />
            <Tile label="ADR" value={money(h.adr)} hint={`Month ${money(h.monthAdr)}`} />
            <Tile label="RevPAR" value={money(h.revpar)} hint={`Month ${money(h.monthRevpar)}`} />
            <Tile label="Room revenue" value={money(h.roomRevenueToday)} hint="Nights posted today" />
            <Tile label="Arrivals" value={h.arrivals} hint={`${h.noShowsPending} no-show(s) pending`} href="/admin/hotel" />
            <Tile label="Departures" value={h.departures} href="/admin/hotel" />
            <Tile label="In-house guests" value={h.inHouseGuests} />
            <Tile label="Outstanding folios" value={money(h.outstandingFolios)} href="/admin/hotel/folios" />
            <Tile label="Dirty rooms" value={h.dirtyRooms} href="/admin/hotel/housekeeping" />
            <Tile label="Out of order" value={h.outOfOrder} href="/admin/hotel/maintenance" />
            <Tile label="Month occupancy" value={`${h.monthOccupancy}%`} />
            <Tile label="Rooms total" value={h.roomsTotal} />
          </div>
        </Section>
        <Section icon={UtensilsCrossed} title="Restaurant today" action={<Link className="text-sm font-semibold text-amber-700" href="/admin/dashboard">Restaurant dashboard</Link>}>
          {!r ? <p className="text-sm text-gray-600">Restaurant figures are not available.</p> : <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Sales (ex. tax)" value={money(r.sales)} hint={`${r.bills} bills`} />
            <Tile label="Average check" value={money(r.averageCheck)} hint={r.covers ? `${r.covers} covers` : ''} />
            <Tile label="Walk-in guests" value={money(r.walkIn)} />
            <Tile label="Hotel guests" value={money(r.hotelGuests)} hint="In-house guests dining" />
            <Tile label="Room service" value={money(r.roomService)} />
            <Tile label="Covered by meal plans" value={money(r.packageCovered)} />
            <Tile label="Discounts" value={money(r.discounts)} />
            <Tile label="Cancelled KOTs" value={r.cancelledKots} hint={`${r.openTables} table(s) open`} />
            {r.byFoodGroup.map((g) => <Tile key={g.group} label={g.group} value={money(g.amount)} />)}
          </div>}
        </Section>
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <Section icon={Banknote} title="Revenue by department" action={<Link className="text-sm font-semibold text-indigo-700" href="/admin/financial-reports">Financial reports</Link>}>
          <div className="grid grid-cols-2 gap-3"><Tile label="Total today" value={money(f.revenueToday)} /><Tile label="Total this month" value={money(f.revenueMonth)} /></div>
          <table className="mt-3 w-full text-sm"><thead><tr className="text-left text-xs text-gray-500"><th className="py-1">Department</th><th className="py-1 text-right">Today</th><th className="py-1 text-right">Month</th></tr></thead><tbody>{f.departmentsMonth.map((d) => <tr key={d.label} className="border-t border-gray-200"><td className="py-1.5">{d.label}</td><td className="py-1.5 text-right tabular-nums">{money(f.departmentsToday.find((x) => x.label === d.label)?.revenue)}</td><td className="py-1.5 text-right tabular-nums">{money(d.revenue)}</td></tr>)}</tbody></table>
          <p className="mt-2 text-xs text-gray-500">From the general ledger. Restaurant bills charged to rooms count once, in Food &amp; beverage.</p>
        </Section>
        <Section icon={Banknote} title="Money position">
          <div className="grid grid-cols-2 gap-3">
            <Tile label="Cash" value={money(f.cash)} href="/admin/cash-book" />
            <Tile label="Bank / QR / card" value={money(f.bank)} href="/admin/bank-book" />
            <Tile label="Guest receivables" value={money(f.guestReceivables)} hint="Open hotel folios" />
            <Tile label="Corporate & agents" value={money(f.cityLedger)} hint="City ledger" />
            <Tile label="Customer credit" value={money(f.customerReceivables)} href="/admin/accounts-receivable" />
            <Tile label="Guest deposits" value={money(f.guestDeposits)} hint="Liability, not revenue" />
            <Tile label="Meal-plan liability" value={money(f.packageLiability)} hint="Allowances not yet used" />
            <Tile label="Payables" value={money(f.payables)} href="/admin/accounts-payable" />
          </div>
        </Section>
        <Section icon={Users} title="Costs and controls">
          <div className="grid grid-cols-2 gap-3">
            <Tile label="Expenses today" value={money(f.expensesToday)} />
            <Tile label="Expenses month" value={money(f.expensesMonth)} />
            <Tile label="Payroll month" value={money(f.payrollMonth)} href="/admin/payroll" />
            <Tile label="Inventory value" value={money(f.inventoryValue)} href="/admin/inventory" />
            <Tile label="Last cash difference" value={money(f.lastCashDifference)} href="/admin/business-days" />
            <Tile label="Unverified payments" value={f.unverifiedPayments} href="/admin/settlements" />
            <Tile label="Staff on duty" value={data.staff.onDuty} hint={data.staff.managerOnDuty ? 'Manager on duty' : 'No manager clocked in'} />
          </div>
        </Section>
      </div>
      <Section icon={CalendarHeart} title="Events & banquets">
        <p className="text-sm text-gray-600">No events or banquet module is installed in this system, so there are no event figures. Group stays (master reservations) are on the hotel side.</p>
      </Section>
    </>}
  </div></AdminLayout>;
}
