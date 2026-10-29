'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Banknote, CheckCircle2, LayoutDashboard, Loader2, Receipt, ShieldAlert } from 'lucide-react';

const DENOMINATIONS = [1000, 500, 100, 50, 20, 10, 5, 2, 1];
const money = (value) => `Rs ${Number(value || 0).toLocaleString('en-IN')}`;

export default function CashCountGate({ children, active }) {
  const pathname = usePathname();
  const router = useRouter();
  const [status, setStatus] = useState(null);
  const [checked, setChecked] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [counts, setCounts] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const refresh = useCallback(async () => {
    if (!active) return;
    try {
      const token = localStorage.getItem('pos_token');
      const response = await fetch('/api/admin/cash-counts', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Cash-count status is temporarily unavailable.');
      const data = await response.json();
      setStatus(data.status || null);
      setCheckError('');
    } catch (statusError) {
      setCheckError(statusError.message || 'Cash-count status is temporarily unavailable.');
    } finally {
      setChecked(true);
    }
  }, [active]);

  useEffect(() => {
    if (!active) return undefined;
    refresh();
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [active, refresh, pathname]);

  const total = useMemo(() => DENOMINATIONS.reduce(
    (sum, denomination) => sum + denomination * (Number(counts[denomination]) || 0), 0
  ), [counts]);

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const token = localStorage.getItem('pos_token');
      const response = await fetch('/api/admin/cash-counts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ denominations: counts }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not submit the count.');
      setSubmitted(true);
      setStatus((previous) => ({ ...previous, due: false, completed: true, submission: data.result }));
      window.setTimeout(() => setSubmitted(false), 2500);
    } catch (submitError) {
      setError(submitError.message || 'Could not submit the count.');
      await refresh();
    } finally {
      setSubmitting(false);
    }
  };

  const emergencyRoute = pathname === '/cashier/dashboard' || pathname?.startsWith('/cashier/dashboard/')
    || pathname === '/cashier/pos' || pathname?.startsWith('/cashier/pos/');

  if (!active || emergencyRoute) return children;

  if (!checked || (checkError && !status)) {
    return (
      <main className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center bg-gray-50 p-4 lg:min-h-screen">
        <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-7 text-center shadow-sm">
          {!checked ? <Loader2 className="mx-auto h-7 w-7 animate-spin text-gray-400" /> : <ShieldAlert className="mx-auto h-8 w-8 text-amber-600" />}
          <h1 className="mt-4 text-lg font-bold text-gray-950">{!checked ? 'Checking cash-count status' : 'Cash-count check unavailable'}</h1>
          <p className="mt-2 text-sm leading-6 text-gray-500">{!checked ? 'This takes only a moment.' : `${checkError} Dashboard and POS remain available.`}</p>
          {checked && <div className="mt-5 flex justify-center gap-2"><button type="button" onClick={refresh} className="h-10 rounded-xl border border-gray-300 px-4 text-sm font-semibold text-gray-700">Retry</button><button type="button" onClick={() => router.push('/cashier/pos')} className="h-10 rounded-xl bg-gray-950 px-4 text-sm font-semibold text-white">Open POS</button></div>}
        </div>
      </main>
    );
  }

  if (!status?.due) return children;

  return (
    <main className="min-h-[calc(100vh-3.5rem)] bg-gradient-to-b from-amber-50 via-gray-50 to-gray-50 px-4 py-8 sm:px-6 lg:min-h-screen lg:px-8 lg:py-12">
      <div className="mx-auto max-w-4xl">
        <div className="mb-5 flex flex-col justify-between gap-4 rounded-2xl border border-amber-200 bg-amber-100/70 p-4 sm:flex-row sm:items-center">
          <div className="flex gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div>
              <p className="font-semibold text-amber-950">Scheduled drawer count is due</p>
              <p className="mt-0.5 text-sm text-amber-800">Other cashier areas pause until this blind cash count is submitted. Expected cash is intentionally hidden.</p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={() => router.push('/cashier/dashboard')} className="inline-flex h-10 items-center gap-2 rounded-xl border border-amber-300 bg-white px-3 text-sm font-semibold text-gray-800 hover:bg-amber-50"><LayoutDashboard className="h-4 w-4" /> Dashboard</button>
            <button type="button" onClick={() => router.push('/cashier/pos')} className="inline-flex h-10 items-center gap-2 rounded-xl bg-gray-950 px-3 text-sm font-semibold text-white hover:bg-gray-800"><Receipt className="h-4 w-4" /> POS</button>
          </div>
        </div>

        <form onSubmit={submit} className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-xl shadow-gray-200/60">
          <div className="border-b border-gray-100 px-5 py-6 sm:px-8">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700"><Banknote className="h-6 w-6" /></span>
              <div>
                <h1 className="text-xl font-bold text-gray-950 sm:text-2xl">Count the cash in the drawer</h1>
                <p className="mt-1 text-sm text-gray-500">Count each denomination physically. Do not estimate or use a system balance.</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2 sm:p-8">
            {DENOMINATIONS.map((denomination) => {
              const quantity = Number(counts[denomination]) || 0;
              return (
                <label key={denomination} className="grid grid-cols-[1fr_auto_7rem] items-center gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-3 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-100">
                  <span className="font-bold text-gray-900">Rs {denomination.toLocaleString('en-IN')}</span>
                  <span className="text-sm font-semibold text-gray-400">×</span>
                  <input
                    type="number"
                    min="0"
                    max="100000"
                    step="1"
                    inputMode="numeric"
                    aria-label={`Quantity of Rs ${denomination}`}
                    value={counts[denomination] ?? ''}
                    onChange={(event) => setCounts((previous) => ({ ...previous, [denomination]: event.target.value }))}
                    placeholder="0"
                    className="h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-right text-base font-semibold text-gray-950 outline-none"
                  />
                  <span className="col-span-3 text-right text-xs font-medium text-gray-500">{money(denomination * quantity)}</span>
                </label>
              );
            })}
          </div>

          <div className="flex flex-col gap-4 border-t border-gray-100 bg-gray-50 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <div><p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Your counted total</p><p className="mt-1 text-2xl font-black text-gray-950">{money(total)}</p></div>
            <button type="submit" disabled={submitting} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-6 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {submitting ? 'Submitting…' : 'Submit drawer count'}
            </button>
          </div>
          {error && <p role="alert" className="border-t border-rose-100 bg-rose-50 px-5 py-3 text-sm font-medium text-rose-700 sm:px-8">{error}</p>}
          {submitted && <p className="border-t border-emerald-100 bg-emerald-50 px-5 py-3 text-sm font-medium text-emerald-700 sm:px-8">Count recorded. Cashier areas are available again.</p>}
        </form>
      </div>
    </main>
  );
}
