'use client';

import { useMemo, useState } from 'react';
import Link from '@/components/admin/panel-link';
import { ArrowRight, BadgeDollarSign, Banknote, CircleAlert, Landmark, Layers3, ReceiptText, Search, ShoppingBasket } from 'lucide-react';
import { BarChart, ChartCard, ChartGrid, KpiCards, RankBars, TrendChart } from '@/components/admin/report-kit';
import DonutChart, { DEFAULT_COLORS } from '@/components/admin/donut-chart';
import { financialTone } from '@/lib/financial-tone';
import { formatCalendarDate, formatCalendarDateTime } from '@/lib/calendar-system.js';
import { CashFlowCard, ChannelMix, CountedCash, DigitalReceipts, MoneyPosition } from '@/components/admin/summary-kit.jsx';
import {
  CompactMetrics, DashboardSection, Metric, PrimaryKpis, SectionHeading,
  TableWrap, money, percent,
} from './analytics-ui';
import { clickableRowClass, useAnalyticsRecords } from './analytics-record-viewer';

export function ExecutiveSummary({ data }) {
  return (
    <div className="space-y-4">
      <PrimaryKpis rows={data.primaryKpis} />
      <CompactMetrics rows={data.secondaryKpis} />
    </div>
  );
}

export function SalesPerformance({ data }) {
  const trend = data.sales.trend || [];
  const hourly = data.sales.hourly || [];
  return (
    <DashboardSection>
      <SectionHeading
        eyebrow="Sales performance"
        title="Demand and sales movement"
        description="Settled bill sales and payment activity for the selected Nepal reporting period."
        action={<Link href="/admin/reports?tab=sales" className="inline-flex items-center gap-1 text-sm font-medium text-gray-700 hover:text-gray-950">Sales analytics <ArrowRight className="h-4 w-4" /></Link>}
      />
      <ChartGrid>
        <ChartCard title="Net Item Sales Trend" hint="Menu item sales after discounts; before tax, service and refunds" isEmpty={!trend.length} empty="No settled sales in this period.">
          <TrendChart data={trend} color="blue" format="currency" height={230} />
        </ChartCard>
        <ChartCard title="Collections by Hour" hint="Actual payment rows, Nepal time" isEmpty={!hourly.length} empty="No collections in this period.">
          <BarChart data={hourly} color="slate" format="currency" height={230} />
        </ChartCard>
      </ChartGrid>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.25fr_1fr]">
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-900">Sales by channel</h3>
          <TableWrap minWidth="620px">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-400"><tr><th className="px-4 py-2.5">Channel</th><th className="px-4 py-2.5 text-right">Orders</th><th className="px-4 py-2.5 text-right">Sales</th><th className="px-4 py-2.5 text-right">Average</th><th className="px-4 py-2.5 text-right">Share</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {(data.channels || []).map((row) => <tr key={row.channel}><td className="px-4 py-3 font-medium text-gray-900">{row.channel}</td><td className="px-4 py-3 text-right tabular-nums">{row.orders}</td><td className="px-4 py-3 text-right font-medium tabular-nums text-emerald-700">{money(row.sales)}</td><td className="px-4 py-3 text-right tabular-nums text-emerald-700">{money(row.averageOrder)}</td><td className="px-4 py-3 text-right tabular-nums">{percent(row.share)}</td></tr>)}
            </tbody>
          </TableWrap>
        </div>
        <div className="grid grid-cols-2 gap-4 rounded-xl border border-gray-100 bg-gray-50 p-4">
          <Metric label="Total Item Sales" value={data.totals.itemSales} format="currency" />
          <Metric label="Less: Discounts" value={data.totals.discounts} format="currency" />
          <Metric label="Net Item Sales" value={data.totals.netItemSales} format="currency" tone="positive" />
          <Metric label="Tax + Service" value={data.totals.tax + data.totals.serviceCharge} format="currency" />
          <Metric label="Net Revenue" value={data.totals.netSales} format="currency" tone="positive" />
          <Metric label="Bills" value={data.totals.bills} />
          <Metric label="Items Sold" value={data.totals.itemsSold} />
        </div>
      </div>
    </DashboardSection>
  );
}

