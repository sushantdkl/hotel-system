/**
 * Idempotent menu importer for Raithane Daure Chulo.
 *
 * Reads the faithful grid extracted from the client's Menu.xlsx
 * (data/menu/menu-grid.json — regenerate with scripts/menu/extract_grid.py),
 * resolves the 13 menu groups, extracts slash-priced variants, and upserts
 * menu_categories / menu_items / menu_item_variants keyed by a stable
 * `source_ref` so re-running updates rather than duplicates.
 *
 * Prices are only ever taken from the extracted numeric cells — never retyped.
 * Display names are normalised for whitespace/punctuation only; suspected
 * spelling issues are reported, never silently rewritten.
 *
 * Usage:
 *   node scripts/import-menu.mjs                     # apply to the active DB
 *   node scripts/import-menu.mjs --dry-run          # diff only, no writes
 *   node scripts/import-menu.mjs --deactivate-unmanaged
 *       # additionally hide (is_available=0) legacy items not in this import
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from '../lib/db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const GRID_PATH = path.join(ROOT, 'data', 'menu', 'menu-grid.json');
const REPORT_PATH = path.join(ROOT, 'menu-import-report.md');

const DRY_RUN = process.argv.includes('--dry-run');
const DEACTIVATE_UNMANAGED = process.argv.includes('--deactivate-unmanaged');

// ---- Category resolution -------------------------------------------------
// Raw workbook header text -> canonical group. Order matches the printed menu.
// `provisional: true` records an assumption that needs client confirmation.
const CATEGORY_MAP = {
  'Coffee Item': { name: 'Coffee Items', order: 1 },
  'Coffee Cold Based': { name: 'Cold Coffee', order: 2 },
  '__UNLABELLED_BEVERAGES__': { name: 'Cold Beverages', order: 3, provisional: true },
  'Fresh Juice': { name: 'Fresh Juice', order: 4 },
  'Breakfast': { name: 'Breakfast', order: 5 },
  'Sandwich & Burger': { name: 'Sandwiches & Burgers', order: 6 },
  'Pizza Selecation': { name: 'Pizza', order: 7 },
  'Soups': { name: 'Soups', order: 8 },
  'Veg. Snacks': { name: 'Vegetarian Snacks', order: 9 },
  'Non-veg Snacks': { name: 'Non-Vegetarian Snacks', order: 10 },
  'MOMO Selection': { name: 'Momo', order: 11 },
  'Fastfood': { name: 'Fast Food', order: 12 },
  'Biryani Selection': { name: 'Biryani', order: 13 },
};

// Suspected spelling corrections — reported for client confirmation only.
const SPELLING_SUGGESTIONS = [
  [/\bNascoffe\b/i, 'Nescafé'],
  [/\bLamonade\b/i, 'Lemonade'],
  [/\bBurgar\b/i, 'Burger'],
  [/\bChcken\b/i, 'Chicken'],
  [/\bDraigon\b/i, 'Dragon'],
  [/\bSaussage\b/i, 'Sausage'],
  [/\bThupka\b/i, 'Thukpa'],
  [/\bLoly Pop\b/i, 'Lollipop'],
  [/\bShapta\b/i, 'Shapta (confirm spelling)'],
  [/\bMusli\b/i, 'Muesli'],
];

const PREP_WORDS = ['Boiled', 'Fried', 'Steam'];

// ---- Helpers -------------------------------------------------------------
function normalizeName(raw) {
  return String(raw)
    .replace(/\s+/g, ' ')            // collapse whitespace / double spaces
    .replace(/^[\s.,;:]+|[\s.,;:]+$/g, '') // strip surrounding punctuation/space
    .trim();
}

function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function colLetter(idx0) {
  let idx = idx0 + 1;
  let s = '';
  while (idx) {
    const rem = (idx - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    idx = Math.floor((idx - 1) / 26);
  }
  return s;
}

function isInt(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function spellingFor(raw) {
  const hits = [];
  for (const [re, suggestion] of SPELLING_SUGGESTIONS) {
    if (re.test(raw)) hits.push(suggestion);
  }
  return hits;
}

/**
 * Parse a slash-priced variant row into { base, variants:[{name,price}] }.
 * e.g. name "Mutton Shadeko Boiled/Fried", price "300/320".
 * Returns null when the row is not a variant.
 */
