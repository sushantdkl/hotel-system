'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  DollarSign, Receipt, Clock, CheckCircle, TrendingUp,
  Calendar, CreditCard, AlertCircle, Users, ShoppingBag, Trash2, ClipboardList
} from 'lucide-react';
import { formatNepalClock, getNepaliDateString } from '@/lib/time-utils';
import { isOpenOrder, canCashierBill, normalizeOrderStatus } from '@/lib/restaurant-status';
import LogoutButton from '@/components/ui/logout-button';
import { authedRequest } from '@/lib/authed-fetch';
import WastageModal from '@/components/inventory/wastage-modal';
import WastageHistoryModal from '@/components/inventory/wastage-history-modal';
import AdminLayout from '@/components/admin/admin-layout';

function orderAmount(order) {
  const n = Number(order?.total_amount ?? order?.grand_total ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function isNepaliToday(dateValue) {
  if (!dateValue) return false;
  return getNepaliDateString(dateValue) === getNepaliDateString();
}

/** Completed “today” = paid/updated today (orders are often opened earlier). */
function completedToday(order) {
  if (normalizeOrderStatus(order.status) !== 'completed') return false;
  return isNepaliToday(order.updated_at) || isNepaliToday(order.created_at);
}

export default function OrderDesk() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    todaySales: 0,
    todayOrders: 0,
    pendingBills: 0,
    completedBills: 0,
    averageOrderValue: 0,
    readyCount: 0,
    activeCount: 0,
    completedTodayCount: 0,
    allOrdersCount: 0
  });
  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState('active'); // ready, active, completed, all
  const [showWastageLog, setShowWastageLog] = useState(false);
  const [showWastageHistory, setShowWastageHistory] = useState(false);
  const checkAuth = useCallback(async () => {
    try {
      const token = localStorage.getItem('pos_token');
      
      if (!token || token === 'null' || token === 'undefined') {
        setLoading(false);
        router.push('/login');
        return;
      }

      const response = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });

      if (!response.ok) {
        localStorage.removeItem('token');
        setLoading(false);
        router.push('/login');
        return;
      }

      const data = await response.json();
      
      if (data.user.role !== 'cashier' && data.user.role !== 'admin') {
        setLoading(false);
        router.push('/login');
        return;
      }

      setUser(data.user);
      setLoading(false);
    } catch (error) {
      console.error('Cashier checkAuth - error:', error);
      localStorage.removeItem('token');
      setLoading(false);
      router.push('/login');
    }
  }, [router]);

  const fetchData = useCallback(async () => {
    try {
      const token = localStorage.getItem('pos_token');
      
      if (!token || token === 'null' || token === 'undefined') {
        return;
      }
      
      const ordersRes = await fetch('/api/restaurant/orders', {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (!ordersRes.ok) return;

      const ordersData = await ordersRes.json();
      const allOrders = ordersData.orders || [];

      const isBillable = (o) => canCashierBill(o.status);
      const isActive = (o) => isOpenOrder(o.status);

      let filteredOrders = allOrders;
      if (filter === 'ready') {
        filteredOrders = allOrders.filter(isBillable);
      } else if (filter === 'active') {
        // A table may contain multiple parties, each with its own order and
        // bill. Never collapse open orders by table_id here.
        filteredOrders = allOrders.filter(isActive);
      } else if (filter === 'completed') {
        filteredOrders = allOrders.filter(completedToday);
      }

      setOrders(filteredOrders);

      const todayCreated = allOrders.filter((o) => isNepaliToday(o.created_at));
      const paidToday = allOrders.filter(completedToday);
      const todaySales = paidToday.reduce((sum, o) => sum + orderAmount(o), 0);
      const billableOrders = allOrders.filter(isBillable);
      const activeOrders = allOrders.filter(isActive);

      setStats({
        todaySales,
        todayOrders: todayCreated.length || paidToday.length,
        pendingBills: billableOrders.length,
        completedBills: paidToday.length,
        averageOrderValue: paidToday.length > 0 ? todaySales / paidToday.length : 0,
        readyCount: billableOrders.length,
        activeCount: activeOrders.length,
        completedTodayCount: paidToday.length,
        allOrdersCount: allOrders.length,
      });
    } catch (error) {
      console.error('Error fetching data:', error);
    }
  }, [filter]);

  /*
   * Both effects previously called functions declared further down the
   * component body — read before their own declaration, and a fresh identity on
   * every render, so no dependency array could describe them honestly. The
   * fetchers are now memoised above and the work runs inside an async callback
   * rather than synchronously in the effect body.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => { if (!cancelled) await checkAuth(); })();
    return () => { cancelled = true; };
  }, [checkAuth]);

  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    const refresh = async () => {
      if (cancelled) return;
      await fetchData();
    };
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [user, fetchData]);

  const handleLogout = () => {
    localStorage.removeItem('pos_token');
    localStorage.removeItem('pos_user');
    router.push('/');
  };

  const getStatusColor = (status) => {
    const colors = {
      pending: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      preparing: 'bg-orange-100 text-orange-800 border-orange-300',
      ready: 'bg-green-100 text-green-800 border-green-300',
      dining: 'bg-blue-100 text-blue-800 border-blue-300',
      served: 'bg-blue-100 text-blue-800 border-blue-300',
      awaiting_payment: 'bg-amber-100 text-amber-900 border-amber-300',
      completed: 'bg-emerald-100 text-emerald-800 border-emerald-300',
      cancelled: 'bg-red-100 text-red-800 border-red-300'
    };
    return colors[status] || 'bg-gray-100 text-gray-800 border-gray-300';
  };

  const getStatusLabel = (status) => {
    const labels = {
      pending: 'New',
      preparing: 'Cooking',
      ready: 'Ready to Serve',
      dining: 'Dining — can bill',
      served: 'Dining — can bill',
      awaiting_payment: 'Awaiting Payment',
      completed: 'Paid',
      cancelled: 'Cancelled'
    };
    return labels[status] || status;
  };

  const getStatusText = (status) => {
    return getStatusLabel(status);
  };

  const formatCurrency = (amount) => {
    const n = Number(amount);
    return `Rs ${Number.isFinite(n) ? n.toFixed(2) : '0.00'}`;
  };

  const formatTime = (dateString) => {
    if (!dateString) return 'N/A';
    return formatNepalClock(dateString);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-700 text-lg">Loading cashier dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <AdminLayout>
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-3 sm:py-4">
            <div className="flex items-center space-x-2 sm:space-x-3">
              <div className="p-1.5 sm:p-2 bg-blue-600 rounded-lg">
                <CreditCard className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
              </div>
              <div>
                <h1 className="text-lg sm:text-2xl font-bold text-gray-900">Order Desk</h1>
                <p className="text-xs sm:text-sm text-gray-600 hidden sm:block">Welcome, {user?.full_name}</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap justify-end">
              <button
                onClick={() => router.push('/cashier/pos')}
                className="px-2.5 py-2 sm:px-4 bg-gray-950 text-white rounded-lg hover:bg-black transition-all text-xs sm:text-base font-semibold"
              >
                Full POS
              </button>
              <button
                onClick={() => router.push('/cashier/billing')}
                className="px-2.5 py-2 sm:px-4 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-all text-xs sm:text-base font-semibold"
              >
                <span className="sm:hidden">Bill</span>
                <span className="hidden sm:inline">Walk-in Bill</span>
              </button>
              <button
                onClick={() => setShowWastageHistory(true)}
                className="p-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200"
                aria-label="View wastage"
                title="View wastage"
              >
                <ClipboardList className="w-5 h-5" />
              </button>
              <button
                onClick={() => setShowWastageLog(true)}
                className="p-2 rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100"
                aria-label="Log wastage"
                title="Log wastage"
              >
                <Trash2 className="w-5 h-5" />
              </button>
              <LogoutButton
                onLogout={handleLogout}
                label="Logout"
                className="!text-xs sm:!text-base"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-2 sm:px-4 lg:px-8 py-3 sm:py-6">
        {/* Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 sm:gap-4 mb-4 sm:mb-6">
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-3 sm:p-5">
            <div className="flex items-center justify-between mb-1 sm:mb-2">
              <DollarSign className="w-6 h-6 sm:w-8 sm:h-8 text-green-600" />
            </div>
            <p className="text-xs sm:text-sm text-gray-600 mb-1">Sales</p>
            <p className="text-base sm:text-2xl font-bold text-gray-900">{formatCurrency(stats.todaySales)}</p>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-3 sm:p-5">
            <div className="flex items-center justify-between mb-1 sm:mb-2">
              <ShoppingBag className="w-6 h-6 sm:w-8 sm:h-8 text-blue-600" />
            </div>
            <p className="text-xs sm:text-sm text-gray-600 mb-1">Orders</p>
            <p className="text-base sm:text-2xl font-bold text-gray-900">{stats.todayOrders}</p>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-3 sm:p-5">
            <div className="flex items-center justify-between mb-1 sm:mb-2">
              <AlertCircle className="w-6 h-6 sm:w-8 sm:h-8 text-orange-600" />
            </div>
            <p className="text-xs sm:text-sm text-gray-600 mb-1">Pending</p>
            <p className="text-base sm:text-2xl font-bold text-gray-900">{stats.pendingBills}</p>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-3 sm:p-5">
            <div className="flex items-center justify-between mb-1 sm:mb-2">
              <CheckCircle className="w-6 h-6 sm:w-8 sm:h-8 text-purple-600" />
            </div>
            <p className="text-xs sm:text-sm text-gray-600 mb-1">Done</p>
            <p className="text-base sm:text-2xl font-bold text-gray-900">{stats.completedBills}</p>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-3 sm:p-5 hidden md:block">
            <div className="flex items-center justify-between mb-1 sm:mb-2">
              <Users className="w-6 h-6 sm:w-8 sm:h-8 text-indigo-600" />
            </div>
            <p className="text-xs sm:text-sm text-gray-600 mb-1">Avg Value</p>
            <p className="text-base sm:text-2xl font-bold text-gray-900">{formatCurrency(stats.averageOrderValue)}</p>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="bg-white rounded-lg shadow p-2 mb-4 sm:mb-6 grid grid-cols-2 lg:grid-cols-4 gap-2">
          <button
            onClick={() => setFilter('ready')}
            className={`py-2.5 px-2 sm:px-4 rounded-md text-xs sm:text-sm font-semibold transition-all ${
              filter === 'ready'
                ? 'bg-blue-600 text-white shadow'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            Ready ({stats.readyCount || 0})
          </button>
          <button
            onClick={() => setFilter('active')}
            className={`py-2.5 px-2 sm:px-4 rounded-md text-xs sm:text-sm font-semibold transition-all ${
              filter === 'active'
                ? 'bg-blue-600 text-white shadow'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            Active ({stats.activeCount || 0})
          </button>
          <button
            onClick={() => setFilter('completed')}
            className={`py-2.5 px-2 sm:px-4 rounded-md text-xs sm:text-sm font-semibold transition-all ${
              filter === 'completed'
                ? 'bg-blue-600 text-white shadow'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            Done today ({stats.completedTodayCount || 0})
          </button>
          <button
            onClick={() => setFilter('all')}
            className={`py-2.5 px-2 sm:px-4 rounded-md text-xs sm:text-sm font-semibold transition-all ${
              filter === 'all'
                ? 'bg-blue-600 text-white shadow'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            All ({stats.allOrdersCount || 0})
          </button>
        </div>

        {/* Orders List */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="p-4 border-b border-gray-200">
            <h2 className="text-xl font-bold text-gray-900 flex items-center">
              <Receipt className="w-5 h-5 mr-2 text-blue-600" />
              {filter === 'ready' ? 'Ready for Payment / Dining' :
               filter === 'active' ? 'All Open Orders (tracking)' :
               filter === 'completed' ? 'Completed Today' : 'All Orders'}
            </h2>
          </div>

          {orders.length === 0 ? (
            <div className="p-12 text-center">
              <AlertCircle className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-600 text-lg">No orders found</p>
            </div>
          ) : (
            <>
              {/* Mobile cards */}
              <div className="md:hidden divide-y divide-gray-100">
                {orders.map((order) => (
                  <div key={order.id} className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-mono font-bold text-gray-900">#{order.id.toString().padStart(4, '0')}</p>
                        <p className="text-sm text-gray-600">
                          {order.table_number ? `Table ${order.table_number}` : 'Takeaway'}
                          {order.party_label ? ` · ${order.party_label}` : ''} · {formatTime(order.created_at)}
                        </p>
                      </div>
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border shrink-0 ${getStatusColor(order.status)}`}>
                        {getStatusText(order.status)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">{order.item_count || 0} items</span>
                      <span className="font-bold text-gray-900">{formatCurrency(order.total_amount)}</span>
                    </div>
                    <button
                      onClick={() => router.push(`/cashier/bill/${order.id}`)}
                      className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-semibold text-sm"
                    >
                      {canCashierBill(order.status) ? 'Process Payment' :
                       order.status === 'completed' ? 'View Details' : 'View / Pay'}
                    </button>
                  </div>
                ))}
              </div>

              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                      Order ID
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                      Table
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                      Time
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                      Items
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                      Amount
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {orders.map((order) => (
                    <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="font-mono font-semibold text-gray-900">
                          #{order.id.toString().padStart(4, '0')}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="font-semibold text-gray-900">{order.table_number || 'Takeaway'}</span>
                        {order.party_label && <span className="block text-xs text-gray-500">{order.party_label}</span>}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {formatTime(order.created_at)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {order.item_count || 0} items
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="font-bold text-gray-900">
                          {formatCurrency(order.total_amount)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${getStatusColor(order.status)}`}>
                          {getStatusText(order.status)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <button
                          onClick={() => router.push(`/cashier/bill/${order.id}`)}
                          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-all font-medium"
                        >
                      {canCashierBill(order.status) ? 'Process Payment' :
                       order.status === 'completed' ? 'View Details' : 'View Order'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </>
          )}
        </div>
      </div>

      {showWastageLog && <WastageModal request={authedRequest} onClose={() => setShowWastageLog(false)} />}
      {showWastageHistory && <WastageHistoryModal request={authedRequest} onClose={() => setShowWastageHistory(false)} />}
    </div>
    </AdminLayout>
  );
}
