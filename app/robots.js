import { RESTAURANT } from '@/lib/restaurant-info.js';

/**
 * Everything except the five public marketing pages is either staff-only or
 * token-scoped, so it is disallowed rather than merely unlinked.
 */
export default function robots() {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || RESTAURANT.siteUrl).replace(/\/$/, '');

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/admin/',
          '/cashier/',
          '/waiter/',
          '/kitchen/',
          '/login',
          '/order/',
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