function parseVariant(rawName, rawPrice) {
  if (typeof rawPrice !== 'string' || !rawPrice.includes('/')) return null;
  const prices = rawPrice.split('/').map((p) => Number(String(p).trim()));
  if (prices.some((p) => !Number.isFinite(p))) return null;

  // Find a trailing "X/Y" label made of known prep words.
  const m = rawName.match(/(\w+)\s*\/\s*(\w+)\s*$/);
  let labels;
  let base;
  if (m && PREP_WORDS.includes(m[1]) && PREP_WORDS.includes(m[2])) {
    labels = [m[1], m[2]];
    base = normalizeName(rawName.slice(0, m.index));
  } else {
    labels = prices.map((_, i) => `Option ${i + 1}`);
    base = normalizeName(rawName);
  }
  if (prices.length !== labels.length) return null;
  return {
    base,
    variants: labels.map((name, i) => ({ name, price: prices[i] })),
  };
}

// ---- Parse the grid into structured items --------------------------------
function parseGrid() {
  const payload = JSON.parse(fs.readFileSync(GRID_PATH, 'utf8'));
  const grid = payload.grid;
  const blocks = [
    [0, 1, 2, 3],
    [4, 5, 6, 7],
    [8, 9, 10, 11],
    [12, 13, 14, 15],
  ];

  const items = [];
  const warnings = [];
  const categoriesSeen = new Map(); // canonical name -> meta

  for (const [srCol, nameCol, , newCol] of blocks) {
    let currentRaw = null;   // raw header text
    let currentCanon = null; // { name, order, provisional }
    let itemsInCat = 0;

    for (let r = 2; r < grid.length; r++) {
      const row = grid[r] || [];
      const sr = row[srCol];
      const name = row[nameCol];
      const price = row[newCol];

      // Skip the repeated column-label row ("Sr. No." / "Item Name" / ...).
      const LABEL_RE = /^(sr\.?\s*no\.?|item name|old price|new price)$/i;
      if ((typeof name === 'string' && LABEL_RE.test(name.trim())) ||
          (typeof sr === 'string' && LABEL_RE.test(sr.trim()))) {
        continue;
      }

      const hasPrice = isInt(price) || (typeof price === 'string' && price.trim() !== '');
      const nameIsStr = typeof name === 'string' && name.trim() !== '';
      const srIsStr = typeof sr === 'string' && sr.trim() !== '';

      // Category header: no price, and a header string present.
      if (!hasPrice) {
        const headerText = nameIsStr ? name : srIsStr ? sr : null;
        if (headerText) {
          currentRaw = headerText;
          currentCanon = CATEGORY_MAP[headerText];
          if (!currentCanon) {
            warnings.push(`Unmapped category header "${headerText}" at ${colLetter(srCol)}${r + 1}`);
            currentCanon = { name: headerText, order: 99 };
          }
          categoriesSeen.set(currentCanon.name, currentCanon);
          itemsInCat = 0;
        }
        continue;
      }

      if (!nameIsStr) continue; // price without a name — skip

      // Detect the unlabelled beverage run: Sr restarts at 1 mid-category.
      if (isInt(sr) && sr === 1 && itemsInCat > 0) {
        currentRaw = '__UNLABELLED_BEVERAGES__';
        currentCanon = CATEGORY_MAP[currentRaw];
        categoriesSeen.set(currentCanon.name, currentCanon);
        itemsInCat = 0;
      }

      if (!currentCanon) {
        warnings.push(`Item "${name}" at ${colLetter(nameCol)}${r + 1} has no category — skipped`);
        continue;
      }

      const rawName = String(name);
      const cell = `${colLetter(nameCol)}${r + 1}`;
      const priceCell = `${colLetter(newCol)}${r + 1}`;
      const variant = parseVariant(rawName, price);

      if (variant) {
        const display = variant.base;
        items.push({
          category: currentCanon.name,
          rawName,
          displayName: display,
          sourceRef: `dsp:${slug(currentCanon.name)}:${slug(display)}`,
          basePrice: variant.variants[0].price,
          variants: variant.variants,
          cell,
          priceCell,
          rawPrice: price,
          spelling: spellingFor(rawName),
        });
      } else {
        const numeric = isInt(price) ? price : Number(String(price).trim());
        if (!Number.isFinite(numeric)) {
          warnings.push(`Item "${name}" at ${priceCell} has non-numeric price "${price}" — skipped`);
          continue;
        }
        const display = normalizeName(rawName);
        items.push({
          category: currentCanon.name,
          rawName,
          displayName: display,
          sourceRef: `dsp:${slug(currentCanon.name)}:${slug(display)}`,
          basePrice: numeric,
          variants: null,
          cell,
          priceCell,
          rawPrice: price,
          spelling: spellingFor(rawName),
        });
      }
      itemsInCat++;
    }
  }

  // Order categories by their canonical order for deterministic display_order.
  const categories = [...categoriesSeen.values()].sort((a, b) => a.order - b.order);
  return { items, categories, warnings, provisional: [...categoriesSeen.values()].filter((c) => c.provisional) };
}

