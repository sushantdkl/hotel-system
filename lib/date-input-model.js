import {
  adToBsIso, bsToAdIso, isCanonicalAdDate, isValidBsDate,
} from '@/lib/calendar-system.js';

export function isoToAdDisplay(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

export function adDisplayToIso(display) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(display);
  if (!match) return null;
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  return isCanonicalAdDate(iso) ? iso : null;
}

export function isoToBsDisplay(iso) {
  if (!isCanonicalAdDate(iso)) return '';
  try { return `${adToBsIso(iso)} BS`; } catch { return ''; }
}

export function bsDisplayToIso(display) {
  const normalized = String(display || '').trim().replace(/\s*BS$/i, '');
  if (!isValidBsDate(normalized)) return null;
  try { return bsToAdIso(normalized); } catch { return null; }
}

export function maskAdInput(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  let output = digits.slice(0, 2);
  if (digits.length > 2) output += `/${digits.slice(2, 4)}`;
  if (digits.length > 4) output += `/${digits.slice(4, 8)}`;
  return output;
}

export function maskBsInput(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  let output = digits.slice(0, 4);
  if (digits.length > 4) output += `-${digits.slice(4, 6)}`;
  if (digits.length > 6) output += `-${digits.slice(6, 8)}`;
  return output;
}
