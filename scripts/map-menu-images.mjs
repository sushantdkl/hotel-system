/**
 * Attach client-provided food photos in /public/images to menu items.
 * Every image is used at most once (no duplicates). An explicit, curated map
 * assigns the most sensible photo per dish; items with no reasonable photo in
 * the pack keep a branded, named fallback tile on the site/POS.
 *
 * Usage: node scripts/map-menu-images.mjs [--dry-run]
 * Targets the active DB (DATABASE_URL for Postgres, else SQLite dev).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from '../lib/db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const IMG_DIR = path.join(ROOT, 'public', 'images');
const DRY = process.argv.includes('--dry-run');

const norm = (s) => String(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Curated map: normalized menu-item name -> image basename (no extension).
// Kept unique; a basename appears at most once.
const EXPLICIT = {
  // NOTE: Coffee/tea/juice/soft-drink items are intentionally NOT mapped — the
  // supplied image pack's beverage filenames do not match their actual contents
  // (e.g. "black-coffee.jpg" is a cocktail), so those items use a branded tile
  // until real drink photos are provided.
  // Breakfast
  'aloo-paratha': 'aalu-paratha',
  'plain-paratha': 'plain-paratha-set',
  'masala-omelette': 'grand-breakfast-combo',
  'fruit-platter': 'fruits-salad',
  // Sandwiches & burgers
  'veg-sandwich': 'veg-sandwich',
  'chicken-sandwich': 'chicken-sandwich',
  'veg-burgar': 'veg-burger',
  'chicken-burger': 'chicken-burger',
  // Soups
  'veg-hot-n-sour': 'veg-manchow-soup',
  'chicken-hot-n-sour': 'hot-and-sour-soup',
  'mushroom-soup': 'mushroom-soup',
  // Vegetarian snacks
  'gurashe-aloo': 'aalo-jeera',
  'french-fries': 'french-fries',
  'honey-chilly-potato': 'chips-chilly',
  'corn-salt-n-pepper': 'popcorn',
  'paneer-pakoda': 'paneer-pakauda',
  'paneer-chilly': 'mustang-aalu',
  'veg-pakoda': 'veg-pakauda',
  'mushroom-chilly': 'mushroom-chilly',
  'mushroom-chhoila': 'veg-boil',
  'peanut-shadeko': 'peanuts-sadheko',
  'cashewnut-fry': 'kaju-fry',
  // Non-vegetarian snacks
  'mutton-sekuwa': 'mutton-sekuwa',
  'mutton-tass-set': 'mutton-tas',
  'jhaneko-sekuwa': 'mutton-bhutan',
  'mutton-chhoila': 'mutton-choila-fry',
  'mutton-shadeko': 'mutton-fry-sadheko',
  'chicken-sekuwa': 'chicken-sekuwa',
  'chicken-shapta': 'chicken-timur-szechuan',
  'chicken-shadeko': 'chicken-fry-sadheko',
  'chicken-chhoila': 'local-chicken-choila',
  'chicken-loly-pop': 'chicken-lollipop',
  'chicken-wings': 'chicken-wings',
  'draigon-chicken': 'chicken-roast',
  'kalejo-pangro': 'kan-jibro',
  'saussage': 'chicken-sausage',
  // Fast food
  'veg-chowmin': 'veg-chow-mein',
  'chicken-chowmin': 'chicken-chow-mein',
  'egg-chowmin': 'chauchau-sadheko',
  'veg-fried-rice': 'veg-fried-rice',
  'egg-fried-rice': 'egg-fried-rice',
  'chicken-fried-rice': 'chicken-fried-rice',
  'mix-fried-rice': 'mixed-fried-rice',
  'chicken-thupka': 'local-chicken-soup',
  'veg-thupka': 'tomato-cream-soup',
};

async function main() {
  const files = fs.readdirSync(IMG_DIR).filter((f) => /\.(jpe?g|png|webp)$/i.test(f) && !/^WhatsApp/i.test(f));
  const byBase = new Map(); // normalized basename -> "/images/<file>"
  for (const f of files) byBase.set(norm(f.replace(/\.(jpe?g|png|webp)$/i, '')), `/images/${f}`);

  const db = Database.getInstance();
  const items = await db.all('SELECT id, name FROM menu_items WHERE source_ref IS NOT NULL ORDER BY id');

  const usedImages = new Set();
  let matched = 0;
  const unmatched = [];

  // Clear existing image_url first so re-runs stay consistent with the map.
  if (!DRY) await db.run('UPDATE menu_items SET image_url = NULL WHERE source_ref IS NOT NULL');

  for (const it of items) {
    const key = norm(it.name);
    const wanted = EXPLICIT[key] || key; // curated, else exact-name match
    const imgPath = byBase.get(norm(wanted));
    if (imgPath && !usedImages.has(imgPath)) {
      usedImages.add(imgPath);
      matched++;
      if (!DRY) await db.run('UPDATE menu_items SET image_url = ? WHERE id = ?', [imgPath, it.id]);
    } else {
      unmatched.push(it.name);
    }
  }

  console.log(`${DRY ? '[DRY] ' : ''}Assigned ${matched}/${items.length} unique photos; ${unmatched.length} use the branded fallback.`);
  console.log(`Fallback items: ${unmatched.join(', ')}`);
  if (Database.close) await Database.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
