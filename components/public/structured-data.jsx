import { RESTAURANT } from '@/lib/restaurant-info.js';

/**
 * schema.org JSON-LD for the public site.
 *
 * Every value is drawn from the restaurant record or the live menu — nothing
 * here is invented. Fields we cannot verify (opening hours, ratings, price
 * range) are deliberately omitted rather than guessed, because fabricated
 * structured data is worse than none: search engines surface it as fact.
 */

function absolute(pathOrUrl) {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || RESTAURANT.siteUrl).replace(/\/$/, '');
  if (!pathOrUrl) return undefined;
  return /^https?:/.test(pathOrUrl) ? pathOrUrl : `${base}${pathOrUrl}`;
}

function clean(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, v]) => v !== undefined && v !== null && v !== '')
  );
}

/** The restaurant itself — emitted once, on the home page. */
export function RestaurantSchema({ contact, brand = {} }) {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || RESTAURANT.siteUrl).replace(/\/$/, '');
  const sameAs = [contact.social.facebook, contact.social.instagram, contact.social.tiktok].filter(Boolean);

  const data = clean({
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    '@id': `${base}/#restaurant`,
    name: brand.name || RESTAURANT.name,
    description: brand.tagline || RESTAURANT.intro,
    url: base,
    telephone: contact.phoneE164,
    email: contact.email || undefined,
    image: RESTAURANT.storefront?.map(absolute),
    logo: absolute(brand.logo || RESTAURANT.logo),
    servesCuisine: ['Nepali', 'Newari', 'Indian', 'Continental'],
    currenciesAccepted: 'NPR',
    hasMenu: `${base}/menu`,
    address: clean({
      '@type': 'PostalAddress',
      streetAddress: RESTAURANT.address.line,
      addressLocality: RESTAURANT.address.city,
      addressRegion: 'Karnali Province',
      postalCode: RESTAURANT.address.postalCode || undefined,
      addressCountry: 'NP',
    }),
    geo: {
      '@type': 'GeoCoordinates',
      latitude: RESTAURANT.coords.lat,
      longitude: RESTAURANT.coords.lng,
    },
    sameAs: sameAs.length ? sameAs : undefined,
  });

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

/**
 * The live menu, built from the same payload the page renders, so the two can
 * never drift apart.
 */
export function MenuSchema({ categories = [] }) {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || RESTAURANT.siteUrl).replace(/\/$/, '');
  if (!categories.length) return null;

  const data = clean({
    '@context': 'https://schema.org',
    '@type': 'Menu',
    '@id': `${base}/menu#menu`,
    name: `${RESTAURANT.name} menu`,
    inLanguage: 'en',
    hasMenuSection: categories.map((category) =>
      clean({
        '@type': 'MenuSection',
        name: category.title,
        hasMenuItem: category.items.map((item) =>
          clean({
            '@type': 'MenuItem',
            name: item.name,
            description: item.description || undefined,
            image: absolute(item.image),
            suitableForDiet: item.diet === 'veg' ? 'https://schema.org/VegetarianDiet' : undefined,
            offers: {
              '@type': 'Offer',
              price: Number(item.price),
              priceCurrency: 'NPR',
            },
          })
        ),
      })
    ),
  });

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
