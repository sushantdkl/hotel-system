'use client';

import { useEffect, useState } from 'react';
import { Printer, X } from 'lucide-react';
import { apiJson } from '@/lib/authed-fetch';
import { useToast } from '@/components/ui/toast';
import { friendlyFromError } from '@/lib/friendly-message';
import { resolvePrinterSettings, settingEnabled } from '@/lib/printer-settings';

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

export function printTableQr(qr, settings = {}) {
  if (!qr?.svg) return;
  const p = resolvePrinterSettings(settings);
  const qrSize = Math.min(130, Math.max(90, Number(p.qr_print_size_mm) || 110));
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  printWindow.document.write(`<!doctype html>
    <html><head><meta charset="utf-8"><title>Table ${escapeHtml(qr.table_number)} QR</title>
    <style>
      *{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#111;font-family:Arial,sans-serif}
      @page{size:A4 portrait;margin:10mm}.sheet{width:190mm;margin:0 auto;padding:0}
      .card{width:170mm;min-height:230mm;margin:0 auto;text-align:center;border:${settingEnabled(p.qr_show_border) ? '1.5px solid #111' : '0'};border-radius:5mm;padding:14mm 12mm}
      .brand{margin:0 0 5mm;font-size:5mm;font-weight:700;letter-spacing:.2mm}
      h1{margin:0;font-size:14mm;line-height:1.05}.hint{margin:4mm 0 7mm;font-size:6mm}
      .qr{width:${qrSize}mm;height:${qrSize}mm;margin:0 auto}.qr svg{display:block;width:100%!important;height:100%!important}
      .url{margin:6mm auto 0;max-width:150mm;font-size:3.2mm;color:#555;overflow-wrap:anywhere}.foot{margin-top:7mm;font-size:4mm;font-weight:600}
      @media print{.sheet{margin:0}.card{break-inside:avoid}}
    </style></head><body><main class="sheet"><section class="card">
      ${settingEnabled(p.qr_show_restaurant) ? `<p class="brand">${escapeHtml(p.restaurant_name || 'Restaurant')}</p>` : ''}
      <h1>${escapeHtml(p.qr_title_prefix)} ${escapeHtml(qr.table_number)}</h1>
      <p class="hint">${escapeHtml(p.qr_instruction)}</p>
      <div class="qr">${qr.svg}</div>
      ${settingEnabled(p.qr_show_url, false) ? `<p class="url">${escapeHtml(qr.url)}</p>` : ''}
      ${p.qr_footer ? `<p class="foot">${escapeHtml(p.qr_footer)}</p>` : ''}
    </section></main></body></html>`);
  printWindow.document.close();
  printWindow.focus();
  window.setTimeout(() => printWindow.print(), 250);
}

export default function TableQrModal({ table, onClose }) {
  const { addToast } = useToast();
  const [qr, setQr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState({});

  useEffect(() => {
    if (!table?.id) return;
    let active = true;
    Promise.all([apiJson(`/api/admin/table-qr?id=${table.id}`), apiJson('/api/admin/settings').catch(() => ({ settings: {} }))])
      .then(([data, config]) => { if (active) { setQr(data); setSettings(config.settings || {}); } })
      .catch((error) => {
        if (active) {
          addToast(friendlyFromError(error, 'load_failed'));
          onClose();
        }
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [table?.id, addToast, onClose]);

  if (!table) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={`QR code for table ${table.table_number}`}>
      <div className="relative w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-2xl">
        <button type="button" onClick={onClose} className="absolute right-3 top-3 rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label="Close QR code">
          <X className="h-5 w-5" />
        </button>
        {loading || !qr ? (
          <p className="py-16 text-sm text-gray-500">Generating QR…</p>
        ) : (
          <>
            <h3 className="text-xl font-bold text-gray-900">Table {qr.table_number}</h3>
            <p className="mb-4 mt-1 text-sm text-gray-500">Customers scan this to view the menu and order.</p>
            <div className="mx-auto w-full max-w-72 [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: qr.svg }} />
            <p className="mt-3 break-all text-[11px] text-gray-400">{qr.url}</p>
            <div className="mt-5 flex gap-3">
              <button type="button" onClick={() => printTableQr(qr, settings)} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800">
                <Printer className="h-4 w-4" /> Print QR
              </button>
              <button type="button" onClick={onClose} className="flex-1 rounded-lg bg-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-300">Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
