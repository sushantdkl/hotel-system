'use client';

import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import {
  Users, Package, FileText, Settings, DollarSign, ShoppingCart,
  LayoutDashboard, Warehouse, LayoutGrid, FolderOpen, Menu, X, Inbox, ChefHat, Wallet, Truck, Trash,
  Building2, ChevronDown, Ruler, Layers, TrendingUp, Activity,
  BookOpen, ScrollText, Coins, Landmark, CreditCard, ArrowRightLeft, Undo2, Receipt, Gauge, ClipboardCheck,
  BarChart3, Globe, ReceiptText, CalendarClock, BellRing, Calendar, History,
  PiggyBank, ShieldCheck, WalletCards, Bike, Contact, CalendarHeart, CalendarCheck2, Printer, BadgePercent, MessageSquareHeart, Banknote, Wine,
  Clock, Siren, CalendarX2, Cctv
} from 'lucide-react';
import LogoutButton from '@/components/ui/logout-button';
import CashCountGate from '@/components/cash-count/cash-count-gate';
import { isNavHidden } from '@/lib/deployment';
import { permissionForStaffPath } from '@/lib/staff-access-policy';
import { HOTEL_ROLE_HOME, WORKSPACES, WORKSPACE_STORAGE_KEY, isAdminLike, isHotelStaff } from '@/lib/roles';
import { HOTEL_PAGES } from '@/components/hotel/pages';
import GlobalSearch from '@/components/admin/global-search';

// Hotel staff may only open the hotel workspace (and the security desk) inside the admin shell.
function panelAllowed(role, pathname) {
  if (pathname === '/cashier' || pathname?.startsWith('/cashier/')) return role === 'cashier' || isAdminLike(role);
  if (isHotelStaff(role)) {
    if (pathname === '/admin/security' || pathname === '/admin/cctv') return role === 'watchman';
    return role !== 'watchman' && (pathname === '/admin/hotel' || Boolean(pathname?.startsWith('/admin/hotel/')));
  }
  return isAdminLike(role);
}

function readWorkspaceSync(role) {
  if (isHotelStaff(role)) return 'hotel';
  try {
    const saved = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    return WORKSPACES.some((w) => w.id === saved) ? saved : 'restaurant';
  } catch {
    return 'restaurant';
  }
}

// Short tone for new urgent/critical owner alerts. Browsers may block audio
// until the user has interacted with the page; the badge still shows.
function playAlertSound() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.2;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
  } catch { /* no audio available */ }
}

function readPanelAuthSync() {
  if (typeof window === 'undefined') return false;
  try {
    const token = localStorage.getItem('pos_token');
    const user = JSON.parse(localStorage.getItem('pos_user') || '{}');
    return Boolean(token && panelAllowed(user.role, window.location.pathname));
  } catch {
    return false;
  }
}

