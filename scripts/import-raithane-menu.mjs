/**
 * Idempotent menu importer for Raithane Daure Chulo.
 *
 * Reads data/menu/raithane-menu.json (transcribed from the client's handwritten
 * menu book) and upserts menu_categories / menu_items / menu_item_variants keyed
 * by a stable `source_ref`, so re-running updates rather than duplicates.
 *
 * Items that exist in the DB but are not in this file are hidden
 * (is_available = 0) rather than deleted, so historical order_items keep their
 * foreign key. Nothing in the ordering/billing flow is touched.
 *
 * Usage:
 *   node scripts/import-raithane-menu.mjs             # apply to the active DB
 *   node scripts/import-raithane-menu.mjs --dry-run   # report only, no writes
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from '../lib/db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const MENU_PATH = path.join(ROOT, 'data', 'menu', 'raithane-menu.json');

const DRY_RUN = process.argv.includes('--dry-run');

async function ensureSourceRefColumn(db) {
  try {
    await db.get('SELECT source_ref FROM menu_items LIMIT 1');
    return;
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

async function upsertCategory(db, cat) {
  const existing = await db.get('SELECT id FROM menu_categories WHERE name = ?', [cat.name]);
  if (existing) {
    if (!DRY_RUN) {
      await db.run(
        'UPDATE menu_categories SET display_order = ?, is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [cat.order, existing.id]
      );
    }
    return { id: existing.id, created: false };
  }
  if (DRY_RUN) return { id: -1, created: true };
  await db.run('INSERT INTO menu_categories (name, display_order, is_active) VALUES (?, ?, 1)', [
    cat.name,
    cat.order,
  ]);
  const row = await db.get('SELECT id FROM menu_categories WHERE name = ?', [cat.name]);
  return { id: row.id, created: true };
}

async function upsertItem(db, item, categoryId, displayOrder) {
  const isVeg = item.veg ? 1 : 0;
  const description = item.description || null;
  const image = item.image || null;

  const existing = await db.get('SELECT id FROM menu_items WHERE source_ref = ?', [item.ref]);
  let itemId;
  let created = false;

  if (existing) {
    itemId = existing.id;
    if (!DRY_RUN) {
      await db.run(
        `UPDATE menu_items
            SET name = ?, description = ?, category_id = ?, base_price = ?, image_url = ?,
                is_vegetarian = ?, display_order = ?, is_available = 1,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [item.name, description, categoryId, item.price, image, isVeg, displayOrder, itemId]
      );
    }
  } else {
    created = true;
    if (DRY_RUN) return { created, variants: item.variants?.length || 0 };
    await db.run(
      `INSERT INTO menu_items
         (name, description, category_id, base_price, image_url, is_vegetarian,
          display_order, is_available, source_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [item.name, description, categoryId, item.price, image, isVeg, displayOrder, item.ref]
    );
    const row = await db.get('SELECT id FROM menu_items WHERE source_ref = ?', [item.ref]);
    itemId = row.id;
  }

  // Variants are rebuilt from the source file so re-runs stay idempotent.
  if (!DRY_RUN && itemId) {
    await db.run('DELETE FROM menu_item_variants WHERE menu_item_id = ?', [itemId]);
    const variants = item.variants || [];
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      await db.run(
        `INSERT INTO menu_item_variants
           (menu_item_id, variant_name, price_modifier, price, is_default)
         VALUES (?, ?, ?, ?, ?)`,
        [itemId, v.name, v.price - item.price, v.price, i === 0 ? 1 : 0]
      );
    }
  }

  return { created, variants: item.variants?.length || 0 };
}

async function main() {
  const menu = JSON.parse(fs.readFileSync(MENU_PATH, 'utf8'));
  const db = Database.getInstance();
  await ensureSourceRefColumn(db);

  const refs = [];
  let createdItems = 0;
  let updatedItems = 0;
  let createdCats = 0;
  let variantCount = 0;
  let displayOrder = 0;

  for (const cat of menu.categories) {
    const { id: categoryId, created } = await upsertCategory(db, cat);
    if (created) createdCats++;
    console.log(`\n${cat.name} (${cat.items.length} items)`);
    for (const item of cat.items) {
      displayOrder++;
      refs.push(item.ref);
      const res = await upsertItem(db, item, categoryId, displayOrder);
      if (res.created) createdItems++;
      else updatedItems++;
      variantCount += res.variants;
      console.log(
        `  ${res.created ? '+' : '~'} ${item.name} — Rs ${item.price}` +
          (res.variants ? ` (${res.variants} variants)` : '')
      );
    }
  }

  // Hide anything not in the new menu; never delete (order history references it).
  let hidden = 0;
  if (!DRY_RUN && refs.length) {
    const placeholders = refs.map(() => '?').join(',');
    const stale = await db.all(
      `SELECT id, name FROM menu_items
        WHERE is_available = 1
          AND (source_ref IS NULL OR source_ref NOT IN (${placeholders}))`,
      refs
    );
    for (const row of stale) {
      await db.run(
        'UPDATE menu_items SET is_available = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [row.id]
      );
      hidden++;
    }
    if (hidden) console.log(`\nHidden ${hidden} item(s) no longer on the menu.`);

    // Deactivate categories that ended up with no available items.
    const emptyCats = await db.all(
      `SELECT c.id, c.name FROM menu_categories c
        WHERE c.is_active = 1
          AND NOT EXISTS (
            SELECT 1 FROM menu_items i WHERE i.category_id = c.id AND i.is_available = 1
          )`
    );
    for (const c of emptyCats) {
      await db.run('UPDATE menu_categories SET is_active = 0 WHERE id = ?', [c.id]);
      console.log(`  - deactivated empty category: ${c.name}`);
    }
  }

  console.log(
    `\n${DRY_RUN ? '[dry run] ' : ''}Done. ` +
      `${createdCats} new categories, ${createdItems} new items, ${updatedItems} updated, ` +
      `${variantCount} variants, ${hidden} hidden.`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
