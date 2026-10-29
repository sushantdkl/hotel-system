import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PosDatabase } from '../../lib/db/index.js';
import { MenuRepository } from '../../lib/db/repositories/menu.js';

test('public menu initializes stock columns on legacy SQLite without inventory-page visits', async () => {
  for (let connection = 0; connection < 2; connection++) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-menu-schema-'));
    const file = path.join(dir, 'test.db');
    const db = new PosDatabase(file);
    try {
      // Reproduce a database created from the old base seed.
      await db.run('ALTER TABLE inventory_items DROP COLUMN is_archived');
      await db.run('ALTER TABLE inventory_items DROP COLUMN pos_stock_visible');
      const repo = Object.create(MenuRepository.prototype);
      repo.db = db;
      const items = await repo.getAllItems({ available: true });
      assert.ok(items.length > 0);
      const item = items[0];
      await db.run('INSERT INTO inventory_items (item_name, menu_item_id, quantity, unit, pos_stock_visible, is_archived) VALUES (?, ?, ?, ?, 1, 0)', ['Test menu stock', item.id, 5, 'pcs']);
      const visible = (await repo.getAllItems()).find((row) => row.id === item.id);
      assert.equal(visible.stock_quantity, 5);
      await db.run('UPDATE inventory_items SET is_archived = 1 WHERE menu_item_id = ?', [item.id]);
      assert.equal((await repo.getAllItems()).find((row) => row.id === item.id).stock_quantity, null);
    } finally {
      db.close();
      for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(file + suffix)) fs.unlinkSync(file + suffix);
      fs.rmdirSync(dir);
    }
  }
});