function readNavGroupsSync() {
  if (typeof window === 'undefined') return {};
  try {
    const saved = JSON.parse(localStorage.getItem('admin_nav_groups') || 'null');
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

function readNavScrollSync() {
  if (typeof window === 'undefined') return 0;
  try {
    return Number(sessionStorage.getItem('admin_nav_scroll') || '0') || 0;
  } catch {
    return 0;
  }
}

// Static, literal Tailwind classes (never templated) so the JIT compiler keeps them.
/**
 * One hue per nav group, spread around the colour wheel.
 *
 * The previous palette drew four of its tints from neighbouring hues (sky,
 * blue, indigo, purple). At a 50-level fill those are indistinguishable — every
 * band read as the same pale blue, so the grouping carried no information. The
 * hues below sit roughly 45-160 degrees apart:
 *
 *   amber 45  ·  lime 90  ·  emerald 160  ·  cyan 190
 *   indigo 240  ·  fuchsia 320  ·  rose 350
 *
 * The two closest remaining pairs (emerald/cyan and fuchsia/rose, ~30 apart)
 * are deliberately assigned to groups that sit far apart in the sidebar, so
 * they are never adjacent bands. Fills are 100 rather than 50 and headers are
 * 800 rather than 700, so the bands are actually visible.
 *
 * GROUP_TINTS below is the single source of truth — both roles' navs read from
 * it, so a group keeps its colour wherever it appears.
 */
const NAV_TINTS = {
  amber: { bg: 'bg-amber-100', header: 'text-amber-800', activeBg: 'bg-amber-200', activeBorder: 'border-amber-600', hover: 'hover:bg-amber-200/70' },
  lime: { bg: 'bg-lime-100', header: 'text-lime-800', activeBg: 'bg-lime-200', activeBorder: 'border-lime-600', hover: 'hover:bg-lime-200/70' },
  emerald: { bg: 'bg-emerald-100', header: 'text-emerald-800', activeBg: 'bg-emerald-200', activeBorder: 'border-emerald-600', hover: 'hover:bg-emerald-200/70' },
  cyan: { bg: 'bg-cyan-100', header: 'text-cyan-800', activeBg: 'bg-cyan-200', activeBorder: 'border-cyan-600', hover: 'hover:bg-cyan-200/70' },
  indigo: { bg: 'bg-indigo-100', header: 'text-indigo-800', activeBg: 'bg-indigo-200', activeBorder: 'border-indigo-600', hover: 'hover:bg-indigo-200/70' },
  fuchsia: { bg: 'bg-fuchsia-100', header: 'text-fuchsia-800', activeBg: 'bg-fuchsia-200', activeBorder: 'border-fuchsia-600', hover: 'hover:bg-fuchsia-200/70' },
  rose: { bg: 'bg-rose-100', header: 'text-rose-800', activeBg: 'bg-rose-200', activeBorder: 'border-rose-600', hover: 'hover:bg-rose-200/70' },
};

/** Group label -> hue. Shared by every role's nav so colours never disagree. */
const GROUP_TINTS = {
  Menu: 'amber',
  Ledgers: 'rose',
  Operations: 'cyan',
  Inventory: 'lime',
  Records: 'lime',
  Finance: 'indigo',
  'Cash & Credit': 'indigo',
  HRM: 'fuchsia',
  Accounting: 'emerald',
  Reports: 'indigo',
};

export default function AdminLayout({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isCashierPanel = pathname === '/cashier' || pathname?.startsWith('/cashier/');
  // Always start loading=true so SSR HTML matches the client's first paint.
  // Reading localStorage in useState() made the client skip the spinner while
  // the server still rendered it Ã¢â€ â€™ hydration mismatch.
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [backdropReady, setBackdropReady] = useState(false);
  const [leadsBadge, setLeadsBadge] = useState(0);
  const [ordersBadge, setOrdersBadge] = useState(0);
  const [waiterCallsBadge, setWaiterCallsBadge] = useState(0);
  const [alertsBadge, setAlertsBadge] = useState(0);
  const [notificationsBadge, setNotificationsBadge] = useState(0);
  const lastAlertIdRef = useRef(null);
  const [capabilities, setCapabilities] = useState(null);
  const [panelRole, setPanelRole] = useState(null);
  const [workspace, setWorkspace] = useState('restaurant');
  const [openGroups, setOpenGroups] = useState({});
  const openLockRef = useRef(false);
  const navScrollRef = useRef(null);
  const navScrollRestoredRef = useRef(false);

  /*
   * Resolve auth + nav prefs before paint (avoids a spinner flash without
   * disagreeing with the server HTML).
   *
   * This one keeps its setState-in-effect deliberately. Lazy useState() was
   * tried here and caused a hydration mismatch — see the note on the `loading`
   * declaration above, which exists because of that bug. useSyncExternalStore
   * would be mismatch-free but its post-hydration update is not guaranteed to
   * land before paint, which reintroduces the flash this effect removes.
   * useLayoutEffect is the tool that satisfies both constraints.
   */
  useLayoutEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- deliberate: see comment above */
    const savedGroups = readNavGroupsSync();
    const firstOpen = Object.keys(savedGroups).find((key) => savedGroups[key] === true);
    setOpenGroups(firstOpen ? { [firstOpen]: true } : {});
    try { setWorkspace(readWorkspaceSync(JSON.parse(localStorage.getItem('pos_user') || '{}').role)); } catch { /* ignore */ }
    if (readPanelAuthSync()) setLoading(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const toggleGroup = (label) => {
    setOpenGroups((prev) => {
      // Accordion navigation: at most one topic can be expanded at a time.
      const next = prev[label] ? {} : { [label]: true };
      try {
        localStorage.setItem('admin_nav_groups', JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const isPosRoute = pathname === '/admin/pos' || pathname?.startsWith('/admin/pos/')
    || pathname === '/cashier/pos' || pathname?.startsWith('/cashier/pos/');
  const isWideWorkspaceRoute = isPosRoute || pathname === '/admin/reports/compare' || pathname === '/cashier/reports/compare';

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const apply = (event) => {
      const desktop = event && typeof event.matches === 'boolean' ? event.matches : mq.matches;
      setIsDesktop(desktop);
      if (desktop) {
        const onWideWorkspace = window.location.pathname.startsWith('/admin/pos')
          || window.location.pathname.startsWith('/cashier/pos')
          || window.location.pathname === '/admin/reports/compare'
          || window.location.pathname === '/cashier/reports/compare';
        if (onWideWorkspace) {
          setSidebarOpen(false);
        } else {
          const saved = localStorage.getItem('admin_sidebar_open');
          setSidebarOpen(saved !== null ? saved === 'true' : true);
        }
      } else {
        setSidebarOpen(false);
      }
    };
    apply();
    mq.addEventListener('change', apply);

    /*
     * Auth gate. Deferred into a microtask rather than run synchronously in the
     * effect body: it either redirects or clears the spinner, and neither is
     * state derived from props, so there is nothing to compute during render.
     * `cancelled` stops a redirect firing after the layout has unmounted.
     */
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      const token = localStorage.getItem('pos_token');
      let user = {};
      try { user = JSON.parse(localStorage.getItem('pos_user') || '{}'); } catch { user = {}; }
      if (!token) router.push('/login');
      else if (!panelAllowed(user.role, window.location.pathname)) router.push(HOTEL_ROLE_HOME[user.role] || '/login');
      else {
        setPanelRole(user.role);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      mq.removeEventListener('change', apply);
    };
  }, [router, isCashierPanel]);

  useEffect(() => {
    if (loading) return undefined;
    let cancelled = false;
    const refreshCapabilities = () => {
      const token = localStorage.getItem('pos_token');
      if (!token) return;
      fetch('/api/auth/capabilities', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
        .then((res) => res.ok ? res.json() : null)
        .then((data) => { if (!cancelled) setCapabilities(data?.capabilities || {}); })
        .catch(() => { if (!cancelled) setCapabilities({}); });
    };

    refreshCapabilities();
    window.addEventListener('focus', refreshCapabilities);
    const refreshTimer = window.setInterval(refreshCapabilities, 60_000);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refreshCapabilities);
      window.clearInterval(refreshTimer);
    };
  }, [loading, pathname]);

  // Wide workspaces start on the compact rail without overwriting the user's
  // normal sidebar preference. The user can still expand it when needed.
  useEffect(() => {
    if (!isDesktop) return undefined;
    // Deferred out of the effect body: this reacts to a route change, it does
    // not derive render output, so it does not belong in the render pass.
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      if (isWideWorkspaceRoute) {
        setSidebarOpen(false);
        return;
      }
      const saved = localStorage.getItem('admin_sidebar_open');
      setSidebarOpen(saved !== null ? saved === 'true' : true);
    });
    return () => { cancelled = true; };
  }, [isWideWorkspaceRoute, isDesktop]);

  useEffect(() => {
    if (loading) return undefined;
    let cancelled = false;
    const fetchCounts = async () => {
      try {
        const token = localStorage.getItem('pos_token');
        if (!token) return;
        const user = JSON.parse(localStorage.getItem('pos_user') || '{}');
        if (isHotelStaff(user.role)) return;
        // New website (online) orders Ã¢â‚¬â€ pending WEB-* orders.
        try {
          const oRes = await fetch('/api/admin/orders?status=pending&pageSize=100', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (oRes.ok) {
            const oData = await oRes.json();
            const n = (oData.orders || oData.data || []).filter((o) =>
              String(o.order_number || '').startsWith('WEB-')
            ).length;
            if (!cancelled) setOrdersBadge(n);
          }
        } catch { /* ignore */ }
        // Cashiers are not authorised for reservation/lead badges. Shared
        // navigation should not repeatedly call endpoints that must reject them.
        if (user.role !== 'admin') return;
        const res = await fetch('/api/admin/reservations/alerts', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) {
          // fallback counts
          const cRes = await fetch('/api/admin/leads/counts', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!cRes.ok || cancelled) return;
          const data = await cRes.json();
          const n = Number(data?.counts?.new_total || 0);
          const soon = Number(data?.counts?.arriving_soon || 0);
          setLeadsBadge(n + soon);
          return;
        }
        const data = await res.json();
        const alertN = (data.alerts || []).filter((a) =>
          ['arriving_soon', 'late', 'no_show_candidate', 'arrived', 'vip_arrived'].includes(a.type)
        ).length;
        const cRes = await fetch('/api/admin/leads/counts', {
          headers: { Authorization: `Bearer ${token}` },
        });
        let newTotal = 0;
        if (cRes.ok) {
          const c = await cRes.json();
          newTotal = Number(c?.counts?.new_total || 0);
        }
        if (!cancelled) setLeadsBadge(newTotal + alertN);
      } catch {
        /* ignore */
      }
    };
    fetchCounts();
    const t = setInterval(fetchCounts, 60000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [loading, pathname]);

  useEffect(() => {
    if (loading) return undefined;
    let cancelled = false;
    const fetchWaiterCalls = async () => {
      try {
        const token = localStorage.getItem('pos_token');
        if (!token) return;
        if (isHotelStaff(JSON.parse(localStorage.getItem('pos_user') || '{}').role)) return;
        const response = await fetch('/api/waiter-requests?status=active&limit=1', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok || cancelled) return;
        const data = await response.json();
        if (!cancelled) setWaiterCallsBadge(Number(data?.counts?.active || 0));
      } catch { /* badge polling should never block navigation */ }
    };
    fetchWaiterCalls();
    const timer = setInterval(fetchWaiterCalls, 15000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [loading, pathname]);

  // Everyone: unread staff notifications (task assignments, tickets).
  useEffect(() => {
    if (loading) return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch('/api/notifications', { headers: { Authorization: `Bearer ${localStorage.getItem('pos_token')}` }, cache: 'no-store' });
        if (response.ok && !cancelled) setNotificationsBadge(Number((await response.json()).unread || 0));
      } catch { /* polling never blocks navigation */ }
    };
    poll();
    const timer = setInterval(poll, 30000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [loading]);

  // Owner: poll manager escalations; sound once per new urgent/critical alert.
  useEffect(() => {
    if (loading || panelRole !== 'admin') return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const token = localStorage.getItem('pos_token');
        const response = await fetch('/api/alerts', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
        if (!response.ok || cancelled) return;
        const data = await response.json();
        setAlertsBadge(Number(data.open || 0));
        const newest = (data.alerts || []).filter((a) => a.status === 'open').sort((a, b) => b.id - a.id)[0];
        if (newest && lastAlertIdRef.current !== null && newest.id > lastAlertIdRef.current && ['urgent', 'critical'].includes(newest.severity)) playAlertSound();
        lastAlertIdRef.current = Math.max(lastAlertIdRef.current || 0, newest?.id || 0);
      } catch { /* polling never blocks navigation */ }
    };
    poll();
    const timer = setInterval(poll, 20000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [loading, panelRole]);

  // Delay backdrop so the opening tap does not immediately close the menu
  useEffect(() => {
    /*
     * The backdrop starts hidden every time this runs, so `false` is simply the
     * value for the current inputs rather than something to set from an effect
     * — it is derived below with useMemo-free arithmetic and only the delayed
     * `true` needs a timer. That removes the synchronous setState that used to
     * queue a second render on every sidebar toggle.
     */
    if (!(sidebarOpen && !isDesktop)) {
      openLockRef.current = false;
      return undefined;
    }
    openLockRef.current = true;
    const t = setTimeout(() => {
      setBackdropReady(true);
      openLockRef.current = false;
    }, 180);
    // Reset on cleanup, so the next open gets the full 180ms delay again.
    // (Deriving `false` without this left the flag true after a close, which
    // made the backdrop live immediately on the following open — the exact tap
    // race the delay exists to prevent.)
    return () => {
      clearTimeout(t);
      setBackdropReady(false);
      openLockRef.current = false;
    };
  }, [sidebarOpen, isDesktop]);

  // `backdropReady` only ever means "the open animation has finished". While the
  // sidebar is closed, or on desktop, it is false by definition — derived here
  // instead of pushed in by the effect above.
  const backdropVisible = sidebarOpen && !isDesktop && backdropReady;

  const openSidebar = useCallback(() => {
    setSidebarOpen(true);
  }, []);

  const closeMobileSidebar = useCallback(() => {
    if (openLockRef.current) return;
    setSidebarOpen(false);
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => {
      const next = !prev;
      // Don't persist a wide workspace's forced-collapse over the user's choice.
      const onWideWorkspace = typeof window !== 'undefined' && (
        window.location.pathname.startsWith('/admin/pos')
        || window.location.pathname.startsWith('/cashier/pos')
        || window.location.pathname === '/admin/reports/compare'
        || window.location.pathname === '/cashier/reports/compare'
      );
      if (typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches && !onWideWorkspace) {
        localStorage.setItem('admin_sidebar_open', String(next));
      }
      return next;
    });
  }, []);

  // Persist the sidebar scroll position across page remounts. Each admin page
  // wraps its own AdminLayout, so the nav unmounts on navigation Ã¢â‚¬â€ we restore
  // instantly via callback ref (before paint) so it never jumps to the top.
  const saveNavScroll = useCallback(() => {
    const top = navScrollRef.current?.scrollTop ?? 0;
    try {
      sessionStorage.setItem('admin_nav_scroll', String(top));
    } catch {
      /* ignore */
    }
  }, []);

  const attachNavScroll = useCallback((el) => {
    navScrollRef.current = el;
    if (!el || navScrollRestoredRef.current) return;
    const saved = readNavScrollSync();
    if (saved > 0) el.scrollTop = saved;
    navScrollRestoredRef.current = true;
  }, []);

  useLayoutEffect(() => {
    const el = navScrollRef.current;
    if (!el) return;
    const saved = readNavScrollSync();
    if (saved <= 0) return;
    // Cashier entries arrive after the capability request. Restoring before
    // they render makes the browser clamp the position to zero.
    const frame = window.requestAnimationFrame(() => {
      if (Math.abs(el.scrollTop - saved) > 1) el.scrollTop = saved;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pathname, sidebarOpen, isDesktop, capabilities]);

  const navigate = (href) => {
    saveNavScroll();
    router.push(href, { scroll: false });
    if (!isDesktop) setSidebarOpen(false);
  };

  const chooseWorkspace = (id) => {
    setWorkspace(id);
    try { localStorage.setItem(WORKSPACE_STORAGE_KEY, id); } catch { /* ignore */ }
    navigate(WORKSPACES.find((w) => w.id === id).home);
  };

  const handleLogout = () => {
    localStorage.removeItem('pos_token');
    localStorage.removeItem('pos_user');
    router.push('/login');
  };

  // Grouped nav. Standalone entries (Dashboard, Settings) have no `items`.
  // Add new modules by dropping an entry into the relevant group Ã¢â‚¬â€ no layout rewrite.
  // `scope` (one workspace or a list) limits an entry to the restaurant, hotel
  // or combined workspace; unscoped entries (alerts, finance, HR, settings)
  // appear in all three.
  const hotelEntries = [
    ...HOTEL_PAGES.map((p) => ({ icon: p.icon, label: p.label, href: p.href, color: 'text-emerald-700', requiredPermission: p.permission })),
    { icon: ShieldCheck, label: 'Security desk', href: '/admin/security', color: 'text-stone-700' },
  ];
  const adminNavGroups = [
    { icon: Gauge, label: 'Control center', href: '/admin/control-center', color: 'text-gray-900', scope: 'combined' },
    { icon: FileText, label: 'Combined report', href: '/admin/overview', color: 'text-gray-700', scope: 'combined' },
    { icon: Siren, label: panelRole === 'admin' ? 'Owner alerts' : 'Alert owner', href: '/admin/alerts', color: 'text-red-600', badge: alertsBadge },
    { icon: Clock, label: 'My HR & notifications', href: '/staff', color: 'text-sky-700', badge: notificationsBadge },
    { icon: FileText, label: 'Business report', href: '/admin/business-report', color: 'text-indigo-700' },
    ...hotelEntries.map((entry) => ({ ...entry, scope: 'hotel' })),
    { icon: Cctv, label: 'CCTV', href: '/admin/cctv', color: 'text-gray-900' },
    // Combined: each business's day-to-day pages sit in one collapsible group.
    { label: 'Hotel', scope: 'combined', tint: 'emerald', items: hotelEntries },
    {
      label: 'Restaurant',
      scope: 'combined',
      tint: 'amber',
      items: [
        { icon: LayoutDashboard, label: 'Restaurant dashboard', href: '/admin/dashboard', color: 'text-gray-600' },
        { icon: Receipt, label: 'POS', href: '/admin/pos', color: 'text-emerald-700' },
        { icon: ReceiptText, label: 'Bills', href: '/admin/bills', color: 'text-emerald-600' },
        { icon: ShoppingCart, label: 'Orders', href: '/admin/orders', color: 'text-orange-600' },
        { icon: Inbox, label: 'Online Orders', href: '/admin/orders/online', color: 'text-amber-600', badge: ordersBadge },
        { icon: LayoutGrid, label: 'Tables', href: '/admin/tables', color: 'text-cyan-600' },
        { icon: ChefHat, label: 'KOT', href: '/admin/kot', color: 'text-amber-600' },
        { icon: Package, label: 'Menu', href: '/admin/products', color: 'text-blue-600' },
        { icon: DollarSign, label: 'Sales Report', href: '/admin/reports', color: 'text-emerald-700', requiredPermission: 'reports.view' },
        { icon: BarChart3, label: 'Analytics', href: '/admin/analytics', color: 'text-indigo-600' },
        { icon: ScrollText, label: 'Summary', href: '/admin/summary-report', color: 'text-rose-700' },
        { icon: Users, label: 'Customers', href: '/admin/customers', color: 'text-pink-600' },
      ],
    },
    { icon: LayoutDashboard, label: 'Restaurant dashboard', href: '/admin/dashboard', color: 'text-gray-600', scope: 'restaurant' },
    { icon: Receipt, label: 'POS', href: '/admin/pos', color: 'text-emerald-700', scope: 'restaurant' },
    { icon: BarChart3, label: 'Analytics', href: '/admin/analytics', color: 'text-indigo-600', scope: 'restaurant' },
    { icon: ScrollText, label: 'Summary', href: '/admin/summary-report', color: 'text-rose-700', scope: 'restaurant' },
    {
      label: 'Reports',
      scope: 'restaurant',
      tint: 'indigo',
      requiredPermission: 'reports.view',
      items: [
        { icon: DollarSign, label: 'Sales Report', href: '/admin/reports', color: 'text-emerald-700' },
        { icon: Wallet, label: 'Finance Report', href: '/admin/reports?tab=finance', color: 'text-indigo-700' },
        { icon: ReceiptText, label: 'Expenses Report', href: '/admin/reports?tab=expenses', color: 'text-rose-700' },
        { icon: ShoppingCart, label: 'Purchases Report', href: '/admin/reports?tab=purchases', color: 'text-amber-700' },
        { icon: Truck, label: 'Suppliers Report', href: '/admin/reports?tab=suppliers', color: 'text-slate-700' },
        { icon: ClipboardCheck, label: 'Orders Report', href: '/admin/reports?tab=orders', color: 'text-cyan-700' },
        { icon: Undo2, label: 'Cancellations & Changes Report', href: '/admin/reports?tab=changes', color: 'text-red-700' },
        { icon: Warehouse, label: 'Inventory Report', href: '/admin/reports?tab=inventory', color: 'text-lime-700' },
        { icon: Users, label: 'Employees Report', href: '/admin/reports?tab=employees', color: 'text-fuchsia-700' },
        { icon: LayoutGrid, label: 'Tables Report', href: '/admin/reports?tab=tables', color: 'text-sky-700' },
        { icon: Calendar, label: 'Reservations Report', href: '/admin/reports?tab=reservations', color: 'text-violet-700' },
        { icon: ChefHat, label: 'Menu Report', href: '/admin/reports?tab=menu', color: 'text-orange-700' },
        { icon: Layers, label: 'Category Report', href: '/admin/reports?tab=categories', color: 'text-teal-700' },
        { icon: Wine, label: 'Category Sales & Stock', href: '/admin/category-sales', color: 'text-rose-700' },
        { icon: Contact, label: 'Customers Report', href: '/admin/reports?tab=customers', color: 'text-pink-700' },
        { icon: History, label: 'Previous-day Activity', href: '/admin/previous-day-activity', color: 'text-indigo-700' },
        { icon: ArrowRightLeft, label: 'Compare Reports', href: '/admin/reports/compare', color: 'text-indigo-700' },
      ],
    },
    {
      label: 'Menu',
      scope: 'restaurant',
      tint: 'amber',
      items: [
        { icon: Package, label: 'Menu', href: '/admin/products', color: 'text-blue-600' },
        { icon: FolderOpen, label: 'Categories', href: '/admin/categories', color: 'text-purple-600' },
        { icon: BadgePercent, label: 'Offers & Discounts', href: '/admin/promotions', color: 'text-rose-600' },
        { icon: Layers, label: 'Combo Packs', href: '/admin/combos', color: 'text-orange-600' },
        { icon: ChefHat, label: 'Recipes', href: '/admin/recipes', color: 'text-rose-600' },
      ],
    },
    {
      label: 'Operations',
      scope: 'restaurant',
      tint: 'cyan',
      items: [
        { icon: LayoutGrid, label: 'Tables', href: '/admin/tables', color: 'text-cyan-600' },
        { icon: ReceiptText, label: 'Bills', href: '/admin/bills', color: 'text-emerald-600' },
        { icon: ChefHat, label: 'KOT', href: '/admin/kot', color: 'text-amber-600' },
        { icon: ShieldCheck, label: 'Cancelled KOT approval', href: '/admin/cancellations', color: 'text-red-700' },
        { icon: ShoppingCart, label: 'Orders', href: '/admin/orders', color: 'text-orange-600' },
        { icon: Bike, label: 'Delivery Executives', href: '/admin/delivery', color: 'text-lime-600' },
        { icon: BellRing, label: 'Waiter Calls', href: '/admin/waiter-requests', color: 'text-amber-700', badge: waiterCallsBadge },
        { icon: Inbox, label: 'Host desk', href: '/admin/leads', color: 'text-amber-600', badge: leadsBadge },
        { icon: MessageSquareHeart, label: 'Customer Reviews', href: '/admin/reviews', color: 'text-rose-600' },
        { icon: Inbox, label: 'Online Orders', href: '/admin/orders/online', color: 'text-amber-600', badge: ordersBadge },
        { icon: Layers, label: 'Table Management', href: '/admin/table-management', color: 'text-sky-600' },
        { icon: Activity, label: 'Kitchen Analytics', href: '/admin/kitchen-analytics', color: 'text-orange-600' },
      ],
    },
    { icon: Users, label: 'Customers', href: '/admin/customers', color: 'text-pink-600', scope: 'restaurant' },
    { icon: BellRing, label: 'Reminders', href: '/admin/reminders', color: 'text-green-600', scope: 'restaurant' },
    { icon: Receipt, label: 'Customer Ledger', href: '/admin/accounts-receivable', color: 'text-teal-700', scope: ['restaurant', 'combined'] },
    { icon: Receipt, label: 'Supplier Ledger', href: '/admin/accounts-payable', color: 'text-orange-700', scope: ['restaurant', 'combined'] },
    {
      label: 'Inventory',
      scope: ['restaurant', 'combined'],
      tint: 'lime',
      items: [
        { icon: Gauge, label: 'Inventory Report', href: '/admin/inventory/dashboard', color: 'text-indigo-700' },
        { icon: ClipboardCheck, label: 'Stock movements', href: '/admin/inventory/movements', color: 'text-indigo-700' },
        { icon: Warehouse, label: 'Inventory', href: '/admin/inventory', color: 'text-indigo-600' },
        { icon: Truck, label: 'Purchases', href: '/admin/purchases', color: 'text-teal-600' },
        { icon: FolderOpen, label: 'Inventory Categories', href: '/admin/inventory-categories', color: 'text-violet-600' },
        { icon: Ruler, label: 'Unit Conversion', href: '/admin/unit-conversion', color: 'text-sky-600' },
        { icon: Building2, label: 'Suppliers', href: '/admin/suppliers', color: 'text-slate-600' },
        { icon: Trash, label: 'Wastage', href: '/admin/wastage', color: 'text-red-600' },
      ],
    },
    {
      label: 'Finance',
      tint: 'indigo',
      items: [
        { icon: Wallet, label: 'Expenses', href: '/admin/expenses', color: 'text-emerald-600' },
        { icon: PiggyBank, label: 'Business Funding', href: '/admin/business-funding', color: 'text-violet-700' },
        { icon: PiggyBank, label: 'Savings & Deposits', href: '/admin/savings', color: 'text-sky-700' },
        { icon: FolderOpen, label: 'Expense Categories', href: '/admin/expense-categories', color: 'text-emerald-700' },
        { icon: ArrowRightLeft, label: 'Cash Exchange', href: '/admin/cash-exchange', color: 'text-amber-600' },
      ],
    },
    {
      label: 'Accounting',
      tint: 'emerald',
      items: [
        { icon: CalendarClock, label: 'Opening & Closing', href: '/admin/business-days', color: 'text-emerald-700' },
        { icon: Banknote, label: 'Scheduled Cash Counts', href: '/admin/cash-counts', color: 'text-emerald-700' },
        { icon: Gauge, label: 'Finance Dashboard', href: '/admin/finance-dashboard', color: 'text-gray-900' },
        { icon: BookOpen, label: 'Chart of Accounts', href: '/admin/chart-of-accounts', color: 'text-indigo-600' },
        { icon: ScrollText, label: 'General Ledger', href: '/admin/general-ledger', color: 'text-slate-600' },
        { icon: Coins, label: 'Cash Book', href: '/admin/cash-book', color: 'text-yellow-600' },
        { icon: Landmark, label: 'Bank Book', href: '/admin/bank-book', color: 'text-blue-600' },
        { icon: ClipboardCheck, label: 'Bank Reconciliation', href: '/admin/bank-reconciliation', color: 'text-cyan-700' },
        { icon: Wallet, label: 'Cash Drawer', href: '/admin/cash-drawer', color: 'text-orange-600' },
        { icon: Landmark, label: 'Bank', href: '/admin/bank', color: 'text-teal-600' },
        { icon: FileText, label: 'Financial Reports', href: '/admin/financial-reports', color: 'text-indigo-700' },
        { icon: Undo2, label: 'Corrections', href: '/admin/corrections', color: 'text-amber-700' },
      ],
    },
    {
      label: 'HRM',
      tint: 'fuchsia',
      items: [
        { icon: Building2, label: 'Departments', href: '/admin/hrm/departments', color: 'text-pink-600' },
        { icon: Contact, label: 'Designations', href: '/admin/hrm/designations', color: 'text-pink-600' },
        { icon: Users, label: 'Staff', href: '/admin/employees', color: 'text-green-600' },
        { icon: CalendarCheck2, label: 'Attendance', href: '/admin/hrm/attendance', color: 'text-sky-600' },
        { icon: CalendarX2, label: 'Leave & clock-ins', href: '/admin/hrm/leave', color: 'text-amber-700' },
        { icon: WalletCards, label: 'Attendance payroll', href: '/admin/hrm/payroll-attendance', color: 'text-emerald-700' },
        { icon: WalletCards, label: 'Payroll', href: '/admin/payroll', color: 'text-emerald-700' },
        { icon: CalendarHeart, label: 'Holidays', href: '/admin/hrm/holidays', color: 'text-rose-600' },
        { icon: TrendingUp, label: 'Staff Performance', href: '/admin/employee-performance', color: 'text-lime-600' },
      ],
    },
    { icon: Globe, label: 'Website CMS', href: '/admin/cms', color: 'text-sky-600', scope: ['restaurant', 'combined'] },
    { icon: ShieldCheck, label: 'Staff Roles & Permissions', href: '/admin/permissions', color: 'text-red-600' },
    { icon: Printer, label: 'Printer', href: '/admin/printer', color: 'text-violet-700', scope: ['restaurant', 'combined'] },
    { icon: Settings, label: 'Settings', href: '/admin/settings', color: 'text-gray-600' },
  ];

  const cashierNavGroups = [
    { icon: LayoutDashboard, label: 'Dashboard', href: '/cashier/dashboard', color: 'text-gray-600', requiredPermission: 'dashboard.view' },
    { icon: Clock, label: 'My HR & notifications', href: '/staff', color: 'text-sky-700', badge: notificationsBadge },
    { icon: Receipt, label: 'POS', href: '/cashier/pos', color: 'text-emerald-700', requiredPermission: 'pos.access' },
    { icon: ShoppingCart, label: 'Order Desk', href: '/cashier', color: 'text-orange-600', requiredPermission: 'order_desk.access' },
    {
      label: 'Reports',
      tint: 'indigo',
      requiredPermission: 'reports.view',
      items: [
        { icon: DollarSign, label: 'Sales Report', href: '/cashier/reports', color: 'text-emerald-700', requiredPermission: 'report.sales.view' },
        { icon: Wallet, label: 'Finance Report', href: '/cashier/reports?tab=finance', color: 'text-indigo-700', requiredPermission: 'report.finance.view' },
        { icon: ReceiptText, label: 'Expenses Report', href: '/cashier/reports?tab=expenses', color: 'text-rose-700', requiredPermission: 'report.expenses.view' },
        { icon: ShoppingCart, label: 'Purchases Report', href: '/cashier/reports?tab=purchases', color: 'text-amber-700', requiredPermission: 'report.purchases.view' },
        { icon: Truck, label: 'Suppliers Report', href: '/cashier/reports?tab=suppliers', color: 'text-slate-700', requiredPermission: 'report.suppliers.view' },
        { icon: ClipboardCheck, label: 'Orders Report', href: '/cashier/reports?tab=orders', color: 'text-cyan-700', requiredPermission: 'report.orders.view' },
        { icon: Undo2, label: 'Cancellations & Changes Report', href: '/cashier/reports?tab=changes', color: 'text-red-700', requiredPermission: 'report.changes.view' },
        { icon: Warehouse, label: 'Inventory Report', href: '/cashier/reports?tab=inventory', color: 'text-lime-700', requiredPermission: 'report.inventory.view' },
        { icon: Users, label: 'Employees Report', href: '/cashier/reports?tab=employees', color: 'text-fuchsia-700', requiredPermission: 'report.employees.view' },
        { icon: LayoutGrid, label: 'Tables Report', href: '/cashier/reports?tab=tables', color: 'text-sky-700', requiredPermission: 'report.tables.view' },
        { icon: Calendar, label: 'Reservations Report', href: '/cashier/reports?tab=reservations', color: 'text-violet-700', requiredPermission: 'report.reservations.view' },
        { icon: ChefHat, label: 'Menu Report', href: '/cashier/reports?tab=menu', color: 'text-orange-700', requiredPermission: 'report.menu.view' },
        { icon: Layers, label: 'Category Report', href: '/cashier/reports?tab=categories', color: 'text-teal-700', requiredPermission: 'report.categories.view' },
        { icon: Wine, label: 'Category Sales & Stock', href: '/cashier/category-sales', color: 'text-rose-700', requiredPermission: 'report.categories.view' },
        { icon: Contact, label: 'Customers Report', href: '/cashier/reports?tab=customers', color: 'text-pink-700', requiredPermission: 'report.customers.view' },
        { icon: History, label: 'Previous-day Activity', href: '/cashier/previous-day-activity', color: 'text-indigo-700', requiredPermission: 'report.previous_day.view' },
        { icon: ArrowRightLeft, label: 'Compare Reports', href: '/cashier/reports/compare', color: 'text-indigo-700', requiredPermission: 'reports.view' },
      ],
    },
    {
      label: 'Menu',
      tint: 'amber',
      items: [
        { icon: Package, label: 'Menu', href: '/cashier/menu-items', color: 'text-blue-600', requiredPermission: 'menu.manage' },
        { icon: FolderOpen, label: 'Categories', href: '/cashier/categories', color: 'text-purple-600', requiredPermission: 'menu.manage' },
        { icon: BadgePercent, label: 'Offers & Discounts', href: '/cashier/promotions', color: 'text-rose-600', requiredPermission: 'promotions.manage' },
        { icon: Layers, label: 'Combo Packs', href: '/cashier/combos', color: 'text-orange-600', requiredPermission: 'combos.manage' },
        { icon: ChefHat, label: 'Recipes', href: '/cashier/recipes', color: 'text-rose-600', requiredPermission: 'menu.manage' },
      ],
    },
    { icon: BarChart3, label: 'Analytics', href: '/cashier/analytics', color: 'text-indigo-600', requiredPermission: 'analytics.view' },
    { icon: ScrollText, label: 'Summary', href: '/cashier/summary-report', color: 'text-rose-700', requiredPermission: 'summary.view' },
    {
      label: 'Operations',
      tint: 'cyan',
      items: [
        { icon: LayoutGrid, label: 'Tables', href: '/cashier/tables', color: 'text-cyan-600', requiredPermission: 'tables.manage' },
        { icon: ReceiptText, label: 'Bills', href: '/cashier/bills', color: 'text-emerald-600', requiredPermission: 'bills.access' },
        { icon: ChefHat, label: 'KOT', href: '/cashier/kots', color: 'text-amber-600', requiredPermission: 'kot_history.access' },
        { icon: CreditCard, label: 'Payments', href: '/cashier/payment-history', color: 'text-blue-600', requiredPermission: 'payments.access' },
        { icon: Bike, label: 'Delivery Executives', href: '/cashier/delivery', color: 'text-lime-600', requiredPermission: 'delivery.manage' },
        { icon: BellRing, label: 'Waiter Calls', href: '/cashier/waiter-requests', color: 'text-amber-700', badge: waiterCallsBadge, requiredPermission: 'waiter_calls.access' },
        { icon: Inbox, label: 'Host desk', href: '/cashier/leads', color: 'text-amber-600', requiredPermission: 'host_desk.manage' },
        { icon: MessageSquareHeart, label: 'Customer Reviews', href: '/cashier/reviews', color: 'text-rose-600', requiredPermission: 'reviews.access' },
        { icon: Inbox, label: 'Online Orders', href: '/cashier/online-orders', color: 'text-amber-600', badge: ordersBadge, requiredPermission: 'online_orders.access' },
        { icon: Calendar, label: 'Reservations', href: '/cashier/reservations', color: 'text-violet-600', requiredPermission: 'reservations.access' },
        { icon: Layers, label: 'Table Management', href: '/cashier/table-management', color: 'text-sky-600', requiredPermission: 'tables.manage' },
        { icon: Activity, label: 'Kitchen Analytics', href: '/cashier/kitchen-analytics', color: 'text-orange-600', requiredPermission: 'kitchen_analytics.view' },
      ],
    },
    { icon: Users, label: 'Customers', href: '/cashier/customers', color: 'text-pink-600', requiredPermission: 'customers.access' },
    { icon: BellRing, label: 'Reminders', href: '/cashier/reminders', color: 'text-green-600', requiredPermission: 'customers.access' },
    { icon: Receipt, label: 'Customer Ledger', href: '/cashier/accounts-receivable', color: 'text-teal-700', requiredPermission: 'customer_ledger.access' },
    { icon: Receipt, label: 'Supplier Ledger', href: '/cashier/accounts-payable', color: 'text-orange-700', requiredPermission: 'supplier_ledger.access' },
    {
      label: 'Inventory',
      tint: 'lime',
      items: [
        { icon: Gauge, label: 'Inventory Report', href: '/cashier/inventory/dashboard', color: 'text-indigo-700', requiredPermission: 'inventory.dashboard.view' },
        { icon: ClipboardCheck, label: 'Stock movements', href: '/cashier/inventory/movements', color: 'text-indigo-700', requiredPermission: 'inventory.movements.view' },
        { icon: Warehouse, label: 'Inventory', href: '/cashier/inventory', color: 'text-indigo-600', requiredPermission: 'inventory.manage' },
        { icon: FolderOpen, label: 'Inventory Categories', href: '/cashier/inventory-categories', color: 'text-violet-600', requiredPermission: 'inventory.setup.manage' },
        { icon: Ruler, label: 'Unit Conversion', href: '/cashier/unit-conversion', color: 'text-sky-600', requiredPermission: 'inventory.setup.manage' },
        { icon: Truck, label: 'Purchases', href: '/cashier/purchases', color: 'text-teal-600', requiredPermission: 'purchases.view' },
        { icon: Building2, label: 'Suppliers', href: '/cashier/suppliers', color: 'text-slate-600', requiredPermission: 'suppliers.view' },
        { icon: Trash, label: 'Wastage', href: '/cashier/wastage', color: 'text-red-600', requiredPermission: 'wastage.manage' },
      ],
    },
    {
      label: 'Finance',
      tint: 'indigo',
      items: [
        { icon: Wallet, label: 'Expenses', href: '/cashier/expenses', color: 'text-emerald-600', requiredPermission: 'expenses.manage' },
        { icon: PiggyBank, label: 'Business Funding', href: '/cashier/business-funding', color: 'text-violet-700', requiredPermission: 'business_funding.manage' },
        { icon: PiggyBank, label: 'Savings & Deposits', href: '/cashier/savings', color: 'text-sky-700', requiredPermission: 'savings.manage' },
        { icon: FolderOpen, label: 'Expense Categories', href: '/cashier/expense-categories', color: 'text-emerald-700', requiredPermission: 'expense_categories.manage' },
        { icon: ArrowRightLeft, label: 'Cash Exchange', href: '/cashier/cash-exchange', color: 'text-amber-600', requiredPermission: 'cash_exchange.manage' },
      ],
    },
    {
      label: 'Accounting',
      tint: 'emerald',
      items: [
        { icon: CalendarClock, label: 'Opening & Closing', href: '/cashier/business-days', color: 'text-emerald-700', requiredPermission: 'business_days.view' },
        { icon: Gauge, label: 'Finance Dashboard', href: '/cashier/finance-dashboard', color: 'text-gray-900', requiredPermission: 'finance_dashboard.access' },
        { icon: BookOpen, label: 'Chart of Accounts', href: '/cashier/chart-of-accounts', color: 'text-indigo-600', requiredPermission: 'chart_of_accounts.access' },
        { icon: ScrollText, label: 'General Ledger', href: '/cashier/general-ledger', color: 'text-slate-600', requiredPermission: 'general_ledger.view' },
        { icon: Coins, label: 'Cash Book', href: '/cashier/cash-book', color: 'text-yellow-600', requiredPermission: 'general_ledger.view' },
        { icon: Landmark, label: 'Bank Book', href: '/cashier/bank-book', color: 'text-blue-600', requiredPermission: 'general_ledger.view' },
        { icon: ClipboardCheck, label: 'Bank Reconciliation', href: '/cashier/bank-reconciliation', color: 'text-cyan-700', requiredPermission: 'bank_reconciliation.access' },
        { icon: Wallet, label: 'Cash Drawer', href: '/cashier/cash-drawer', color: 'text-orange-600', requiredPermission: 'cash_drawer.manage' },
        { icon: Landmark, label: 'Bank', href: '/cashier/bank', color: 'text-blue-700', requiredPermission: 'bank.access' },
        { icon: FileText, label: 'Financial Reports', href: '/cashier/financial-reports', color: 'text-indigo-700', requiredPermission: 'financial_reports.access' },
        { icon: ShieldCheck, label: 'Cancelled KOT approval', href: '/cashier/cancellations', color: 'text-amber-700', requiredPermission: 'cancellation_verifications.manage', featureFlag: 'kot_cancellation_approval.enabled' },
        { icon: Undo2, label: 'Corrections', href: '/cashier/corrections', color: 'text-amber-700', requiredPermission: 'corrections.manage' },
      ],
    },
    {
      label: 'HRM',
      tint: 'fuchsia',
      items: [
        { icon: Building2, label: 'Departments', href: '/cashier/hrm/departments', color: 'text-pink-600', requiredPermission: 'hrm.departments.manage' },
        { icon: Contact, label: 'Designations', href: '/cashier/hrm/designations', color: 'text-pink-600', requiredPermission: 'hrm.designations.manage' },
        { icon: Users, label: 'Staff', href: '/cashier/employees', color: 'text-green-600', requiredPermission: 'employees.manage' },
        { icon: CalendarCheck2, label: 'Attendance', href: '/cashier/hrm/attendance', color: 'text-sky-600', requiredPermission: 'hrm.attendance.manage' },
        { icon: WalletCards, label: 'Payroll', href: '/cashier/payroll', color: 'text-emerald-700', requiredPermission: 'payroll.view' },
        { icon: CalendarHeart, label: 'Holidays', href: '/cashier/hrm/holidays', color: 'text-rose-600', requiredPermission: 'hrm.holidays.manage' },
        { icon: TrendingUp, label: 'Staff Performance', href: '/cashier/employee-performance', color: 'text-lime-600', requiredPermission: 'employee_performance.view' },
      ],
    },
    { icon: Globe, label: 'Website CMS', href: '/cashier/cms', color: 'text-sky-600', requiredPermission: 'cms.manage' },
    { icon: Printer, label: 'Printer', href: '/cashier/printer', color: 'text-violet-700', requiredPermission: 'settings.manage' },
    { icon: Settings, label: 'Settings', href: '/cashier/settings', color: 'text-gray-600', requiredPermission: 'settings.manage' },
  ];

  const hotelStaffNavGroups = [
    ...(panelRole === 'watchman'
      ? [{ icon: ShieldCheck, label: 'Security desk', href: '/admin/security', color: 'text-stone-700' }, { icon: Cctv, label: 'CCTV', href: '/admin/cctv', color: 'text-gray-900' }]
      : HOTEL_PAGES.map((p) => ({ icon: p.icon, label: p.label, href: p.href, color: 'text-emerald-700', requiredPermission: p.permission }))),
    { icon: Clock, label: 'My HR & notifications', href: '/staff', color: 'text-sky-700', badge: notificationsBadge },
  ];
  const canSwitchWorkspace = !isCashierPanel && isAdminLike(panelRole);
  // Opening a hotel page from the restaurant workspace shows the hotel menu.
  const activeWorkspace = workspace === 'restaurant' && (pathname === '/admin/hotel' || pathname?.startsWith('/admin/hotel/') || pathname === '/admin/security') ? 'hotel' : workspace;
  const inWorkspace = (entry) => isCashierPanel || !entry.scope || [].concat(entry.scope).includes(activeWorkspace);
  // requiredPermission: one key or a list (any one is enough). Admin and manager
  // hold every capability, so this only hides entries from staff roles.
  const hasNavPermission = (entry) => !entry.requiredPermission || isAdminLike(panelRole) || [].concat(entry.requiredPermission).some((key) => capabilities?.[key] === true);
  const rawNavGroups = (isCashierPanel ? cashierNavGroups : isHotelStaff(panelRole) ? hotelStaffNavGroups : adminNavGroups)
    .filter((entry) => inWorkspace(entry) && (!entry.ownerOnly || panelRole === 'admin'));
  const requiredPagePermission = isCashierPanel ? permissionForStaffPath(pathname) : null;
  const featureDisabledPage = (pathname === '/admin/cancellations' || pathname === '/cashier/cancellations')
    && capabilities?.['kot_cancellation_approval.enabled'] !== true;

  // Apply the deployment profile: hide disabled waiter/kitchen/table/reservation
  // entries and drop any group left empty. Routes still exist for historical data.
  const navGroups = rawNavGroups
    .map((group) => {
      if (!group.items) {
        if (isNavHidden(group.href)) return null;
        if (group.featureFlag && capabilities?.[group.featureFlag] !== true) return null;
        if (!hasNavPermission(group)) return null;
        return group;
      }
      if (!hasNavPermission(group)) return null;
      const items = group.items.filter((it) =>
        !isNavHidden(it.href)
        && (!it.featureFlag || capabilities?.[it.featureFlag] === true)
        && hasNavPermission(it)
      );
      return items.length ? { ...group, items } : null;
    })
    .filter(Boolean);

  const allNavHrefs = useMemo(
    () =>
      navGroups
        .flatMap((g) => (g.items ? g.items.map((i) => i.href) : g.href ? [g.href] : []))
        .filter(Boolean),
    [navGroups]
  );

  /** Longest path match with segment boundary Ã¢â‚¬â€ avoids /admin/inventory lighting up on /admin/inventory-categories. */
  const activeHref = useMemo(() => {
    if (!pathname) return null;
    const matches = allNavHrefs.filter((href) => {
      const [hrefPath, hrefQuery = ''] = href.split('?');
      if (pathname !== hrefPath && !pathname.startsWith(`${hrefPath}/`)) return false;
      if (!hrefQuery) return true;
      const expected = new URLSearchParams(hrefQuery);
      return Array.from(expected.entries()).every(([key, value]) => searchParams.get(key) === value);
    });
    if (!matches.length) return null;
    return matches.sort((a, b) => b.length - a.length)[0];
  }, [pathname, searchParams, allNavHrefs]);

  const isActiveHref = (href) => activeHref === href;
  // Flat list only used when the desktop rail is collapsed to icons.
  const flatItems = navGroups.flatMap((g) => (g.items ? g.items : [g]));

  if (loading || capabilities === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-gray-900 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (featureDisabledPage || (requiredPagePermission && capabilities?.[requiredPagePermission] !== true)) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-16">
        <div className="mx-auto max-w-lg rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <ShieldCheck className="mx-auto h-10 w-10 text-gray-400" />
          <h1 className="mt-4 text-xl font-bold text-gray-950">Access not allowed</h1>
          <p className="mt-2 text-sm leading-6 text-gray-600">
            {featureDisabledPage
              ? 'Enable cancelled KOT approval under Admin Settings before this page can be used.'
              : 'Your role does not have permission to open this area. Ask an administrator to enable it under Staff Permissions.'}
          </p>
          <button
            type="button"
            onClick={() => router.push('/cashier')}
            className="mt-6 rounded-xl bg-gray-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 active:scale-[0.98]"
          >
            Back to cashier workspace
          </button>
        </div>
      </div>
    );
  }

  const showLabels = sidebarOpen || !isDesktop;

  const renderNavButton = (item, topLevel, tint) => {
    const isActive = isActiveHref(item.href);
    return (
      <button
        key={item.href}
        type="button"
        onClick={() => navigate(item.href)}
        className={`w-full flex items-center ${
          showLabels ? `space-x-3 ${topLevel ? 'px-4' : 'pl-8 pr-4'}` : 'justify-center px-2'
        } py-2.5 rounded-lg text-left relative ${
          isActive
            ? `${tint?.activeBg || 'bg-gray-100'} border-l-4 ${tint?.activeBorder || 'border-gray-800'}`
            : `active:bg-gray-50 ${tint?.hover || 'hover:bg-gray-50'}`
        }`}
      >
        <item.icon className={`${item.color} ${showLabels ? 'w-5 h-5' : 'w-6 h-6'} flex-shrink-0`} />
        {showLabels && (
          <span className={`font-medium flex-1 ${isActive ? 'text-gray-900' : 'text-gray-700'}`}>
            {item.label}
          </span>
        )}
        {item.badge > 0 && (
          <span
            className={`${showLabels ? '' : 'absolute top-1.5 right-1.5'} min-w-5 h-5 px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center`}
          >
            {item.badge > 99 ? '99+' : item.badge}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 overflow-x-hidden">
      {/* Fixed mobile top bar Ã¢â‚¬â€ always above the aside so the hamburger is easy to tap */}
      <div className="lg:hidden print:hidden fixed top-0 inset-x-0 z-[70] bg-white border-b border-gray-200 px-2 py-1.5 flex items-center justify-between pt-[max(0.5rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={() => {
            if (sidebarOpen) closeMobileSidebar();
            else openSidebar();
          }}
          className="relative z-[71] h-12 w-12 flex items-center justify-center rounded-xl bg-gray-100 active:bg-gray-200 text-gray-800 touch-manipulation [-webkit-tap-highlight-color:transparent]"
          aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
        >
          {sidebarOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
        <h2 className="text-base font-bold text-gray-800 pointer-events-none">{isCashierPanel ? 'Cashier Station' : 'Admin Panel'}</h2>
        <div className="h-12 w-12" aria-hidden />
      </div>

      {backdropVisible && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-[55] bg-black/20 lg:hidden touch-manipulation"
          onClick={closeMobileSidebar}
        />
      )}

      <aside
        className={`print:hidden fixed top-0 left-0 h-full bg-white border-r border-gray-200 shadow-xl lg:shadow-none transition-transform duration-200 z-[60] flex flex-col ${
          sidebarOpen
            ? 'w-64 translate-x-0 pointer-events-auto'
            : 'w-64 -translate-x-full pointer-events-none lg:pointer-events-auto lg:w-20 lg:translate-x-0'
        }`}
      >
        <div className="p-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0 gap-2 pt-[max(1rem,env(safe-area-inset-top))] lg:pt-4">
          {showLabels && <h2 className="text-xl font-bold text-gray-800 truncate">{isCashierPanel ? 'Cashier Station' : isHotelStaff(panelRole) ? 'Hotel' : 'Admin Panel'}</h2>}
          <button
            type="button"
            onClick={toggleSidebar}
            className="hidden lg:flex min-h-10 min-w-10 items-center justify-center hover:bg-gray-100 rounded-lg text-gray-700 flex-shrink-0"
            aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
          >
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <button
            type="button"
            onClick={closeMobileSidebar}
            className="lg:hidden h-12 w-12 flex items-center justify-center rounded-xl bg-gray-100 active:bg-gray-200 text-gray-800 touch-manipulation"
            aria-label="Close menu"
          >
            <X size={22} />
          </button>
        </div>

        {canSwitchWorkspace && showLabels && (
          <div className="flex-shrink-0 px-3 pt-3">
            <div role="group" aria-label="Workspace" className="grid grid-cols-3 gap-1 rounded-xl bg-gray-100 p-1">
              {WORKSPACES.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  aria-pressed={activeWorkspace === w.id}
                  onClick={() => chooseWorkspace(w.id)}
                  className={`rounded-lg px-1 py-2 text-xs font-semibold transition-colors ${activeWorkspace === w.id ? 'bg-white text-gray-950 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {showLabels && <GlobalSearch />}

        <nav
          ref={attachNavScroll}
          onScroll={saveNavScroll}
          className="flex-1 overflow-y-auto overscroll-contain p-3 space-y-1"
        >
          {showLabels
            ? navGroups.map((group) => {
                if (!group.items) return renderNavButton(group, true);
                const hasActive = group.items.some((it) => isActiveHref(it.href));
                const anyGroupOpen = Object.values(openGroups).some(Boolean);
                const expanded = openGroups[group.label] === true || (!anyGroupOpen && hasActive);
                const groupBadge = group.items.reduce((n, it) => n + (it.badge || 0), 0);
                const tint = NAV_TINTS[group.tint];
                return (
                  <div key={group.label} className={`rounded-xl ${tint?.bg || ''}`}>
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.label)}
                      className={`w-full flex items-center gap-2 px-4 py-2 rounded-lg text-left text-xs font-semibold uppercase tracking-wide ${tint?.header || 'text-gray-500'} ${tint?.hover || 'hover:bg-gray-50'}`}
                    >
                      <span className="flex-1">{group.label}</span>
                      {!expanded && groupBadge > 0 && (
                        <span className="min-w-5 h-5 px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center">
                          {groupBadge > 99 ? '99+' : groupBadge}
                        </span>
                      )}
                      <ChevronDown
                        className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
                      />
                    </button>
                    {expanded && (
                      <div className="mt-1 space-y-1 pb-1">
                        {group.items.map((item) => renderNavButton(item, false, tint))}
                      </div>
                    )}
                  </div>
                );
              })
            : flatItems.map((item) => renderNavButton(item, true))}
        </nav>

        <div className="flex-shrink-0 p-3 border-t border-gray-200">
          <LogoutButton
            onLogout={handleLogout}
            variant="sidebar"
            iconOnly={!showLabels}
            label="Logout"
            className={!showLabels ? 'justify-center px-2 space-x-0' : ''}
          />
        </div>
      </aside>

      <div
        className={`min-h-screen min-w-0 pt-14 lg:pt-0 print:!ml-0 print:!pt-0 ${
          sidebarOpen ? 'lg:ml-64' : 'lg:ml-20'
        } ${sidebarOpen && !isDesktop ? 'opacity-45' : 'opacity-100'}`}
        style={{ '--admin-sidebar-offset': sidebarOpen ? '16rem' : '5rem' }}
      >
        <div className="admin-page-content w-full min-w-0">
          <CashCountGate active={isCashierPanel && panelRole === 'cashier'}>{children}</CashCountGate>
        </div>
      </div>
    </div>
  );
}
