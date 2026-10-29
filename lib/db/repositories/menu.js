import Database from '../index.js';
import { ensureMenuVariantsSchema, getVariantsByMenuItemIds } from '@/lib/menu-variants.js';

export class MenuRepository {
  constructor() {
    this.db = Database.getInstance();
  }
  
  async getCategories() {
    return await this.db.all(`
      SELECT * FROM menu_categories 
      WHERE is_active = 1 
      ORDER BY COALESCE(display_order, 999), name
    `);
  }
  
  async getItemsByCategory(categoryId) {
    await ensureMenuVariantsSchema(this.db);
    const items = await this.db.all(`
      SELECT mi.*, mi.id as item_id, mi.name as item_name,
             mi.base_price as price, mi.is_vegetarian as is_veg,
             mc.name as category
      FROM menu_items mi
      JOIN menu_categories mc ON mi.category_id = mc.id
      WHERE mi.category_id = ? AND mi.is_available = 1
      ORDER BY mi.name
    `, [categoryId]);
    const variantsByItem = await getVariantsByMenuItemIds(this.db, items.map((i) => i.id));
    for (const item of items) item.variants = variantsByItem.get(item.id) || [];
    return items;
  }
  
  async getAllItems(filters = {}) {
    await ensureMenuVariantsSchema(this.db);
    let sql = `
      SELECT mi.*, mi.id as item_id, mi.name as item_name,
             mi.base_price as price, mi.is_vegetarian as is_veg,
             mc.name as category,
             (SELECT i.quantity FROM inventory_items i WHERE i.menu_item_id = mi.id AND COALESCE(i.is_archived, 0) = 0 AND COALESCE(i.pos_stock_visible, 0) = 1 LIMIT 1) AS stock_quantity,
             (SELECT i.unit FROM inventory_items i WHERE i.menu_item_id = mi.id AND COALESCE(i.is_archived, 0) = 0 AND COALESCE(i.pos_stock_visible, 0) = 1 LIMIT 1) AS stock_unit
      FROM menu_items mi
      JOIN menu_categories mc ON mi.category_id = mc.id
      WHERE 1=1
    `;
    const params = [];
    
    if (filters.category_id) {
      sql += ' AND mi.category_id = ?';
      params.push(filters.category_id);
    }
    
    if (filters.search) {
      sql += ' AND (mi.name LIKE ? OR mi.description LIKE ?)';
      const searchTerm = `%${filters.search}%`;
      params.push(searchTerm, searchTerm);
    }
    
    if (filters.is_vegetarian !== undefined) {
      sql += ' AND mi.is_vegetarian = ?';
      params.push(filters.is_vegetarian ? 1 : 0);
    }
    
    if (filters.available !== null && filters.available !== undefined) {
      sql += ' AND mi.is_available = ?';
      params.push(filters.available ? 1 : 0);
    }
    
    sql += ' ORDER BY mc.name, mi.name';

    const items = await this.db.all(sql, params);
    const variantsByItem = await getVariantsByMenuItemIds(this.db, items.map((i) => i.id));
    for (const item of items) item.variants = variantsByItem.get(item.id) || [];
    return items;
  }
  
  async getItemById(id) {
    const item = await this.db.get(`
      SELECT mi.*, mc.name as category_name
      FROM menu_items mi
      JOIN menu_categories mc ON mi.category_id = mc.id
      WHERE mi.id = ?
    `, [id]);
    
    if (item) {
      try {
        item.variants = await this.db.all(`
          SELECT * FROM menu_item_variants 
          WHERE menu_item_id = ?
          ORDER BY price_modifier
        `, [id]);
      } catch {
        item.variants = [];
      }
    }
    
    return item;
  }
  
  async createItem(item) {
    const result = await this.db.run(`
      INSERT INTO menu_items (
        name, description, category_id, base_price, image_url,
        preparation_time, is_vegetarian, is_available
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      item.name,
      item.description || null,
      item.category_id,
      item.base_price,
      item.image_url || null,
      item.preparation_time || item.prep_time_minutes || 15,
      item.is_vegetarian ? 1 : 0,
      item.is_available !== false ? 1 : 0,
    ]);
    
    return result.lastInsertRowid;
  }
  
  async updateItem(id, item) {
    return await this.db.run(`
      UPDATE menu_items SET
        name = ?, description = ?, category_id = ?, base_price = ?,
        image_url = ?,
        preparation_time = ?, is_vegetarian = ?, is_available = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [
      item.name,
      item.description,
      item.category_id,
      item.base_price,
      item.image_url ?? null,
      item.preparation_time,
      item.is_vegetarian ? 1 : 0,
      item.is_available ? 1 : 0,
      id,
    ]);
  }
  
  async toggleAvailability(id) {
    return await this.db.run(`
      UPDATE menu_items 
      SET is_available = NOT is_available,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [id]);
  }
  
  async deleteItem(id) {
    // Clear the inventory link first. inventory_items.menu_item_id is declared
    // ON DELETE SET NULL in the schema, but the column is also added by
    // ensureColumn() on databases that predate it — and an ALTER TABLE ADD
    // COLUMN carries no FK, so on those the delete would leave the inventory
    // row pointing at a menu item that no longer exists. That stale link then
    // wins over name matching in resolveInventoryItem() as soon as the id is
    // reused. Clearing it explicitly costs one statement and never lies.
    return await this.db.transaction(async (tx) => {
      await tx.run(
        'UPDATE inventory_items SET menu_item_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE menu_item_id = ?',
        [id]
      );
      return await tx.run('DELETE FROM menu_items WHERE id = ?', [id]);
    });
  }
}