export function PaymentFinance({ data }) {
  const sales = data.sales || {};
  const payRows = sales.byPayment || (data.payments.methods || []).map((row) => ({ label: row.label, value: row.amount, meta: `${row.transactions} transaction${row.transactions === 1 ? '' : 's'}` }));
  const groupRows = sales.byGroup || [];
  const categoryRows = (sales.byCategory || []).slice(0, 6);
  const reportKpis = sales.reportKpis || [];
  const explanatoryKpis = reportKpis.map((row) => ({ ...row, hint: row.hint || row.note }));
  const finance = data.finance;
  return (
    <DashboardSection>
      <SectionHeading icon={BadgeDollarSign} tone="emerald" eyebrow="Money control" title="Sales, collections and revenue mix" description="One owner overview for the selected Nepal reporting period. Deeper drilldowns stay inside Reports." />
      <KpiCards kpis={explanatoryKpis} groups={MONEY_KPI_GROUPS} />

      <PaymentSummary data={data} />

      <div className="mt-5">
        <ChannelMix data={data.channelMix || {}} className="overflow-hidden rounded-xl" />
      </div>

      {/* The physical drawer count lives on this Sales & Money view only — the
          same card the Summary Report prints (components/admin/summary-kit.jsx).
          Rendered unconditionally: gating it on days_closed made a period with
          no counted close look like a missing feature, so the card names which
          empty state it is instead. */}
      {/* The three cash-position blocks an owner checks on this view: what was
          physically counted, which QR money was a sale rather than a money
          exchange, and what actually left the drawer. Same cards the Summary
          Report prints, so one figure looks identical wherever it is read. */}
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <MoneyPosition data={data.moneyPosition || {}} className="overflow-hidden rounded-xl" />
        <CashFlowCard data={data.cashFlow || {}} className="overflow-hidden rounded-xl" />
      </div>
      <div className="mt-5">
        <CountedCash data={data.cashReconciliation || {}} className="overflow-hidden rounded-xl" />
      </div>
      <div className="mt-5">
        <DigitalReceipts data={data.digitalReceipts || {}} className="overflow-hidden rounded-xl" />
      </div>


      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <ChartCard title="Net Item Sales Trend" hint="Menu item sales after discounts; before tax, service and refunds" isEmpty={!sales.trend?.length} empty="No settled sales in this period.">
          <TrendChart data={sales.trend || []} color="blue" format="currency" height={230} />
        </ChartCard>
        <ChartCard title="By Hour" hint="Settled bill value by Nepal hour" isEmpty={!sales.hourly?.length} empty="No hourly sales in this period.">
          <BarChart data={sales.hourly || []} color="slate" format="currency" height={230} />
        </ChartCard>
        <ChartCard title="By Day" isEmpty={!sales.byDay?.length} empty="No daily sales in this period.">
          <BarChart data={sales.byDay || []} color="blue" format="currency" height={220} />
        </ChartCard>
        <DonutMix title="Money Received by Method" rows={payRows} centerLabel="Received" />
        <DonutMix title="By Group" rows={groupRows} centerLabel="Sales" />
        <DonutMix title="By Category" rows={categoryRows} centerLabel="Sales" />
      </div>

      <ChannelPaymentMix rows={sales.channelPayments} />

      <div className="mt-5 grid gap-4 rounded-2xl border border-gray-800 bg-gray-950 p-5 text-white sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 sm:p-6">
        {[
          ['Gross Profit', finance.grossProfit], ['Operating Expenses', finance.operatingExpenses], ['Operating Profit', finance.operatingProfit], ['Cash in Hand', finance.cashBalance],
          ['Bank / Online', finance.bankBalance], ['Receivables', finance.accountsReceivable], ['Payables', finance.accountsPayable], ['Purchases', finance.cogs],
        ].map(([label, value]) => {
          const tone = financialTone({ label, value });
          return <div key={label}><p className="text-xs text-gray-400">{label}</p><p className={`mt-1 truncate text-base font-semibold tabular-nums ${tone === 'positive' ? 'text-emerald-400' : tone === 'negative' ? 'text-rose-400' : 'text-white'}`}>{money(value)}</p></div>;
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-sm font-medium">
        <Link href="/admin/financial-reports?report=pnl" className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-950"><BadgeDollarSign className="h-4 w-4" /> View P&amp;L</Link>
        <Link href="/admin/finance-dashboard" className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-950"><ReceiptText className="h-4 w-4" /> Full finance</Link>
      </div>
      <PaymentDetailTables breakdown={data.payments?.breakdown} />
    </DashboardSection>
  );
}

const MONEY_KPI_GROUPS = [
  { id: 'sold', title: '1. What customers ordered', caption: 'Start with menu prices, then subtract discounts.', keys: ['total_item_sales', 'discounts', 'net_item_sales'] },
  { id: 'billed', title: '2. What the restaurant billed', caption: 'Add service, delivery and other charges; tax is shown separately; subtract refunds.', keys: ['service_extra', 'tax', 'refunds', 'net'] },
  { id: 'settled', title: '3. How those bills were settled', caption: 'Cash and QR are received. Sold on credit is not cash; credit collections are already inside cash/QR.', keys: ['cash_received', 'qr_received', 'credit_sales', 'credit_collections'] },
  { id: 'position', title: '4. What remains open', caption: 'Receivables are the live all-time balance; open orders are not billed yet.', keys: ['receivables', 'open_orders_value', 'cancelled', 'aov'] },
];

export function MoneyBridge({ sales, payments }) {
  const extra = Number(sales.billedTotal || 0) - Number(sales.netItemSales || 0) - Number(sales.tax || 0);
  const collected = Number(payments.cashCollected || 0) + Number(payments.onlineCollected || 0);
  const credit = Number((sales.reportKpis || []).find((row) => row.key === 'credit_sales')?.value || 0);
  return <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50/60 p-4 sm:p-5">
    <h3 className="text-sm font-semibold text-blue-950">How the figures connect</h3>
    <div className="mt-3 grid gap-3 text-sm lg:grid-cols-2">
      <p className="rounded-lg bg-white px-4 py-3 text-gray-700"><strong className="text-gray-950">Sales:</strong> {money(sales.itemSales)} − {money(sales.discounts)} discounts = <strong>{money(sales.netItemSales)}</strong> net items; then + {money(extra)} service/delivery/extras + {money(sales.tax)} tax − {money(sales.refunds)} refunds = <strong>{money(sales.netSales)}</strong> net revenue.</p>
      <p className="rounded-lg bg-white px-4 py-3 text-gray-700"><strong className="text-gray-950">Settlement:</strong> {money(payments.cashCollected)} cash + {money(payments.onlineCollected)} digital = <strong>{money(collected)}</strong> actually received. Another <strong>{money(credit)}</strong> was sold on credit, so it is revenue but not cash received yet.</p>
    </div>
    <p className="mt-3 text-xs text-blue-800">“Still Owed to You” is the current balance across all unpaid bills, including older periods. “Open Orders” have not become bills or sales yet.</p>
  </div>;
}

function PaymentSummary({ data }) {
  const breakdown = data.payments?.breakdown;
  if (!breakdown) return null;
  const summary = breakdown.summary || {};
  const rows = [
    ['Cash sales', summary.cash?.amount, summary.cash?.transactions, 'cash'],
    ['Online / bank sales', summary.online?.amount, summary.online?.transactions, 'online'],
    ['Split payments', summary.split?.amount, summary.split?.transactions, 'split'],
    ['Still owed (not received)', summary.due?.amount, summary.due?.transactions, 'due'],
    ['Of cash: credit collected', summary.ledgerCash, null, 'ledger'],
    ['Of bank / QR: credit collected', summary.ledgerOnline, null, 'ledger'],
  ];
  return (
    <section className="mt-5 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">Payment reconciliation</p>
          <h3 className="mt-0.5 text-base font-semibold text-gray-950">Payment summary</h3>
          <p className="mt-1 text-sm text-gray-500">{data.range?.start} to {data.range?.end} · Split orders are shown once, separately from cash and online sales.</p>
        </div>
        <span className="inline-flex w-fit rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">{summary.transactions || 0} sales / due entries</span>
      </div>
      <TableWrap minWidth="620px">
        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-400"><tr><th className="px-4 py-2.5">Payment method</th><th className="px-4 py-2.5 text-right">Amount</th><th className="px-4 py-2.5 text-right">Orders / entries</th></tr></thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map(([label, amount, transactions, tone]) => <tr key={label} className="hover:bg-gray-50/70"><td className="px-4 py-3 font-medium text-gray-900"><PaymentIcon tone={tone} />{label}</td><td className="px-4 py-3 text-right font-semibold tabular-nums text-gray-900">{money(amount)}</td><td className="px-4 py-3 text-right tabular-nums text-gray-600">{transactions == null ? <span className="text-gray-300">—</span> : transactions}</td></tr>)}
        </tbody>
        <tfoot className="border-t-2 border-gray-900 bg-gray-50"><tr><td className="px-4 py-3.5 font-semibold text-gray-950">Total money received</td><td className="px-4 py-3.5 text-right text-base font-bold tabular-nums text-emerald-700">{money(summary.total)}</td><td className="px-4 py-3.5 text-right font-bold tabular-nums text-gray-950">{summary.transactions || 0}</td></tr></tfoot>
      </TableWrap>

    </section>
  );
}

function PaymentDetailTables({ breakdown }) {
  if (!breakdown) return null;
  return <div className="mt-8 border-t border-gray-200 pt-6"><div className="mb-4"><p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">Payment records</p><h3 className="mt-0.5 text-base font-semibold text-gray-950">Order-level payment details</h3><p className="mt-1 text-sm text-gray-500">Detailed sales and outstanding balances for the selected period.</p></div><div className="grid gap-5 2xl:grid-cols-2"><PaymentOrderTable icon={Banknote} tone="emerald" title="Cash sales" note="Cash-only orders" rows={breakdown.rows?.cash} /><PaymentOrderTable icon={Landmark} tone="blue" title="Online / bank sales" note="Online or bank-only orders" rows={breakdown.rows?.online} /><SplitOrderTable rows={breakdown.rows?.split} /><DueOrderTable rows={breakdown.rows?.due} /></div></div>;
}

function PaymentIcon({ tone }) {
  const Icon = tone === 'cash' ? Banknote : tone === 'online' ? Landmark : tone === 'split' ? Layers3 : CircleAlert;
  const color = tone === 'cash' ? 'text-emerald-600' : tone === 'online' ? 'text-blue-600' : tone === 'split' ? 'text-violet-600' : tone === 'due' ? 'text-amber-600' : 'text-gray-500';
  return <Icon className={`mr-2 inline-block h-4 w-4 ${color}`} />;
}

function OrderLabel({ row }) {
  const value = row.orderNumber || row.billNumber || '—';
  return <span className="font-medium text-gray-900">{String(value).startsWith('#') ? value : `#${value}`}</span>;
}

function DateTime({ value, dateOnly = false }) {
  if (!value) return <span className="text-gray-300">—</span>;
  return <span className="whitespace-nowrap">{dateOnly ? formatCalendarDate(value) : formatCalendarDateTime(value)}</span>;
}

function PaymentOrderTable({ icon: Icon, tone, title, note, rows = [] }) {
  const { openBill } = useAnalyticsRecords();
  return <div className="overflow-hidden rounded-xl border border-gray-200"><div className="flex items-start justify-between gap-3 border-b border-gray-100 bg-gray-50 px-4 py-3"><div className="flex gap-2.5"><span className={`mt-0.5 rounded-lg p-1.5 ${tone === 'emerald' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}><Icon className="h-4 w-4" /></span><div><h4 className="text-sm font-semibold text-gray-950">{title} <span className="text-gray-400">({rows.length})</span></h4><p className="text-xs text-gray-500">{note}</p></div></div><span className="text-sm font-semibold tabular-nums text-gray-900">{money(rows.reduce((sum, row) => sum + Number(row.paid || 0), 0))}</span></div><div className="max-h-[360px] overflow-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead className="sticky top-0 z-10 bg-white text-xs uppercase tracking-wide text-gray-400"><tr><th className="px-4 py-2.5">S.N.</th><th className="px-4 py-2.5">Order #</th><th className="px-4 py-2.5">Date / time</th><th className="px-4 py-2.5">Customer</th><th className="px-4 py-2.5 text-right">Amount</th></tr></thead><tbody className="divide-y divide-gray-100">{rows.map((row, index) => <tr key={row.id} className={clickableRowClass} onClick={() => openBill(row.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openBill(row.id); } }} tabIndex={0} role="button"><td className="px-4 py-3 text-gray-400">{index + 1}</td><td className="px-4 py-3"><OrderLabel row={row} /></td><td className="px-4 py-3 text-gray-600"><DateTime value={row.dateTime} /></td><td className="px-4 py-3 text-gray-700">{row.customer}</td><td className="px-4 py-3 text-right font-semibold tabular-nums text-gray-900">{money(row.paid)}</td></tr>)}</tbody></table>{!rows.length && <p className="py-8 text-center text-sm text-gray-400">No {title.toLowerCase()} in this period.</p>}</div></div>;
}

function SplitOrderTable({ rows = [] }) {
  const { openBill } = useAnalyticsRecords();
  return <div className="overflow-hidden rounded-xl border border-violet-100"><div className="flex items-start justify-between gap-3 border-b border-violet-100 bg-violet-50 px-4 py-3"><div className="flex gap-2.5"><span className="mt-0.5 rounded-lg bg-violet-100 p-1.5 text-violet-700"><Layers3 className="h-4 w-4" /></span><div><h4 className="text-sm font-semibold text-gray-950">Split payment orders <span className="text-gray-400">({rows.length})</span></h4><p className="text-xs text-gray-500">Orders paid with multiple methods</p></div></div><span className="text-sm font-semibold tabular-nums text-gray-900">{money(rows.reduce((sum, row) => sum + Number(row.paid || 0), 0))}</span></div><div className="max-h-[360px] overflow-auto"><table className="w-full min-w-[770px] text-left text-sm"><thead className="sticky top-0 z-10 bg-white text-xs uppercase tracking-wide text-gray-400"><tr><th className="px-4 py-2.5">S.N.</th><th className="px-4 py-2.5">Order #</th><th className="px-4 py-2.5">Date / time</th><th className="px-4 py-2.5">Customer</th><th className="px-4 py-2.5 text-right">Cash</th><th className="px-4 py-2.5 text-right">Online / bank</th><th className="px-4 py-2.5 text-right">Amount</th></tr></thead><tbody className="divide-y divide-gray-100">{rows.map((row, index) => <tr key={row.id} className={clickableRowClass} onClick={() => openBill(row.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openBill(row.id); } }} tabIndex={0} role="button"><td className="px-4 py-3 text-gray-400">{index + 1}</td><td className="px-4 py-3"><OrderLabel row={row} /></td><td className="px-4 py-3 text-gray-600"><DateTime value={row.dateTime} /></td><td className="px-4 py-3 text-gray-700">{row.customer}</td><td className="px-4 py-3 text-right tabular-nums text-gray-600">{money(row.cash)}</td><td className="px-4 py-3 text-right tabular-nums text-gray-600">{money(row.online)}</td><td className="px-4 py-3 text-right font-semibold tabular-nums text-gray-900">{money(row.paid)}</td></tr>)}</tbody></table>{!rows.length && <p className="py-8 text-center text-sm text-gray-400">No split payment orders in this period.</p>}</div></div>;
}

function DueOrderTable({ rows = [] }) {
  const { openBill } = useAnalyticsRecords();
  return <div className="overflow-hidden rounded-xl border border-amber-100"><div className="flex items-start justify-between gap-3 border-b border-amber-100 bg-amber-50 px-4 py-3"><div className="flex gap-2.5"><span className="mt-0.5 rounded-lg bg-amber-100 p-1.5 text-amber-700"><CircleAlert className="h-4 w-4" /></span><div><h4 className="text-sm font-semibold text-gray-950">Due / unpaid bills <span className="text-gray-400">({rows.length})</span></h4><p className="text-xs text-gray-500">Outstanding balance from bills in this period</p></div></div><span className="text-sm font-semibold tabular-nums text-amber-800">{money(rows.reduce((sum, row) => sum + Number(row.outstanding || 0), 0))}</span></div><div className="max-h-[360px] overflow-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="sticky top-0 z-10 bg-white text-xs uppercase tracking-wide text-gray-400"><tr><th className="px-4 py-2.5">S.N.</th><th className="px-4 py-2.5">Order #</th><th className="px-4 py-2.5">Date</th><th className="px-4 py-2.5">Customer</th><th className="px-4 py-2.5 text-right">Amount</th><th className="px-4 py-2.5 text-right">Paid</th><th className="px-4 py-2.5 text-right">Outstanding</th></tr></thead><tbody className="divide-y divide-gray-100">{rows.map((row, index) => <tr key={row.id} className={clickableRowClass} onClick={() => openBill(row.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openBill(row.id); } }} tabIndex={0} role="button"><td className="px-4 py-3 text-gray-400">{index + 1}</td><td className="px-4 py-3"><OrderLabel row={row} /></td><td className="px-4 py-3 text-gray-600"><DateTime value={row.dateTime} dateOnly /></td><td className="px-4 py-3 text-gray-700">{row.customer}</td><td className="px-4 py-3 text-right tabular-nums text-gray-600">{money(row.amount)}</td><td className="px-4 py-3 text-right tabular-nums text-gray-600">{money(row.paid)}</td><td className="px-4 py-3 text-right font-semibold tabular-nums text-amber-800">{money(row.outstanding)}</td></tr>)}</tbody></table>{!rows.length && <p className="py-8 text-center text-sm text-gray-400">No outstanding bills from this period.</p>}</div></div>;
}

function ChannelPaymentMix({ rows = [] }) {
  const preferredOrder = ['Dine In', 'Takeaway', 'Delivery'];
  const ordered = [...rows].sort((a, b) => {
    const aIndex = preferredOrder.indexOf(a.channel);
    const bIndex = preferredOrder.indexOf(b.channel);
    return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
  });
  return <div className="mt-7 border-t border-gray-100 pt-6"><div className="mb-4"><p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">Channel payment mix</p><h3 className="mt-1 text-base font-semibold text-gray-950">How each order channel was paid</h3><p className="mt-1 text-sm text-gray-500">Cash, bank / QR, and credit collections for dine-in, takeaway, and delivery orders.</p></div><div className="grid gap-5 xl:grid-cols-2">{ordered.length ? ordered.map((row) => <DonutMix key={row.channel} title={`${row.channel} payments`} rows={row.methods} centerLabel={row.channel} />) : <div className="rounded-xl border border-dashed border-gray-200 py-10 text-center text-sm text-gray-400 xl:col-span-2">No channel payment data for this period.</div>}</div></div>;
}

function DonutMix({ title, rows, centerLabel }) {
  const total = (rows || []).reduce((sum, row) => sum + Number(row.value || 0), 0);
  const segments = (rows || []).slice(0, 6).map((row, index) => ({
    label: row.label,
    value: row.value,
    color: DEFAULT_COLORS[index % DEFAULT_COLORS.length],
  }));

  return (
    <ChartCard title={title} isEmpty={!segments.length} empty={`No ${title.toLowerCase()} data in this period.`}>
      <div className="grid items-center gap-5 sm:grid-cols-[220px_1fr]">
        <DonutChart segments={segments} size={220} thickness={32} centerLabel={centerLabel} centerValue={money(total)} />
        <div className="space-y-2">
          {segments.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 inline-flex items-center gap-2 text-gray-600">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: row.color }} />
                <span className="break-words">{row.label}</span>
              </span>
              <span className="shrink-0 font-medium tabular-nums text-gray-900">{money(row.value)}</span>
            </div>
          ))}
        </div>
      </div>
    </ChartCard>
  );
}

export function MenuPerformance({ data }) {
  const menu = data.menu;
  const { openReportRow } = useAnalyticsRecords();
  const [itemSearch, setItemSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const categoryBars = (menu.categories || []).slice(0, 8).map((row) => ({ label: row.category, value: row.revenue, meta: `${row.quantity} items | ${row.orders} orders` }));
  const soldItems = useMemo(
    () => menu.soldItems || menu.topItems || [],
    [menu.soldItems, menu.topItems]
  );
  const categories = useMemo(
    () => [...new Set(soldItems.map((row) => row.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [soldItems]
  );
  const visibleItems = useMemo(() => {
    const query = itemSearch.trim().toLowerCase();
    return soldItems.filter((row) =>
      (!categoryFilter || row.category === categoryFilter) &&
      (!query || `${row.item} ${row.category}`.toLowerCase().includes(query))
    );
  }, [soldItems, itemSearch, categoryFilter]);
  const openItemBills = (row) => openReportRow({
    tab: 'menu',
    tableId: 'sold-items',
    row: { id: row.id, name: row.item, category: row.category },
    title: 'Menu item bills',
  });
  return (
    <DashboardSection>
      <SectionHeading icon={ShoppingBasket} tone="amber" eyebrow="Menu intelligence" title="What guests are ordering" description="Item and category revenue are pre-discount menu mix figures; recipe margin is shown only when recipe coverage is complete." action={<Link href="/admin/reports?tab=menu" className="inline-flex items-center gap-1 text-sm font-medium text-gray-700">Menu analytics <ArrowRight className="h-4 w-4" /></Link>} />
      {!menu.recipeCoverage.reliable && <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">Margin ranking is hidden: {menu.recipeCoverage.recipes} of {menu.recipeCoverage.menuItems} menu items have recipes.</div>}
      <div className="grid min-w-0 gap-5 xl:grid-cols-[1.25fr_0.75fr] [&>*]:min-w-0">
        <div className="min-w-0 overflow-hidden rounded-xl border border-gray-100 bg-white">
          <div className="flex flex-col gap-2 border-b border-gray-100 p-3 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input type="search" value={itemSearch} onChange={(event) => setItemSearch(event.target.value)} placeholder="Search sold items…" className="h-9 w-full rounded-lg border border-gray-300 pl-9 pr-3 text-sm text-gray-900" />
            </div>
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="h-9 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 sm:w-auto">
              <option value="">All categories</option>
              {categories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </div>
          <p className="px-4 py-2 text-xs text-gray-500">{visibleItems.length} of {soldItems.length} sold item{soldItems.length === 1 ? '' : 's'}</p>
          <div className="max-h-[32rem] divide-y divide-gray-100 overflow-y-auto border-t border-gray-100 sm:hidden">
            {visibleItems.map((row) => (
              <button key={row.rowKey || `${row.id ?? 'unlinked'}:${row.item}:${row.category}`} type="button" className="block w-full px-4 py-3 text-left transition-colors hover:bg-gray-50 active:bg-gray-100" onClick={() => openItemBills(row)}>
                <span className="block break-words text-sm font-semibold text-gray-900">{row.item}</span>
                <span className="mt-0.5 block break-words text-xs text-gray-500">{row.category}</span>
                <span className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <span><span className="block text-gray-400">Qty</span><span className="mt-0.5 block font-semibold tabular-nums text-gray-800">{row.quantity}</span></span>
                  <span><span className="block text-gray-400">Orders</span><span className="mt-0.5 block font-semibold tabular-nums text-gray-800">{row.orders}</span></span>
                  <span className="text-right"><span className="block text-gray-400">Revenue</span><span className="mt-0.5 block font-semibold tabular-nums text-emerald-700">{money(row.revenue)}</span></span>
                </span>
              </button>
            ))}
            {!visibleItems.length && <p className="py-10 text-center text-sm text-gray-400">No sold items match these filters.</p>}
          </div>
          <div className="hidden max-h-[440px] overflow-auto border-t border-gray-100 sm:block">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="sticky top-0 z-10 bg-gray-50 text-xs uppercase tracking-wide text-gray-400"><tr><th className="px-4 py-2.5">Item</th><th className="px-4 py-2.5">Category</th><th className="px-4 py-2.5 text-right">Qty</th><th className="px-4 py-2.5 text-right">Orders</th><th className="px-4 py-2.5 text-right">Revenue</th></tr></thead>
              <tbody className="divide-y divide-gray-100">{visibleItems.map((row) => <tr key={row.rowKey || `${row.id ?? 'unlinked'}:${row.item}:${row.category}`} className={clickableRowClass} onClick={() => openItemBills(row)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openItemBills(row); } }} tabIndex={0} role="button" aria-label={`View bills containing ${row.item}`}><td className="px-4 py-3 font-medium text-gray-900">{row.item}</td><td className="px-4 py-3 text-gray-500">{row.category}</td><td className="px-4 py-3 text-right tabular-nums">{row.quantity}</td><td className="px-4 py-3 text-right tabular-nums">{row.orders}</td><td className="px-4 py-3 text-right font-medium tabular-nums text-emerald-700">{money(row.revenue)}</td></tr>)}</tbody>
            </table>
            {!visibleItems.length && <p className="py-10 text-center text-sm text-gray-400">No sold items match these filters.</p>}
          </div>
        </div>
        <ChartCard title="Category Mix" isEmpty={!categoryBars.length} empty="No category sales."><RankBars data={categoryBars} color="slate" format="currency" /></ChartCard>
      </div>
      <div className="mt-5 grid min-w-0 gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        <div className="min-w-0 rounded-xl border border-gray-100 bg-gray-50 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900"><ShoppingBasket className="h-4 w-4" /> Commonly ordered together</h3>
          <div className="mt-3 divide-y divide-gray-100">{menu.pairs?.length ? menu.pairs.map((row) => <div key={row.items} className="flex min-w-0 items-start justify-between gap-3 py-2.5 text-sm"><span className="min-w-0 break-words text-gray-700">{row.items}</span><span className="shrink-0 tabular-nums text-gray-500">{row.orders} orders</span></div>) : <p className="py-6 text-center text-sm text-gray-400">Not enough completed baskets yet.</p>}</div>
        </div>
        <div className="min-w-0 rounded-xl border border-gray-100 bg-gray-50 p-4">
          <h3 className="text-sm font-semibold text-gray-900">Lowest-moving sold items</h3>
          <div className="mt-3 divide-y divide-gray-100">{(menu.lowItems || []).map((row) => <div key={`${row.item}-${row.category}`} className="flex min-w-0 items-start justify-between gap-3 py-2.5 text-sm"><div className="min-w-0"><p className="break-words font-medium text-gray-800">{row.item}</p><p className="break-words text-xs text-gray-400">{row.category}</p></div><span className="shrink-0 tabular-nums text-gray-600">{row.quantity} sold</span></div>)}</div>
        </div>
      </div>
    </DashboardSection>
  );
}

