/**
 * Shared thermal-receipt print system. One place owns the @page / @media print
 * CSS so every receipt (cashier bill, walk-in, KOT) prints identically and can
 * switch between 80mm and 58mm printers from Settings — no per-page CSS.
 *
 * Callers build only the receipt <body> markup (using the class helpers below)
 * and hand it to openReceiptPrint({ size, body }).
 */

// body width is the printable area; thermal heads waste ~4-8mm of the paper.
// Sizes tuned so 58mm keeps proportionally the same scale as 80mm rather than
// just shrinking the same pixel values into a narrower box.
export const RECEIPT_SIZES = {
  '58': { page: '58mm', body: '48mm', base: 11, name: 14, doctype: 10, total: 13 },
  '80': { page: '80mm', body: '72mm', base: 12, name: 16, doctype: 11, total: 15 },
  'a4': { page: 'A4', body: '190mm', base: 12, name: 22, doctype: 14, total: 17 },
};

export function normalizeSize(size) {
  const s = String(size || '80').toLowerCase().replace('mm', '').trim();
  return RECEIPT_SIZES[s] ? s : '80';
}

/**
 * Money formatter shared by every receipt template. One place decides the
 * currency style so nothing prints "Rs 250" next to "250.00" next to
 * "Rs.250.00". Values are already-finalized numbers from the billing layer —
 * this only formats, it never computes.
 * @param {number} amount
 * @param {{ prefix?: boolean, sign?: boolean }} opts  prefix: show "Rs. "; sign: show +/- for signed deltas.
 */
export function formatReceiptMoney(amount, { prefix = false, sign = false } = {}) {
  const n = Number(amount) || 0;
  const abs = Math.abs(n);
  const grouped = abs.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const signStr = sign ? (n < 0 ? '−' : n > 0 ? '+' : '') : (n < 0 ? '-' : '');
  return `${signStr}${prefix ? 'Rs. ' : ''}${grouped}`;
}

/**
 * The full <style> block for a given paper size.
 * `layout: 'bill'` is the customer-facing document (taller line-height, more
 * breathing room between sections); `layout: 'kot'` is the dense kitchen
 * ticket. Both share the same type scale and column system.
 */
