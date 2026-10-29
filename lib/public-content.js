/**
 * Server-side bridge that lets the public site show CMS-managed content while
 * keeping lib/restaurant-info.js + lib/public-gallery.js as the guaranteed
 * fallback. If a CMS value is empty or the store is unreachable, the original
 * approved constant is used — so the public site can never render blank because
 * of the CMS.
 *
 * Menu prices are intentionally NOT sourced here; the public menu keeps using
 * the POS menu source.
 */

import { cache } from 'react';
import Database from '@/lib/db/index';
import { getCmsContent, SITE_THEMES } from '@/lib/cms.js';
import { RESTAURANT, toE164 } from '@/lib/restaurant-info.js';
import { HERO, GALLERY, SIGNATURE_ITEMS, POPULAR_CATEGORIES, STOREFRONT } from '@/lib/public-gallery.js';

const pick = (cmsVal, fallback) => {
  const v = typeof cmsVal === 'string' ? cmsVal.trim() : cmsVal;
  return v || v === 0 ? v : fallback;
};

// Deduped per request: the layout (header/footer) and the page both read it.
const loadCms = cache(async () => {
  try {
    return await getCmsContent(Database.getInstance());
  } catch {
    return null;
  }
});

/** Full home-page content for the public site. Never throws. */
export async function getPublicHome() {
  const cms = await loadCms();
  const h = cms?.home || {};
  const sec = h.sections || {};

  const popular = (h.popularCategories?.length ? h.popularCategories : POPULAR_CATEGORIES).map((c) => ({
    title: c.title,
    note: c.note || '',
    img: c.img || null,
    href: c.href || '/menu',
  }));

  const signature = (h.signatureItems?.length ? h.signatureItems : SIGNATURE_ITEMS).map((it) => ({
    name: it.name,
    category: it.category || '',
    img: it.img || '',
    href: it.href || '/menu',
  }));

  const steps = (h.howItWorksSteps?.length ? h.howItWorksSteps : [
    { title: 'Cooked on the chulo', text: 'Khana sets, sekuwa and bhutuwa over a real wood fire.' },
    { title: 'Raithane ingredients', text: 'Kodo and makai roti, gundruk achar, local chicken and mutton.' },
    { title: 'Dine-in or takeaway', text: 'Eat with us, or message on WhatsApp to order ahead.' },
  ]);

  return {
    heroHeadingLine1: pick(h.heroHeadingLine1, 'रैथाने स्वाद,'),
    heroHeadingLine2: pick(h.heroHeadingLine2, 'दाउरे चुलोमा.'),
    heroHeadingLine3: pick(h.heroHeadingLine3, 'Cooked over wood fire.'),
    heroDescription: pick(h.heroDescription, RESTAURANT.intro),
    heroImage: pick(h.heroImage, HERO.main.src),
    heroImageAlt: pick(h.heroImageAlt, HERO.main.alt),
    heroInsetImage: pick(h.heroInsetImage, HERO.inset.src),
    heroInsetAlt: pick(h.heroInsetAlt, HERO.inset.alt),
    heroBadgeValue: pick(h.heroBadgeValue, '100+'),
    heroBadgeLabel: pick(h.heroBadgeLabel, 'dishes on the menu'),
    heroEyebrow: pick(h.heroEyebrow, 'Daure chulo kitchen · Dine-in & takeaway · Birendranagar-08, Surkhet'),
    primaryCta: {
      label: pick(h.primaryCta?.label, 'View Menu'),
      href: pick(h.primaryCta?.href, '/menu'),
    },
    secondaryCta: {
      label: pick(h.secondaryCta?.label, 'WhatsApp'),
      href: pick(h.secondaryCta?.href, 'whatsapp'),
    },
    tertiaryCta: {
      label: pick(h.tertiaryCta?.label, 'Call'),
      href: pick(h.tertiaryCta?.href, 'tel'),
    },

    popularTitle: pick(h.popularTitle, 'Popular categories'),
    popularLead: pick(h.popularLead, 'The dishes our kitchen is known for.'),
    popularCategories: popular,

    signatureTitle: pick(h.signatureTitle, 'Signature dishes'),
    signatureLead: pick(h.signatureLead, 'Straight off the daure chulo.'),
    signatureItems: signature,

    howItWorksTitle: pick(h.howItWorksTitle, 'How it works'),
    howItWorksLead: pick(h.howItWorksLead, 'Traditional cooking, served the way it has always been done.'),
    howItWorksSteps: steps,

    menuTitle: pick(h.menuTitle, 'On the menu'),
    menuLead: pick(h.menuLead, 'Live prices, straight from our kitchen.'),
    menuCtaLabel: pick(h.menuCtaLabel, 'Full menu'),
    menuCtaHref: pick(h.menuCtaHref, '/menu'),

    aboutStripTitle: pick(h.aboutStripTitle, 'A daure chulo kitchen in Surkhet'),
    aboutStripText: pick(
      h.aboutStripText,
      'In Birendranagar-08, we cook over a traditional daure chulo — Karnali special thali, kodo and makai roti sets, sekuwa, choila and dhido, alongside momo, pizza, coffee and lassi. Dine in or take away.'
    ),
    aboutStripImage: pick(h.aboutStripImage, '/raithane/chulo-story-v2.png'),
    aboutStripImageAlt: pick(h.aboutStripImageAlt, 'Traditional wood-fired daure chulo with a cooking pot'),
    aboutStripCtaLabel: pick(h.aboutStripCtaLabel, 'More about us'),
    aboutStripCtaHref: pick(h.aboutStripCtaHref, '/about'),

    galleryTitle: pick(h.galleryTitle, 'Gallery'),
    galleryCtaLabel: pick(h.galleryCtaLabel, 'See more'),
    galleryCtaHref: pick(h.galleryCtaHref, '/gallery'),
    galleryLimit: Number(h.galleryLimit) > 0 ? Number(h.galleryLimit) : 6,

    findUsTitle: pick(h.findUsTitle, 'Find us'),
    findUsLead: pick(h.findUsLead, 'Birendranagar-08, Surkhet — Karnali Province.'),

    sections: {
      hero: sec.hero !== false,
      popular: sec.popular !== false,
      signature: sec.signature !== false,
      howItWorks: sec.howItWorks !== false,
      menu: sec.menu !== false,
      about: sec.about !== false,
      gallery: sec.gallery !== false,
      findUs: sec.findUs !== false,
    },
  };
}

