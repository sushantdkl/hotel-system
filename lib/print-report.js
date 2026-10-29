/**
 * Thermal printing for on-screen reports and lists.
 *
 * Instead of window.print()-ing a wide web page (which a thermal printer
 * shrinks to unreadable or spreads over metres of roll), the report's DOM is
 * read into label/value lines and reprinted in the receipt style from
 * lib/print-receipt.js at the configured paper size (Printer settings → paper
 * size). A4 keeps the browser's normal page print.
 *
 * What is read: headings (h1–h4), label/value rows (`justify-between` flex rows
 * or anything marked `data-print-row`), table rows and short paragraphs.
 * What is skipped: buttons, inputs, icons, `print:hidden`, `data-print-skip`,
 * and small-print notes (`text-xs` paragraphs).
 */

import { authedRequest } from '@/lib/authed-fetch';
import { normalizeSize, receiptStyle } from '@/lib/print-receipt.js';
import { formatNepalClock, formatNepalDate } from '@/lib/time-utils.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SKIP_TAGS = new Set(['BUTTON', 'svg', 'INPUT', 'SELECT', 'TEXTAREA', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'IMG']);
const AMOUNT = /^(?:[-+−]\s*)?(?:Rs\.?\s*)?[\d,]+(?:\.\d+)?%?$|^(?:[-+−]\s*)?Rs\.?\s*[\d,]+(?:\.\d+)?$|^—$/;
const MONEY = /\.\d|Rs|%|^—$/;

const cls = (el) => (typeof el.className === 'string' ? el.className : el.getAttribute('class') || '');
// Row text without its [data-print-skip] parts (inline notes like "accounting record").
const text = (el) => [...el.querySelectorAll('[data-print-skip]')]
  .reduce((t, s) => t.replace(s.innerText, ''), el.innerText || '')
  .replace(/\s*\n+\s*/g, ' · ').replace(/\s+/g, ' ').trim();
const bold = (el) => /\bfont-(?:bold|semibold|extrabold|black)\b/.test(cls(el)) || Boolean(el.closest('tfoot'));
const skip = (el) => SKIP_TAGS.has(el.tagName) || el.hasAttribute('data-print-skip')
  || /(?:^|\s)print:hidden(?:\s|$)/.test(cls(el)) || el.getClientRects().length === 0;

function isRow(el) {
  if (el.hasAttribute('data-print-row')) return true;
  if (!/\bjustify-between\b/.test(cls(el)) || el.children.length < 2) return false;
  return !el.querySelector('h1,h2,h3,h4,table,.justify-between,[data-print-row]');
}

/** Report DOM → printable lines, in reading order. */
export function readReport(root, items = []) {
  for (const el of root.children) {
    if (skip(el)) continue;
    if (/^H[1-4]$/.test(el.tagName)) {
      const kind = el.tagName === 'H4' ? 'sub' : el.tagName === 'H3' ? 'head' : 'group';
      if (text(el)) items.push({ type: kind, text: text(el) });
    } else if (el.tagName === 'TR') {
      const cells = [...el.cells].filter((c) => !skip(c)).map(text).filter(Boolean);
      if (!cells.length) continue;
      if (el.closest('thead')) { items.push({ type: 'sub', text: cells.join(' / ') }); continue; }
      const isMoney = (c) => AMOUNT.test(c) && MONEY.test(c);
      items.push({ type: 'row', label: cells.filter((c) => !isMoney(c)).join(' · '), value: cells.filter(isMoney).join(' | '), bold: bold(el) });
    } else if (isRow(el)) {
      const parts = [...el.children].filter((c) => !skip(c));
      const value = parts.length > 1 ? text(parts[parts.length - 1]) : '';
      const label = parts.slice(0, parts.length > 1 ? -1 : 1).map(text).filter(Boolean).join(' · ');
      if (label || value) items.push({ type: 'row', label, value, bold: bold(el) });
    } else if (el.tagName === 'P' && !/\btext-xs\b/.test(cls(el))) {
      const t = text(el);
      if (t && t.length <= 80) items.push({ type: 'note', text: t });
    } else {
      readReport(el, items);
    }
  }
  return items;
}

function itemsHtml(items) {
  return items.map((it) => {
    if (it.type === 'group') return `<div class="r-doctype"><div class="r-b">${esc(it.text)}</div></div>`;
    if (it.type === 'head') return `<div class="r-hr"></div><div class="r-b" style="margin-bottom:1mm">${esc(it.text)}</div>`;
    if (it.type === 'sub') return `<div class="r-xs r-b" style="margin-top:1mm;text-transform:uppercase">${esc(it.text)}</div>`;
    if (it.type === 'row') {
      const b = it.bold ? ' r-b' : '';
      // Several amounts (multi-column table rows) do not fit beside the label on a roll: label line, then amounts.
      return it.value.includes(' | ')
        ? `<div class="r-sm${b}">${esc(it.label)}</div><div class="r-row r-num${b}" style="justify-content:flex-end">${esc(it.value)}</div>`
        : `<div class="r-row${b}"><span>${esc(it.label)}</span><span class="r-num" style="white-space:nowrap;padding-left:2mm">${esc(it.value)}</span></div>`;
    }
    return `<div class="r-sm">${esc(it.text)}</div>`;
  }).join('');
}

/** Prints through a hidden iframe, so it can wait on settings without tripping the pop-up blocker. */
function printInFrame(html) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:100%;bottom:100%;border:0';
  document.body.appendChild(frame);
  frame.contentDocument.write(html);
  frame.contentDocument.close();
  frame.contentWindow.focus();
  frame.contentWindow.print();
  setTimeout(() => frame.remove(), 1000);
}

export async function loadPrintSettings() {
  try {
    const res = await authedRequest('/api/admin/settings');
    return res.ok ? (await res.json()).settings || {} : {};
  } catch {
    return {};
  }
}

/** Thermal page from printable lines. Returns false when the paper is A4 (caller prints its own page). */
export function printThermalItems({ items, title = '', subtitle = '', settings = {} }) {
  const size = normalizeSize(settings.receipt_paper_size);
  if (size === 'a4') return false;
  const head = title
    ? `<div class="r-head">${settings.restaurant_name ? `<span class="r-sm">${esc(settings.restaurant_name)}</span>` : ''}<div class="r-name">${esc(title)}</div>${subtitle ? `<span class="r-sm">${esc(subtitle)}</span>` : ''}</div>`
    : '';
  const foot = `<div class="r-foot"><span class="r-xs">Printed ${esc(formatNepalDate(new Date().toISOString()))} ${esc(formatNepalClock(new Date().toISOString()))}</span></div>`;
  printInFrame(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(title || 'Report')}</title>${receiptStyle(size, { layout: 'bill' })}</head><body>${head}${itemsHtml(items)}${foot}</body></html>`);
  return true;
}

/** Print an on-screen report element on the thermal roll (or the normal page on A4). */
export async function printReport(root, { title = '', subtitle = '' } = {}) {
  const settings = await loadPrintSettings();
  if (!root || !printThermalItems({ items: readReport(root), title, subtitle, settings })) window.print();
}
