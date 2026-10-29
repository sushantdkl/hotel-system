/**
 * Curated public-site imagery — client-provided local assets only.
 * Photos live under public/raithane/.
 */

export const STOREFRONT = [
  { src: '/raithane/restaurant-interior.webp', alt: 'Raithane Daure Chulo dining room in Birendranagar-08, Surkhet' },
  { src: '/raithane/about-hands.webp', alt: 'Cooking over the daure chulo at Raithane Daure Chulo' },
];

/** Hero imagery (distinct from every other section). */
export const HERO = {
  main: { src: '/raithane/hero-thali-v2.png', alt: 'Karnali special thali set at Raithane Daure Chulo' },
  inset: { src: '/raithane/chulo-fire.webp', alt: 'Wood fire burning in the daure chulo' },
};

/** Signature dishes on the home page — all distinct photos. */
export const SIGNATURE_ITEMS = [
  { name: 'Karnali Special Thali Set', img: '/raithane/menu-special-thali.webp', category: 'Khana Set' },
  { name: 'Chicken Sekuwa', img: '/raithane/menu-chicken-sekuwa.webp', category: 'Sekuwa & Grill' },
  { name: 'Mutton Choila', img: '/raithane/menu-choila.webp', category: 'Choila' },
  { name: 'Chicken Momo', img: '/raithane/menu-momo.webp', category: 'Momo' },
];

/** Popular categories — distinct photos; `img: null` renders a branded tile. */
export const POPULAR_CATEGORIES = [
  { title: 'Khana Set', note: 'Karnali thali & dhido', img: '/raithane/menu-dal-bhat.webp' },
  { title: 'Sekuwa & Grill', note: 'Chicken · Mutton · Fish', img: '/raithane/menu-chicken-sekuwa.webp' },
  { title: 'Momo', note: 'Steam · Fry · Jhol', img: '/raithane/menu-momo.webp' },
  { title: 'Café', note: 'Coffee, tea & lassi', img: '/raithane/menu-coffee.webp' },
];

/** Gallery grid — room + food photos used by the landing / CMS defaults. */
export const GALLERY = [
  '/raithane/gallery-01.webp',
  '/raithane/gallery-02.webp',
  '/raithane/gallery-03.webp',
  '/raithane/gallery-04.webp',
  '/raithane/gallery-05.webp',
  '/raithane/gallery-06.webp',
  '/raithane/gallery-07.webp',
  '/raithane/gallery-08.webp',
  '/raithane/gallery-09.webp',
  '/raithane/gallery-10.webp',
  '/raithane/gallery-11.webp',
  '/raithane/gallery-12.webp',
];