/** Merged About page content. Never throws. */
export async function getPublicAbout() {
  const cms = await loadCms();
  const a = cms?.about || {};
  const features = (a.features?.length ? a.features : [
    { title: 'Daure chulo cooking', text: 'Wood-fired flavour in every khana set, sekuwa and bhutuwa.' },
    { title: 'Raithane menu', text: 'Karnali thali, kodo–makai roti, dhido, choila and sekuwa.' },
    { title: 'Café counter', text: 'Espresso, cappuccino, iced coffee, lassi and masala tea.' },
    { title: 'Dine-in & takeaway', text: 'Eat in, take away, or order ahead on WhatsApp.' },
  ]);
  return {
    heading: pick(a.heading, RESTAURANT.name),
    description: pick(a.description, RESTAURANT.intro),
    descriptionExtra: pick(
      a.descriptionExtra,
      'Located in Birendranagar-08, Surkhet, we cook the raithane way — over a wood-fired daure chulo. Our menu runs from Karnali special thali, kodo and makai roti breakfast sets and dhido to chicken and mutton sekuwa, choila, momo, chowmein, biryani, pizza and sandwiches, finished with espresso, lassi and masala tea.'
    ),
    image: pick((a.images || [])[0], STOREFRONT[0]?.src || RESTAURANT.storefront[0]),
    images: (a.images?.length ? a.images : RESTAURANT.storefront).filter(Boolean),
    features,
    visitHeading: pick(a.visitHeading, 'Visit us'),
    visible: a.visible !== false,
  };
}

/** Merged Gallery items. Falls back to the built-in gallery when CMS is empty. */
export async function getPublicGallery() {
  const cms = await loadCms();
  const heading = pick(cms?.gallery?.heading, 'Gallery');
  const lead = pick(cms?.gallery?.lead, 'Food, fire and room photos from Raithane Daure Chulo.');
  const items = (cms?.gallery?.items || [])
    .filter((i) => i && i.url && i.visible !== false)
    .sort((x, y) => (x.order || 0) - (y.order || 0))
    .map((i) => ({ url: i.url, alt: i.alt || i.title || 'Raithane Daure Chulo', title: i.title || '' }));
  if (items.length) return { heading, lead, items };
  return {
    heading,
    lead,
    items: GALLERY.map((src) => ({ url: src, alt: 'Raithane Daure Chulo', title: '' })),
  };
}

