'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BedDouble } from 'lucide-react';
import { apiJson } from '@/lib/authed-fetch';

/** Restaurant bill -> hotel folio link (shown only when the bill was charged to a room). */
export default function BillFolioLink({ billId }) {
  const [link, setLink] = useState(null);
  useEffect(() => {
    let cancelled = false;
    apiJson(`/api/hotel/links?bill=${billId}`).then((data) => { if (!cancelled) setLink(data.link || null); }).catch(() => {});
    return () => { cancelled = true; };
  }, [billId]);
  if (!link) return null;
  return <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
    <p className="flex items-center gap-2 font-semibold"><BedDouble className="h-4 w-4" />Charged to hotel room{link.room ? ` ${link.room}` : ''}{link.guest ? ` · ${link.guest}` : ''}</p>
    <p className="mt-1 text-xs">On the guest folio: Rs {Number(link.folioAmount).toFixed(2)}{link.packageAmount ? ` · covered by meal plan: Rs ${Number(link.packageAmount).toFixed(2)}` : ''}. Revenue is counted once, here in the restaurant.</p>
    <Link className="mt-1 inline-block text-xs font-semibold underline" href={`/admin/hotel/folios?guest=${encodeURIComponent(link.stayId)}`}>Open guest folio</Link>
  </div>;
}
