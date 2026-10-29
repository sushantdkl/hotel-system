'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import AdminLayout from '@/components/admin/admin-layout';
import {
  DollarSign, ShoppingCart, TrendingUp, TrendingDown, LayoutGrid,
  AlertTriangle, PackageX, PackageMinus, Clock3, Receipt, CalendarClock,
  ShoppingBag, ChefHat, UserCheck, Boxes, Package, Award, Users, Sparkles,
  Sun, Sunrise, Sunset, Moon, Inbox, Banknote, RotateCcw, CreditCard, Hash,
  Trash2, Loader2,
} from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { TrendChart } from '@/components/admin/report-kit';
import { FEATURES } from '@/lib/deployment';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { formatCalendarDate } from '@/lib/calendar-system.js';
import {
  tableBoardState, isRunningTable, isReservedTable,
  groupTablesByRoom, filterRoomGroups, computeTableStatusCounts,
  TableRoomBoard,
} from '@/components/tables/table-room-board';
import { useOpenDuration } from '@/components/tables/table-open-duration';

function MenuTableSubtitle({ table }) {
  const openFor = useOpenDuration(table?.opened_at, Boolean(table?.opened_at));
  return (
    <p className="mb-4 text-sm text-gray-500">
      {(table.party_count || 1)} active part{(table.party_count || 1) === 1 ? 'y' : 'ies'}
      {openFor ? ` · open ${openFor}` : ''}
    </p>
  );
}

function authedRequest(url) {
  const token = localStorage.getItem('pos_token');
  return fetch(url, { headers: { Authorization: `Bearer ${token}` } });
}

function formatBusinessDate(value) {
  return formatCalendarDate(value, { empty: '-' });
}

// ponytail: no restaurant-hours table exists yet — greeting/open-closed/shift are
// derived from the clock only. Swap for real settings if opening hours become configurable.
function useTimeContext() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);
  const hour = now.getHours();
  let greeting = 'Good evening';
  let GreetingIcon = Moon;
  if (hour < 12) { greeting = 'Good morning'; GreetingIcon = Sunrise; }
  else if (hour < 17) { greeting = 'Good afternoon'; GreetingIcon = Sun; }
  else if (hour < 21) { greeting = 'Good evening'; GreetingIcon = Sunset; }
  else { greeting = 'Good night'; GreetingIcon = Moon; }
  const isOpen = hour >= 7 && hour < 23;
  const shift = hour < 12 ? 'Morning shift' : hour < 17 ? 'Afternoon shift' : hour < 23 ? 'Evening shift' : 'Closed';
  const timeLabel = now.toLocaleTimeString('en-US', { timeZone: 'Asia/Kathmandu', hour: 'numeric', minute: '2-digit' });
  return { greeting, GreetingIcon, isOpen, shift, timeLabel };
}

