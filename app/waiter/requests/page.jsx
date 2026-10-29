'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, BellRing } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import WaiterRequestsBoard from '@/components/waiter-requests/waiter-requests-board';

export default function WaiterRequestsPage() {
  const router = useRouter();
  const { token, loading } = useAuth();

  useEffect(() => {
    if (!loading && !token) router.replace('/login');
  }, [loading, token, router]);

  if (loading || !token) return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">Loading…</div>;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <button type="button" onClick={() => router.push('/waiter')} className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-700 active:scale-[0.97]" aria-label="Back to waiter floor"><ArrowLeft className="h-5 w-5" /></button>
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-800"><BellRing className="h-5 w-5" /></span>
          <div>
            <h1 className="font-semibold text-slate-950">Waiter Calls</h1>
            <p className="text-xs text-slate-500">Live requests from tables</p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4 sm:p-6">
        <WaiterRequestsBoard compactHeader />
      </main>
    </div>
  );
}