// ---- Schema safety -------------------------------------------------------
async function ensureSourceRefColumn(db) {
  try {
    await db.get('SELECT source_ref FROM menu_items LIMIT 1');
    return; // column already exists
  } catch {
    /* add it below */
  }
  try {
    await db.run('ALTER TABLE menu_items ADD COLUMN source_ref TEXT');
    console.log('  + added menu_items.source_ref column');
  } catch (err) {
    if (!/duplicate|exists/i.test(String(err.message))) throw err;
  }
}

// ---- DB upserts ----------------------------------------------------------
async function upsertCategory(db, cat, changes) {
  const existing = await db.get('SELECT id FROM menu_categories WHERE name = ?', [cat.name]);
  if (existing) {
    if (!DRY_RUN) {
      await db.run(
        'UPDATE menu_categories SET display_order = ?, is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [cat.order, existing.id]
      );
    }
    changes.categories.updated.push(cat.name);
    return existing.id;
  }
  changes.categories.created.push(cat.name);
  if (DRY_RUN) return -1;
  await db.run(
    'INSERT INTO menu_categories (name, display_order, is_active) VALUES (?, ?, 1)',
    [cat.name, cat.order]
  );
  const row = await db.get('SELECT id FROM menu_categories WHERE name = ?', [cat.name]);
  return row.id;
}

