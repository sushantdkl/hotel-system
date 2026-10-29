'use client';

import { useEffect, useState } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import { useToast } from '@/components/ui/toast';
import { friendlyFromError } from '@/lib/friendly-message';
import { apiJson } from '@/lib/authed-fetch';
import { KpiCards } from '@/components/admin/report-kit';

const hourLabel = (h) => `${((h + 11) % 12) + 1}${h < 12 ? 'a' : 'p'}`;

export default function KitchenAnalyticsPage() {
  const { addToast } = useToast();
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = () => apiJson('/api/admin/kitchen-analytics').then(setD).catch((e) => addToast(friendlyFromError(e, 'load_failed'))).finally(() => setLoading(false));
  useEffect(() => {
    load();
    const t = setInterval(load, 30000); // refresh for a live kitchen
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const maxHour = Math.max(1, ...((d?.by_hour || []).map((x) => x.count)));
  const activeHours = (d?.by_hour || []).filter((x) => x.count > 0);

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Kitchen Analytics</h1>
        <p className="mt-1 text-sm text-gray-500">Today&apos;s throughput, preparation times and chef performance. Refreshes live.</p>
      </header>

      <div className="space-y-6 bg-gray-50 p-4 sm:p-6 lg:p-8">
        <KpiCards
          kpis={[
            { key: 'orders', label: 'Orders today', value: d?.orders_today ?? 0, format: 'number' },
            { key: 'ready', label: 'Completed', value: d?.ready_today ?? 0, format: 'number', sub: `${d?.active_now ?? 0} in progress` },
            { key: 'dishes', label: 'Dishes prepared', value: d?.dishes_prepared_today ?? 0, format: 'number' },
            { key: 'avg', label: 'Avg prep time', value: d?.avg_prep_minutes ?? 0, format: 'number', sub: 'minutes' },
            { key: 'busy', label: 'Busiest hour', value: d?.busiest_hour != null ? hourLabel(d.busiest_hour) : '—' },
          ]}
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-gray-200 bg-white p-5">
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Orders by hour</h2>
            {activeHours.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-400">No orders yet today.</p>
            ) : (
              <div className="flex items-end gap-1.5" style={{ height: 160 }}>
                {activeHours.map((x) => (
                  <div key={x.hour} className="flex flex-1 flex-col items-center justify-end gap-1">
                    <span className="text-[10px] text-gray-400">{x.count}</span>
                    <div className="w-full rounded-t bg-orange-500" style={{ height: `${(x.count / maxHour) * 120}px`, minHeight: 3 }} />
                    <span className="text-[10px] text-gray-500">{hourLabel(x.hour)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
            <div className="border-b border-gray-200 px-5 py-4"><h2 className="text-sm font-semibold text-gray-900">Chef performance — today</h2></div>
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr><th className="px-5 py-3 font-semibold">Chef</th><th className="px-5 py-3 text-right font-semibold">Orders</th><th className="px-5 py-3 text-right font-semibold">Dishes</th><th className="px-5 py-3 text-right font-semibold">Avg prep</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(d?.chefs || []).map((c) => (
                  <tr key={c.name} className="hover:bg-gray-50">
                    <td className="px-5 py-2.5 font-medium text-gray-900">{c.name}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-gray-900">{c.prepared}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-gray-900">{c.dishes}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-gray-600">{c.avg_prep_minutes} min</td>
                  </tr>
                ))}
                {!loading && (d?.chefs || []).length === 0 && <tr><td colSpan={4} className="px-5 py-8 text-center text-gray-500">No attributed prep yet. Chefs are credited when they mark orders preparing/ready.</td></tr>}
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </AdminLayout>
  );
}
