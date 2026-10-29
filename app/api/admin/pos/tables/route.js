import { NextResponse } from 'next/server';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { TableRepository } from '@/lib/db/repositories/tables.js';
import Database from '@/lib/db/index.js';
import { ensureKotProSchema } from '@/lib/kot-service.js';
import { ensureColumn } from '@/lib/db/schema-helpers.js';
import { logger } from '@/lib/logger.js';

async function loadTablesSafe(db) {
  try {
    const tableRepo = new TableRepository();
    return await tableRepo.getAll();
  } catch (error) {
    logger.warn('pos_tables_getAll_failed', { message: error?.message });
    // Fallback — same rows the Tables admin page uses.
    return db.all(
      `SELECT t.*, t.id AS table_id
       FROM tables t
       WHERE COALESCE(t.is_active, 1) = 1
       ORDER BY t.floor, t.section, t.table_number`
    );
  }
}

/** Table board for the Admin POS: every table + all active parties + KOT counts. */
export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'waiter', 'cashier'], permission: 'tables.view' });
    if (auth.error) return auth.error;

    const db = Database.getInstance();
    try {
      await ensureKotProSchema(db);
      await ensureColumn(db, 'orders', 'party_label', 'TEXT').catch(() => {});
    } catch (error) {
      logger.warn('pos_tables_schema_ensure_failed', { message: error?.message });
    }

    const tables = await loadTablesSafe(db);

    // All active orders across dine-in tables (supports multi-party).
    const activeOrders = await db.all(
      `SELECT o.id, o.table_id, o.order_number, o.status, o.party_label, o.customer_name, o.created_at,
              COALESCE((
                SELECT SUM(oi.subtotal) FROM order_items oi
                WHERE oi.order_id = o.id
                  AND COALESCE(oi.status,'') NOT IN ('voided','cancelled')
              ), 0) AS amount
       FROM orders o
       WHERE o.table_id IS NOT NULL
         AND o.status NOT IN ('completed','cancelled')
       ORDER BY o.id ASC`
    ).catch(() => []);

    const byTable = {};
    for (const o of activeOrders) {
      const canon = Number(o.table_id);
      const key = Number.isFinite(canon) ? canon : o.table_id;
      if (!byTable[key]) byTable[key] = [];
      byTable[key].push(o);
    }

    const activeIds = activeOrders.map((o) => o.id);
    let kotCounts = {};
    let unsentCounts = {};
    if (activeIds.length) {
      const ph = activeIds.map(() => '?').join(',');
      const krows = await db.all(
        `SELECT order_id, COUNT(*) AS c FROM kots
         WHERE order_id IN (${ph}) AND COALESCE(voided,0)=0 AND COALESCE(kot_type,'new')!='cancellation'
         GROUP BY order_id`,
        activeIds
      ).catch(() => []);
      for (const r of krows) kotCounts[r.order_id] = Number(r.c);
      const urows = await db.all(
        `SELECT order_id, COALESCE(SUM(quantity - COALESCE(sent_quantity,0)),0) AS u
         FROM order_items
         WHERE order_id IN (${ph}) AND COALESCE(status,'') NOT IN ('voided','cancelled')
         GROUP BY order_id`,
        activeIds
      ).catch(() => []);
      for (const r of urows) unsentCounts[r.order_id] = Number(r.u);
    }

    const board = (tables || []).map((t) => {
      const tid = t.table_id || t.id;
      const tidNum = Number(tid);
      const parties = (byTable[tidNum] || byTable[tid] || byTable[String(tid)] || []).map((o, idx) => ({
        order_id: o.id,
        order_number: o.order_number,
        order_status: o.status,
        party_label: o.party_label || `Party ${idx + 1}`,
        customer_name: o.customer_name || null,
        amount: Number(o.amount || 0),
        created_at: o.created_at || null,
        kot_count: kotCounts[o.id] || 0,
        unsent_count: unsentCounts[o.id] || 0,
      }));
      const primary = parties.find((p) => p.order_id === t.current_order_id) || parties[0] || null;
      const totalAmount = parties.reduce((s, p) => s + p.amount, 0);
      // Earliest active party start — how long this table has been running.
      const openedAt = parties
        .map((p) => p.created_at)
        .filter(Boolean)
        .sort()[0] || null;
      return {
        id: tid,
        table_number: t.table_number,
        capacity: t.capacity,
        floor: t.floor,
        section: t.section,
        status: parties.length ? (t.status === 'available' ? 'occupied' : t.status) : t.status,
        current_order_id: primary?.order_id || t.current_order_id || null,
        order_status: primary?.order_status || t.order_status || null,
        order_number: primary?.order_number || t.order_number || null,
        current_amount: totalAmount,
        kot_count: parties.reduce((s, p) => s + p.kot_count, 0),
        unsent_count: parties.reduce((s, p) => s + p.unsent_count, 0),
        party_count: parties.length,
        opened_at: openedAt,
        parties,
      };
    });

    return NextResponse.json({ success: true, tables: board });
  } catch (error) {
    return handleRouteError(error, 'Could not load the table board.');
  }
}
