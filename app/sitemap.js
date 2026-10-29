import { RESTAURANT } from '@/lib/restaurant-info.js';

/**
 * Public sitemap. Only the five marketing pages belong here — staff routes are
 * behind auth and QR order pages are per-table tokens, neither of which should
 * ever be advertised to a crawler.
 */
export default function sitemap() {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || RESTAURANT.siteUrl).replace(/\/$/, '');
  const now = new Date();

  return [
    { url: `${base}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/menu`, lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${base}/about`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${base}/gallery`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/contact`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
  ];
}
