'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle, Banknote, ChefHat, ClipboardList, Clock3, FileClock, History, ListChecks,
  ReceiptText, Search, Tags, Users, WalletCards,
} from 'lucide-react';
import { BarChart, ChartCard, RankBars } from '@/components/admin/report-kit';
import {
  DashboardSection, NepalTime, SectionHeading, StatusPill, TableWrap, money, percent,
} from './analytics-ui';
import { clickableRowClass, useAnalyticsRecords } from './analytics-record-viewer';

const NAV = [
  ['overview', 'Overview', ListChecks],
  ['orders', 'Orders & KOT', ClipboardList],
  ['cancellations', 'Cancellations', AlertTriangle],
  ['billing', 'Bills & Money', WalletCards],
  ['audit', 'Staff & Audit', FileClock],
];

/**
 * Merge every reversal, rewrite and giveaway into one time-ordered list.
 *
 * Six record types answer the same question — an order cancelled, a kitchen
 * ticket cancelled, a line removed, a bill voided or refunded, a bill reopened
 * and re-billed, a discount given — and each lived on a different tab. Read
 * together they are the shift's exception log: the actions that move money
 * without selling anything.
 *
 * This reports actions and values. It does not label anyone's behaviour as
 * suspicious — the reader decides what a pattern means, with the reason and the
 * staff member beside every row.
 *
 * `value` is the money impact as a POSITIVE magnitude, with the kind naming the
 * direction, so the column totals without sign errors.
 */
function buildChangeLog(report, related) {
  const rows = [];
  for (const row of related(report.cancellations)) {
    rows.push({
      id: `order-${row.id}`, at: row.cancelledAt || row.createdAt, kind: 'Order cancelled', tone: 'negative',
      document: row.orderNumber, orderId: row.id, billId: row.billId || null, kotId: null,
      where: `${row.table} \u00b7 ${row.orderType}`,
      value: Math.abs(Number(row.originalValue || 0)),
      detail: `${row.quantity} item(s), ${row.kotCount} KOT${row.kitchenStarted ? ' \u00b7 prep started' : ''}`,
      reason: row.reason, actor: row.cancelledBy, actorRole: row.cancelledByRole,
    });
  }
  for (const row of related(report.cancelledKots || report.kots).filter((k) => k.lifecycle === 'cancelled' || k.status === 'cancelled')) {
    rows.push({
      id: `kot-${row.id}`, at: row.cancelledAt || row.printedAt, kind: 'KOT cancelled', tone: 'negative',
      document: row.kotNumber, orderId: row.orderId, billId: null, kotId: row.id,
      where: row.table && row.table !== '\u2014' ? `Table ${row.table}` : (row.orderType || '\u2014'),
      value: Math.abs(Number(row.value || 0)),
      detail: (row.items || []).map((item) => `${item.quantity}\u00d7 ${item.name}`).join(', ') || 'No snapshot',
      reason: row.reason, actor: row.cancelledBy, actorRole: row.cancelledByRole,
    });
  }
  for (const row of related(report.itemChanges).filter((i) => ['item_removed', 'kot_item_cancelled'].includes(i.action))) {
    rows.push({
      id: `item-${row.id}`, at: row.createdAt, kind: 'Item removed', tone: 'negative',
      document: row.orderNumber, orderId: row.orderId, billId: row.billId || null, kotId: null, where: '\u2014',
      value: row.valueDifference == null ? null : Math.abs(Number(row.valueDifference)),
      detail: `${row.quantity}\u00d7 ${row.item}`, reason: row.reason, actor: row.actor, actorRole: row.actorRole,
    });
  }
  for (const row of related(report.corrections)) {
    rows.push({
      id: `corr-${row.id}`, at: row.createdAt, kind: row.type === 'void' ? 'Bill voided' : 'Refund', tone: 'negative',
      document: row.billNumber, orderId: row.orderId, billId: row.billId, kotId: null, where: row.orderNumber,
      value: Math.abs(Number(row.amount || 0)),
      detail: row.originalMethods?.join(' + ') || 'Method not recorded',
      reason: row.reason, actor: row.actor, actorRole: row.actorRole,
    });
  }
  for (const row of related(report.revisions)) {
    const delta = Number(row.delta || 0);
    rows.push({
      id: `rev-${row.id}`, at: row.createdAt, kind: 'Bill reopened / changed', tone: delta < 0 ? 'negative' : 'warning',
      document: row.billNumber, orderId: row.orderId, billId: row.billId, kotId: null, where: row.orderNumber, value: Math.abs(delta),
      detail: `${money(row.originalTotal)} \u2192 ${money(row.newTotal)}`,
      reason: row.reason, actor: row.createdBy, actorRole: '',
    });
  }
  for (const row of related(report.discounts)) {
    rows.push({
      id: `disc-${row.id}`, at: row.createdAt, kind: 'Discount given', tone: 'warning',
      document: row.billNumber, orderId: row.orderId, billId: row.id || row.billId, kotId: null,
      where: row.table && row.table !== '\u2014' ? `Table ${row.table}` : (row.orderType || row.orderNumber),
      value: Math.abs(Number(row.discount || 0)),
      detail: `${money(row.gross)} \u2192 ${money(row.netItemValue ?? row.gross - row.discount)} (${percent(row.discountPercent)})`,
      reason: row.discountReason, actor: row.cashier, actorRole: row.cashierRole,
    });
  }
  return rows.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}

const CHANGE_KINDS = [
  'Order cancelled', 'KOT cancelled', 'Item removed',
  'Bill voided', 'Refund', 'Bill reopened / changed', 'Discount given',
];

const CHANGE_TONES = {
  'Order cancelled': 'bg-red-50 text-red-700 ring-red-200',
  'KOT cancelled': 'bg-orange-50 text-orange-700 ring-orange-200',
  'Item removed': 'bg-rose-50 text-rose-700 ring-rose-200',
  'Bill voided': 'bg-violet-50 text-violet-700 ring-violet-200',
  Refund: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200',
  'Bill reopened / changed': 'bg-amber-50 text-amber-700 ring-amber-200',
  'Discount given': 'bg-blue-50 text-blue-700 ring-blue-200',
};