export function receiptStyle(size = '80', { layout = 'kot' } = {}) {
  const c = RECEIPT_SIZES[normalizeSize(size)];
  const bill = layout === 'bill';
  const padY = bill ? '3mm 2.2mm' : '2mm';
  const lh = bill ? 1.35 : 1.3;
  return `<style>
    @media print { @page { size: ${c.page}${c.page === 'A4' ? '' : ' auto'}; margin: ${c.page === 'A4' ? '10mm' : '0'}; } }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: ${c.body}; }
    body { max-width: ${c.body}; margin: 0 auto; padding: ${padY};
      font-family: Arial, Helvetica, 'Segoe UI', system-ui, sans-serif;
      font-size: ${c.base}px; line-height: ${lh}; background: #fff; color: #000;
      -webkit-print-color-adjust: exact; print-color-adjust: exact; }

    .r-center { text-align: center; }
    .r-b { font-weight: bold; }
    .r-sm { font-size: ${c.base - 1}px; }
    .r-xs { font-size: ${c.base - 2}px; color: #333; }
    .r-num { font-variant-numeric: tabular-nums; font-feature-settings: 'tnum' 1; }

    /* Header: restaurant identity, largest text on the receipt */
    .r-head { text-align: center; padding-bottom: ${bill ? '3mm' : '1.5mm'}; }
    .r-name { font-size: ${c.name}px; font-weight: 800; letter-spacing: .2px; line-height: 1.15; }
    .r-head .r-sm { display: block; color: #111; margin-top: 1px; }

    /* Document type banner: what kind of document this is (bill, pre-bill, etc.) */
    .r-doctype { text-align: center; border-top: 1px solid #000; border-bottom: 1px solid #000;
      padding: ${bill ? '1.6mm' : '1mm'} 0; margin-bottom: ${bill ? '2.5mm' : '1.5mm'}; }
    .r-doctype .r-b { font-size: ${c.doctype}px; letter-spacing: .5px; }
    .r-doctype .r-tag { font-size: ${c.base - 2}px; margin-top: 1px; }

    /* Two-column metadata grid: label-free pairs, compact rows */
    .r-meta { margin-bottom: ${bill ? '2.2mm' : '1mm'}; }
    .r-meta-row { display: flex; justify-content: space-between; gap: 6px; margin: 1px 0; font-size: ${c.base - 1}px; }
    .r-meta-row .l { color: #000; }
    .r-meta-row .v { font-weight: 600; text-align: right; }
    .r-meta-full { margin: 1px 0; font-size: ${c.base - 1}px; }

    .r-hr { border-top: 1px dashed #000; margin: ${bill ? '2mm' : '1mm'} 0; }

    /* Item table */
    table { width: 100%; border-collapse: collapse; margin: ${bill ? '1mm 0 2mm' : '1mm 0'}; }
    thead th { border-top: 1px solid #000; border-bottom: 1px solid #000; padding: ${bill ? '1.4mm' : '0.8mm'} 0;
      text-align: left; font-size: ${c.base - 2}px; font-weight: 700; text-transform: uppercase; letter-spacing: .3px; }
    tbody td { padding: ${bill ? '1.1mm' : '0.6mm'} 0; font-size: ${c.base - 1}px; vertical-align: top; }
    tbody tr.r-item-sub td { padding-top: 0; padding-bottom: ${bill ? '1.4mm' : '0.8mm'}; }
    .c-qty { width: 11%; text-align: center; }
    .c-name { width: 47%; text-align: left; padding-right: 2px; word-break: break-word; }
    .c-price { width: 20%; text-align: right; }
    .c-total { width: 22%; text-align: right; }
    .r-mod { font-size: ${c.base - 3}px; color: #222; padding-left: 2px; line-height: 1.25; }

    /* Totals */
    .r-row { display: flex; justify-content: space-between; margin: 1px 0; font-size: ${c.base - 1}px; }
    .r-totals { margin-top: ${bill ? '1mm' : '0.5mm'}; }
    .r-grand { border-top: 2px solid #000; border-bottom: 2px solid #000; padding: ${bill ? '1.8mm' : '1mm'} 0;
      margin: ${bill ? '1.5mm 0' : '0.8mm 0'}; display: flex; justify-content: space-between; align-items: baseline;
      font-size: ${c.total}px; font-weight: 800; }

    /* Footer */
    .r-foot { text-align: center; padding-top: ${bill ? '2mm' : '1mm'}; font-size: ${c.base - 2}px; line-height: 1.4; }
    .r-foot .r-thanks { font-size: ${c.base - 1}px; font-weight: 700; margin-bottom: 1px; }
    .r-qr { display: block; margin: ${bill ? '2mm' : '1mm'} auto; width: ${c.body === '48mm' ? '28mm' : '38mm'}; max-width: 80%; }
  </style>`;
}

/**
 * Open a print window with the shared thermal CSS, write the body, auto-print
 * and close. `body` is receipt markup only (no <html>/<head>/<style>).
 * @param {{ title?: string, size?: string, body?: string, layout?: 'kot'|'bill' }} opts
 */
export function openReceiptPrint({ title = 'Receipt', size = '80', body = '', layout = 'kot' } = {}) {
  const w = window.open('', '', 'width=360,height=640');
  if (!w) return false;
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title>${receiptStyle(size, { layout })}</head><body>${body}
    <script>
      var printed=false;
      window.onload=function(){ if(printed) return; printed=true; window.focus(); window.print();
        setTimeout(function(){ window.close(); }, 400); };
    </script></body></html>`);
  w.document.close();
  w.focus();
  return true;
}