function GrowthBadge({ current, previous }) {
  // Hide noise: quiet today, no history, or a -100% cliff that just means
  // nothing has been settled yet (open floor sales still count separately).
  if (previous == null) return null;
  if (Number(current) === 0) return null;
  if (Number(previous) === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
        <TrendingUp className="w-3 h-3" /> New vs yesterday
      </span>
    );
  }
  const growth = ((current - previous) / previous) * 100;
  const positive = growth >= 0;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${positive ? 'text-emerald-600' : 'text-red-600'}`}>
      {positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {positive ? '+' : ''}{growth.toFixed(0)}% vs yesterday
    </span>
  );
}

const ATTENTION_META = {
  out_of_stock: { icon: PackageX, tone: 'text-red-600 bg-red-50' },
  low_stock: { icon: PackageMinus, tone: 'text-amber-600 bg-amber-50' },
  kitchen_delay: { icon: Clock3, tone: 'text-orange-600 bg-orange-50' },
  unpaid_bill: { icon: Receipt, tone: 'text-rose-600 bg-rose-50' },
  reopened_bill: { icon: RotateCcw, tone: 'text-violet-600 bg-violet-50' },
  credit_due: { icon: CreditCard, tone: 'text-indigo-600 bg-indigo-50' },
  reservation_soon: { icon: CalendarClock, tone: 'text-blue-600 bg-blue-50' },
};

const ACTIVITY_META = {
  order_created: { icon: ShoppingBag, tone: 'text-blue-600 bg-blue-50' },
  kitchen_ready: { icon: ChefHat, tone: 'text-emerald-600 bg-emerald-50' },
  reservation_checked_in: { icon: UserCheck, tone: 'text-violet-600 bg-violet-50' },
  manual_restock: { icon: Boxes, tone: 'text-teal-600 bg-teal-50' },
  purchase_receipt: { icon: Boxes, tone: 'text-teal-600 bg-teal-50' },
  opening_balance: { icon: Boxes, tone: 'text-indigo-600 bg-indigo-50' },
  wastage: { icon: PackageX, tone: 'text-red-600 bg-red-50' },
  adjustment: { icon: Package, tone: 'text-gray-500 bg-gray-100' },
  manual_adjustment: { icon: Package, tone: 'text-gray-500 bg-gray-100' },
};

export default function AdminDashboard() {
  const router = useRouter();
  const pathname = usePathname();
  const cashierPanel = pathname?.startsWith('/cashier');
  const panelPath = (adminPath, cashierPath) => cashierPanel ? cashierPath : adminPath;
  const { addToast } = useToast();
  const { confirm } = useConfirm();
  const { greeting, GreetingIcon, isOpen, shift, timeLabel } = useTimeContext();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [onlineOrders, setOnlineOrders] = useState([]);
  const [tables, setTables] = useState([]);
  const [menuTable, setMenuTable] = useState(null); // occupied table action menu
  // Clear-table confirmation: { table, party|null } — party null means the whole table.
  const [clearTarget, setClearTarget] = useState(null);
  const [clearReason, setClearReason] = useState('');
  const [clearing, setClearing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tick, setTick] = useState(0); // re-render "Updated Xs ago"
  const [businessContext, setBusinessContext] = useState(null);
  const [businessContextLoading, setBusinessContextLoading] = useState(true);
  const [tableRoomFilter, setTableRoomFilter] = useState('all');
  const [tableStatusFilter, setTableStatusFilter] = useState('all');

  const fetchStats = useCallback(async ({ soft = false } = {}) => {
    if (soft) setRefreshing(true);
    try {
      const res = await authedRequest('/api/admin/dashboard');
      if (res.ok) {
        const data = await res.json();
        setStats(data.stats);
        setLastUpdated(new Date());
      }
    } catch (error) {
      console.error('Error fetching dashboard:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const fetchTables = useCallback(async () => {
    try {
      const res = await authedRequest('/api/admin/pos/tables');
      if (res.ok) {
        const data = await res.json();
        const list = data.tables || data.data || [];
        if (Array.isArray(list) && list.length > 0) {
          setTables(list);
          return;
        }
      }
      // Fallback: same list the Tables admin page uses (normalize to board shape).
      const fallback = await authedRequest('/api/admin/tables');
      if (!fallback.ok) return;
      const data = await fallback.json();
      const list = (data.tables || []).map((t) => ({
        id: t.id,
        table_number: t.table_number,
        capacity: t.capacity,
        floor: t.floor,
        section: t.section,
        status: t.status,
        current_order_id: t.current_order_id || null,
        order_status: null,
        order_number: t.order_number || null,
        current_amount: 0,
        kot_count: 0,
        unsent_count: 0,
        party_count: t.current_order_id ? 1 : 0,
        parties: t.current_order_id
          ? [{ order_id: t.current_order_id, order_number: t.order_number, party_label: 'Party 1', amount: 0 }]
          : [],
      }));
      setTables(list);
    } catch {
      /* ignore */
    }
  }, []);

  // New website orders arrive as pending WEB-* orders. Poll so they stand out.
  const fetchOnlineOrders = useCallback(async () => {
    try {
      const res = await authedRequest('/api/admin/orders?status=pending&pageSize=100');
      if (!res.ok) return;
      const data = await res.json();
      const rows = (data.orders || data.data || data.items || []).filter((o) =>
        String(o.order_number || '').startsWith('WEB-')
      );
      setOnlineOrders(rows);
    } catch {
      /* ignore */
    }
  }, []);

  const fetchBusinessContext = useCallback(async () => {
    try {
      const res = await authedRequest('/api/admin/business-days?view=context');
      if (!res.ok) return;
      const data = await res.json();
      setBusinessContext(data || null);
    } catch {
      /* ignore */
    } finally {
      setBusinessContextLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    fetchOnlineOrders();
    fetchTables();
    fetchBusinessContext();
    // Keep KPIs + floor + online orders in sync so the board feels live.
    const t = setInterval(() => {
      fetchStats({ soft: true });
      fetchOnlineOrders();
      fetchTables();
      fetchBusinessContext();
    }, 15000);
    const clock = setInterval(() => setTick((n) => n + 1), 1000);
    return () => { clearInterval(t); clearInterval(clock); };
  }, [fetchStats, fetchOnlineOrders, fetchTables, fetchBusinessContext]);

  const kpis = stats?.kpis;
  const occupiedTables = tables.filter(isRunningTable);
  const reservedTables = tables.filter(isReservedTable);
  const freeTables = Math.max(0, tables.length - occupiedTables.length - reservedTables.length);
  const floorAmount = occupiedTables.reduce((s, t) => s + Number(t.current_amount || 0), 0);
  const tableRooms = useMemo(() => groupTablesByRoom(tables), [tables]);
  const visibleTableRooms = useMemo(
    () => filterRoomGroups(tableRooms, tableRoomFilter, tableStatusFilter),
    [tableRooms, tableRoomFilter, tableStatusFilter]
  );
  const tableStatusCounts = useMemo(() => computeTableStatusCounts(tables), [tables]);
  const updatedAgo = (() => {
    void tick;
    if (!lastUpdated) return null;
    const sec = Math.max(0, Math.floor((Date.now() - lastUpdated.getTime()) / 1000));
    if (sec < 5) return 'just now';
    if (sec < 60) return `${sec}s ago`;
    return `${Math.floor(sec / 60)}m ago`;
  })();
  // The shared chart kit reads { label, sub, value }; the dashboard API speaks
  // { day, date, value }. One map keeps the kit as the single chart contract.
  const toSeries = (rows) => (rows || []).map((d) => ({ label: d.day, sub: formatCalendarDate(d.date), value: d.value }));
  const revenueTrend = toSeries(stats?.revenueTrend);
  const orderVolume = toSeries(stats?.orderVolume);
  const storeNeedsOpening = !businessContextLoading && !businessContext?.activeSession;
  const storeActionLabel = businessContext?.storeClosed ? 'Reopen Store' : 'Open Store';
  // Whether the store is ACTUALLY open right now — an active session, not a
  // 7am-11pm clock guess. `isOpen` above is only a time-of-day heuristic used
  // for the greeting; using it for status badges is what caused the header
  // to say "Live · Open" while the store-needs-opening banner was showing.
  const storeIsOpen = !businessContextLoading && !storeNeedsOpening;

  const handleTableClick = (table) => {
    if (isReservedTable(table)) {
      router.push(panelPath('/admin/leads', '/cashier/reservations'));
      return;
    }
    if (!isRunningTable(table)) {
      router.push(`${panelPath('/admin/pos', '/cashier/pos')}?table=${table.id}`);
      return;
    }
    setMenuTable(table);
  };

  const primaryParty = (table) => (table.parties || [])[0] || null;

  // Void one or more orders on a table when guests leave without paying.
  const confirmClear = useCallback(async () => {
    if (!clearTarget || clearing) return;
    const reason = clearReason.trim();
    if (!reason) return;
    const { table, party } = clearTarget;
    const orderIds = party
      ? [party.order_id]
      : [
          ...new Set(
            [
              ...((table.parties || []).map((p) => p.order_id)),
              table.current_order_id,
            ].filter(Boolean)
          ),
        ];
    if (!orderIds.length) {
      setClearTarget(null);
      return;
    }
    setClearing(true);
    const token = localStorage.getItem('pos_token');
    let ok = 0;
    for (const oid of orderIds) {
      try {
        const res = await fetch(`/api/admin/orders/${oid}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: 'cancel', reason, restock: true }),
        });
        if (res.ok) ok += 1;
      } catch {
        /* keep going with the rest */
      }
    }
    setClearing(false);
    setClearTarget(null);
    setClearReason('');
    setMenuTable(null);
    if (ok > 0) {
      addToast({ variant: 'success', title: 'Table cleared', description: `${ok} part${ok === 1 ? 'y' : 'ies'} cleared. Table is now free.` });
    } else {
      addToast({ variant: 'error', title: 'Could not clear', description: 'The table could not be cleared. Please try again.' });
    }
    fetchTables();
  }, [clearTarget, clearReason, clearing, addToast, fetchTables]);

  return (
    <AdminLayout>
      <header className="bg-white border-b border-gray-200 px-4 sm:px-6 lg:px-8 py-5 sm:py-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-50">
              <GreetingIcon className="w-6 h-6 text-amber-600" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">{greeting}</h1>
              <p className="text-gray-500 mt-0.5 text-sm">Restaurant overview — sales, open work, and what needs action.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <button
              type="button"
              onClick={() => router.push(panelPath('/admin/pos', '/cashier/pos'))}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-900 text-white text-xs font-semibold hover:bg-gray-800"
            >
              Takeaway
            </button>
            <button
              type="button"
              onClick={() => router.push(panelPath('/admin/business-days', '/cashier/business-days'))}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs font-semibold hover:bg-emerald-100"
            >
              <CalendarClock className="h-3.5 w-3.5" />
              Opening & Closing
            </button>
            <button
              type="button"
              onClick={() => { fetchStats({ soft: true }); fetchOnlineOrders(); fetchTables(); fetchBusinessContext(); }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50"
              title="Refresh now"
            >
              <RotateCcw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              {updatedAgo ? `Updated ${updatedAgo}` : 'Refresh'}
            </button>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-medium ${storeIsOpen ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${storeIsOpen ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'}`} />
              Live · {storeIsOpen ? 'Open' : 'Closed'}
            </span>
            <div className="text-right">
              <p className="font-semibold text-gray-800 tabular-nums">{timeLabel}</p>
              <p className="text-xs text-gray-400">{shift}</p>
            </div>
          </div>
        </div>
      </header>

      <div className="p-4 sm:p-6 lg:p-8 bg-gray-50 space-y-6">
        {storeNeedsOpening && (
          <section className="border border-amber-200 bg-amber-50 p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-800">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-amber-700">Store is closed</p>
                  <h2 className="mt-1 text-xl font-bold text-amber-950">
                    {businessContext?.storeClosed ? 'Reopen the store before taking orders' : 'Open the store before operations begin'}
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-amber-900">
                    {businessContext?.storeClosed && businessContext?.current
                      ? `Business Day ${formatBusinessDate(businessContext.current.business_date)} is still available. Start another store session to continue the same day.`
                      : 'No active store session is open yet. Enter the opening cash before POS orders, bills, payments, expenses, and cash movements begin.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => router.push(panelPath('/admin/business-days', '/cashier/business-days'))}
                className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-lg bg-gray-950 px-5 text-sm font-semibold text-white hover:bg-black"
              >
                <CalendarClock className="h-4 w-4" />
                {storeActionLabel}
              </button>
            </div>
          </section>
        )}
        {loading && !stats ? (
          <div className="text-center py-20 text-gray-500">Loading dashboard…</div>
        ) : (
          <>
            {/* Live table board — primary operational surface */}
            <section className="rounded-lg border border-gray-200 bg-white p-4 sm:p-6 shadow-sm">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <LayoutGrid className="h-5 w-5 text-cyan-600" />
                  <div>
                    <h2 className="text-base sm:text-lg font-bold text-gray-900">Floor tables</h2>
                    <p className="text-xs text-gray-500">Available is green, running is blue, and reserved is red.</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { fetchStats({ soft: true }); fetchTables(); fetchOnlineOrders(); fetchBusinessContext(); }}
                  className={`inline-flex items-center gap-1 text-xs font-semibold hover:underline ${storeIsOpen ? 'text-cyan-700' : 'text-gray-500'}`}
                >
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${storeIsOpen ? `bg-emerald-500 ${refreshing ? 'animate-ping' : 'animate-pulse'}` : 'bg-gray-400'}`} />
                  {storeIsOpen ? 'Live' : 'Store closed'}{updatedAgo ? ` · ${updatedAgo}` : ''}
                </button>
              </div>
              {tables.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-400">No tables configured yet.</p>
              ) : (
                <div>
                  <TableRoomBoard
                    tables={tables}
                    rooms={tableRooms}
                    visibleRooms={visibleTableRooms}
                    roomFilter={tableRoomFilter}
                    statusFilter={tableStatusFilter}
                    statusCounts={tableStatusCounts}
                    onRoomFilter={setTableRoomFilter}
                    onStatusFilter={setTableStatusFilter}
                    onTableClick={handleTableClick}
                  />
                  <div className="hidden">
                  {tables.map((t) => {
                    const occupied = isRunningTable(t);
                    const reserved = isReservedTable(t);
                    const state = occupied ? 'running' : reserved ? 'reserved' : 'available';
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => handleTableClick(t)}
                        className={`min-h-[110px] rounded-lg border-2 p-3 text-left transition-[border-color,box-shadow,transform] duration-150 hover:shadow-md active:scale-[0.98] ${
                          occupied
                            ? 'border-sky-300 bg-sky-50 hover:border-sky-400'
                            : reserved
                              ? 'border-red-300 bg-red-50 hover:border-red-400'
                              : 'border-emerald-200 bg-emerald-50 hover:border-emerald-400'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <span className="text-xl font-bold text-gray-900">{t.table_number}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            occupied
                              ? 'bg-sky-200 text-sky-900'
                              : reserved
                                ? 'bg-red-200 text-red-900'
                                : 'bg-emerald-200 text-emerald-900'
                          }`}>
                            {state === 'running' ? 'Running' : state === 'reserved' ? 'Reserved' : 'Available'}
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-gray-500">{t.floor || 'Floor'}{t.section ? ` · ${t.section}` : ''}</p>
                        {occupied ? (
                          <div className="mt-2 space-y-0.5">
                            <p className="text-xs font-semibold text-sky-800">
                              {(t.party_count || 1)} part{(t.party_count || 1) === 1 ? 'y' : 'ies'} · {formatCurrency(t.current_amount || 0)}
                            </p>
                            {t.unsent_count > 0 && (
                              <p className="text-[11px] font-medium text-amber-700">{t.unsent_count} unsent</p>
                            )}
                          </div>
                        ) : reserved ? (
                          <p className="mt-2 text-xs font-medium text-red-700">View reservation</p>
                        ) : (
                          <p className="mt-2 text-xs font-medium text-emerald-700">Open in POS</p>
                        )}
                      </button>
                    );
                  })}
                  </div>
                </div>
              )}
            </section>

            {/* Occupied-table action menu */}
            {menuTable && (
              <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
                <button type="button" className="absolute inset-0" aria-label="Close" onClick={() => setMenuTable(null)} />
                <div className="relative z-10 w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-white p-5 shadow-2xl">
                  <h3 className="text-lg font-bold text-gray-900">Table {menuTable.table_number}</h3>
                  <MenuTableSubtitle table={menuTable} />
                  <div className="space-y-2">
                    {(menuTable.parties || []).map((p) => (
                      <div
                        key={p.order_id}
                        className="flex items-stretch gap-2 rounded-xl border border-sky-200 bg-sky-50 hover:border-sky-400"
                      >
                        <button
                          type="button"
                          onClick={() => router.push(`${panelPath('/admin/pos', '/cashier/pos')}?order=${p.order_id}`)}
                          className="flex flex-1 items-center justify-between px-4 py-3 text-left"
                        >
                          <div>
                            <p className="font-semibold text-gray-900">{p.party_label || 'Party'}</p>
                            <p className="text-xs text-gray-500">Add items · {p.order_number}</p>
                          </div>
                          <span className="font-bold text-sky-800">{formatCurrency(p.amount)}</span>
                        </button>
                        <button
                          type="button"
                          title="Clear this party (left without paying)"
                          onClick={() => { setClearReason(''); setClearTarget({ table: menuTable, party: p }); }}
                          className="flex items-center justify-center rounded-r-xl border-l border-sky-200 px-3 text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                    {!(menuTable.parties || []).length && menuTable.current_order_id && (
                      <button
                        type="button"
                        onClick={() => router.push(`${panelPath('/admin/pos', '/cashier/pos')}?order=${menuTable.current_order_id}`)}
                        className="w-full rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-left font-semibold text-sky-900"
                      >
                        a. Add items
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={async () => {
                        const parties = menuTable.party_count || (menuTable.parties || []).length || 1;
                        const ok = await confirm({
                          title: `Add another person on table ${menuTable.table_number}?`,
                          message: `This opens a new separate tab on table ${menuTable.table_number} (alongside the ${parties} already seated). They order and pay independently.`,
                          confirmLabel: 'Add person',
                          tone: 'default',
                        });
                        if (!ok) return;
                        setMenuTable(null);
                        router.push(`${panelPath('/admin/pos', '/cashier/pos')}?table=${menuTable.id}&new_party=1`);
                      }}
                      className="w-full rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-left font-semibold text-violet-900 hover:border-violet-400"
                    >
                      b. Add another person
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const party = primaryParty(menuTable);
                        const oid = party?.order_id || menuTable.current_order_id;
                        if (oid) router.push(`${panelPath('/admin/pos', '/cashier/pos')}?order=${oid}&change=1`);
                      }}
                      className="w-full rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left font-semibold text-amber-900 hover:border-amber-400"
                    >
                      c. Change table
                    </button>
                    <button
                      type="button"
                      onClick={() => { setClearReason(''); setClearTarget({ table: menuTable, party: null }); }}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-left font-semibold text-rose-700 hover:border-rose-400"
                    >
                      <Trash2 className="h-4 w-4" />
                      d. Clear table {(menuTable.party_count || 1) > 1 ? '(all parties)' : ''} — left without paying
                    </button>
                    <button
                      type="button"
                      onClick={() => setMenuTable(null)}
                      className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Clear-table confirmation */}
            {clearTarget && (
              <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
                <button type="button" className="absolute inset-0" aria-label="Close" onClick={() => { if (!clearing) { setClearTarget(null); setClearReason(''); } }} />
                <div className="relative z-10 w-full max-w-sm rounded-t-2xl sm:rounded-2xl bg-white p-5 shadow-2xl">
                  <div className="mb-3 flex items-center gap-3">
                    <div className="rounded-xl bg-rose-100 p-2.5 text-rose-600">
                      <AlertTriangle className="h-5 w-5" />
                    </div>
                    <h3 className="text-lg font-bold text-gray-900">
                      Clear {clearTarget.party ? (clearTarget.party.party_label || 'this party') : `Table ${clearTarget.table.table_number}`}?
                    </h3>
                  </div>
                  <p className="mb-3 text-sm text-gray-600">
                    {clearTarget.party
                      ? 'This voids this party\u2019s order without payment (they left without paying). This cannot be undone.'
                      : `This voids ${(clearTarget.table.party_count || 1) > 1 ? 'all open parties' : 'the open order'} on this table without payment (guests left without paying). This cannot be undone.`}
                  </p>
                  <textarea
                    autoFocus
                    value={clearReason}
                    onChange={(e) => setClearReason(e.target.value)}
                    rows={2}
                    placeholder="Reason (required) \u2014 e.g. guest left without paying"
                    className="mb-4 w-full rounded-xl border border-gray-300 p-2.5 text-sm focus:border-rose-500 focus:outline-none"
                  />
                  <div className="flex flex-col-reverse gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => { setClearTarget(null); setClearReason(''); }}
                      disabled={clearing}
                      className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={confirmClear}
                      disabled={clearing || !clearReason.trim()}
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
                    >
                      {clearing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      {clearing ? 'Clearing…' : 'Clear now'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* New website orders — stands out at the top when present */}
            {onlineOrders.length > 0 && (
              <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 sm:p-5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="relative p-2.5 rounded-xl bg-amber-500 text-white">
                      <ShoppingBag className="w-6 h-6" />
                      <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-red-600 text-white text-[11px] font-bold flex items-center justify-center">
                        {onlineOrders.length > 99 ? '99+' : onlineOrders.length}
                      </span>
                    </div>
                    <div>
                      <h2 className="text-base sm:text-lg font-bold text-gray-900">
                        {onlineOrders.length} new online {onlineOrders.length === 1 ? 'order' : 'orders'}
                      </h2>
                      <p className="text-xs sm:text-sm text-amber-800">
                        Placed from the website — awaiting confirmation.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => router.push(panelPath('/admin/orders/online', '/cashier/online-orders'))}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700"
                  >
                    Review orders
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {onlineOrders.slice(0, 4).map((o) => (
                    <button
                      key={o.id}
                      onClick={() => router.push(`${panelPath('/admin/orders', '/cashier/orders')}/${o.id}`)}
                      className="rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-left text-xs hover:border-amber-400"
                    >
                      <span className="font-semibold text-gray-900">{o.customer_name || 'Guest'}</span>
                      <span className="text-gray-500"> · {o.order_type} · {o.item_count || 0} item(s)</span>
                    </button>
                  ))}
                  {onlineOrders.length > 4 && (
                    <span className="self-center text-xs text-amber-800">+{onlineOrders.length - 4} more</span>
                  )}
                </div>
              </div>
            )}

            {/* Section 2 — Primary KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <div className="p-2 sm:p-2.5 rounded-lg bg-blue-50"><DollarSign className="w-5 h-5 text-blue-600" /></div>
                </div>
                <h3 className="text-xl sm:text-2xl font-bold text-gray-900 tabular-nums truncate">{formatCurrency(kpis?.sales?.value || 0)}</h3>
                <p className="text-gray-500 text-xs sm:text-sm mt-1">Paid sales today</p>
                {(kpis?.floorOpen?.value > 0 || floorAmount > 0) && (
                  <p className="text-[11px] text-sky-700 mt-0.5 tabular-nums">
                    + {formatCurrency(kpis?.floorOpen?.value || floorAmount)} still open on floor
                  </p>
                )}
                <div className="mt-1"><GrowthBadge current={kpis?.sales?.value || 0} previous={kpis?.sales?.prev} /></div>
              </div>

              <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <div className="p-2 sm:p-2.5 rounded-lg bg-violet-50"><ShoppingCart className="w-5 h-5 text-violet-600" /></div>
                </div>
                <h3 className="text-xl sm:text-2xl font-bold text-gray-900 tabular-nums">{kpis?.orders?.value ?? 0}</h3>
                <p className="text-gray-500 text-xs sm:text-sm mt-1">Orders Today</p>
                <div className="mt-1"><GrowthBadge current={kpis?.orders?.value || 0} previous={kpis?.orders?.prev} /></div>
              </div>

              <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <div className="p-2 sm:p-2.5 rounded-lg bg-emerald-50"><Hash className="w-5 h-5 text-emerald-600" /></div>
                </div>
                <h3 className="text-xl sm:text-2xl font-bold text-gray-900 tabular-nums truncate">{formatCurrency(kpis?.avgTicket?.value || 0)}</h3>
                <p className="text-gray-500 text-xs sm:text-sm mt-1">Avg ticket</p>
                <p className="text-[11px] text-gray-400 mt-1">{kpis?.avgTicket?.paidBills || 0} paid bills</p>
              </div>

              <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <div className="p-2 sm:p-2.5 rounded-lg bg-amber-50"><Banknote className="w-5 h-5 text-amber-600" /></div>
                </div>
                <h3 className="text-xl sm:text-2xl font-bold text-gray-900 tabular-nums truncate">{formatCurrency(kpis?.profit?.value || 0)}</h3>
                <p className="text-gray-500 text-xs sm:text-sm mt-1">Est. profit</p>
                <div className="mt-1"><GrowthBadge current={kpis?.profit?.value || 0} previous={kpis?.profit?.prev} /></div>
              </div>
            </div>

            {/* Live floor / counter pulse — blends API KPIs with live table board */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <button type="button" onClick={() => router.push(panelPath('/admin/pos', '/cashier/pos'))} className="text-left bg-white border border-gray-200 rounded-xl p-4 hover:border-gray-300 shadow-sm transition">
                <p className="text-2xl font-bold text-gray-900 tabular-nums">{Math.max(kpis?.activeOrders?.value ?? 0, occupiedTables.length)}</p>
                <p className="text-xs text-gray-500 mt-1">Active orders</p>
                {floorAmount > 0 && (
                  <p className="text-[11px] text-sky-700 mt-0.5 tabular-nums">{formatCurrency(floorAmount)} on floor</p>
                )}
              </button>
              <button type="button" onClick={() => router.push(panelPath('/admin/bills', '/cashier/bills'))} className="text-left bg-white border border-gray-200 rounded-xl p-4 hover:border-gray-300 shadow-sm transition">
                <p className="text-2xl font-bold text-gray-900 tabular-nums">{kpis?.openBills?.value ?? 0}</p>
                <p className="text-xs text-gray-500 mt-1">Open bills</p>
              </button>
              <button type="button" onClick={() => router.push(panelPath('/admin/bills', '/cashier/bills'))} className="text-left bg-white border border-gray-200 rounded-xl p-4 hover:border-gray-300 shadow-sm transition">
                <p className="text-2xl font-bold text-violet-700 tabular-nums">{kpis?.reopenedBills?.value ?? 0}</p>
                <p className="text-xs text-gray-500 mt-1">Reopened in POS</p>
              </button>
              <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                <p className="text-2xl font-bold text-indigo-700 tabular-nums truncate">{formatCurrency(kpis?.creditOutstanding?.value || 0)}</p>
                <p className="text-xs text-gray-500 mt-1">Credit outstanding today</p>
              </div>
              <div className="bg-white border border-cyan-100 rounded-xl p-4 shadow-sm col-span-2 sm:col-span-1">
                <p className="text-2xl font-bold text-cyan-700 tabular-nums">
                  {occupiedTables.length}
                  <span className="text-base font-medium text-gray-400"> / {tables.length || kpis?.occupiedTables?.total || 0}</span>
                </p>
                <p className="text-xs text-gray-500 mt-1">Running tables · {freeTables} available · {reservedTables.length} reserved</p>
              </div>
            </div>

            {(kpis?.refundsToday?.value > 0 || kpis?.discountsToday?.value > 0) && (
              <div className="flex flex-wrap gap-3 text-sm">
                {kpis?.refundsToday?.value > 0 && (
                  <div className="inline-flex items-center gap-2 rounded-lg bg-rose-50 text-rose-800 px-3 py-2 border border-rose-100">
                    <RotateCcw className="w-4 h-4" />
                    Refunds today: {formatCurrency(kpis.refundsToday.value)} ({kpis.refundsToday.count})
                  </div>
                )}
                {kpis?.discountsToday?.value > 0 && (
                  <div className="inline-flex items-center gap-2 rounded-lg bg-amber-50 text-amber-900 px-3 py-2 border border-amber-100">
                    Discounts today: {formatCurrency(kpis.discountsToday.value)}
                  </div>
                )}
              </div>
            )}

            {/* Sections 3 & 4 — Needs Attention beside Today's Activity.
                One grid row from lg up; the default items-stretch makes both
                cards the height of the taller one, and each list scrolls inside
                its own card, so 2 items next to 15 still reads as a row rather
                than one short card and one very long one. The cap keeps a busy
                day from pushing everything below the fold. */}
            <div className="grid lg:grid-cols-2 gap-4 lg:max-h-[520px]">
              <div className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 shadow-sm flex flex-col min-h-0">
                <div className="flex items-center gap-2 mb-4 shrink-0">
                  <AlertTriangle className="w-5 h-5 text-amber-500" />
                  <h2 className="text-base font-semibold text-gray-900">Needs Attention</h2>
                </div>
                {(stats?.needsAttention || []).length === 0 ? (
                  <div className="py-6 text-center">
                    <p className="text-sm font-medium text-emerald-700">All clear for now</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {occupiedTables.length
                        ? `${occupiedTables.length} table${occupiedTables.length === 1 ? '' : 's'} occupied · ${formatCurrency(floorAmount)} open on floor`
                        : isOpen
                          ? 'Floor is quiet — waiting for the next order.'
                          : 'Restaurant is closed. Open hours start at 7:00.'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1 flex-1 min-h-0 overflow-y-auto pr-1 max-h-[420px]">
                    {stats.needsAttention.map((item, i) => {
                      const meta = ATTENTION_META[item.type] || { icon: AlertTriangle, tone: 'text-gray-500 bg-gray-100' };
                      const Icon = meta.icon;
                      return (
                        <div key={i} className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
                          <div className={`p-1.5 rounded-lg shrink-0 ${meta.tone}`}><Icon className="w-4 h-4" /></div>
                          <p className="text-sm text-gray-700">{item.text}</p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 shadow-sm flex flex-col min-h-0">
                <h2 className="text-base font-semibold text-gray-900 mb-4 shrink-0">Today&apos;s Activity</h2>
                {(stats?.activity || []).length === 0 ? (
                  <div className="py-6 text-center">
                    <p className="text-sm font-medium text-gray-700">No activity logged yet today</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {onlineOrders.length
                        ? `${onlineOrders.length} online order${onlineOrders.length === 1 ? '' : 's'} waiting — open Online Orders.`
                        : occupiedTables.length
                          ? 'Guests are seated — sales and kitchen events will show up here as they happen.'
                          : 'Place an order in POS or accept an online order to kick things off.'}
                    </p>
                    <div className="mt-3 flex justify-center gap-2">
                      <button type="button" onClick={() => router.push(panelPath('/admin/pos', '/cashier/pos'))} className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white">Takeaway</button>
                      <button type="button" onClick={() => router.push(panelPath('/admin/business-days', '/cashier/business-days'))} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800">
                        <CalendarClock className="h-3.5 w-3.5" />
                        Opening & Closing
                      </button>
                      {onlineOrders.length > 0 && (
                        <button type="button" onClick={() => router.push(panelPath('/admin/orders/online', '/cashier/online-orders'))} className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800">Online orders</button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-0 flex-1 min-h-0 overflow-y-auto pr-1 max-h-[420px]">
                    {stats.activity.map((item, i) => {
                      const meta = ACTIVITY_META[item.type] || { icon: Sparkles, tone: 'text-gray-500 bg-gray-100' };
                      const Icon = meta.icon;
                      return (
                        <div key={i} className="flex items-start gap-3 py-2.5 border-b border-gray-50 last:border-0">
                          <div className={`p-1.5 rounded-lg shrink-0 ${meta.tone}`}><Icon className="w-4 h-4" /></div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-800">{item.text}</p>
                          </div>
                          <span className="text-xs text-gray-400 shrink-0 whitespace-nowrap">{item.atLabel}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Section 5 — Business Overview */}
            <div className="grid lg:grid-cols-2 gap-4">
              <div className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 shadow-sm">
                <h2 className="text-base font-semibold text-gray-900 mb-5">Revenue Trend</h2>
                {revenueTrend.every((d) => d.value === 0) ? (
                  <p className="text-sm text-gray-500 py-10 text-center">No sales yet this week.</p>
                ) : (
                  <TrendChart data={revenueTrend} color="blue" format="currency" height={180} />
                )}
              </div>

              <div className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 shadow-sm">
                <h2 className="text-base font-semibold text-gray-900 mb-5">Order Volume</h2>
                {orderVolume.every((d) => d.value === 0) ? (
                  <p className="text-sm text-gray-500 py-10 text-center">No orders yet this week.</p>
                ) : (
                  <TrendChart data={orderVolume} color="slate" format="number" height={180} />
                )}
              </div>
            </div>

            {/* Payment mix + hourly + top items */}
            <div className="grid lg:grid-cols-3 gap-4">
              <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
                <h2 className="text-base font-semibold text-gray-900 mb-4">Payment mix today</h2>
                {(stats?.paymentMix || []).length === 0 ? (
                  <p className="text-sm text-gray-500 py-6 text-center">No payments yet.</p>
                ) : (
                  <div className="space-y-3">
                    {stats.paymentMix.map((row) => (
                      <div key={row.method}>
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="font-medium text-gray-800 capitalize">{row.method}</span>
                          <span className="tabular-nums text-gray-600">{formatCurrency(row.total)} · {row.pct}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                          <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.min(100, row.pct)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
                <h2 className="text-base font-semibold text-gray-900 mb-4">Sales by hour</h2>
                {(stats?.hourlySales || []).every((h) => !h.value) ? (
                  <p className="text-sm text-gray-500 py-6 text-center">No hourly sales yet.</p>
                ) : (
                  <div className="flex items-end gap-1 h-36">
                    {(stats.hourlySales || []).map((h) => {
                      const max = Math.max(...(stats.hourlySales || []).map((x) => x.value), 1);
                      const pct = Math.max(4, Math.round((h.value / max) * 100));
                      return (
                        <div key={h.hour} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${h.label}: ${formatCurrency(h.value)}`}>
                          <div className="w-full rounded-t bg-emerald-500/80" style={{ height: `${pct}%` }} />
                          <span className="text-[9px] text-gray-400 truncate w-full text-center">{h.hour}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
                <h2 className="text-base font-semibold text-gray-900 mb-4">Top items today</h2>
                {(stats?.topItems || []).length === 0 ? (
                  <p className="text-sm text-gray-500 py-6 text-center">No item sales yet.</p>
                ) : (
                  <div className="space-y-2">
                    {stats.topItems.map((item, i) => (
                      <div key={`${item.name}-${i}`} className="flex items-center justify-between gap-2 py-1.5 border-b border-gray-50 last:border-0">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{i + 1}. {item.name}</p>
                          <p className="text-[11px] text-gray-400">{formatCurrency(item.revenue)}</p>
                        </div>
                        <span className="text-sm font-semibold tabular-nums text-gray-700 shrink-0">{item.qty}×</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Section 6 — Performance */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <div className="p-2 rounded-lg bg-amber-50"><Award className="w-4 h-4 text-amber-600" /></div>
                  <p className="text-xs font-medium text-gray-500">Top Selling Item</p>
                </div>
                {stats?.performance?.topItem ? (
                  <>
                    <p className="text-lg font-semibold text-gray-900 truncate">{stats.performance.topItem.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{stats.performance.topItem.qty} sold today</p>
                  </>
                ) : (
                  <p className="text-sm text-gray-400">No item sales yet today.</p>
                )}
              </div>

              {FEATURES.staffRoleLogin && (
                <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="p-2 rounded-lg bg-green-50"><Users className="w-4 h-4 text-green-600" /></div>
                    <p className="text-xs font-medium text-gray-500">Best Employee</p>
                  </div>
                  {stats?.performance?.bestEmployee ? (
                    <>
                      <p className="text-lg font-semibold text-gray-900 truncate">{stats.performance.bestEmployee.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{stats.performance.bestEmployee.orders} orders today</p>
                    </>
                  ) : (
                    <p className="text-sm text-gray-400">No orders logged to a waiter yet today.</p>
                  )}
                </div>
              )}

              {FEATURES.requiredTableAssignment && (
                <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="p-2 rounded-lg bg-cyan-50"><LayoutGrid className="w-4 h-4 text-cyan-600" /></div>
                    <p className="text-xs font-medium text-gray-500">Most Occupied Table</p>
                  </div>
                  {stats?.performance?.busiestTable ? (
                    <>
                      <p className="text-lg font-semibold text-gray-900 truncate">Table {stats.performance.busiestTable.table}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{stats.performance.busiestTable.orders} orders today</p>
                    </>
                  ) : (
                    <p className="text-sm text-gray-400">No table activity yet today.</p>
                  )}
                </div>
              )}
            </div>

            {/* Section 7 — Inventory Snapshot */}
            {(stats?.inventorySnapshot || []).length > 0 && (
              <div className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 shadow-sm">
                <div className="flex items-center justify-between gap-3 mb-4">
                  <h2 className="text-base font-semibold text-gray-900">Inventory Snapshot</h2>
                  <button
                    onClick={() => router.push(panelPath('/admin/inventory', '/cashier/inventory'))}
                    className="text-xs font-medium text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50"
                  >
                    View Inventory
                  </button>
                </div>
                <div className="space-y-1">
                  {stats.inventorySnapshot.map((item, i) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                      <div className="flex items-center gap-2.5">
                        <span className={`w-2 h-2 rounded-full ${item.status === 'out' ? 'bg-red-500' : 'bg-amber-500'}`} />
                        <span className="text-sm font-medium text-gray-800">{item.name}</span>
                      </div>
                      <span className={`text-sm font-semibold ${item.status === 'out' ? 'text-red-600' : 'text-amber-600'}`}>
                        {item.qty} {item.unit}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Section 8 — Reservation Snapshot */}
            {FEATURES.reservations && stats?.reservations && (
              <div className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 shadow-sm">
                <div className="flex items-center justify-between gap-3 mb-4">
                  <h2 className="text-base font-semibold text-gray-900">Reservation Snapshot</h2>
                  <button
                    onClick={() => router.push(panelPath('/admin/leads', '/cashier/reservations'))}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50"
                  >
                    <Inbox className="w-3.5 h-3.5" /> Open Host Desk
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="rounded-xl bg-blue-50 py-4">
                    <p className="text-2xl font-bold text-blue-700 tabular-nums">{stats.reservations.upcoming}</p>
                    <p className="text-xs text-blue-600 mt-1">Upcoming</p>
                  </div>
                  <div className="rounded-xl bg-amber-50 py-4">
                    <p className="text-2xl font-bold text-amber-700 tabular-nums">{stats.reservations.waiting}</p>
                    <p className="text-xs text-amber-600 mt-1">Waiting</p>
                  </div>
                  <div className="rounded-xl bg-gray-100 py-4">
                    <p className="text-2xl font-bold text-gray-700 tabular-nums">{stats.reservations.cancelled}</p>
                    <p className="text-xs text-gray-500 mt-1">Cancelled</p>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
