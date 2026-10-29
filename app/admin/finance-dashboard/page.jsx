'use client';

import { useEffect, useState } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import Link from 'next/link';
import { useToast } from '@/components/ui/toast';
import { friendlyFromError } from '@/lib/friendly-message';
import { apiJson } from '@/lib/authed-fetch';
import { money } from '@/components/accounting/ledger-table';
import { formatNepalDisplay } from '@/lib/report-dates.js';

const CARDS = [
  { key: 'sales_today', label: "Today's Sales", tone: 'text-emerald-700', href: '/admin/general-ledger' },
  { key: 'sales_week', label: 'Weekly Sales', tone: 'text-emerald-700', href: '/admin/financial-reports' },
  { key: 'sales_month', label: 'Monthly Sales', tone: 'text-emerald-700', href: '/admin/financial-reports' },
  { key: 'profit_today', label: "Today's Net Profit", tone: 'text-gray-900', href: '/admin/financial-reports' },
  { key: 'profit_month', label: 'Monthly Net Profit', tone: 'text-gray-900', href: '/admin/financial-reports' },
  { key: 'expenses_today', label: 'Expenses Today', tone: 'text-rose-700', href: '/admin/expenses' },
  { key: 'cash_in_drawer', label: 'Cash Balance', tone: 'text-gray-900', href: '/admin/cash-book' },
  { key: 'bank_balance', label: 'Bank Balance', tone: 'text-gray-900', href: '/admin/bank-book' },
  { key: 'outstanding_ar', label: 'Customer Credit (AR)', tone: 'text-amber-700', href: '/admin/accounts-receivable' },
  { key: 'outstanding_ap', label: 'Supplier Payable (AP)', tone: 'text-amber-700', href: '/admin/accounts-payable' },
  { key: 'inventory_value', label: 'Inventory Value', tone: 'text-gray-900', href: '/admin/inventory' },
  { key: 'cash_in_today', label: 'Cash In Today', tone: 'text-emerald-700', href: '/admin/cash-book' },
  { key: 'cash_out_today', label: 'Cash Out Today', tone: 'text-rose-700', href: '/admin/cash-book' },
];

export default function FinanceDashboardPage() {
  const { addToast } = useToast();
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiJson('/api/admin/finance-dashboard')
      .then(setD)
      .catch((e) => addToast(friendlyFromError(e, 'load_failed')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const maxSales = Math.max(1, ...((d?.sales_trend || []).map((x) => x.sales)));
  const maxCat = Math.max(1, ...((d?.top_expense_categories || []).map((x) => x.total)));

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Finance Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Financial health at a glance — Nepal time{d?.today ? ` · ${formatNepalDisplay(d.today)}` : ''}.
        </p>
      </header>

      <div className="space-y-6 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {CARDS.map((c) => (
            <Link key={c.key} href={c.href} className="rounded-2xl border border-gray-200 bg-white p-5 transition-shadow hover:shadow-sm">
              <p className="text-sm font-medium text-gray-500">{c.label}</p>
              <p className={`mt-2 text-2xl font-bold tabular-nums ${c.tone}`}>{loading ? '…' : money(d?.[c.key])}</p>
            </Link>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-gray-200 bg-white p-5">
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Sales — last 7 days (NPT)</h2>
            {(d?.sales_trend || []).length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-400">No sales recorded yet.</p>
            ) : (
              <div className="flex items-end gap-2" style={{ height: 160 }}>
                {d.sales_trend.map((x) => (
                  <div key={x.date} className="flex flex-1 flex-col items-center justify-end gap-1">
                    <span className="text-[10px] text-gray-400">{x.sales ? money(x.sales).replace('Rs ', '') : ''}</span>
                    <div className="w-full rounded-t bg-emerald-500" style={{ height: `${(x.sales / maxSales) * 120}px`, minHeight: x.sales ? 3 : 0 }} />
                    <span className="text-[10px] text-gray-500">{formatNepalDisplay(x.date).split(' ')[0]}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5">
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Top expense categories — today</h2>
            {(d?.top_expense_categories || []).length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-400">No expenses logged today.</p>
            ) : (
              <div className="space-y-3">
                {d.top_expense_categories.map((c) => (
                  <div key={c.category}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="text-gray-700">{c.category}</span>
                      <span className="tabular-nums font-medium text-gray-900">{money(c.total)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-100"><div className="h-2 rounded-full bg-rose-500" style={{ width: `${(c.total / maxCat) * 100}%` }} /></div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {(d?.recent_large_transactions || []).length > 0 && (
          <section className="rounded-2xl border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Recent large transactions</h2>
            <div className="divide-y divide-gray-100">
              {d.recent_large_transactions.map((t) => (
                <div key={t.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <p className="text-gray-900">{t.memo || t.source || 'Journal'}</p>
                    <p className="text-xs text-gray-400">{t.date} · {t.source}</p>
                  </div>
                  <span className="tabular-nums font-medium text-gray-900">{money(t.amount)}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </AdminLayout>
  );
}
