/**
 * Website CMS store.
 *
 * Content is persisted in the existing key/value `system_settings` table under
 * `cms_<section>` keys (JSON) — no new content engine. Uploaded image metadata
 * lives in a small `cms_media` table. Menu prices are intentionally NOT managed
 * here; the public menu keeps reading the POS menu source.
 *
 * Defaults are pre-filled from the approved public-site copy + `public/images/`
 * assets so the admin CMS opens with the live site content already populated.
 * Those `/images/...` paths ship with the app (and cPanel deploy); new uploads
 * go to persistent UPLOADS_DIR/cms and are served at `/uploads/cms/...`.
 */

import { ensureSqliteTable } from '@/lib/db/ensure-sqlite-table.js';
import { RESTAURANT } from '@/lib/restaurant-info.js';
import {
  HERO, SIGNATURE_ITEMS, POPULAR_CATEGORIES, GALLERY, STOREFRONT,
} from '@/lib/public-gallery.js';

export const CMS_SECTIONS = ['brand', 'home', 'festive', 'about', 'gallery', 'videos', 'menu', 'contact', 'seo'];

/** Curated site colour schemes — the lower 'wall' colour of a Nepali hill house. */
export const SITE_THEMES = ['rato-mato', 'nilo', 'sal', 'dhuwa'];

function settingsFallback(db) {
  return db.get(
    `SELECT
       MAX(CASE WHEN setting_key='restaurant_name' THEN setting_value END) AS name,
       MAX(CASE WHEN setting_key='restaurant_address' THEN setting_value END) AS address,
       MAX(CASE WHEN setting_key='restaurant_phone' THEN setting_value END) AS phone,
       MAX(CASE WHEN setting_key='restaurant_email' THEN setting_value END) AS email
     FROM system_settings`
  );
}

/** Deep-merge so older saved CMS JSON still picks up new default fields.
 * Empty strings and empty arrays from saved CMS are intentional clears — keep them. */
export function deepMerge(base, override) {
  if (override == null) return base;
  if (Array.isArray(base) || Array.isArray(override)) {
    return override !== undefined && override !== null ? override : base;
  }
  if (typeof base !== 'object' || typeof override !== 'object') {
    // Preserve intentional empty string clears from the CMS editor.
    if (override === '') return '';
    return override !== undefined && override !== null ? override : base;
  }
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (k.startsWith('_')) {
      out[k] = v;
      continue;
    }
    out[k] = deepMerge(base[k], v);
  }
  return out;
}

