'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, RefreshCw, Search, TriangleAlert, Warehouse } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/components/ui/toast';
import { friendlyFromError } from '@/lib/friendly-message';

export default function KitchenInventoryPage() {
  const router = useRouter();
  const { apiCall } = useAuth();
  const { addToast } = useToast();
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiCall('/api/admin/inventory');
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not load stock');
      setItems(data.items || []);
    } catch (error) {
      addToast(friendlyFromError(error, 'load_failed'));
    } finally {
      setLoading(false);
    }
  }, [apiCall, addToast]);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => !q || [item.item_name, item.category]
      .some((value) => String(value || '').toLowerCase().includes(q)));
  }, [items, search]);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <button type="button" onClick={() => router.push('/kitchen')} aria-label="Back to kitchen" className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100"><ArrowLeft className="h-5 w-5" /></button>
          <div className="flex-1"><h1 className="font-bold text-slate-950">Stock levels</h1><p className="text-xs text-slate-500">Read-only kitchen inventory</p></div>
          <button type="button" onClick={load} title="Refresh stock" aria-label="Refresh stock" className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
        </div>
        <div className="mx-auto max-w-5xl px-4 pb-3">
          <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search stock" className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm" /></div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((item) => {
            const onHand = Number(item.quantity || 0);
            const min = Number(item.min_stock_level || 0);
            const low = onHand <= min;
            const unit = item.consumption_unit || item.unit || '';
            return (
              <article key={item.id} className={`border p-4 ${low ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}>
                <div className="flex items-start gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center ${low ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>{low ? <TriangleAlert className="h-5 w-5" /> : <Warehouse className="h-5 w-5" />}</div>
                  <div className="min-w-0 flex-1"><h2 className="truncate font-semibold text-slate-950">{item.item_name}</h2><p className="text-xs text-slate-500">{item.category || 'Uncategorised'}</p></div>
                </div>
                <div className="mt-4 flex items-end justify-between"><div><p className="text-xs text-slate-500">On hand</p><p className={`text-xl font-bold tabular-nums ${low ? 'text-amber-900' : 'text-slate-950'}`}>{onHand.toLocaleString()} <span className="text-sm font-medium">{unit}</span></p></div><p className="text-xs text-slate-500">Min {min.toLocaleString()}</p></div>
              </article>
            );
          })}
        </div>
        {!loading && rows.length === 0 && <p className="py-16 text-center text-slate-500">No stock items found.</p>}
      </main>
    </div>
  );
}