function ChangeKindPill({ kind }) {
  return <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${CHANGE_TONES[kind] || 'bg-gray-100 text-gray-700 ring-gray-200'}`}>{kind}</span>;
}

export /** Metric cards double as filters: the count and the way to see it are one control. */
const CHANGE_GROUPS = [
  ['cancellations', 'Cancellations', ['Order cancelled', 'KOT cancelled', 'Item removed']],
  ['voids', 'Voids & refunds', ['Bill voided', 'Refund']],
  ['rebilled', 'Re-billed', ['Bill reopened / changed']],
  ['discounts', 'Discounts given', ['Discount given']],
];

export function AllChanges({ report, related = (rows) => rows || [] }) {
  const { openBill, openKot, openOrder } = useAnalyticsRecords();
  const [kind, setKind] = useState('');
  const [group, setGroup] = useState('');
  const [search, setSearch] = useState('');
  const rows = buildChangeLog(report, related);
  const groupKinds = CHANGE_GROUPS.find(([id]) => id === group)?.[2] || null;
  const query = search.trim().toLowerCase();
  const shown = rows.filter((row) => {
    if (kind && row.kind !== kind) return false;
    if (groupKinds && !groupKinds.includes(row.kind)) return false;
    if (!query) return true;
    return `${row.kind} ${row.document || ''} ${row.where || ''} ${row.detail || ''} ${row.reason || ''} ${row.actor || ''}`
      .toLowerCase().includes(query);
  });
  const totalValue = shown.reduce((sum, row) => sum + (Number.isFinite(row.value) ? row.value : 0), 0);
  const unavailableValues = shown.filter((row) => row.value == null).length;
  const countOf = (name) => rows.filter((row) => row.kind === name).length;
  const groupCount = (kinds) => rows.filter((row) => kinds.includes(row.kind)).length;
  const groupValue = (kinds) => rows.filter((row) => kinds.includes(row.kind)).reduce((sum, row) => sum + (Number.isFinite(row.value) ? row.value : 0), 0);
  const groupUnavailable = (kinds) => rows.filter((row) => kinds.includes(row.kind) && row.value == null).length;
  const selectGroup = (id) => { setGroup((current) => (current === id ? '' : id)); setKind(''); };
  const openChange = (row) => {
    if (row.kotId) openKot(row.kotId);
    else if (row.billId) openBill(row.billId);
    else if (row.orderId) openOrder({ orderId: row.orderId, orderNumber: row.document, billId: row.billId });
  };
  return <>
    <DashboardSection>
      <SectionHeading
        icon={History} tone="rose" eyebrow="Exception log"
        title="Everything cancelled, changed, refunded or discounted"
        description="One chronological list across orders, kitchen tickets, items and bills. Click a row to open the bill, KOT, or order. Value is the money impact of each action." />
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <button type="button" onClick={() => { setGroup(''); setKind(''); }}
          className={`rounded-xl border p-4 text-left transition-colors ${group || kind ? 'border-gray-200 bg-gray-50 hover:border-gray-300' : 'border-gray-950 bg-white'}`}>
          <p className="text-xs text-gray-500">All changes</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-gray-950">{rows.length}</p>
        </button>
        <MiniMetric label={kind || group ? 'Value shown' : 'Value affected'} value={money(totalValue)} negative note={unavailableValues ? `${unavailableValues} legacy value unavailable` : null} />
        {CHANGE_GROUPS.map(([id, label, kinds]) => (
          <button key={id} type="button" onClick={() => selectGroup(id)}
            className={`rounded-xl border p-4 text-left transition-colors ${group === id ? 'border-gray-950 bg-white' : 'border-gray-200 bg-gray-50 hover:border-gray-300'}`}>
            <p className="text-xs text-gray-500">{label}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-gray-950">{groupCount(kinds)}</p>
            <p className="mt-0.5 text-xs tabular-nums text-red-700">{money(groupValue(kinds))}</p>
            {groupUnavailable(kinds) ? <p className="mt-0.5 text-[11px] text-gray-500">{groupUnavailable(kinds)} value unavailable</p> : null}
          </button>
        ))}
      </div>
      <label className="relative mt-4 block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search bill, order, KOT, table, item, reason or staff…"
          className="h-10 w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 text-sm"
        />
      </label>
      <div className="mt-4 flex flex-wrap gap-2">
        {['', ...CHANGE_KINDS].map((name) => (
          <button
            key={name || 'all'} type="button" onClick={() => { setKind(name); setGroup(''); }}
            className={`h-9 rounded-full border px-3 text-sm font-medium transition-colors ${
              kind === name ? 'border-gray-950 bg-gray-950 text-white' : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
            }`}>
            {name || 'All'} ({name ? countOf(name) : rows.length})
          </button>
        ))}
      </div>
    </DashboardSection>
    <DashboardSection>
      {shown.length === 0 ? (
        <p className="py-12 text-center text-sm text-gray-400">
          {rows.length
            ? 'No change matches this filter or search.'
            : 'Nothing was cancelled, voided, refunded, re-billed or discounted in this period.'}
        </p>
      ) : (
        <ScrollTable>
          <table className="w-full min-w-[1240px] text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-400">
              <tr><Th>Time</Th><Th>What happened</Th><Th>Document</Th><Th>Where</Th><Th right>Value</Th><Th>Detail</Th><Th>Reason</Th><Th>Staff</Th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shown.map((row) => (
                <tr
                  key={row.id}
                  className={row.billId || row.kotId || row.orderId ? clickableRowClass : undefined}
                  onClick={() => openChange(row)}
                  onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openChange(row); } }}
                  tabIndex={row.billId || row.kotId || row.orderId ? 0 : undefined}
                  role={row.billId || row.kotId || row.orderId ? 'button' : undefined}
                >
                  <Td><NepalTime value={row.at} /></Td>
                  <Td><ChangeKindPill kind={row.kind} /></Td>
                  <Td><span className="font-semibold text-gray-900">{row.document || '\u2014'}</span></Td>
                  <Td>{row.where}</Td>
                  <Td right><span className="font-semibold text-red-700">{row.value == null ? 'Unavailable' : money(row.value)}</span></Td>
                  <Td><span className="line-clamp-2 max-w-[280px] text-xs text-gray-500">{row.detail}</span></Td>
                  <Td>{row.reason || 'No reason recorded'}</Td>
                  <Td>{row.actor || '\u2014'}{row.actorRole ? <p className="text-xs text-gray-400">{row.actorRole}</p> : null}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollTable>
      )}
    </DashboardSection>
  </>;
}

const ACTION_LABELS = {
  order_created: 'Order created', item_added: 'Item added', item_edited: 'Item edited', item_removed: 'Item removed',
  kot_issued: 'KOT issued', kot_reprinted: 'KOT reprinted', kot_cancelled: 'KOT cancelled', kot_item_cancelled: 'KOT item cancelled',
  order_changed_table: 'Table changed', order_moved_to_billing: 'Moved to billing', invoice_generated: 'Bill generated',
  payment_recorded: 'Payment recorded', bill_completed: 'Bill completed', table_released: 'Table released',
  bill_reopened_to_pos: 'Bill reopened', reopen_settled: 'Reopen settled', reopen_refund_settled: 'Reopen reduction refunded',
  refund_created: 'Refund issued', bill_voided: 'Bill voided', receipt_reprinted: 'Receipt reprinted',
};

export default function OrderOperationsAnalytics({ data, live }) {
  const report = data || {};
  const [view, setView] = useState('overview');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [staff, setStaff] = useState('');
  const [expandedOrder, setExpandedOrder] = useState(null);

  const staffOptions = useMemo(() => [...new Set((report.staff || []).map((row) => row.name).filter(Boolean))].sort(), [report.staff]);
  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (report.orders || []).filter((row) =>
      (!status || row.status === status) && (!type || row.orderType === type) && (!staff || row.staff === staff) &&
      (!q || `${row.orderNumber} ${row.table} ${row.customer} ${row.billNumber || ''}`.toLowerCase().includes(q))
    );
  }, [report.orders, search, status, type, staff]);
  const orderIds = useMemo(() => new Set(filteredOrders.map((row) => Number(row.id))), [filteredOrders]);
  const hasFilters = Boolean(search.trim() || status || type || staff);
  const filterRelated = (rows) => (rows || []).filter((row) => !hasFilters || (row.orderId != null && orderIds.has(Number(row.orderId))));
  const drill = (target, nextStatus = '') => { setView(target); setStatus(nextStatus); };

  if (!data) return <DashboardSection><p className="py-14 text-center text-sm text-gray-400">Order operations data is not available.</p></DashboardSection>;

  return <div className="space-y-5">
    <DashboardSection>
      <SectionHeading icon={ClipboardList} tone="indigo" eyebrow="Order operations" title="Orders & Billing Analytics" description="Order, KOT, bill and payment states stay separate. Sensitive actions show value, reason, user and time wherever the application persisted them." />
      <div className="mt-6 overflow-x-auto border-b border-gray-200" role="tablist" aria-label="Order analytics sections"><div className="flex min-w-max gap-1">{NAV.map(([id, label, Icon]) => <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)} className={`inline-flex h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-[border-color,color,transform] duration-150 ease-out active:scale-[0.98] ${view === id ? 'border-gray-950 text-gray-950' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-800'}`}><Icon className="h-4 w-4" />{label}</button>)}</div></div>
      {view !== 'overview' && <Filters search={search} setSearch={setSearch} status={status} setStatus={setStatus} type={type} setType={setType} staff={staff} setStaff={setStaff} staffOptions={staffOptions} />}
    </DashboardSection>

    {view === 'overview' && <Overview report={report} live={live} drill={drill} />}
    {view === 'orders' && <OrdersAndKot report={report} orders={filteredOrders} related={filterRelated} expandedOrder={expandedOrder} setExpandedOrder={setExpandedOrder} />}
    {view === 'cancellations' && <Cancellations report={report} related={filterRelated} />}
    {view === 'billing' && <BillsAndMoney report={report} related={filterRelated} />}
    {view === 'audit' && <StaffAndAudit report={report} related={filterRelated} search={search} />}
  </div>;
}

function Filters({ search, setSearch, status, setStatus, type, setType, staff, setStaff, staffOptions }) {
  return <div className="mt-5 grid gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 sm:grid-cols-2 xl:grid-cols-[minmax(260px,1fr)_180px_180px_220px]">
    <label className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search order, bill, customer or table…" className="h-10 w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 text-sm" /></label>
    <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm"><option value="">All order statuses</option>{['pending','preparing','ready','dining','awaiting_payment','completed','cancelled'].map((value) => <option key={value} value={value}>{labelize(value)}</option>)}</select>
    <select value={type} onChange={(event) => setType(event.target.value)} className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm"><option value="">All order types</option>{['Dine-in','Takeaway','Delivery','Online ordering'].map((value) => <option key={value}>{value}</option>)}</select>
    <select value={staff} onChange={(event) => setStaff(event.target.value)} className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm"><option value="">All staff</option>{staffOptions.map((value) => <option key={value}>{value}</option>)}</select>
  </div>;
}

function Overview({ report, live, drill }) {
  const s = report.summary || {};
  const cards = [
    ['Orders Created', s.ordersCreated, 'number', 'orders', ''], ['Completed Orders', s.completedOrders, 'number', 'orders', 'completed'], ['Open Orders', s.openOrders, 'number', 'orders', 'pending'], ['Cancelled Orders', s.cancelledOrders, 'number', 'cancellations', 'cancelled'],
    ['Total Order Value', s.totalOrderValue, 'currency', 'orders', ''], ['Completed Sales', s.completedSalesValue, 'currency', 'billing', ''], ['Average Order', s.averageOrderValue, 'currency', 'orders', ''],
    ['Dine-in', s.dineIn, 'number', 'orders', ''], ['Takeaway', s.takeaway, 'number', 'orders', ''], ['Delivery', s.delivery, 'number', 'orders', ''],
    // Collections by medium, beside the order counts: what was actually taken,
    // split the way the drawer is reconciled. QR is every digital medium; the
    // per-provider split belongs to the payment breakdown chart, not a headline.
    ['Cash Sale', s.cashSale, 'currency', 'billing', ''], ['Online Sale', s.qrSale, 'currency', 'billing', ''], ['Credit Sale', s.creditSale, 'currency', 'billing', ''],
    ['Service / Extra Charge', s.serviceCharge, 'currency', 'billing', ''],
    ['Pending Payments', s.pendingPayments, 'number', 'billing', ''], ['Unpaid Bills', s.unpaidBills, 'number', 'billing', ''],
    ['Discounted Bills', s.discountedBills, 'number', 'billing', ''], ['Discount Given', s.discountAmount, 'currency', 'billing', ''],
    ['Voided Bills', s.voidedBills, 'number', 'billing', ''], ['Void Value', s.voidValue, 'currency', 'billing', ''], ['Refunds', s.refunds, 'number', 'billing', ''], ['Refund Value', s.refundValue, 'currency', 'billing', ''],
  ];
  const hourRows = (report.charts?.byHour || []).filter((row) => row.value > 0);
  const typeRows = (report.charts?.byType || []).map((row) => ({ label: row.type, value: row.orders, meta: `${money(row.sales)} · ${percent(row.cancellationRate)} cancelled` }));
  return <>
    <DashboardSection><SectionHeading eyebrow="Period summary" title="Everything that happened to orders" description="Click a metric to open the relevant detail section." /><div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">{cards.filter(([, value], index) => index < 16 || Number(value) > 0).map(([label, value, format, target, nextStatus]) => <button key={label} type="button" onClick={() => drill(target, nextStatus)} className="rounded-xl border border-gray-200 bg-gray-50 p-3.5 text-left transition-[border-color,transform] duration-150 ease-out hover:border-gray-300 active:scale-[0.98]"><p className="text-xs text-gray-500">{label}</p><p className={`mt-1 text-lg font-semibold tabular-nums ${/Void|Refund|Discount/.test(label) && Number(value) > 0 ? 'text-red-700' : 'text-gray-950'}`}>{format === 'currency' ? money(value) : Number(value || 0).toLocaleString()}</p></button>)}</div></DashboardSection>
    <DashboardSection><SectionHeading icon={Clock3} tone="blue" eyebrow="Lifecycle" title="Order → kitchen → billing → payment" description="These are independent persisted states; later stages never overwrite the earlier counts." /><Lifecycle values={report.lifecycle} /><div className="mt-6 grid gap-5 xl:grid-cols-2"><ChartCard title="Orders by Nepal hour" isEmpty={!hourRows.length} empty="No orders in this period."><BarChart data={hourRows} color="blue" format="number" height={240} /></ChartCard><ChartCard title="Order type performance" isEmpty={!typeRows.length} empty="No order types in this period."><RankBars data={typeRows} color="slate" format="number" /></ChartCard></div></DashboardSection>
    <DashboardSection><SectionHeading icon={ChefHat} tone="orange" eyebrow="Kitchen data quality" title="Prep timing that can be trusted" description={report.kitchenQuality?.note} /><KitchenQuality data={report.kitchenQuality} live={live} /><ReasonGrid reasons={report.reasons} compact /></DashboardSection>
  </>;
}

function Lifecycle({ values = {} }) {
  const steps = [['Created', values.ordersCreated], ['KOT Sent', values.kotSent], ['Preparing', values.preparing], ['Ready', values.ready], ['Served', values.served], ['Billed', values.billed], ['Paid', values.paid]];
  return <div className="grid gap-2 sm:grid-cols-4 xl:grid-cols-7">{steps.map(([label, value], index) => <div key={label} className="relative rounded-xl border border-gray-200 bg-white p-4"><p className="text-xs text-gray-500">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums text-gray-950">{Number(value || 0)}</p>{index < steps.length - 1 && <span className="absolute -right-2 top-1/2 z-10 hidden h-px w-2 bg-gray-300 xl:block" />}</div>)}</div>;
}

function KitchenQuality({ data = {}, live = {} }) {
  const rows = [
    ['Valid completed KOTs', data.validCompleted, 'positive'], ['Auto-closed / incomplete', data.autoClosedOrIncomplete, 'warning'], ['Invalid timestamps', data.invalidTimestamps, 'negative'], ['Still open', data.stillOpen, 'warning'], ['Cancelled', data.cancelled, 'negative'],
    ['Average prep', data.averagePrepMinutes == null ? 'Not enough valid data' : `${data.averagePrepMinutes} min`, 'default'], ['Median prep', data.medianPrepMinutes == null ? 'Not enough valid data' : `${data.medianPrepMinutes} min`, 'default'], ['Live backlog', Number(live?.preparingKots || 0) + Number(live?.pendingKots || 0), 'warning'],
  ];
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{rows.map(([label, value, tone]) => <div key={label} className="rounded-xl border border-gray-100 bg-gray-50 p-4"><p className="text-xs text-gray-500">{label}</p><p className={`mt-1 text-base font-semibold ${tone === 'positive' ? 'text-emerald-700' : tone === 'negative' ? 'text-red-700' : tone === 'warning' ? 'text-amber-700' : 'text-gray-950'}`}>{value ?? 0}</p></div>)}</div>;
}

function OrdersAndKot({ report, orders, related, expandedOrder, setExpandedOrder }) {
  const { openKot } = useAnalyticsRecords();
  const kots = related(report.kots);
  return <>
    <DashboardSection><SectionHeading icon={ClipboardList} tone="blue" eyebrow="Orders" title={`${orders.length} order${orders.length === 1 ? '' : 's'} match the filters`} description="Click an order to open its bill (same as the sales report). Expand the order number for the audit timeline." /><div className="max-h-[620px] overflow-auto"><TableWrap minWidth="1120px"><thead className="sticky top-0 z-10 bg-gray-50 text-xs uppercase tracking-wide text-gray-400"><tr><Th>Placed</Th><Th>Order</Th><Th>Status</Th><Th>Type / table</Th><Th>Customer</Th><Th>Staff</Th><Th right>Items</Th><Th right>Value</Th><Th>Bill</Th></tr></thead><tbody className="divide-y divide-gray-100">{orders.map((row) => <OrderRow key={row.id} row={row} expanded={expandedOrder === row.id} onExpand={() => setExpandedOrder(expandedOrder === row.id ? null : row.id)} timeline={(report.timeline || []).filter((event) => Number(event.orderId) === Number(row.id))} />)}</tbody></TableWrap></div></DashboardSection>
    <DashboardSection><SectionHeading icon={ChefHat} tone="orange" eyebrow="KOT" title="Kitchen ticket lifecycle" description="Click a KOT row to open the ticket popup. Completed-normally tickets alone contribute to prep averages." /><div className="max-h-[620px] overflow-auto"><TableWrap minWidth="1120px"><thead className="sticky top-0 z-10 bg-gray-50 text-xs uppercase tracking-wide text-gray-400"><tr><Th>Issued</Th><Th>KOT / Order</Th><Th>Table</Th><Th>Status</Th><Th>Lifecycle quality</Th><Th right>Qty</Th><Th right>Value</Th><Th right>Prep</Th><Th>Reason / actor</Th></tr></thead><tbody className="divide-y divide-gray-100">{kots.map((row) => <tr key={row.id} className={clickableRowClass} onClick={() => openKot(row.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openKot(row.id); } }} tabIndex={0} role="button"><Td><NepalTime value={row.printedAt} /></Td><Td><span className="font-semibold text-gray-900">{row.kotNumber}</span><p className="text-xs text-gray-400">{row.orderNumber}</p></Td><Td>{row.table}</Td><Td><StatusPill tone={statusTone(row.status)}>{labelize(row.status)}</StatusPill></Td><Td><QualityPill value={row.lifecycle} /></Td><Td right>{row.quantity}</Td><Td right>{money(row.value)}</Td><Td right>{row.prepMinutes == null ? '—' : `${row.prepMinutes} min`}</Td><Td><p>{row.reason}</p>{row.cancelledAt && <p className="text-xs text-gray-400">{row.cancelledBy} · <NepalTime value={row.cancelledAt} /></p>}</Td></tr>)}</tbody></TableWrap></div></DashboardSection>
  </>;
}

function OrderRow({ row, expanded, onExpand, timeline }) {
  const { openOrder } = useAnalyticsRecords();
  return <><tr className={`${clickableRowClass} hover:bg-gray-50`} onClick={() => openOrder(row)} onKeyDown={(event) => { if (event.key === 'Enter') openOrder(row); }} tabIndex={0} role="button"><Td><NepalTime value={row.createdAt} /></Td><Td><button type="button" onClick={(event) => { event.stopPropagation(); onExpand(); }} className="font-semibold text-gray-900 hover:underline">{row.orderNumber}</button></Td><Td><StatusPill tone={statusTone(row.status)}>{labelize(row.status)}</StatusPill></Td><Td>{row.orderType}<p className="text-xs text-gray-400">Table {row.table}</p></Td><Td>{row.customer}</Td><Td>{row.staff}<p className="text-xs text-gray-400">{row.staffRole}</p></Td><Td right>{row.quantity}</Td><Td right><span className="font-semibold">{money(row.originalValue)}</span></Td><Td>{row.billNumber ? <span className="font-medium text-blue-700">{row.billNumber}</span> : '—'}</Td></tr>{expanded && <tr><td colSpan={9} className="bg-slate-50 px-5 py-4"><OrderTimeline rows={timeline} /></td></tr>}</>;
}

function Cancellations({ report, related }) {
  const { openOrder, openKot } = useAnalyticsRecords();
  const orders = related(report.cancelledOrders);
  const kots = related(report.cancelledKots);
  const items = related(report.itemChanges).filter((row) => ['item_removed', 'kot_item_cancelled'].includes(row.action));
  const value = orders.reduce((sum, row) => sum + Number(row.originalValue || 0), 0);
  const rate = report.summary?.ordersCreated ? orders.length / report.summary.ordersCreated * 100 : 0;
  return <>
    <DashboardSection><SectionHeading icon={AlertTriangle} tone="rose" eyebrow="Cancellations" title="Cancelled orders, KOTs and individual items" description="Click a row to open the order or KOT. Whole-order, kitchen-ticket and line-item cancellations remain separate records." /><div className="grid gap-3 sm:grid-cols-4"><MiniMetric label="Cancelled orders" value={orders.length} /><MiniMetric label="Order value affected" value={money(value)} negative /><MiniMetric label="Cancellation rate" value={percent(rate)} /><MiniMetric label="Average cancelled order" value={money(orders.length ? value / orders.length : 0)} /></div></DashboardSection>
    <DashboardSection><SectionHeading title="Cancelled orders" description="Cancellation actor is shown only when an audit record exists; older rows are explicitly marked Not persisted." /><ScrollTable><table className="w-full min-w-[1280px] text-left text-sm"><thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-400"><tr><Th>Cancelled</Th><Th>Order</Th><Th>Table / type</Th><Th>Customer</Th><Th right>Items</Th><Th right>Value</Th><Th>Prior activity</Th><Th>Reason</Th><Th>Cancelled by</Th></tr></thead><tbody className="divide-y divide-gray-100">{orders.map((row) => <tr key={row.id} className={clickableRowClass} onClick={() => openOrder(row)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openOrder(row); } }} tabIndex={0} role="button"><Td><NepalTime value={row.cancelledAt} /></Td><Td><span className="font-semibold">{row.orderNumber}</span></Td><Td>{row.table} · {row.orderType}</Td><Td>{row.customer}</Td><Td right>{row.quantity}</Td><Td right>{money(row.originalValue)}</Td><Td>{row.kotCount} KOT{row.kitchenStarted ? ' · prep started' : ''}</Td><Td>{row.reason}</Td><Td>{row.cancelledBy}<p className="text-xs text-gray-400">{row.cancelledByRole}</p></Td></tr>)}</tbody></table></ScrollTable></DashboardSection>
    <DashboardSection><div className="grid gap-7 xl:grid-cols-2"><div><SectionHeading title="Cancelled KOTs" description="Full ticket cancellations and cancellation tickets are shown with their saved item snapshot." /><ScrollTable><table className="w-full min-w-[780px] text-left text-sm"><thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-400"><tr><Th>KOT / Order</Th><Th>Items</Th><Th right>Value</Th><Th>Previous state</Th><Th>Reason / actor</Th></tr></thead><tbody className="divide-y divide-gray-100">{kots.map((row) => <tr key={row.id} className={clickableRowClass} onClick={() => openKot(row.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openKot(row.id); } }} tabIndex={0} role="button"><Td><span className="font-semibold">{row.kotNumber}</span><p className="text-xs text-gray-400">{row.orderNumber}</p></Td><Td>{row.items.map((item) => `${item.quantity}× ${item.name}`).join(', ') || 'No snapshot'}</Td><Td right>{money(row.value)}</Td><Td>{row.previousStatus || '—'}</Td><Td>{row.reason}<p className="text-xs text-gray-400">{row.cancelledBy}</p></Td></tr>)}</tbody></table></ScrollTable></div><div><SectionHeading title="Item removals and reductions" description="Draft removals and sent-item cancellation notices from the POS audit trail." /><ScrollTable><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-400"><tr><Th>Time</Th><Th>Order / item</Th><Th>Action</Th><Th right>Impact</Th><Th>Reason</Th><Th>Staff</Th></tr></thead><tbody className="divide-y divide-gray-100">{items.map((row) => <tr key={row.id} className={row.orderId ? clickableRowClass : undefined} onClick={() => row.orderId && openOrder({ orderId: row.orderId, orderNumber: row.orderNumber })}><Td><NepalTime value={row.createdAt} /></Td><Td>{row.orderNumber}<p className="text-xs text-gray-400">{row.quantity}× {row.item}</p></Td><Td>{labelize(row.action)}</Td><Td right><span className="text-red-700">{money(row.valueDifference)}</span></Td><Td>{row.reason}</Td><Td>{row.actor}</Td></tr>)}</tbody></table></ScrollTable></div></div></DashboardSection>
    <DashboardSection><SectionHeading title="Reason analytics" description="No reason recorded remains a visible exception category." /><ReasonGrid reasons={report.reasons} /></DashboardSection>
  </>;
}

/**
 * Bill / order cell for the billing tables.
 * Opens the same bill invoice modal as the sales report.
 */
function BillOrderCell({ row }) {
  const { openBill, openOrder } = useAnalyticsRecords();
  const label = row.billNumber || `Bill ${row.billId ?? ''}`.trim();
  return (
    <Td>
      <button
        type="button"
        className="font-semibold text-gray-900 hover:text-blue-700 hover:underline"
        onClick={(event) => {
          event.stopPropagation();
          if (row.billId || row.id) openBill(row.billId || row.id);
          else openOrder(row);
        }}
      >
        {label}
      </button>
      <p className="text-xs text-gray-400">{row.orderNumber || 'No order linked'}</p>
    </Td>
  );
}

function BillsAndMoney({ report, related }) {
  const { openBill } = useAnalyticsRecords();
  const discounts = related(report.discounts);
  const corrections = related(report.corrections);
  const revisions = related(report.revisions);
  const pending = related(report.pendingBills);
  const voids = corrections.filter((row) => row.type === 'void');
  const refunds = corrections.filter((row) => row.type === 'refund');
  const discountValue = discounts.reduce((sum, row) => sum + Number(row.discount || 0), 0);
  return <>
    <DashboardSection><SectionHeading icon={Banknote} tone="emerald" eyebrow="Billing control" title="Discounts, voids, refunds, reopens and payment state" description="Click a bill row to open the same invoice modal as the sales report." /><div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6"><MiniMetric label="Discounted bills" value={discounts.length} /><MiniMetric label="Discount amount" value={money(discountValue)} negative /><MiniMetric label="Voided bills" value={voids.length} /><MiniMetric label="Void value" value={money(voids.reduce((sum, row) => sum + row.amount, 0))} negative /><MiniMetric label="Refunds" value={refunds.length} /><MiniMetric label="Refund value" value={money(refunds.reduce((sum, row) => sum + row.amount, 0))} negative /></div><div className="mt-6 grid gap-5 xl:grid-cols-2"><ChartCard title="Payment methods" isEmpty={!report.payments?.length} empty="No payments in this period."><RankBars data={(report.payments || []).map((row) => ({ label: row.method, value: row.amount, meta: `${row.transactions} transactions` }))} color="emerald" format="currency" /></ChartCard><ChartCard title="Discounts by cashier context" hint="The application does not persist a separate discount approver" isEmpty={!report.staff?.some((row) => row.discountValue > 0)} empty="No discounts in this period."><RankBars data={(report.staff || []).filter((row) => row.discountValue > 0).map((row) => ({ label: row.name, value: row.discountValue, meta: `${row.discounts} bills` }))} color="red" format="currency" /></ChartCard></div></DashboardSection>
    <DashboardSection><SectionHeading icon={Tags} tone="amber" title="Discounted bills" description="Bill cashier is contextual attribution only; the schema has no separate applied-by or approved-by discount field." /><ScrollTable><table className="w-full min-w-[1280px] text-left text-sm"><thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-400"><tr><Th>Time</Th><Th>Bill / order</Th><Th>Table</Th><Th right>Gross</Th><Th right>Discount</Th><Th right>%</Th><Th right>Final</Th><Th>Reason</Th><Th>Cashier context</Th></tr></thead><tbody className="divide-y divide-gray-100">{discounts.map((row) => <tr key={row.id} className={clickableRowClass} onClick={() => openBill(row.id)}><Td><NepalTime value={row.createdAt} /></Td><BillOrderCell row={row} /><Td>{row.table}<p className="text-xs text-gray-400">{row.orderType}</p></Td><Td right>{money(row.gross)}</Td><Td right><span className="font-semibold text-red-700">{money(row.discount)}</span></Td><Td right>{percent(row.discountPercent)}</Td><Td right>{money(row.total)}</Td><Td>{row.discountReason}</Td><Td>{row.cashier}<p className="text-xs text-gray-400">{row.cashierRole}</p></Td></tr>)}</tbody></table></ScrollTable></DashboardSection>
    <DashboardSection><div className="grid gap-7 xl:grid-cols-2"><div><SectionHeading title="Voids & refunds" description="A void reverses the sale; a refund returns money after the sale." /><ScrollTable><table className="w-full min-w-[800px] text-left text-sm"><thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-400"><tr><Th>Time</Th><Th>Action</Th><Th>Bill / order</Th><Th right>Amount</Th><Th>Payment / reason</Th><Th>Staff</Th></tr></thead><tbody className="divide-y divide-gray-100">{corrections.map((row) => <tr key={row.id} className={clickableRowClass} onClick={() => openBill(row.billId)}><Td><NepalTime value={row.createdAt} /></Td><Td><StatusPill tone="negative">{labelize(row.type)}</StatusPill></Td><Td><span className="font-semibold">{row.billNumber}</span><p className="text-xs text-gray-400">{row.orderNumber}</p></Td><Td right>{money(row.amount)}</Td><Td>{row.originalMethods.join(' + ') || 'Not recorded'}<p className="text-xs text-gray-500">{row.reason}</p></Td><Td>{row.actor}<p className="text-xs text-gray-400">{row.actorRole}</p></Td></tr>)}</tbody></table></ScrollTable></div><div><SectionHeading title="Reopened bills" description="Original invoice history stays immutable; each change is represented by an audited delta." /><ScrollTable><table className="w-full min-w-[820px] text-left text-sm"><thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-400"><tr><Th>Reopened</Th><Th>Bill / order</Th><Th right>Original</Th><Th right>New</Th><Th right>Difference</Th><Th>Reason / staff</Th></tr></thead><tbody className="divide-y divide-gray-100">{revisions.map((row) => <tr key={row.id} className={clickableRowClass} onClick={() => openBill(row.billId)}><Td><NepalTime value={row.createdAt} /></Td><Td><span className="font-semibold">{row.billNumber}</span><p className="text-xs text-gray-400">{row.orderNumber}</p></Td><Td right>{money(row.originalTotal)}</Td><Td right>{money(row.newTotal)}</Td><Td right><span className={row.delta < 0 ? 'font-semibold text-red-700' : row.delta > 0 ? 'font-semibold text-emerald-700' : ''}>{row.delta > 0 ? '+' : ''}{money(row.delta)}</span></Td><Td>{row.reason}<p className="text-xs text-gray-400">{row.createdBy}</p></Td></tr>)}</tbody></table></ScrollTable></div></div></DashboardSection>
    {pending.length > 0 && <DashboardSection><SectionHeading icon={ReceiptText} tone="rose" title="Pending and unpaid bills" description="Bills whose received payment is below the current bill total." /><ScrollTable><table className="w-full min-w-[860px] text-left text-sm"><thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-400"><tr><Th>Bill / order</Th><Th>Status</Th><Th>Methods</Th><Th right>Total</Th><Th right>Paid</Th><Th right>Outstanding</Th></tr></thead><tbody className="divide-y divide-gray-100">{pending.map((row) => <tr key={row.id} className={clickableRowClass} onClick={() => openBill(row.id)}><Td><span className="font-semibold">{row.billNumber}</span><p className="text-xs text-gray-400">{row.orderNumber}</p></Td><Td><StatusPill tone="warning">{row.paymentStatus || row.status}</StatusPill></Td><Td>{row.methods.join(' + ') || 'Not recorded'}</Td><Td right>{money(row.total)}</Td><Td right>{money(row.paid)}</Td><Td right><span className="font-semibold text-red-700">{money(Math.max(row.outstanding, row.total - row.paid))}</span></Td></tr>)}</tbody></table></ScrollTable></DashboardSection>}
  </>;
}

function StaffAndAudit({ report, related, search }) {
  const timeline = related(report.timeline).filter((row) => !search || `${row.orderNumber || ''} ${row.action} ${row.actor} ${row.reason || ''}`.toLowerCase().includes(search.toLowerCase()));
  return <>
    <DashboardSection><SectionHeading icon={Users} tone="violet" eyebrow="Staff activity" title="Objective action and value attribution" description="This report surfaces actions and rates; it does not label staff behaviour as suspicious or fraudulent." /><ScrollTable><table className="w-full min-w-[1280px] text-left text-sm"><thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-400"><tr><Th>Staff</Th><Th right>Orders</Th><Th right>Sales handled</Th><Th right>Bills</Th><Th right>Discounts</Th><Th right>Discount value</Th><Th right>Order cancels</Th><Th right>Item cancels</Th><Th right>KOT cancels</Th><Th right>Voids</Th><Th right>Reopens</Th><Th right>Refunds</Th></tr></thead><tbody className="divide-y divide-gray-100">{(report.staff || []).map((row) => <tr key={row.id || row.name}><Td><span className="font-semibold">{row.name}</span><p className="text-xs text-gray-400">{row.role}</p></Td><Td right>{row.ordersCreated}</Td><Td right>{money(row.salesHandled)}</Td><Td right>{row.billsGenerated}</Td><Td right>{row.discounts}</Td><Td right>{money(row.discountValue)}</Td><Td right>{row.ordersCancelled}</Td><Td right>{row.itemsCancelled}</Td><Td right>{row.kotsCancelled}</Td><Td right>{row.billsVoided}</Td><Td right>{row.billsReopened}</Td><Td right>{row.refunds}</Td></tr>)}</tbody></table></ScrollTable></DashboardSection>
    <DashboardSection><SectionHeading icon={ChefHat} tone="teal" title="Item operational analytics" description="Revenue, cancellations and modifications use persisted order items and POS audit events. Item-level discounts/refunds are omitted because they are not persisted separately." /><ScrollTable><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-400"><tr><Th>Item</Th><Th right>Ordered</Th><Th right>Revenue</Th><Th right>Cancelled qty</Th><Th right>Cancellation value</Th><Th right>Cancellation rate</Th><Th right>Modifications</Th></tr></thead><tbody className="divide-y divide-gray-100">{(report.items || []).map((row) => <tr key={`${row.item}-${row.variant || ''}`}><Td><span className="font-medium">{row.item}</span>{row.variant && <p className="text-xs text-gray-400">{row.variant}</p>}</Td><Td right>{row.orderedQuantity}</Td><Td right>{money(row.revenue)}</Td><Td right>{row.cancelledQuantity}</Td><Td right>{money(row.cancellationValue)}</Td><Td right>{percent(row.cancellationRate)}</Td><Td right>{row.modifications}</Td></tr>)}</tbody></table></ScrollTable></DashboardSection>
    <DashboardSection><SectionHeading icon={FileClock} tone="slate" title="Complete persisted audit trail" description="Events are shown only when they were actually written to POS or bill audit history." /><AuditTable rows={timeline} /></DashboardSection>
    <DashboardSection><SectionHeading title="Data coverage notes" /><ul className="space-y-2 text-sm text-gray-600">{(report.limitations || []).map((note) => <li key={note} className="flex gap-2"><span className="text-gray-300">•</span><span>{note}</span></li>)}</ul></DashboardSection>
  </>;
}

function ReasonGrid({ reasons = {}, compact = false }) {
  const groups = [['Order cancellations', reasons.orderCancellations], ['KOT cancellations', reasons.kotCancellations], ['Item cancellations', reasons.itemCancellations], ['Bill voids', reasons.billVoids], ['Refunds', reasons.refunds], ['Bill reopens', reasons.reopens], ['Discounts', reasons.discounts]].filter(([, rows]) => rows?.length);
  if (!groups.length) return compact ? null : <p className="py-10 text-center text-sm text-gray-400">No sensitive-action reasons in this period.</p>;
  return <div className={`${compact ? 'mt-6' : ''} grid gap-4 xl:grid-cols-2`}>{groups.map(([title, rows]) => <div key={title} className="rounded-xl border border-gray-200 bg-white p-4"><h3 className="text-sm font-semibold text-gray-900">{title}</h3><div className="mt-3 divide-y divide-gray-100">{rows.slice(0, compact ? 4 : 8).map((row) => <div key={row.reason} className="flex items-center justify-between gap-4 py-2.5 text-sm"><div className="min-w-0"><p className="truncate font-medium text-gray-800">{row.reason}</p><p className="text-xs text-gray-400">{percent(row.share)} of actions</p></div><div className="shrink-0 text-right"><p className="font-semibold tabular-nums">{row.count}</p>{row.value > 0 && <p className="text-xs tabular-nums text-gray-500">{money(row.value)}</p>}</div></div>)}</div></div>)}</div>;
}

function AuditTable({ rows = [] }) {
  const { openOrder, openBill, openKot } = useAnalyticsRecords();
  const openRow = (row) => {
    if (row.kotId) openKot(row.kotId);
    else if (row.billId) openBill(row.billId);
    else if (row.orderId) openOrder({ orderId: row.orderId, orderNumber: row.orderNumber });
  };
  return (
    <div className="max-h-[720px] overflow-auto">
      <TableWrap minWidth="1180px">
        <thead className="sticky top-0 z-10 bg-gray-50 text-xs uppercase tracking-wide text-gray-400">
          <tr><Th>Time</Th><Th>Order</Th><Th>Entity</Th><Th>Action</Th><Th>Staff</Th><Th>Reason</Th><Th>Change / detail</Th></tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row) => (
            <tr
              key={row.id}
              className={row.orderId || row.billId || row.kotId ? clickableRowClass : undefined}
              onClick={() => openRow(row)}
            >
              <Td><NepalTime value={row.createdAt} /></Td>
              <Td><span className="font-medium text-gray-900">{row.orderNumber || (row.orderId ? `Order ${row.orderId}` : '—')}</span></Td>
              <Td>{row.entity}</Td>
              <Td>
                <StatusPill tone={/cancel|void|refund|remove/i.test(row.action) ? 'negative' : /reopen|edit|change/i.test(row.action) ? 'warning' : 'info'}>
                  {ACTION_LABELS[row.action] || labelize(row.action)}
                </StatusPill>
              </Td>
              <Td>{row.actor}<p className="text-xs text-gray-400">{row.actorRole}</p></Td>
              <Td>{row.reason || '—'}</Td>
              <Td><JsonSummary value={row.detail || row.after || row.before} /></Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}

function OrderTimeline({ rows = [] }) {
  if (!rows.length) return <p className="text-sm text-gray-400">No persisted audit events for this order.</p>;
  return <div><p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Persisted order timeline</p><ol className="space-y-3">{[...rows].reverse().map((row) => <li key={row.id} className="grid gap-1 border-l-2 border-gray-200 pl-4 sm:grid-cols-[155px_1fr]"><span className="text-xs text-gray-400"><NepalTime value={row.createdAt} /></span><div><p className="text-sm font-semibold text-gray-800">{ACTION_LABELS[row.action] || labelize(row.action)}</p><p className="text-xs text-gray-500">{row.actor} · {row.entity}{row.reason ? ` · ${row.reason}` : ''}</p></div></li>)}</ol></div>;
}

function JsonSummary({ value }) {
  if (value == null) return <span className="text-gray-300">—</span>;
  if (typeof value === 'string') return <span className="line-clamp-2 max-w-[360px] text-xs text-gray-500">{value}</span>;
  const text = Object.entries(value).slice(0, 4).map(([key, item]) => `${labelize(key)}: ${Array.isArray(item) ? `${item.length} item(s)` : typeof item === 'object' ? 'details' : String(item)}`).join(' · ');
  return <span className="line-clamp-2 max-w-[380px] text-xs text-gray-500">{text || 'Recorded change'}</span>;
}

function QualityPill({ value }) {
  const meta = { completed_normally: ['Valid completion', 'positive'], auto_closed_or_incomplete: ['Auto-closed / incomplete', 'warning'], invalid_timestamps: ['Invalid timestamps', 'negative'], still_open: ['Still open', 'warning'], cancelled: ['Cancelled', 'negative'] }[value] || [labelize(value), 'neutral'];
  return <StatusPill tone={meta[1]}>{meta[0]}</StatusPill>;
}

function MiniMetric({ label, value, negative = false, note = null }) { return <div className="rounded-xl border border-gray-100 bg-gray-50 p-4"><p className="text-xs text-gray-500">{label}</p><p className={`mt-1 text-lg font-semibold tabular-nums ${negative ? 'text-red-700' : 'text-gray-950'}`}>{value}</p>{note ? <p className="mt-0.5 text-[11px] text-gray-500">{note}</p> : null}</div>; }
function ScrollTable({ children }) { return <div className="max-h-[560px] overflow-auto rounded-xl border border-gray-100">{children}</div>; }
function Th({ children, right = false }) { return <th className={`px-4 py-2.5 font-semibold ${right ? 'text-right' : ''}`}>{children}</th>; }
function Td({ children, right = false }) { return <td className={`px-4 py-3 align-top ${right ? 'text-right tabular-nums' : ''}`}>{children}</td>; }
function labelize(value) { return String(value || '—').replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()); }
function statusTone(value) { return ['completed', 'paid', 'ready'].includes(value) ? 'positive' : ['cancelled', 'voided', 'refunded'].includes(value) ? 'negative' : ['pending', 'preparing', 'awaiting_payment', 'reopened'].includes(value) ? 'warning' : 'neutral'; }