function defaults(base = {}) {
  return {
    brand: {
      businessName: base.name || RESTAURANT.name,
      shortName: RESTAURANT.shortName,
      tagline: RESTAURANT.tagline,
      logo: RESTAURANT.logo,
      favicon: '/images/brand/raithane-logo.jpeg',
      theme: 'rato-mato',
      hours: '',
      email: base.email || RESTAURANT.email,
      phone: base.phone || RESTAURANT.phoneDisplay,
      whatsapp: base.phone || RESTAURANT.whatsappNumber,
      location: base.address || RESTAURANT.address.full,
      mapEmbed: RESTAURANT.mapEmbedSrc,
      social: {
        facebook: RESTAURANT.social.facebook,
        instagram: '',
        tiktok: RESTAURANT.social.tiktok,
      },
    },
    home: {
      heroHeadingLine1: 'रैथाने स्वाद,',
      heroHeadingLine2: 'दाउरे चुलोमा.',
      heroHeadingLine3: 'Cooked over wood fire.',
      heroDescription: RESTAURANT.intro,
      heroImage: HERO.main.src,
      heroImageAlt: HERO.main.alt,
      heroInsetImage: HERO.inset.src,
      heroInsetAlt: HERO.inset.alt,
      heroBadgeValue: '100+',
      heroBadgeLabel: 'dishes on the menu',
      heroEyebrow: 'Daure chulo kitchen · Dine-in & takeaway · Birendranagar-08, Surkhet',
      primaryCta: { label: 'View Menu', href: '/menu' },
      secondaryCta: { label: 'WhatsApp', href: 'whatsapp' },
      tertiaryCta: { label: 'Call', href: 'tel' },

      popularTitle: 'Popular categories',
      popularLead: 'The dishes our kitchen is known for.',
      popularCategories: POPULAR_CATEGORIES.map((c) => ({
        title: c.title,
        note: c.note || '',
        img: c.img || '',
        href: '/menu',
      })),

      signatureTitle: 'Signature dishes',
      signatureLead: 'Straight off the daure chulo.',
      signatureItems: SIGNATURE_ITEMS.map((it) => ({
        name: it.name,
        category: it.category || '',
        img: it.img || '',
        href: '/menu',
      })),

      howItWorksTitle: 'How it works',
      howItWorksLead: 'Traditional cooking, served the way it has always been done.',
      howItWorksSteps: [
        { title: 'Cooked on the chulo', text: 'Khana sets, sekuwa and bhutuwa over a real wood fire.' },
        { title: 'Raithane ingredients', text: 'Kodo and makai roti, gundruk achar, local chicken and mutton.' },
        { title: 'Dine-in or takeaway', text: 'Eat with us, or message on WhatsApp to order ahead.' },
      ],

      menuTitle: 'On the menu',
      menuLead: 'Live prices, straight from our kitchen.',
      menuCtaLabel: 'Full menu',
      menuCtaHref: '/menu',

      aboutStripTitle: 'A daure chulo kitchen in Surkhet',
      aboutStripText:
        'In Birendranagar-08, we cook over a traditional daure chulo — Karnali special thali, kodo and makai roti sets, sekuwa, choila and dhido, alongside momo, pizza, coffee and lassi. Dine in or take away.',
      aboutStripImage: '/raithane/chulo-story-v2.png',
      aboutStripImageAlt: 'Traditional wood-fired daure chulo with a cooking pot',
      aboutStripCtaLabel: 'More about us',
      aboutStripCtaHref: '/about',

      galleryTitle: 'Gallery',
      galleryCtaLabel: 'See more',
      galleryCtaHref: '/gallery',
      galleryLimit: 6,

      findUsTitle: 'Find us',
      findUsLead: 'Birendranagar-08, Surkhet — Karnali Province.',

      sections: {
        hero: true,
        popular: true,
        signature: true,
        howItWorks: true,
        menu: true,
        about: true,
        gallery: true,
        findUs: true,
      },
    },
    festive: {
      heading: 'Festive highlights',
      lead: '',
      visible: true,
      items: [],
    },
    videos: {
      heading: 'Videos',
      lead: '',
      items: [],
    },
    menu: {
      heading: 'Our menu',
      lead: 'Live prices from our kitchen. Order for pickup or delivery, or send your order on WhatsApp.',
      note: 'No online payment — pay at the counter or on delivery. We call to confirm every order.',
    },
    about: {
      heading: RESTAURANT.name,
      description: RESTAURANT.intro,
      descriptionExtra:
        'Located in Birendranagar-08, Surkhet, we cook the raithane way — over a wood-fired daure chulo. Our menu runs from Karnali special thali, kodo and makai roti breakfast sets and dhido to chicken and mutton sekuwa, choila, momo, chowmein, biryani, pizza and sandwiches, finished with espresso, lassi and masala tea.',
      images: [STOREFRONT[0]?.src || RESTAURANT.storefront[0], STOREFRONT[1]?.src || RESTAURANT.storefront[1]],
      features: [
        { title: 'Daure chulo cooking', text: 'Wood-fired flavour in every khana set, sekuwa and bhutuwa.' },
        { title: 'Raithane menu', text: 'Karnali thali, kodo–makai roti, dhido, choila and sekuwa.' },
        { title: 'Café counter', text: 'Espresso, cappuccino, iced coffee, lassi and masala tea.' },
        { title: 'Dine-in & takeaway', text: 'Eat in, take away, or order ahead on WhatsApp.' },
      ],
      visitHeading: 'Visit us',
      visible: true,
    },
    gallery: {
      heading: 'Gallery',
      lead: 'Food, fire and room photos from Raithane Daure Chulo.',
      items: GALLERY.map((src, i) => ({
        url: src,
        title: '',
        alt: 'Raithane Daure Chulo',
        order: i,
        visible: true,
      })),
    },
    contact: {
      pageHeading: 'Contact and location',
      intro: 'Call, message, or find us in Birendranagar-08, Surkhet.',
      formHeading: 'Send us a message',
      phone: base.phone || RESTAURANT.phoneDisplay,
      whatsapp: RESTAURANT.whatsappNumber,
      email: base.email || RESTAURANT.email,
      location: base.address || RESTAURANT.address.full,
      mapEmbed: RESTAURANT.mapEmbedSrc,
      social: {
        facebook: RESTAURANT.social.facebook,
        instagram: '',
        tiktok: RESTAURANT.social.tiktok,
      },
    },
    seo: {
      title: 'Raithane Daure Chulo | Traditional Nepali Kitchen & Café | Surkhet',
      description: RESTAURANT.intro,
      ogImage: RESTAURANT.storefront[0],
      canonical: '',
    },
  };
}

