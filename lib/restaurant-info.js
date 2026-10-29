/**
 * Central factual identity for Raithane Daure Chulo.
 *
 * Sourced from client-supplied menu, signage and assets.
 * Do NOT invent opening hours, ratings, or social URLs — only verified fields.
 */

export const RESTAURANT = {
  name: 'Raithane Daure Chulo',
  shortName: 'Raithane Daure Chulo',
  tagline: 'Traditional Nepali kitchen & café in Birendranagar, Surkhet',
  intro:
    'Daure-chulo cooking, Karnali thali, sekuwa, momo and café classics in Birendranagar, Surkhet. रैथाने स्वाद, दाउरे चुलोमा पकाइएको.',
  address: {
    line: 'Birendranagar-08',
    city: 'Surkhet',
    postalCode: '',
    country: 'Nepal',
    full: 'Birendranagar-08, Surkhet, Karnali Province, Nepal',
  },
  coords: { lat: 28.5981066696641, lng: 81.61978015808363 },
  phoneDisplay: '+977 984-9216081',
  phoneE164: '+9779849216081',
  whatsappNumber: '9779849216081',
  email: '',
  social: {
    facebook: '',
    tiktok: '',
  },
  mapEmbedSrc:
    'https://www.google.com/maps?q=28.5981066696641,81.61978015808363&z=17&hl=en&output=embed',
  logo: '/images/brand/raithane-logo.jpeg',
  storefront: ['/raithane/restaurant-interior.webp', '/raithane/about-food.webp'],
  themeColor: '#A54B32',
  siteUrl: 'https://raithanedaurechulo.com.np',
};

/**
 * Phone as typed in the CMS -> E.164. Local Nepali numbers ("9858038225",
 * "083-520000") get +977; "+…" / "00…" are kept as already international.
 */
export function toE164(raw) {
  const s = String(raw || '').trim();
  const digits = s.replace(/\D/g, '');
  if (!digits) return '';
  if (s.startsWith('+')) return `+${digits}`;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith('977') && digits.length > 10) return `+${digits}`;
  return `+977${digits.replace(/^0+/, '')}`;
}

export function telHref() {
  return `tel:${RESTAURANT.phoneE164}`;
}

export function mailtoHref() {
  return `mailto:${RESTAURANT.email}`;
}

export function whatsappHref(message = "Hello Raithane Daure Chulo! I'd like to place an order.") {
  return `https://wa.me/${RESTAURANT.whatsappNumber}?text=${encodeURIComponent(message)}`;
}

/** External "Open in Google Maps" link (search by name near coordinates). */
export function directionsHref() {
  const { lat, lng } = RESTAURANT.coords;
  const q = encodeURIComponent(`${RESTAURANT.name}, ${RESTAURANT.address.full}`);
  return `https://www.google.com/maps/search/?api=1&query=${q}&center=${lat},${lng}`;
}

/** "Read reviews on Google" — points to the live listing rather than copying reviews. */
export function googleReviewsHref() {
  const q = encodeURIComponent(`${RESTAURANT.name} ${RESTAURANT.address.city}`);
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}
