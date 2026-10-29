'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { permissionForOperationalPath } from '@/lib/staff-access-policy';

const CapabilitiesContext = createContext({});

export function useStaffCapabilities() {
  return useContext(CapabilitiesContext);
}

export default function StaffAreaGuard({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [capabilities, setCapabilities] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const token = localStorage.getItem('pos_token');
    if (!token) {
      router.replace('/login');
      return undefined;
    }
    fetch('/api/auth/capabilities', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('unauthorized')))
      .then((data) => { if (!cancelled) setCapabilities(data.capabilities || {}); })
      .catch(() => { if (!cancelled) setCapabilities({}); });
    return () => { cancelled = true; };
  }, [router]);

  if (capabilities === null) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">Loading permissions…</div>;
  }

  const required = permissionForOperationalPath(pathname);
  const disabledByOwner = pathname === '/kitchen/cancellations' && capabilities['kot_cancellation_approval.enabled'] !== true;
  if ((required && capabilities[required] !== true) || disabledByOwner) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-16">
        <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <ShieldCheck className="mx-auto h-10 w-10 text-slate-400" />
          <h1 className="mt-4 text-xl font-bold text-slate-950">Access not allowed</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">{disabledByOwner ? 'An administrator must enable cancelled KOT approval in Settings before this page can be used.' : 'An administrator has disabled this area for your role.'}</p>
          <button type="button" onClick={() => router.replace('/login')} className="mt-6 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">Return to sign in</button>
        </div>
      </main>
    );
  }

  return <CapabilitiesContext.Provider value={capabilities}>{children}</CapabilitiesContext.Provider>;
}