/** Merged contact block for the public Contact page. Never throws. */
export async function getPublicContact() {
  const cms = await loadCms();
  const c = cms?.contact || {};
  const b = cms?.brand || {};
  // Brand ("Brand & Contact identity") is the single source for contact
  // details; the old Contact-tab copies are only a fallback for cleared fields.
  const bs = b.social || {};
  const cs = c.social || {};
  const social = { facebook: pick(bs.facebook, cs.facebook), tiktok: pick(bs.tiktok, cs.tiktok), instagram: pick(bs.instagram, cs.instagram) };

  const phoneDisplay = pick(b.phone, pick(c.phone, RESTAURANT.phoneDisplay));
  const email = pick(b.email, pick(c.email, RESTAURANT.email));
  const location = pick(b.location, pick(c.location, RESTAURANT.address.full));
  const whatsappNumber = toE164(pick(b.whatsapp, pick(c.whatsapp, ''))).slice(1) || RESTAURANT.whatsappNumber;
  const phoneE164 = toE164(phoneDisplay) || RESTAURANT.phoneE164;
  const name = pick(b.businessName, RESTAURANT.name);

  return {
    pageHeading: pick(c.pageHeading, 'Contact and location'),
    intro: pick(c.intro, 'Call, message, or find us in Birendranagar-08, Surkhet.'),
    formHeading: pick(c.formHeading, 'Send us a message'),
    phoneDisplay,
    phoneE164,
    email,
    location,
    whatsappNumber,
    mapEmbedSrc: pick(b.mapEmbed, pick(c.mapEmbed, RESTAURANT.mapEmbedSrc)),
    social: {
      facebook: pick(social.facebook, RESTAURANT.social.facebook),
      tiktok: pick(social.tiktok, RESTAURANT.social.tiktok),
      instagram: pick(social.instagram, ''),
    },
    hrefs: {
      tel: `tel:${phoneE164}`,
      mailto: `mailto:${email}`,
      whatsapp: `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(`Hello ${name}! I'd like to place an order.`)}`,
      directions: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name}, ${location}`)}`,
    },
  };
}

/** Brand bits for shell / structured data. */
export async function getPublicBrand() {
  const cms = await loadCms();
  const b = cms?.brand || {};
  return {
    name: pick(b.businessName, RESTAURANT.name),
    shortName: pick(b.shortName, RESTAURANT.shortName),
    tagline: pick(b.tagline, RESTAURANT.tagline),
    logo: pick(b.logo, RESTAURANT.logo),
    favicon: pick(b.favicon, pick(b.logo, RESTAURANT.logo)),
    theme: SITE_THEMES.includes(b.theme) ? b.theme : SITE_THEMES[0],
    // One line per row, e.g. "Every day · 7am – 9pm". Empty = not shown (never invented).
    hours: String(b.hours || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
  };
}

/** Wide festive banners shown after the home hero. Empty list = section hidden. */
export async function getPublicFestive() {
  const cms = await loadCms();
  const f = cms?.festive || {};
  const items = f.visible === false ? [] : (f.items || [])
    .filter((item) => item && item.image && item.visible !== false)
    .sort((x, y) => Number(x.order || 0) - Number(y.order || 0));
  return { heading: pick(f.heading, 'Festive highlights'), lead: pick(f.lead, ''), items };
}

/** A video URL → how to show it: YouTube embed, a playable file, or a plain link. */
export function videoSource(url = '') {
  const raw = String(url).trim();
  const yt = raw.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
  if (yt) return { kind: 'youtube', src: `https://www.youtube-nocookie.com/embed/${yt[1]}` };
  if (/\.(mp4|webm)(\?|$)/i.test(raw) || /^\/(uploads|api\/media)\//.test(raw)) return { kind: 'file', src: raw };
  return /^https:\/\//.test(raw) ? { kind: 'link', src: raw } : null;
}

/** Videos for the gallery page. */
export async function getPublicVideos() {
  const cms = await loadCms();
  const v = cms?.videos || {};
  const items = (v.items || [])
    .filter((item) => item && item.visible !== false && videoSource(item.url))
    .sort((x, y) => Number(x.order || 0) - Number(y.order || 0))
    .map((item) => ({ ...videoSource(item.url), title: item.title || '', description: item.description || '' }));
  return { heading: pick(v.heading, 'Videos'), lead: pick(v.lead, ''), items };
}

/** Menu page copy (dishes and prices always come from the POS). */
export async function getPublicMenuPage() {
  const cms = await loadCms();
  const m = cms?.menu || {};
  return {
    heading: pick(m.heading, 'Our menu'),
    lead: pick(m.lead, 'Live prices from our kitchen. Order for pickup or delivery, or send your order on WhatsApp.'),
    note: pick(m.note, 'No online payment — pay at the counter or on delivery. We call to confirm every order.'),
  };
}

/** Site-wide SEO defaults from the CMS SEO tab. */
export async function getPublicSeo() {
  const cms = await loadCms();
  const s = cms?.seo || {};
  return {
    title: pick(s.title, ''),
    description: pick(s.description, RESTAURANT.intro),
    ogImage: pick(s.ogImage, '/raithane/og-cover.jpg'),
    canonical: pick(s.canonical, ''),
  };
}
