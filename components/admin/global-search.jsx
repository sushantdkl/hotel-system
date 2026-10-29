'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { apiJson } from '@/lib/authed-fetch';

/**
 * Search guests, stays, rooms, invoices, bills, orders, tables, customers,
 * suppliers and staff. The server returns only what the user may open.
 */
export default function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef(null);
  useEffect(() => {
    if (q.trim().length < 2) return undefined; // the list is hidden below 2 characters
    let cancelled = false;
    const t = setTimeout(() => {
      apiJson(`/api/search?q=${encodeURIComponent(q.trim())}`).then((d) => { if (!cancelled) { setResults(d.results || []); setActive(0); setOpen(true); } }).catch(() => {});
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);
  useEffect(() => {
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const go = (r) => { setOpen(false); setQ(''); router.push(r.href); };
  return <div ref={box} className="relative flex-shrink-0 px-3 pt-3">
    <label className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-emerald-500">
      <Search size={15} className="text-gray-400" />
      <input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => results.length && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          if (e.key === 'Enter' && results[active]) go(results[active]);
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder="Search guest, room, bill…" aria-label="Global search" role="combobox" aria-expanded={open} aria-controls="global-search-results" className="w-full bg-transparent outline-none" />
    </label>
    {open && q.trim().length >= 2 && <ul id="global-search-results" role="listbox" className="absolute left-3 right-3 z-50 mt-1 max-h-96 overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
      {!results.length ? <li className="px-3 py-2 text-xs text-gray-500">No matches you can open.</li> : results.map((r, i) => <li key={`${r.type}-${r.id}-${i}`} role="option" aria-selected={i === active}>
        <button type="button" onMouseEnter={() => setActive(i)} onClick={() => go(r)} className={`block w-full px-3 py-2 text-left ${i === active ? 'bg-emerald-50' : ''}`}>
          <span className="mr-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">{r.type}</span>
          <span className="text-sm font-medium text-gray-900">{r.title}</span>
          {r.subtitle && <span className="block truncate text-xs text-gray-500">{r.subtitle}</span>}
        </button>
      </li>)}
    </ul>}
  </div>;
}
