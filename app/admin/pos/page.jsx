'use client';

import { useEffect, useState } from 'react';
import { CalendarClock, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import AdminLayout from '@/components/admin/admin-layout';
import AdminPos from '@/components/pos/admin-pos';
import { apiJson } from '@/lib/authed-fetch';

export default function AdminPosPage() {
  const router = useRouter();
  const [status, setStatus] = useState(undefined);
  useEffect(() => {
    let active = true;
    apiJson('/api/admin/business-days?view=context')
      .then((data) => { if (active) setStatus(data); })
      .catch(() => { if (active) setStatus(null); });
    return () => { active = false; };
  }, []);
  const ready = !!status?.activeSession;
  return (
    <AdminLayout>
      {status === undefined ? <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
        : ready ? <AdminPos /> : <div className="flex min-h-[70vh] items-center justify-center bg-gray-50 p-4"><div className="w-full max-w-lg border border-gray-200 bg-white p-7 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center bg-gray-950 text-white"><CalendarClock className="h-6 w-6" /></div><h1 className="mt-5 text-2xl font-bold text-gray-950">{status?.storeClosed ? 'Store Session Closed' : 'Business Day Opening Required'}</h1><p className="mt-2 text-sm leading-6 text-gray-600">{status?.storeClosed ? 'Reopen the store session before taking orders or payments.' : 'Enter the business date and physical opening cash before taking orders or payments.'}</p><button type="button" onClick={() => router.push('/admin/business-days')} className="mt-6 h-12 w-full bg-gray-950 px-5 text-sm font-semibold text-white hover:bg-black">{status?.storeClosed ? 'Reopen Store' : 'Open Business Day'}</button></div></div>}
    </AdminLayout>
  );
}