export async function ensureCmsSchema(db) {
  await ensureSqliteTable(
    db,
    `CREATE TABLE IF NOT EXISTS cms_media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE NOT NULL,
      title TEXT,
      alt TEXT,
      section TEXT,
      width INTEGER,
      height INTEGER,
      size INTEGER,
      uploaded_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  );
}

async function readSetting(db, key) {
  const row = await db.get('SELECT setting_value FROM system_settings WHERE setting_key = ?', [key]);
  if (!row || row.setting_value == null) return null;
  try {
    return JSON.parse(row.setting_value);
  } catch {
    return null;
  }
}

async function writeSetting(db, key, value) {
  const json = JSON.stringify(value);
  const existing = await db.get('SELECT id FROM system_settings WHERE setting_key = ?', [key]);
  if (existing) {
    await db.run('UPDATE system_settings SET setting_value = ?, updated_at = CURRENT_TIMESTAMP WHERE setting_key = ?', [json, key]);
  } else {
    await db.run('INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)', [key, json]);
  }
}

/** Full CMS content with defaults merged in for any unset section. */
export async function getCmsContent(db) {
  const base = (await settingsFallback(db).catch(() => null)) || {};
  const def = defaults(base);
  const out = {};
  for (const section of CMS_SECTIONS) {
    const stored = await readSetting(db, `cms_${section}`);
    out[section] = stored ? deepMerge(def[section], stored) : def[section];
  }
  return out;
}

export async function getCmsSection(db, section) {
  const all = await getCmsContent(db);
  return all[section] || null;
}

export async function setCmsSection(db, section, data, actorId = null) {
  if (!CMS_SECTIONS.includes(section)) {
    throw Object.assign(new Error('Unknown CMS section'), { status: 400 });
  }
  const payload = { ...data, _updatedBy: actorId, _updatedAt: new Date().toISOString() };
  await writeSetting(db, `cms_${section}`, payload);
  return payload;
}

/** Media library ------------------------------------------------------- */
export async function listMedia(db, { section = null } = {}) {
  await ensureCmsSchema(db);
  if (section) {
    return db.all('SELECT * FROM cms_media WHERE section = ? ORDER BY created_at DESC', [section]);
  }
  return db.all('SELECT * FROM cms_media ORDER BY created_at DESC');
}

export async function addMedia(db, { url, title = null, alt = null, section = null, width = null, height = null, size = null, uploaded_by = null }) {
  await ensureCmsSchema(db);
  const res = await db.run(
    `INSERT INTO cms_media (url, title, alt, section, width, height, size, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [url, title, alt, section, width, height, size, uploaded_by]
  );
  const id = res?.lastInsertRowid ?? res?.lastID ?? null;
  if (id != null) {
    const row = await db.get('SELECT * FROM cms_media WHERE id = ?', [id]);
    if (row) return row;
  }
  // Fallback if insert-id lookup fails (still return a usable media object).
  const byUrl = await db.get('SELECT * FROM cms_media WHERE url = ? ORDER BY id DESC', [url]);
  if (byUrl) return byUrl;
  return {
    id: id || null,
    url,
    title,
    alt,
    section,
    width,
    height,
    size,
    uploaded_by,
  };
}

/** True if a media URL is still referenced anywhere in CMS content. */
export async function isMediaReferenced(db, url) {
  const content = await getCmsContent(db);
  return JSON.stringify(content).includes(url);
}

export async function deleteMedia(db, id, { force = false } = {}) {
  await ensureCmsSchema(db);
  const row = await db.get('SELECT * FROM cms_media WHERE id = ?', [id]);
  if (!row) throw Object.assign(new Error('Media not found'), { status: 404 });
  if (!force && (await isMediaReferenced(db, row.url))) {
    throw Object.assign(new Error('This image is still used in published content. Confirm to remove it anyway.'), {
      status: 409,
      referenced: true,
    });
  }
  await db.run('DELETE FROM cms_media WHERE id = ?', [id]);
  return { deleted: true, url: row.url };
}
