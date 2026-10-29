import Database from '../index.js';

export class TableRepository {
  constructor() {
    this.db = Database.getInstance();
  }

  async getAll(filters = {}) {
    // Subqueries instead of JOIN+GROUP BY — Postgres rejects SQLite-style GROUP BY t.id
    // when selecting columns from joined tables.
    let sql = `
      SELECT
        t.*,
        t.id AS table_id,
        t.current_order_id,
        o.id AS order_id,
        o.order_number,
        o.status AS order_status,
        o.created_at AS order_created_at,
        o.customer_name,
        u.full_name AS waiter_name,
        (
          SELECT COUNT(oi.id)
          FROM order_items oi
          WHERE oi.order_id = o.id AND COALESCE(oi.status, '') NOT IN ('voided', 'cancelled')
        ) AS item_count,
        (
          SELECT COALESCE(SUM(oi.subtotal), 0)
          FROM order_items oi
          WHERE oi.order_id = o.id AND COALESCE(oi.status, '') NOT IN ('voided', 'cancelled')
        ) AS current_order_amount,
        (
          SELECT COALESCE(SUM(oi.subtotal), 0)
          FROM order_items oi
          WHERE oi.order_id = o.id AND COALESCE(oi.status, '') NOT IN ('voided', 'cancelled')
        ) AS current_amount
      FROM tables t
      LEFT JOIN orders o ON t.current_order_id = o.id
      LEFT JOIN users u ON t.waiter_id = u.id
      WHERE COALESCE(t.is_active, 1) = 1
    `;
    const params = [];

    if (filters.floor) {
      sql += ' AND t.floor = ?';
      params.push(filters.floor);
    }

    if (filters.section) {
      sql += ' AND t.section = ?';
      params.push(filters.section);
    }

    if (filters.status) {
      sql += ' AND t.status = ?';
      params.push(filters.status);
    }

    // Lexicographic sort — avoid CAST(... AS INTEGER) which errors on Postgres for non-numeric labels
    sql += ` ORDER BY t.floor, t.section, t.table_number`;

    return await this.db.all(sql, params);
  }

  async getById(id) {
    return await this.db.get('SELECT *, id as table_id FROM tables WHERE id = ?', [id]);
  }

  async getByNumber(tableNumber) {
    return await this.db.get('SELECT *, id as table_id FROM tables WHERE table_number = ?', [tableNumber]);
  }

  async updateStatus(id, status) {
    return await this.db.run(
      `
      UPDATE tables
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
      [status, id]
    );
  }

  async assignWaiter(tableId, waiterId) {
    return await this.db.run(
      `
      UPDATE tables
      SET waiter_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
      [waiterId, tableId]
    );
  }

  async clearTable(id) {
    const table = await this.getById(id);
    if (table?.current_order_id) {
      const err = new Error(
        'This table still has an open order. Cancel or complete the order before clearing.'
      );
      err.code = 'open_order';
      err.status = 409;
      throw err;
    }
    return await this.db.run(
      `
      UPDATE tables
      SET status = 'available',
          current_order_id = NULL,
          waiter_id = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
      [id]
    );
  }

  async getAvailableTables() {
    return await this.db.all(`
      SELECT *, id as table_id FROM tables
      WHERE status = 'available' AND (is_active = 1 OR is_active IS NULL)
      ORDER BY capacity, table_number
    `);
  }

  async getOccupiedTables() {
    return await this.db.all(`
      SELECT
        t.*,
        t.id AS table_id,
        o.order_number,
        o.created_at AS order_time,
        u.full_name AS waiter_name,
        (
          SELECT COALESCE(SUM(oi.subtotal), 0)
          FROM order_items oi
          WHERE oi.order_id = o.id AND COALESCE(oi.status, '') NOT IN ('voided', 'cancelled')
        ) AS current_amount
      FROM tables t
      LEFT JOIN orders o ON t.current_order_id = o.id
      LEFT JOIN users u ON t.waiter_id = u.id
      WHERE t.status = 'occupied'
      ORDER BY o.created_at
    `);
  }
}
