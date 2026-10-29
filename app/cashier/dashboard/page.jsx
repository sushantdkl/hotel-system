'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, LayoutGrid, RefreshCw, ShoppingBag } from 'lucide-react';
import AdminLayout from '@/components/admin/admin-layout';
import { authedRequest } from '@/lib/authed-fetch';
import { formatCurrency } from '@/lib/currency';
import { FloorTableBoard, isRunningTable } from '@/components/pos/floor-table-board';

export default function CashierDashboard() {
  const router = useRouter();
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [roomFilter, setRoomFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedTable, setSelectedTable] = useState(null);

  const fetchTables = useCallback(async () => {
    try {
      const response = await authedRequest('/api/admin/pos/tables');
      if (!response.ok) return;
      const data = await response.json();
      setTables(data.tables || data.data || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTables();
    const timer = window.setInterval(fetchTables, 5000);
    return () => window.clearInterval(timer);
  }, [fetchTables]);

  const openTable = (table) => {
    if (isRunningTable(table)) setSelectedTable(table);
    else router.push(`/cashier/pos?table=${table.id}`);
  };

  return (
    <AdminLayout>
      <main className="min-h-screen bg-gray-50 px-3 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Dashboard</h1>
              <p className="mt-1 text-sm text-gray-500">Live table status. Select a table to open or continue its order.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => router.push('/cashier/pos')} className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-gray-800"><ShoppingBag className="h-4 w-4" />Takeaway</button>
              <button type="button" onClick={() => router.push('/cashier/business-days')} className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"><CalendarClock className="h-4 w-4" />Opening &amp; Closing</button>
              <button type="button" onClick={fetchTables} className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50"><RefreshCw className="h-4 w-4" />Refresh</button>
            </div>
          </div>

          <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
            <div className="mb-4 flex items-center gap-2"><LayoutGrid className="h-5 w-5 text-cyan-600" /><h2 className="font-semibold text-gray-900">Tables</h2></div>
            {loading ? (
              <p className="py-12 text-center text-sm text-gray-400">Loading tables…</p>
            ) : tables.length ? (
              <FloorTableBoard tables={tables} roomFilter={roomFilter} statusFilter={statusFilter} onRoomFilter={setRoomFilter} onStatusFilter={setStatusFilter} onTableClick={openTable} />
            ) : (
              <p className="py-12 text-center text-sm text-gray-400">No tables configured yet.</p>
            )}
          </section>
        </div>

        {selectedTable && (
          <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
            <button type="button" className="absolute inset-0" aria-label="Close" onClick={() => setSelectedTable(null)} />
            <div className="relative z-10 w-full max-w-md rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl">
              <h3 className="text-lg font-bold text-gray-900">Table {selectedTable.table_number}</h3>
              <p className="mb-4 text-sm text-gray-500">{selectedTable.party_count || 1} active {(selectedTable.party_count || 1) === 1 ? 'party' : 'parties'}</p>
              <div className="space-y-2">
                {(selectedTable.parties || []).map((party) => (
                  <button key={party.order_id} type="button" onClick={() => router.push(`/cashier/pos?order=${party.order_id}`)} className="flex w-full items-center justify-between rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-left hover:border-sky-400">
                    <div><p className="font-semibold text-gray-900">{party.party_label || 'Party'}</p><p className="text-xs text-gray-500">Open POS · {party.order_number}</p></div>
                    <span className="font-bold text-sky-800">{formatCurrency(party.amount)}</span>
                  </button>
                ))}
                {!(selectedTable.parties || []).length && selectedTable.current_order_id && <button type="button" onClick={() => router.push(`/cashier/pos?order=${selectedTable.current_order_id}`)} className="w-full rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-left font-semibold text-sky-900">Open order in POS</button>}
                <button type="button" onClick={() => router.push(`/cashier/pos?table=${selectedTable.id}&new_party=1`)} className="w-full rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-left font-semibold text-violet-900">Add another party</button>
                <button type="button" onClick={() => setSelectedTable(null)} className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600">Cancel</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </AdminLayout>
  );
}
