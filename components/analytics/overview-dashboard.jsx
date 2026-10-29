'use client';

import { useState } from 'react';
import {
  Activity, BarChart3, ChefHat, ClipboardCheck, History, PackageSearch, ShoppingBasket, Users,
} from 'lucide-react';
import AnalyticsHome, { OwnerMoneyMetrics } from './analytics-home';
import { AllChanges } from './order-operations-analytics';
import OrderOperationsAnalytics from './order-operations-analytics';
import { VoidedPaymentControl } from './payment-reconciliation';
import { AnalyticsRecordProvider } from './analytics-record-viewer';

import { MenuPerformance, PaymentFinance } from './overview-commercial';
import {
  AttentionCenter, Controls,
  FloorAndReservations,
  InventorySupplier,
  LiveStatus,
  ManagementSummary,
  PeoplePerformance,
  RecentActivity,
} from './overview-operations';

export default function OverviewDashboard({
  data,
  panelPrefix = '/admin',
  transactionLoading = false,
  onTransactionPageChange,
  onTransactionPageSizeChange,
  onExportTransactions,
}) {
  const [view, setView] = useState('overview');
  const tabs = [
    ['overview', 'Overview', Activity],
    ['sales', 'Sales & Money', BarChart3],
    ['stock', 'Purchases & Stock', PackageSearch],
    ['menu', 'Menu & Tables', ShoppingBasket],
    ['kitchen', 'Orders & Billing', ChefHat],
    ['people', 'Customers & Team', Users],
    ['control', 'Controls & Activity', ClipboardCheck],
    // Its own top-level view, not a sub-tab of Orders & Billing: an owner asking
    // "what was cancelled, voided, refunded, re-billed or discounted today?" is
    // asking about the whole shift, not about one document type.
    ['changes', 'Cancellations & Changes', History],
  ];

  return (
    <AnalyticsRecordProvider range={data?.range || null}>
      <div>
        <OwnerMoneyMetrics data={data} panelPrefix={panelPrefix} />

        <div className="mb-5 sm:hidden">
          <label htmlFor="analytics-view" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">Analytics view</label>
          <select id="analytics-view" value={view} onChange={(event) => setView(event.target.value)} className="h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-900 shadow-sm">
            {tabs.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </div>

        <div className="mb-5 hidden overflow-x-auto overscroll-x-contain border-b border-gray-200 sm:block" role="tablist" aria-label="Analytics views">
          <div className="flex min-w-max gap-1">
            {tabs.map(([id, label, Icon]) => (
              <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)} className={`inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-[border-color,color,transform] duration-150 ease-out active:scale-[0.98] ${view === id ? 'border-gray-950 text-gray-950' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-800'}`}>
                <Icon className="h-4 w-4" />{label}
              </button>
            ))}
          </div>
        </div>

        {view === 'overview' && <AnalyticsHome data={data} />}
        {view === 'sales' && <div className="space-y-5"><PaymentFinance data={data} /></div>}
        {view === 'stock' && <div className="space-y-5"><InventorySupplier data={data} /></div>}
        {view === 'menu' && <div className="space-y-5"><MenuPerformance data={data} /><FloorAndReservations data={data} /></div>}
        {view === 'kitchen' && <div className="space-y-5"><LiveStatus data={data} /><OrderOperationsAnalytics data={data.orderOperations} live={data.live} /></div>}
        {view === 'people' && <div className="space-y-5"><PeoplePerformance data={data} /></div>}
        {view === 'changes' && <div className="space-y-5"><VoidedPaymentControl data={data} /><AllChanges report={data.orderOperations || {}} /></div>}
        {view === 'control' && <div className="space-y-5">
          <AttentionCenter rows={data.attention} />
          <Controls data={data} />
          <RecentActivity
            data={data}
            pagination={data.transactionPagination}
            loading={transactionLoading}
            onPageChange={onTransactionPageChange}
            onPageSizeChange={onTransactionPageSizeChange}
            onExportTransactions={onExportTransactions}
          />
          <ManagementSummary data={data} />
        </div>}
      </div>
    </AnalyticsRecordProvider>
  );
}
