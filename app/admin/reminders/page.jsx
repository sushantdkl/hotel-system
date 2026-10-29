'use client';

import { useEffect, useMemo, useState } from 'react';
import AdminLayout from '@/components/admin/admin-layout';
import { Search, MessageCircle, BellRing } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { authedRequest } from '@/lib/authed-fetch';
import WhatsappBulkModal from '@/components/customers/whatsapp-bulk-modal';
import { DEFAULT_REMINDER_MESSAGE, creditBillsMessage, fillTemplate, openWhatsapp, whatsappNumber } from '@/lib/whatsapp.js';

// Unpaid bills with items ride along by default; delete {bills} from the message to leave them out.
const withBills = (message) => (message.includes('{bills}') ? message : `${message}

{bills}`);

const FILTERS = [
  { id: 'credit', label: 'Credit due' },
  { id: 'all', label: 'All customers' },
  { id: 'vip', label: 'VIP' },
];

export default function RemindersPage() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [restaurant, setRestaurant] = useState('');
  const [message, setMessage] = useState(() => withBills(DEFAULT_REMINDER_MESSAGE));
  const [billsByCustomer, setBillsByCustomer] = useState({});
  const [filter, setFilter] = useState('credit');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [showBulk, setShowBulk] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [custRes, setRes, billsRes] = await Promise.all([
          authedRequest('/api/admin/customers'),
          authedRequest('/api/admin/settings'),
          authedRequest('/api/admin/accounts-receivable?view=open_bills').catch(() => null),
        ]);
        const custData = await custRes.json().catch(() => ({}));
        if (!custRes.ok) throw new Error(custData.error || 'Could not load customers.');
        setCustomers(custData.customers || []);
        if (setRes.ok) {
          const s = (await setRes.json()).settings || {};
          setRestaurant(s.restaurant_name || '');
          setMessage(withBills(s.whatsapp_reminder_message || DEFAULT_REMINDER_MESSAGE));
        }
        // Optional: needs customer-ledger access; without it {bills} is just left empty.
        if (billsRes?.ok) {
          const grouped = {};
          for (const b of (await billsRes.json()).bills || []) (grouped[b.customer_id] ||= []).push(b);
          setBillsByCustomer(grouped);
        }
      } catch (e) {
        setError(e.message || 'Could not load customers.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const dueOf = (c) => Number(c.current_credit || c.credit_balance || 0);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return customers
      .filter((c) => {
        if (filter === 'credit' && dueOf(c) <= 0.009) return false;
        if (filter === 'vip' && !c.is_vip) return false;
        if (!term) return true;
        return c.name?.toLowerCase().includes(term) || String(c.phone || '').includes(term);
      })
      .map((c) => ({
        ...c,
        amount: dueOf(c) > 0.009 ? formatCurrency(dueOf(c)) : '',
        bills: creditBillsMessage(billsByCustomer[c.id] || []),
      }));
  }, [customers, filter, search, billsByCustomer]);

  const selected = rows.filter((c) => selectedIds.has(c.id));
  const allSelected = rows.length > 0 && rows.every((c) => selectedIds.has(c.id));

  const toggle = (id) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const sendOne = (c) => {
    const text = fillTemplate(message, { name: c.name, restaurant, amount: c.amount, phone: c.phone, bills: c.bills });
    if (!openWhatsapp(c.phone, text)) setError('Could not open WhatsApp — check the number and allow pop-ups.');
    else setError('');
  };

  return (
    <AdminLayout>
      <header className="border-b border-gray-200 bg-white px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-800 sm:text-3xl"><BellRing className="h-7 w-7 text-green-600" /> Reminders</h1>
        <p className="mt-1 text-sm text-gray-700 sm:text-base">Send WhatsApp reminders to customers — one by one, or to everyone selected.</p>
      </header>

      <div className="space-y-4 p-4 sm:p-6 lg:p-8">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Message</span>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900" />
            <span className="mt-1 block text-xs text-gray-500">Use {'{name}'}, {'{restaurant}'}, {'{amount}'} (credit due), {'{bills}'} (unpaid bills with items). The default can be changed in Settings → WhatsApp messages.</span>
          </label>
        </div>

        <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-500" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or phone..." className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-4 text-gray-900" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" onClick={() => setFilter(f.id)} className={`rounded-full border px-3.5 py-1.5 text-sm font-medium ${filter === f.id ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>{f.label}</button>
            ))}
            <label className="ml-auto flex items-center gap-2 text-sm font-medium text-gray-800">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => setSelectedIds((prev) => {
                  const next = new Set(prev);
                  if (allSelected) rows.forEach((c) => next.delete(c.id)); else rows.forEach((c) => next.add(c.id));
                  return next;
                })}
                className="h-4 w-4 accent-green-600"
              />
              Select all shown
            </label>
            <button type="button" disabled={!selected.length} onClick={() => setShowBulk(true)} className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-40">
              <MessageCircle className="h-4 w-4" /> Send to selected ({selected.length})
            </button>
          </div>
        </div>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}

        <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {loading ? (
            <p className="py-10 text-center text-gray-700">Loading customers...</p>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-gray-700">No customers match this filter.</p>
          ) : rows.map((c) => (
            <div key={c.id} className="flex items-center gap-3 px-4 py-3">
              <input type="checkbox" checked={selectedIds.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Select ${c.name}`} className="h-4 w-4 shrink-0 accent-green-600" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-gray-900">{c.name}</p>
                <p className="text-xs text-gray-600">{c.phone || 'No phone'}</p>
              </div>
              {c.amount && <span className="shrink-0 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-700">Due {c.amount}</span>}
              <button
                type="button"
                disabled={!whatsappNumber(c.phone)}
                onClick={() => sendOne(c)}
                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-40"
              >
                <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
              </button>
            </div>
          ))}
        </div>
      </div>

      <WhatsappBulkModal
        open={showBulk}
        onClose={() => setShowBulk(false)}
        recipients={selected}
        template={message}
        restaurant={restaurant}
        title="Send reminders on WhatsApp"
      />
    </AdminLayout>
  );
}
