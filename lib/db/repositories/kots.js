import Database from '../index.js';
import { ensureKotProSchema } from '../../kot-service.js';
import { nextDocumentNumber } from '../../document-numbers.js';
import { nepalDateString } from '../../report-dates.js';

export class KotRepository {
  constructor() {
    this.db = Database.getInstance();
  }

  async _hasKots() {
    try {
      if (this.db.driver === 'postgres') {
        return !!await this.db.get(
          `SELECT 1 AS ok FROM information_schema.tables WHERE table_name = 'kots'`
        );
      }
      return !!await this.db.get(
        `SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='kots'`
      );
    } catch {
      // If check fails, try a simple select
      try {
        await this.db.get(`SELECT 1 AS ok FROM kots LIMIT 1`);
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * Create a new KOT from order items
   */
  async create({ order_id, station, items, prepared_by = null, order_notes = null }) {
    if (!await this._hasKots()) return null;
    await ensureKotProSchema(this.db);

    return await this.db.transaction(async () => {
      // Fetched before the number is minted: the order's channel is what
      // decides the prefix (K / K-TW / K-D).
      const order = await this.db.get('SELECT table_id, table_number, order_type FROM orders WHERE id = ?', [order_id]);
      const kotNumber = await nextDocumentNumber(this.db, { type: 'kot', prefix: 'KOT', order });
      // Insert KOT
      const result = await this.db.run(
        `INSERT INTO kots (kot_number, order_id, station, status, prepared_by, table_id, table_number, order_type, order_notes)
         VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
        [kotNumber, order_id, station, prepared_by, order?.table_id || null, order?.table_number || null, order?.order_type || null, order_notes || null]
      );

      const kot_id = result.lastInsertRowid;

      // Insert KOT items
      for (const item of items) {
        await this.db.run(
          `INSERT INTO kot_items (kot_id, order_item_id, menu_item_id, quantity, special_instructions, status)
           VALUES (?, ?, ?, ?, ?, 'pending')`,
          [
            kot_id,
            item.order_item_id || null,
            item.menu_item_id || null,
            item.quantity,
            item.special_instructions || null,
          ]
        );
      }

      return kot_id;
    });
  }

  /**
   * Get KOT by ID with all items
   */
  async getById(id) {
    if (!await this._hasKots()) return null;

    const kot = await this.db.get(
      `SELECT 
        k.*,
        k.id as kot_id,
        o.order_number,
        o.table_id,
        t.table_number
       FROM kots k
       LEFT JOIN orders o ON k.order_id = o.id
       LEFT JOIN tables t ON o.table_id = t.id
       WHERE k.id = ?`,
      [id]
    );

    if (!kot) return null;

    // Get items
    kot.items = await this.getItems(id);

    return kot;
  }

  /**
   * Get KOTs by order ID
   */
  async getByOrder(orderId) {
    if (!await this._hasKots()) return [];

    const kots = await this.db.all(
      `SELECT
        k.*,
        k.id as kot_id,
        COALESCE(k.kot_number, 'KOT-' || k.id) as kot_number,
        (
          SELECT COUNT(ki.id)
          FROM kot_items ki
          WHERE ki.kot_id = k.id
        ) as total_items
       FROM kots k
       WHERE k.order_id = ?
       ORDER BY COALESCE(k.printed_at, k.id) DESC`,
      [orderId]
    );
    
    // Fetch items for each KOT
    const kotsWithItems = [];
    for (const kot of kots) {
      kotsWithItems.push({
        ...kot,
        items: await this.getItems(kot.kot_id)
      });
    }
    return kotsWithItems;
  }

  /**
   * Get KOTs by status and station
   */
  async getByFilters({ status = null, station = null, date = null, limit = 50 }) {
    if (!await this._hasKots()) return [];

    let query = `
      SELECT
        k.*,
        k.id as kot_id,
        o.order_number,
        o.table_id,
        t.table_number,
        (
          SELECT COUNT(ki.id)
          FROM kot_items ki
          WHERE ki.kot_id = k.id
        ) as total_items,
        (
          SELECT SUM(CASE WHEN ki.status = 'completed' THEN 1 ELSE 0 END)
          FROM kot_items ki
          WHERE ki.kot_id = k.id
        ) as completed_items
      FROM kots k
      LEFT JOIN orders o ON k.order_id = o.id
      LEFT JOIN tables t ON o.table_id = t.id
      WHERE 1=1
    `;

    const params = [];

    if (status) {
      query += ` AND k.status = ?`;
      params.push(status);
    }

    if (station) {
      query += ` AND k.station = ?`;
      params.push(station);
    }

    if (date) {
      query += ` AND date(k.printed_at, '+5 hours', '+45 minutes') = date(?)`;
      params.push(date);
    }

    query += `
      ORDER BY
        CASE k.status
          WHEN 'pending' THEN 1
          WHEN 'preparing' THEN 2
          WHEN 'ready' THEN 3
          ELSE 4
        END,
        k.printed_at DESC
      LIMIT ?
    `;
    params.push(limit);

    return await this.db.all(query, params);
  }

  /**
   * Get pending KOTs for a specific station
   */
  async getPendingByStation(station) {
    return await this.getByFilters({ status: 'pending', station });
  }

  /**
   * Get all active KOTs (pending, preparing, ready)
   */
  async getActive() {
    if (!await this._hasKots()) return [];

    return await this.db.all(
      `SELECT
        k.*,
        k.id as kot_id,
        o.order_number,
        o.table_id,
        t.table_number,
        (
          SELECT COUNT(ki.id)
          FROM kot_items ki
          WHERE ki.kot_id = k.id
        ) as total_items,
        (
          SELECT SUM(CASE WHEN ki.status = 'completed' THEN 1 ELSE 0 END)
          FROM kot_items ki
          WHERE ki.kot_id = k.id
        ) as completed_items
       FROM kots k
       LEFT JOIN orders o ON k.order_id = o.id
       LEFT JOIN tables t ON o.table_id = t.id
       WHERE k.status IN ('pending', 'preparing', 'ready')
       ORDER BY
         CASE k.status
           WHEN 'pending' THEN 1
           WHEN 'preparing' THEN 2
           ELSE 3
         END,
         k.printed_at DESC`
    );
  }

  /**
   * Update KOT status
   */
  async updateStatus(id, status, prepared_by = null) {
    if (!await this._hasKots()) return false;

    const params = [status];
    let query = `UPDATE kots SET status = ?`;

    if (status === 'preparing') {
      query += `, started_at = CURRENT_TIMESTAMP`;
    } else if (status === 'ready') {
      query += `, completed_at = CURRENT_TIMESTAMP`;
    }

    query += ` WHERE id = ?`;
    params.push(id);

    const result = await this.db.run(query, params);
    return result.changes > 0;
  }

  /**
   * Update individual KOT item status
   */
  async updateItemStatus(kot_item_id, status) {
    if (!await this._hasKots()) return false;

    const result = await this.db.run(
      `UPDATE kot_items SET status = ? WHERE id = ?`,
      [status, kot_item_id]
    );

    if (result.changes > 0) {
      // Check if all items in the KOT are completed
      const kotItem = await this.db.get(
        `SELECT kot_id FROM kot_items WHERE id = ?`,
        [kot_item_id]
      );

      if (kotItem) {
        const pendingCount = await this.db.get(
          `SELECT COUNT(*) as count FROM kot_items 
           WHERE kot_id = ? AND status != 'completed'`,
          [kotItem.kot_id]
        );

        // If all items completed, mark KOT as ready
        if (pendingCount.count === 0) {
          await this.updateStatus(kotItem.kot_id, 'ready');
        }
      }
    }

    return result.changes > 0;
  }

  /**
   * Get KOT items by KOT ID
   */
  async getItems(kot_id) {
    if (!await this._hasKots()) return [];

    try {
      return await this.db.all(
        `SELECT 
          ki.*,
          oi.special_instructions,
          COALESCE(mi.name, oi.item_name) as item_name,
          mi.preparation_time as prep_time_minutes,
          mi.image_url as image_url
         FROM kot_items ki
         LEFT JOIN order_items oi ON ki.order_item_id = oi.id
         LEFT JOIN menu_items mi ON COALESCE(ki.menu_item_id, oi.menu_item_id, oi.item_id) = mi.id
         WHERE ki.kot_id = ?
         ORDER BY ki.id`,
        [kot_id]
      );
    } catch {
      return [];
    }
  }

  /**
   * Mark all items in a KOT as completed
   */
  async completeAllItems(kot_id) {
    if (!await this._hasKots()) return false;

    return await this.db.transaction(async () => {
      // Update all items to completed
      await this.db.run(
        `UPDATE kot_items SET status = 'completed' WHERE kot_id = ?`,
        [kot_id]
      );

      // Update KOT status to ready
      await this.updateStatus(kot_id, 'ready');

      return true;
    });
  }

  /**
   * Get kitchen performance stats for a date
   */
  async getStats(date = nepalDateString()) {
    if (!await this._hasKots()) {
      return {
        total_kots: 0,
        pending_kots: 0,
        preparing_kots: 0,
        ready_kots: 0,
        completed_kots: 0,
        avg_prep_time_minutes: 0,
        by_station: [],
      };
    }

    const stats = await this.db.get(
      `SELECT 
        COUNT(*) as total_kots,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_kots,
        SUM(CASE WHEN status = 'preparing' THEN 1 ELSE 0 END) as preparing_kots,
        SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) as ready_kots,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_kots,
        AVG(
          CASE WHEN completed_at IS NOT NULL 
          THEN (julianday(completed_at) - julianday(printed_at)) * 24 * 60
          ELSE NULL END
        ) as avg_prep_time_minutes
       FROM kots
       WHERE date(printed_at, '+5 hours', '+45 minutes') = date(?)`,
      [date]
    );

    // Get stats by station
    const stationStats = await this.db.all(
      `SELECT 
        station,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'preparing' THEN 1 ELSE 0 END) as preparing,
        AVG(
          CASE WHEN completed_at IS NOT NULL 
          THEN (julianday(completed_at) - julianday(printed_at)) * 24 * 60
          ELSE NULL END
        ) as avg_prep_time
       FROM kots
       WHERE date(printed_at, '+5 hours', '+45 minutes') = date(?)
       GROUP BY station`,
      [date]
    );

    return {
      ...stats,
      by_station: stationStats
    };
  }
}
