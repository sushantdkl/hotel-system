'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Search, Calendar, DollarSign, CreditCard,
  Download, Filter, Receipt, RefreshCw
} from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { formatNepalTime } from '@/lib/time-utils';
import AdminLayout from '@/components/admin/admin-layout';
import DateInput from '@/components/ui/date-input.jsx';
import { toCsv } from '@/lib/csv';

const nepalToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu' }).format(new Date());
const displayMethod = (method) => {
  const value = String(method || 'cash').toLowerCase();
  if (value === 'cash') return 'Cash';
  if (value === 'credit') return 'Credit';
  return 'Online';
};

export default function PaymentHistoryPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState([]);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMethod, setFilterMethod] = useState('all');
  const [startDate, setStartDate] = useState(nepalToday);
  const [endDate, setEndDate] = useState(nepalToday);

  const fetchPayments = useCallback(async ({ quiet = false } = {}) => {
    try {
      if (!quiet) setLoading(true);
      setError('');
      const token = localStorage.getItem('pos_token');
      
      // Don't fetch if no valid token
      if (!token || token === 'null' || token === 'undefined') {
        router.push('/login');
        return;
      }
      
      const response = await fetch(
        `/api/restaurant/payments?startDate=${startDate}&endDate=${endDate}`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      if (response.ok) {
        const data = await response.json();
        setPayments(data.payments || []);
      } else {
        const data = await response.json().catch(() => ({}));
        setError(data.error || 'Could not load payment history.');
      }
    } catch (error) {
      console.error('Error fetching payments:', error);
      setError('Could not load payment history.');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, router]);

  useEffect(() => {
    if (!startDate || !endDate) return undefined;
    fetchPayments();
    const interval = setInterval(() => fetchPayments({ quiet: true }), 10000);
    return () => clearInterval(interval);
  }, [startDate, endDate, fetchPayments]);

  const filteredPayments = useMemo(() => {
    let filtered = [...payments];

    // Search filter
    if (searchTerm) {
      filtered = filtered.filter(p =>
        p.order_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.table_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.customer_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.customer_phone?.includes(searchTerm)
      );
    }

    // Method filter
    if (filterMethod !== 'all') {
      if (filterMethod === 'online') {
        filtered = filtered.filter(p => displayMethod(p.payment_method) === 'Online');
      } else if (filterMethod === 'split') {
        filtered = filtered.filter(p => Number(p.is_split) === 1);
      } else {
        filtered = filtered.filter(p => displayMethod(p.payment_method).toLowerCase() === filterMethod);
      }
    }

    return filtered;
  }, [payments, searchTerm, filterMethod]);

  const calculateTotals = () => {
    const sum = (rows) => rows.reduce((total, payment) => total + Number(payment.amount || 0), 0);
    const total = sum(filteredPayments);
    const cash = sum(filteredPayments.filter(p => displayMethod(p.payment_method) === 'Cash'));
    const online = sum(filteredPayments.filter(p => displayMethod(p.payment_method) === 'Online'));
    const credit = sum(filteredPayments.filter(p => displayMethod(p.payment_method) === 'Credit'));
    const split = sum(filteredPayments.filter(p => Number(p.is_split) === 1));

    return { total, cash, online, credit, split };
  };

  const exportToCSV = () => {
    const headers = ['Date', 'Order #', 'Table', 'Method', 'Amount', 'Customer', 'Phone'];
    const rows = filteredPayments.map(p => ({
      Date: formatNepalTime(p.created_at),
      'Order #': p.order_number,
      Table: p.table_number || 'N/A',
      Method: displayMethod(p.payment_method),
      Amount: formatCurrency(Number(p.amount || 0)),
      Customer: p.customer_name || '',
      Phone: p.customer_phone || '',
    }));

    const blob = new Blob([toCsv(headers, rows)], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payment-history-${startDate}-to-${endDate}.csv`;
    a.click();
  };

  const formatDateTime = (dateString) => {
    if (!dateString) return 'N/A';
    return formatNepalTime(dateString);
  };

  const totals = calculateTotals();

  if (loading && payments.length === 0 && !error) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-800 text-lg">Loading payment history...</p>
        </div>
      </div>
    );
  }

  return (
    <AdminLayout>
    <div className="min-h-screen bg-white p-8">
      <div className="max-w-7xl mx-auto">
        {error && (
          <div className="mb-4 flex items-center justify-between gap-3 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <span>{error}</span>
            <button type="button" onClick={() => fetchPayments()} className="font-semibold underline">Retry</button>
          </div>
        )}
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={() => router.push('/cashier')}
            className="flex items-center space-x-2 text-gray-800 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="font-semibold">Back to Dashboard</span>
          </button>
          <h1 className="text-3xl font-bold text-gray-800 flex items-center">
            <Receipt className="w-8 h-8 mr-3 text-blue-600" />
            Payment History
          </h1>
          <button
            onClick={exportToCSV}
            className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-all font-semibold"
          >
            <Download className="w-5 h-5" />
            <span>Export CSV</span>
          </button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-6 gap-4 mb-8">
          <div className="bg-white border-2 border-gray-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <DollarSign className="w-8 h-8 text-blue-600" />
            </div>
            <p className="text-gray-600 text-xs font-medium mb-1">Total</p>
            <p className="text-xl font-bold text-gray-900">{formatCurrency(totals.total)}</p>
          </div>

          <div className="bg-white border-2 border-gray-200 rounded-xl p-4">
            <p className="text-gray-600 text-xs font-medium mb-1">Cash</p>
            <p className="text-xl font-bold text-gray-900">{formatCurrency(totals.cash)}</p>
          </div>

          <div className="bg-white border-2 border-gray-200 rounded-xl p-4">
            <p className="text-gray-600 text-xs font-medium mb-1">Online</p>
            <p className="text-xl font-bold text-gray-900">{formatCurrency(totals.online)}</p>
          </div>

          <div className="bg-white border-2 border-gray-200 rounded-xl p-4">
            <p className="text-gray-600 text-xs font-medium mb-1">Credit</p>
            <p className="text-xl font-bold text-gray-900">{formatCurrency(totals.credit)}</p>
          </div>

          <div className="bg-white border-2 border-gray-200 rounded-xl p-4">
            <p className="text-gray-600 text-xs font-medium mb-1">Split</p>
            <p className="text-xl font-bold text-gray-900">{formatCurrency(totals.split)}</p>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2 flex items-center">
                <Calendar className="w-4 h-4 mr-2" />
                Start Date
              </label>
              <DateInput
                value={startDate}
                onChange={setStartDate}
                className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2 flex items-center">
                <Calendar className="w-4 h-4 mr-2" />
                End Date
              </label>
              <DateInput
                value={endDate}
                onChange={setEndDate}
                className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2 flex items-center">
                <Filter className="w-4 h-4 mr-2" />
                Payment Method
              </label>
              <select
                value={filterMethod}
                onChange={(e) => setFilterMethod(e.target.value)}
                className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
              >
                <option value="all">All Methods</option>
                <option value="cash">Cash</option>
                <option value="online">Online</option>
                <option value="credit">Credit</option>
                <option value="split">Split</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-900 mb-2 flex items-center">
                <Search className="w-4 h-4 mr-2" />
                Search
              </label>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Order #, Table, Customer..."
                className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Payments Table */}
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="p-6 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-800">
              Transactions ({filteredPayments.length})
            </h2>
            <button type="button" onClick={() => fetchPayments()} disabled={loading} title="Refresh payments" aria-label="Refresh payments" className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {filteredPayments.length === 0 ? (
            <div className="p-12 text-center">
              <Receipt className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-800 text-lg">No payments found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase">
                      Date & Time
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase">
                      Order #
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase">
                      Table
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase">
                      Customer
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase">
                      Method
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-gray-600 uppercase">
                      Amount
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase">
                      Discount
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredPayments.map((payment) => (
                    <tr key={payment.row_key || payment.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-800">
                        {formatDateTime(payment.created_at)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="font-mono font-semibold text-gray-900">
                          {payment.order_number}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap font-semibold text-gray-900">
                        {payment.table_number || 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <div>
                          <p className="font-semibold text-gray-900">{payment.customer_name || '-'}</p>
                          {payment.customer_phone && (
                            <p className="text-xs text-gray-700">{payment.customer_phone}</p>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">
                          {Number(payment.is_split) === 1 ? 'Split' : displayMethod(payment.payment_method)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <span className="font-bold text-gray-900 text-lg">
                          {formatCurrency(payment.amount)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {payment.discount_amount > 0 ? (
                          <div>
                            <p className="text-red-600 font-semibold">
                              - {formatCurrency(payment.discount_amount)}
                            </p>
                            <p className="text-xs text-gray-700">{payment.discount_reason}</p>
                          </div>
                        ) : (
                          <span className="text-gray-700">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
    </AdminLayout>
  );
}
