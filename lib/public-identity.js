import { RESTAURANT } from './restaurant-info.js';

/** Normalize only known Kathmandu defaults, never financial/audit records. */
export function publicIdentity(value) {
  if (Array.isArray(value)) return value.map(publicIdentity);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, key.startsWith('_') ? entry : publicIdentity(entry)]));
  if (typeof value !== 'string') return value;
  if (/kathmandu.?momo.*facebook|facebook.*kathmandu.?momo/i.test(value)) return RESTAURANT.social.facebook;
  if (/kathmandu.?momo.*instagram|instagram.*kathmandu.?momo/i.test(value)) return RESTAURANT.social.instagram;
  if (/kathmandu.?momo.*tiktok|tiktok.*kathmandu.?momo/i.test(value)) return RESTAURANT.social.tiktok;
  if (/^https?:.*(?:Kathmandu%20Momo|Ghantaghar)/i.test(value)) return RESTAURANT.mapEmbedSrc;
  const exact = {
    '/images/chicken-sekuwa.jpg': RESTAURANT.storefront[0],
    '/images/chicken-chilly.jpg': RESTAURANT.storefront[1],
    '083-5220501 / 9848035105': RESTAURANT.phoneDisplay,
    '9848035105': RESTAURANT.whatsappNumber,
    '9779848035105': RESTAURANT.whatsappNumber,
    'Ghantaghar Chowk , Surkhet': RESTAURANT.address.full,
  };
  return exact[value] ?? value
    .replace(/Kathmandu Momo/gi, RESTAURANT.name)
    .replace(/kathmandumomo@gmail\.com/gi, RESTAURANT.email)
    .replace(/Ghantaghar Chowk\s*,?\s*Surkhet/gi, RESTAURANT.address.full);
}

export function publicSocialUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !/kathmandu.?momo/i.test(url.href) ? url.href : '';
  } catch { return ''; }
}

export function contactPhones(display) {
  return String(display || '').split(/\s*\/\s*|\s*,\s*/).map((phone) => {
    const digits = phone.replace(/\D/g, '');
    const international = phone.startsWith('+') ? `+${digits}` : `+977${digits.replace(/^0/, '')}`;
    return { display: phone.trim(), href: `tel:${international}` };
  }).filter((phone) => phone.display && /\d/.test(phone.display));
}
