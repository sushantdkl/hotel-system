'use client';
import Link from 'next/link';
import { analyticsReportHref } from '@/lib/analytics-links';

import {
  Banknote, Bike, ClipboardList, Coins, CreditCard, Gift, Landmark, PiggyBank,
  ShoppingBag, ShoppingCart, Star, Tag, TrendingUp, Undo2, User, Users,
  UtensilsCrossed, Wallet,
} from 'lucide-react';
import { ChartCard, RankBars, TrendChart, formatValue } from '@/components/admin/report-kit';
import DonutChart, { DEFAULT_COLORS } from '@/components/admin/donut-chart';

const money = (value) => formatValue(value, 'currency');
const number = (value) => formatValue(value, 'number');
const percent = (value) => formatValue(value, 'percent');

const ORDER_TYPE_COLORS = ['#0f766e', '#1e293b', '#eab308'];
const PAYMENT_COLORS = ['#1e293b', '#0f766e', '#eab308'];

const ICON_WRAP = {
  amber: 'bg-amber-50 text-amber-700',
  teal: 'bg-teal-50 text-teal-700',
  rose: 'bg-rose-50 text-rose-600',
  slate: 'bg-slate-100 text-slate-600',
};

function MetricCard({ icon: Icon, iconTone = 'teal', label, value, detail, hero, href }) {
  if (href) return <Link href={href} className="block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 hover:brightness-95" aria-label={`View ${label} report`}><MetricCard icon={Icon} iconTone={iconTone} label={label} value={value} detail={detail} hero={hero} /></Link>;
  if (hero) {
    return (
      <div className="relative overflow-hidden rounded-xl bg-teal-800 px-4 py-4 text-white shadow-sm sm:px-5">
        <svg className="pointer-events-none absolute bottom-1 right-2 h-12 w-28 opacity-25" viewBox="0 0 112 48" fill="none" aria-hidden>
          <path d="M0 34c14 0 16-20 28-16s18 24 34 14 22-20 50-16" stroke="white" strokeWidth="2.25" />
        </svg>
        <div className="relative">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15">
            <Icon className="h-5 w-5" />
          </span>
          <p className="mt-3 text-xs font-medium text-white/75">{label}</p>
          <p className="mt-1 truncate text-2xl font-bold tabular-nums" title={String(value ?? 0)}>{money(value)}</p>
          {detail ? <p className="mt-1 truncate text-xs text-white/60">{detail}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-100 bg-white px-4 py-4 shadow-sm sm:px-5">
      <span className={`flex h-10 w-10 items-center justify-center rounded-full ${ICON_WRAP[iconTone] || ICON_WRAP.teal}`}>
        <Icon className="h-5 w-5" />
      </span>
      <p className="mt-3 text-xs font-medium text-gray-500">{label}</p>
      <p className="mt-1 truncate text-2xl font-bold tabular-nums text-gray-950" title={String(value ?? 0)}>{money(value)}</p>
      {detail ? <p className="mt-1 truncate text-xs text-gray-400">{detail}</p> : null}
    </div>
  );
}

function SplitStat({ icon: Icon, iconTone = 'teal', label, value, href }) {
  if (href) return <Link href={href} className="block rounded focus-visible:outline-2 focus-visible:outline-teal-700 hover:underline" aria-label={`View ${label} report`}><SplitStat icon={Icon} iconTone={iconTone} label={label} value={value} /></Link>;
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${ICON_WRAP[iconTone] || ICON_WRAP.teal}`}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-gray-500">{label}</p>
        <p className="truncate text-lg font-bold tabular-nums text-gray-950">{money(value)}</p>
      </div>
    </div>
  );
}

/**
 * One Money flow: trading path → cash/QR/credit sales → credit collections →
 * net cash & bank/QR → order-type split.
 */
export function OwnerMoneyMetrics({ data, panelPrefix = '/admin' }) {
  const finance = data.finance || {};
  const totals = data.totals || {};
  const inventory = data.inventory || {};
  const payments = data.payments || {};
  const openingBalance = data.businessDayMetrics?.openingCash ?? finance.openingBalance;
  const serviceExtra = Math.max(
    0,
    Number(totals.billedTotal || 0)
      - Number(totals.netItemSales || 0)
      - Number(totals.tax || 0)
      - Number(totals.deliveryFee || 0),
  );
  const cashSales = Number(payments.cashSales ?? Math.max(0, Number(payments.cashCollected || 0) - Number(payments.creditCollectionsCash || 0)));
  const onlineSales = Number(payments.onlineSales ?? Math.max(0, Number(payments.onlineCollected || 0) - Number(payments.creditCollectionsOnline || 0)));
  const creditSales = Number(payments.creditSales || 0);
  const creditCollectionsCash = Number(payments.creditCollectionsCash || 0);
  const creditCollectionsOnline = Number(payments.creditCollectionsOnline || 0);
  const netCashCollection = Number(payments.netCashCollection ?? payments.cashCollected ?? 0);
  const netOnlineCollection = Number(payments.netOnlineCollection ?? payments.onlineCollected ?? 0);
  const moneyReceived = Number(payments.grossCollected || (netCashCollection + netOnlineCollection));

  const channelRows = data.channelMix?.rows || [];
  const dineIn = Number(channelRows.find((row) => row.channel === 'dine_in')?.billedTotal || 0);
  const takeaway = Number(channelRows.find((row) => row.channel === 'takeaway')?.billedTotal || 0);
  const delivery = Number(channelRows.find((row) => row.channel === 'delivery')?.billedTotal || 0);

  const kpis = [
    { label: 'Opening Balance', value: openingBalance, detail: 'Drawer cash at opening', icon: Wallet, iconTone: 'amber' },
    { label: 'Total Sales', value: totals.itemSales, detail: 'Everything sold at menu price (bill date)', icon: TrendingUp, iconTone: 'teal' },
    { label: 'Discounts', value: totals.discounts, detail: 'Discounts given to customers', icon: Tag, iconTone: 'rose' },
    { label: 'Service / Extra Charges', value: serviceExtra, detail: 'Service and checkout extras', icon: UtensilsCrossed, iconTone: 'teal' },
    { label: 'Delivery Charges', value: totals.deliveryFee, detail: 'Delivery fees billed', icon: Bike, iconTone: 'teal' },
    {
      label: 'Savings & Deposits',
      value: finance.totalDeposits,
      detail: `${number(finance.depositCount)} deposit${Number(finance.depositCount || 0) === 1 ? '' : 's'} this period`,
      icon: PiggyBank,
      iconTone: 'slate',
    },
    { label: 'Refunds', value: totals.refunds, detail: 'Money returned to customers', icon: Undo2, iconTone: 'rose' },
    { label: 'Purchases', value: inventory.purchaseValue, detail: `${number(inventory.purchases)} purchase records`, icon: ShoppingCart, iconTone: 'rose' },
    { label: 'Expenses', value: data.suppliers?.purchasing?.expenses?.total ?? finance.operatingExpenses, detail: 'Manual and non-purchase operating expenses', icon: CreditCard, iconTone: 'rose' },
    { label: 'Net Collection', value: Number(payments.netCollections ?? moneyReceived), detail: 'Cash + bank/QR received less period refunds', icon: Coins, hero: true },
  ];

  return (
    <section aria-label="Key financial figures" className="mb-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-950">Money flow</h2>
        <p className="mt-0.5 text-xs text-gray-500">Sales path, then how money was received (Cash / Online / Credit), credit collections, net collections, and order type.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {kpis.map((card) => <MetricCard key={card.label} {...card} href={analyticsReportHref(card.label, data.range, panelPrefix)} />)}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-950">How payment was recorded</h3>
          <p className="mt-0.5 text-xs text-gray-400">Cash, Online, and Credit for this period.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <SplitStat icon={Banknote} iconTone="teal" label="Cash Sale" value={cashSales} />
            <SplitStat icon={Landmark} iconTone="slate" label="Online Sale" value={onlineSales} />
            <SplitStat icon={User} iconTone="amber" label="Credit Sale" value={creditSales} />
          </div>
          <div className="mt-4 grid gap-4 border-t border-gray-100 pt-4 sm:grid-cols-2">
            <SplitStat icon={Banknote} iconTone="teal" label="Credit Collection (Cash)" value={creditCollectionsCash} />
            <SplitStat icon={Landmark} iconTone="slate" label="Credit Collection (Online)" value={creditCollectionsOnline} />
            <SplitStat icon={Wallet} iconTone="teal" label="Net Cash Collection" value={netCashCollection} />
            <SplitStat icon={Landmark} iconTone="slate" label="Net Online Collection" value={netOnlineCollection} />
          </div>
        </div>

        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-950">Where sales came from</h3>
          <p className="mt-0.5 text-xs text-gray-400">Finalized bills by order type.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <SplitStat icon={Users} iconTone="teal" label="Dine-in Sales" value={dineIn} href={analyticsReportHref('Dine-in Sales', data.range, panelPrefix)} />
            <SplitStat icon={ShoppingBag} iconTone="amber" label="Takeaway Sales" value={takeaway} href={analyticsReportHref('Takeaway Sales', data.range, panelPrefix)} />
            <SplitStat icon={Bike} iconTone="slate" label="Delivery Sales" value={delivery} href={analyticsReportHref('Delivery Sales', data.range, panelPrefix)} />
          </div>
        </div>
      </div>
    </section>
  );
}

export default function AnalyticsHome({ data }) {
  const totals = data.totals || {};
  const payments = data.payments || {};
  const customers = data.customers || {};
  const tableEarnings = (data.tables?.rows || []).slice(0, 7).map((row) => ({
    label: `Table ${row.table_number}`,
    value: row.revenue,
    meta: `${number(row.orders)} order${Number(row.orders) === 1 ? '' : 's'}${row.dining_minutes ? ` · ${Math.round(row.dining_minutes)} min avg` : ''}`,
  }));
  const purchasing = data.suppliers?.purchasing || {};
  const cashSales = Number(payments.cashSales ?? Math.max(0, Number(payments.cashCollected || 0) - Number(payments.creditCollectionsCash || 0)));
  const onlineSales = Number(payments.onlineSales ?? Math.max(0, Number(payments.onlineCollected || 0) - Number(payments.creditCollectionsOnline || 0)));
  const creditSales = Number(payments.creditSales || 0);
  const channelRows = data.channelMix?.rows || [];
  const orderTypeRows = [
    { label: 'Dine-in', value: Number(channelRows.find((row) => row.channel === 'dine_in')?.billedTotal || 0) },
    { label: 'Takeaway', value: Number(channelRows.find((row) => row.channel === 'takeaway')?.billedTotal || 0) },
    { label: 'Delivery', value: Number(channelRows.find((row) => row.channel === 'delivery')?.billedTotal || 0) },
  ];
  const paymentBreakdownRows = [
    { label: 'Cash', value: cashSales },
    { label: 'Online', value: onlineSales },
    { label: 'Credit', value: creditSales },
  ];
  const chartRows = {
    salesCategories: (data.sales?.byCategory || []).map((row) => ({ label: row.label, value: row.value, meta: row.meta })),
    masterCategories: (data.sales?.byGroup || []).map((row) => ({ label: row.label, value: row.value, meta: `${number(row.quantity)} sold` })),
    purchaseCategories: (purchasing.purchases?.categories || []).map((row) => ({ label: row.category, value: row.amount, meta: percent(row.share) })),
    expenseCategories: (purchasing.expenses?.categories || []).map((row) => ({ label: row.category, value: row.amount, meta: percent(row.share) })),
  };

  const bills = Number(totals.bills || 0);
  const aov = bills ? Number(totals.billedTotal || totals.itemSales || 0) / bills : 0;
  const identified = Number(customers.identified || 0);
  const returning = Number(customers.repeatCustomers || 0);
  const newest = Math.max(0, identified - returning);
  const topItem = data.bestWorst?.bestItem?.item || data.menu?.topItems?.[0]?.item || '—';

  return (
    <div className="space-y-5">
      <section aria-label="Visual business breakdown">
        <div className="mb-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">Visual dashboard</p>
          <h2 className="mt-1 text-lg font-semibold text-gray-950">What is driving the business</h2>
          <p className="mt-1 text-sm text-gray-500">Hover, tap, or focus a donut segment to inspect its share.</p>
        </div>

        <div className="grid gap-4 lg:grid-cols-4">
          <ChartCard title="Sales Trend" hint="Net item sales by day" isEmpty={!data.sales?.trend?.length} empty="No settled sales in this period." className="lg:col-span-2">
            <TrendChart data={data.sales?.trend || []} color="emerald" format="currency" height={220} />
          </ChartCard>
          <VisualDonut title="Sales by Order Type" rows={orderTypeRows} centerLabel="Total Sales" colors={ORDER_TYPE_COLORS} compact />
          <VisualDonut title="Payments Breakdown" rows={paymentBreakdownRows} centerLabel="Received" colors={PAYMENT_COLORS} compact />
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <VisualDonut title="Sales by Category" rows={chartRows.salesCategories} centerLabel="Sales" />
          <VisualDonut title="Sales by Master Category" rows={chartRows.masterCategories} centerLabel="Sales" />
          <VisualDonut title="Purchases by Category" rows={chartRows.purchaseCategories} centerLabel="Purchases" />
          <VisualDonut title="Expenses by Category" rows={chartRows.expenseCategories} centerLabel="Expenses" />
          <ChartCard title="Table Earnings" hint="Revenue earned by each dine-in table" isEmpty={!tableEarnings.length} empty="No settled table sales in this period.">
            <RankBars data={tableEarnings} color="emerald" format="currency" limit={7} />
          </ChartCard>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-gray-100 bg-gray-50/80 px-3 py-3 sm:grid-cols-3 lg:grid-cols-6">
          <FooterStat icon={ClipboardList} label="Total Orders" value={number(totals.createdOrders ?? bills)} />
          <FooterStat icon={Coins} label="Average Order Value" value={money(aov)} />
          <FooterStat icon={Gift} label="Items Sold" value={number(totals.itemsSold)} />
          <FooterStat icon={User} label="New Customers" value={number(newest)} />
          <FooterStat icon={Users} label="Returning Customers" value={number(returning)} />
          <FooterStat icon={Star} label="Top Item" value={topItem} />
        </div>
      </section>
    </div>
  );
}

function FooterStat({ icon: Icon, label, value }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 px-1 py-1">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-teal-700 shadow-sm">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[11px] text-gray-500">{label}</p>
        <p className="truncate text-sm font-semibold tabular-nums text-gray-950">{value}</p>
      </div>
    </div>
  );
}

function VisualDonut({ title, rows = [], centerLabel, colors, compact = false }) {
  const usableRows = rows.filter((row) => Number(row.value || 0) >= 0).slice(0, 8);
  const total = usableRows.reduce((sum, row) => sum + Number(row.value || 0), 0);
  const palette = colors || DEFAULT_COLORS;
  const segments = usableRows.map((row, index) => ({ ...row, color: palette[index % palette.length] }));
  const hasValue = total > 0;
  const size = compact ? 148 : 190;
  const share = (value) => (total ? `${Math.round((Number(value || 0) / total) * 1000) / 10}%` : '0%');

  return (
    <ChartCard title={title} isEmpty={!hasValue} empty={`No ${title.toLowerCase()} in this period.`}>
      <div className={`grid items-center gap-4 ${compact ? '' : 'sm:grid-cols-[190px_minmax(0,1fr)]'}`}>
        <DonutChart segments={segments} size={size} thickness={compact ? 22 : 28} centerLabel={centerLabel} centerValue={money(total)} />
        <div className={`w-full space-y-2.5 ${compact ? '' : 'max-h-[210px] overflow-auto pr-2'}`}>
          {segments.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-3 text-xs">
              <span className="inline-flex min-w-0 items-center gap-1.5 text-gray-600">
                <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: row.color }} />
                <span className="truncate">{row.label}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-medium tabular-nums text-gray-900">{money(row.value)}</span>
                <span className="block text-[10px] text-gray-400">{row.meta || share(row.value)}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </ChartCard>
  );
}