async function upsertItem(db, item, categoryId, displayOrder, changes) {
  const existing = await db.get('SELECT id, base_price, name, category_id FROM menu_items WHERE source_ref = ?', [
    item.sourceRef,
  ]);
  let itemId;
  if (existing) {
    changes.items.updated.push({ ref: item.sourceRef, name: item.displayName, price: item.basePrice });
    itemId = existing.id;
    if (!DRY_RUN) {
      await db.run(
        `UPDATE menu_items
           SET name = ?, category_id = ?, base_price = ?, display_order = ?,
               is_available = 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [item.displayName, categoryId, item.basePrice, displayOrder, itemId]
      );
    }
  } else {
    changes.items.created.push({ ref: item.sourceRef, name: item.displayName, price: item.basePrice });
    if (DRY_RUN) return;
    await db.run(
      `INSERT INTO menu_items (name, category_id, base_price, display_order, is_available, source_ref)
       VALUES (?, ?, ?, ?, 1, ?)`,
      [item.displayName, categoryId, item.basePrice, displayOrder, item.sourceRef]
    );
    const row = await db.get('SELECT id FROM menu_items WHERE source_ref = ?', [item.sourceRef]);
    itemId = row.id;
  }

  // Variants: rebuild idempotently.
  if (!DRY_RUN && itemId) {
    await db.run('DELETE FROM menu_item_variants WHERE menu_item_id = ?', [itemId]);
    if (item.variants) {
      for (let i = 0; i < item.variants.length; i++) {
        const v = item.variants[i];
        await db.run(
          'INSERT INTO menu_item_variants (menu_item_id, variant_name, price_modifier, is_default) VALUES (?, ?, ?, ?)',
          [itemId, v.name, v.price - item.basePrice, i === 0 ? 1 : 0]
        );
      }
    }
  }
}

// ---- Report --------------------------------------------------------------
function writeReport({ items, categories, warnings, provisional }, changes) {
  const now = new Date().toISOString();
  const byCat = new Map();
  for (const it of items) {
    if (!byCat.has(it.category)) byCat.set(it.category, []);
    byCat.get(it.category).push(it);
  }
  const variantItems = items.filter((i) => i.variants);
  const spellingItems = items.filter((i) => i.spelling.length);

  const L = [];
  L.push('# Menu Import Report — Raithane Daure Chulo');
  L.push('');
  L.push(`- Generated: ${now}`);
  L.push(`- Source: \`data/menu/Menu.xlsx\` → \`data/menu/menu-grid.json\``);
  L.push(`- Mode: ${DRY_RUN ? '**DRY RUN** (no database writes)' : 'APPLIED to active database'}`);
  L.push(`- Items parsed: **${items.length}** across **${categories.length}** groups`);
  L.push(
    `- DB result: categories ${changes.categories.created.length} created / ${changes.categories.updated.length} updated; ` +
      `items ${changes.items.created.length} created / ${changes.items.updated.length} updated`
  );
  if (DEACTIVATE_UNMANAGED) {
    L.push(`- Legacy items hidden (is_available=0, not deleted): **${changes.deactivated}**`);
  }
  L.push('');

  if (provisional.length) {
    L.push('## ⚠️ Assumptions requiring client confirmation');
    for (const p of provisional) {
      L.push(`- **${p.name}** — the workbook leaves this heading blank; grouped provisionally. Confirm the name.`);
    }
    L.push('');
  }

  L.push('## Variant items (slash prices → variants, not text)');
  L.push('');
  L.push('| Item | Category | Variants | Source cell |');
  L.push('|------|----------|----------|-------------|');
  for (const v of variantItems) {
    const vs = v.variants.map((x) => `${x.name} Rs ${x.price}`).join('; ');
    L.push(`| ${v.displayName} | ${v.category} | ${vs} | ${v.cell} / ${v.priceCell} (\`${v.rawPrice}\`) |`);
  }
  L.push('');

  L.push('## Suspected spelling corrections (NOT auto-applied — confirm meaning)');
  L.push('');
  L.push('| Raw name (kept) | Suggestion | Category | Source cell |');
  L.push('|-----------------|------------|----------|-------------|');
  for (const s of spellingItems) {
    L.push(`| ${s.rawName} | ${s.spelling.join(', ')} | ${s.category} | ${s.cell} |`);
  }
  L.push('');

  if (warnings.length) {
    L.push('## Warnings');
    for (const w of warnings) L.push(`- ${w}`);
    L.push('');
  }

  L.push('## Full item list by group');
  L.push('');
  for (const cat of categories) {
    const list = byCat.get(cat.name) || [];
    L.push(`### ${cat.name} (${list.length})${cat.provisional ? ' — _provisional group_' : ''}`);
    L.push('');
    L.push('| # | Raw name | Display name | Price (Rs) | source_ref | Cell |');
    L.push('|---|----------|--------------|-----------|------------|------|');
    list.forEach((it, i) => {
      const price = it.variants
        ? it.variants.map((v) => `${v.name} ${v.price}`).join(' / ')
        : it.basePrice;
      L.push(`| ${i + 1} | ${it.rawName} | ${it.displayName} | ${price} | \`${it.sourceRef}\` | ${it.cell} |`);
    });
    L.push('');
  }

  fs.writeFileSync(REPORT_PATH, L.join('\n'), 'utf8');
  console.log(`\nReport written to ${path.relative(ROOT, REPORT_PATH)}`);
}

// ---- Main ----------------------------------------------------------------
async function main() {
  const parsed = parseGrid();
  console.log(`Parsed ${parsed.items.length} items across ${parsed.categories.length} categories.`);
  if (parsed.warnings.length) {
    console.log(`Warnings: ${parsed.warnings.length}`);
    parsed.warnings.forEach((w) => console.log(`  ! ${w}`));
  }

  const db = Database.getInstance();
  await ensureSourceRefColumn(db);

  const changes = {
    categories: { created: [], updated: [] },
    items: { created: [], updated: [] },
    deactivated: 0,
  };

  // Categories first (need ids), then items with per-category display_order.
  const catIds = new Map();
  for (const cat of parsed.categories) {
    catIds.set(cat.name, await upsertCategory(db, cat, changes));
  }

  const orderCounter = new Map();
  for (const item of parsed.items) {
    const n = (orderCounter.get(item.category) || 0) + 1;
    orderCounter.set(item.category, n);
    await upsertItem(db, item, catIds.get(item.category), n, changes);
  }

  if (DEACTIVATE_UNMANAGED && !DRY_RUN) {
    const res = await db.run('UPDATE menu_items SET is_available = 0 WHERE source_ref IS NULL');
    changes.deactivated = res?.changes ?? res?.rowCount ?? 0;
    // Hide legacy categories that have no imported (source_ref) items so their
    // filter chips disappear from the POS and public menu. Data is preserved.
    await db.run(
      `UPDATE menu_categories SET is_active = 0
       WHERE id NOT IN (SELECT DISTINCT category_id FROM menu_items WHERE source_ref IS NOT NULL)`
    );
  }

  writeReport(parsed, changes);

  console.log(
    `\n${DRY_RUN ? '[DRY RUN] Would apply' : 'Applied'}: ` +
      `categories +${changes.categories.created.length}/~${changes.categories.updated.length}, ` +
      `items +${changes.items.created.length}/~${changes.items.updated.length}`
  );

  if (Database.close) await Database.close();
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
