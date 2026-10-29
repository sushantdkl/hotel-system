'use client';

import { useMemo, useState } from 'react';
import { MessageCircle, X, Check, Send } from 'lucide-react';
import { fillTemplate, openWhatsapp, whatsappNumber } from '@/lib/whatsapp.js';

/**
 * Sends one WhatsApp message to many customers. WhatsApp only allows one
 * click-to-chat per user action, so this walks a queue: each click opens the
 * next chat with the message pre-filled and marks it done.
 * recipients: [{ id, name, phone, amount? }]
 */
export default function WhatsappBulkModal({ open, ...props }) {
  // Mounted only while open so message/sent state starts fresh each time.
  return open ? <BulkModalBody {...props} /> : null;
}

function BulkModalBody({ onClose, recipients, template, restaurant, title = 'Send WhatsApp message' }) {
  const [message, setMessage] = useState(template || '');
  const [sent, setSent] = useState({});
  const [error, setError] = useState('');

  const rows = useMemo(() => recipients.map((r) => ({
    ...r,
    valid: Boolean(whatsappNumber(r.phone)),
    text: fillTemplate(message, { name: r.name, restaurant, amount: r.amount ?? '', phone: r.phone, bills: r.bills ?? '' }),
  })), [recipients, message, restaurant]);

  const send = (row) => {
    setError('');
    if (!openWhatsapp(row.phone, row.text)) {
      setError('WhatsApp did not open — allow pop-ups for this site and try again.');
      return;
    }
    setSent((prev) => ({ ...prev, [row.id]: true }));
  };
  const next = rows.find((r) => r.valid && !sent[r.id]);
  const doneCount = rows.filter((r) => sent[r.id]).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[92dvh] w-full max-w-2xl flex-col rounded-lg bg-white">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{title}</h2>
            <p className="text-xs text-gray-500">{recipients.length} selected · {doneCount} opened</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-600 hover:bg-gray-100" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-3 overflow-y-auto px-5 py-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Message</span>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900" />
            <span className="mt-1 block text-xs text-gray-500">Use {'{name}'}, {'{restaurant}'}, {'{amount}'}, {'{bills}'} — replaced for each customer.</span>
          </label>

          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">WhatsApp opens one chat at a time. Press “Open next chat”, send the message there, then come back for the next one.</p>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</p>}

          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-gray-900">{row.name}</p>
                  <p className="text-xs text-gray-500">{row.phone || 'No phone'}{!row.valid && row.phone ? ' · invalid number' : ''}</p>
                </div>
                <button
                  type="button"
                  disabled={!row.valid}
                  onClick={() => send(row)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${sent[row.id] ? 'bg-emerald-50 text-emerald-700' : 'bg-green-600 text-white hover:bg-green-700'}`}
                >
                  {sent[row.id] ? <><Check className="h-3.5 w-3.5" /> Opened</> : <><MessageCircle className="h-3.5 w-3.5" /> Send</>}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Close</button>
          <button type="button" disabled={!next} onClick={() => next && send(next)} className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-40">
            <Send className="h-4 w-4" /> {next ? `Open next chat (${next.name})` : 'All done'}
          </button>
        </div>
      </div>
    </div>
  );
}
