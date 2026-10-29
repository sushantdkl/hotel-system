/**
 * Generate demo SVG food images for all menu items and set image_url.
 * Usage: node scripts/seed-menu-images.mjs
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function resolveDbPath() {
  if (process.env.DB_NAME) return path.join(root, 'databases', process.env.DB_NAME);
  const licensePath = path.join(root, 'databases', '.license');
  if (fs.existsSync(licensePath)) {
    const license = JSON.parse(fs.readFileSync(licensePath, 'utf8'));
    if (license.db_name) return path.join(root, 'databases', license.db_name);
  }
  return path.join(root, 'databases', 'pos_restaurant.db');
}

const COLORS = [
  ['#f97316', '#fdba74'],
  ['#ef4444', '#fca5a5'],
  ['#eab308', '#fde68a'],
  ['#22c55e', '#86efac'],
  ['#06b6d4', '#67e8f9'],
  ['#8b5cf6', '#c4b5fd'],
  ['#ec4899', '#f9a8d4'],
  ['#78716c', '#d6d3d1'],
];

function svgFor(name, idx) {
  const [a, b] = COLORS[idx % COLORS.length];
  const label = (name || 'Food').slice(0, 18).replace(/[<>&]/g, '');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${a}"/>
      <stop offset="100%" stop-color="${b}"/>
    </linearGradient>
  </defs>
  <rect width="640" height="480" fill="url(#g)"/>
  <ellipse cx="320" cy="300" rx="180" ry="48" fill="rgba(0,0,0,0.12)"/>
  <ellipse cx="320" cy="250" rx="150" ry="110" fill="rgba(255,255,255,0.35)"/>
  <circle cx="280" cy="230" r="28" fill="rgba(255,255,255,0.55)"/>
  <circle cx="340" cy="210" r="36" fill="rgba(255,255,255,0.45)"/>
  <circle cx="360" cy="260" r="24" fill="rgba(255,255,255,0.5)"/>
  <text x="320" y="420" text-anchor="middle" font-family="Arial,sans-serif" font-size="28" font-weight="700" fill="#1c1917">${label}</text>
</svg>`;
}

const uploadsMenu = path.join(root, 'uploads', 'menu');
const publicMenu = path.join(root, 'public', 'uploads', 'menu');
fs.mkdirSync(uploadsMenu, { recursive: true });
fs.mkdirSync(publicMenu, { recursive: true });

const dbPath = resolveDbPath();
if (!fs.existsSync(dbPath)) {
  console.error('DB not found:', dbPath);
  process.exit(1);
}

const db = new Database(dbPath);
const items = db.prepare('SELECT id, name FROM menu_items ORDER BY id').all();
const update = db.prepare('UPDATE menu_items SET image_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');

let n = 0;
for (const item of items) {
  const slug = String(item.name || 'item')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || `item-${item.id}`;
  const filename = `${item.id}-${slug}.svg`;
  const svg = svgFor(item.name, item.id);
  fs.writeFileSync(path.join(uploadsMenu, filename), svg);
  fs.writeFileSync(path.join(publicMenu, filename), svg);
  const url = `/uploads/menu/${filename}`;
  update.run(url, item.id);
  n += 1;
}

db.close();
console.log(`✓ Seeded ${n} menu images → uploads/menu + public/uploads/menu`);
console.log('  image_url examples: /uploads/menu/<id>-<slug>.svg');
