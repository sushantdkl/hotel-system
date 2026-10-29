/**
 * Table conflict detection for reservations + walk-ins.
 */

import Database from '@/lib/db/index.js';
import {
  reservationDateTime,
  RESERVATION_STATUS,
  parsePartySize,
  parsePreferences,
} from '@/lib/reservation-core.js';
import { getReservationSettings } from '@/lib/reservation-settings.js';

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

export function occupancyWindow(start, settings) {
  if (!start) return null;
  const hold = settings.reservation_hold_minutes ?? 30;
  const dining = settings.reservation_dining_minutes ?? 90;
  const cleaning = settings.reservation_cleaning_minutes ?? 10;
  return {
    start: addMinutes(start, -hold),
    end: addMinutes(start, dining + cleaning),
  };
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

export { parsePartySize };

/**
 * Check if assigning `tableId` conflicts for a slot.
 */
export async function checkTableConflict(
  {
    tableId,
    startDate,
    startTime,
    excludeReservationId = null,
    partySize = null,
    preferences = null,
    skipAlternatives = false,
  },
  db = Database.getInstance()
) {
  if (!tableId) return { ok: true, conflicts: [], alternatives: [] };

  const settings = await getReservationSettings(db);
  const start = reservationDateTime(startDate, startTime);
  if (!start) {
    return { ok: false, error: 'Invalid reservation date/time.', conflicts: [], alternatives: [] };
  }

  const window = occupancyWindow(start, settings);
  const table = await db.get(`SELECT * FROM tables WHERE id = ?`, [tableId]);
  if (!table) {
    return { ok: false, error: 'Table not found.', conflicts: [], alternatives: [] };
  }

  const conflicts = [];
  const size = partySize != null ? partySize : null;
  const prefs = parsePreferences(preferences);

  if (size != null && table.capacity != null && Number(table.capacity) < size) {
    conflicts.push({
      type: 'capacity',
      message: `Table ${table.table_number} seats ${table.capacity}, but party is ${size}. Suggest a larger table or combining tables.`,
    });
  }

  if (prefs.wheelchair && String(table.notes || '').toLowerCase().includes('no wheelchair')) {
    conflicts.push({
      type: 'preference',
      message: `Table ${table.table_number} may not meet wheelchair access needs.`,
    });
  }

  const rows = await db.all(
    `SELECT * FROM reservations
     WHERE table_id = ?
       AND status IN ('confirmed', 'arrived', 'seated')
       ${excludeReservationId ? 'AND id != ?' : ''}`,
    excludeReservationId ? [tableId, excludeReservationId] : [tableId]
  );

  for (const r of rows) {
    const rStart = reservationDateTime(r.date, r.time);
    if (!rStart) continue;
    const rWindow = occupancyWindow(rStart, settings);
    if (overlaps(window.start, window.end, rWindow.start, rWindow.end)) {
      conflicts.push({
        type: 'reservation',
        reservation_id: r.id,
        name: r.name,
        date: r.date,
        time: r.time,
        message: `Overlaps reservation for ${r.name} at ${r.time || r.date}.`,
      });
    }
  }

  if (table.current_order_id) {
    const order = await db.get(
      `SELECT * FROM orders WHERE id = ? AND status NOT IN ('completed', 'cancelled')`,
      [table.current_order_id]
    );
    if (order) {
      const raw = String(order.created_at || '').replace(' ', 'T');
      const orderStart = raw ? new Date(raw) : new Date();
      if (Number.isNaN(orderStart.getTime())) {
        conflicts.push({
          type: 'open_order',
          order_id: order.id,
          message: `Table ${table.table_number} has an open order.`,
        });
      } else {
        const orderEnd = addMinutes(
          orderStart,
          (settings.reservation_dining_minutes || 90) + (settings.reservation_cleaning_minutes || 10)
        );
        if (overlaps(window.start, window.end, orderStart, orderEnd)) {
          conflicts.push({
            type: 'open_order',
            order_id: order.id,
            message: `Table ${table.table_number} has an open order that overlaps this slot.`,
          });
        }
      }
    }
  }

  const alternatives = skipAlternatives
    ? []
    : await suggestAlternativeTables(
        {
          partySize: size,
          preferences: prefs,
          excludeTableId: tableId,
          startDate,
          startTime,
          excludeReservationId,
        },
        db
      );

  const hard = conflicts.filter((c) => c.type === 'reservation' || c.type === 'open_order' || c.type === 'capacity');
  return {
    ok: hard.length === 0,
    conflicts,
    alternatives,
    table,
    window,
  };
}

export async function suggestAlternativeTables(
  {
    partySize,
    preferences = {},
    excludeTableId = null,
    startDate,
    startTime,
    excludeReservationId = null,
    limit = 5,
  },
  db = Database.getInstance()
) {
  const start = reservationDateTime(startDate, startTime);
  if (!start) return [];

  let tables = await db.all(
    `SELECT * FROM tables WHERE (is_active = 1 OR is_active IS NULL) ORDER BY capacity, table_number`
  );

  if (excludeTableId) {
    tables = tables.filter((t) => t.id !== excludeTableId);
  }

  if (partySize) {
    tables = tables.filter((t) => !t.capacity || Number(t.capacity) >= partySize);
  }

  const prefs = parsePreferences(preferences);
  if (prefs.outdoor) {
    const outdoor = tables.filter((t) =>
      /outdoor|patio|garden|terrace/i.test(`${t.section || ''} ${t.floor || ''} ${t.notes || ''}`)
    );
    if (outdoor.length) tables = outdoor;
  }

  if (prefs.section) {
    const sec = String(prefs.section).toLowerCase();
    const filtered = tables.filter((t) => String(t.section || '').toLowerCase() === sec);
    if (filtered.length) tables = filtered;
  }

  const ok = [];
  for (const t of tables) {
    const check = await checkTableConflict(
      {
        tableId: t.id,
        startDate,
        startTime,
        excludeReservationId,
        partySize,
        preferences: prefs,
        skipAlternatives: true,
      },
      db
    );
    if (check.ok) {
      ok.push({
        id: t.id,
        table_number: t.table_number,
        capacity: t.capacity,
        section: t.section,
        floor: t.floor,
      });
    }
    if (ok.length >= limit) break;
  }
  return ok;
}

export async function isHoldActive(res, settings, now = new Date()) {
  if (![RESERVATION_STATUS.CONFIRMED, RESERVATION_STATUS.ARRIVED].includes(res?.status)) {
    return false;
  }
  const when = reservationDateTime(res.date, res.time);
  if (!when) return false;
  const hold = settings?.reservation_hold_minutes ?? 30;
  const grace = settings?.reservation_grace_minutes ?? 20;
  const ms = when.getTime() - now.getTime();
  return ms <= hold * 60 * 1000 && ms >= -(grace * 60 * 1000);
}

export async function findHoldForTable(tableId, db = Database.getInstance()) {
  const settings = await getReservationSettings(db);
  const rows = await db.all(
    `SELECT r.*, t.table_number
     FROM reservations r
     LEFT JOIN tables t ON t.id = r.table_id
     WHERE r.table_id = ? AND r.status IN ('confirmed', 'arrived')`,
    [tableId]
  );
  const now = new Date();
  return rows.find((r) => isHoldActive(r, settings, now)) || null;
}

/** Soft conflict warning: walk-in now vs upcoming hold (even outside hard block window). */
export async function upcomingHoldWarning(tableId, db = Database.getInstance()) {
  const settings = await getReservationSettings(db);
  const hold = await findHoldForTable(tableId, db);
  if (hold) {
    return {
      code: 'table_reserved',
      message: `Table ${hold.table_number} has an upcoming reservation for ${hold.name}.`,
      reservation: hold,
      alternatives: await suggestAlternativeTables(
        {
          partySize: parsePartySize(hold.guests, hold.party_size),
          startDate: hold.date,
          startTime: hold.time,
          excludeTableId: tableId,
          excludeReservationId: hold.id,
        },
        db
      ),
      settings,
    };
  }

  // Also warn if confirmed reservation starts within dining window even if outside hold
  const rows = await db.all(
    `SELECT r.*, t.table_number FROM reservations r
     LEFT JOIN tables t ON t.id = r.table_id
     WHERE r.table_id = ? AND r.status IN ('confirmed', 'arrived')`,
    [tableId]
  );
  const now = new Date();
  const dining = settings.reservation_dining_minutes || 90;
  for (const r of rows) {
    const when = reservationDateTime(r.date, r.time);
    if (!when) continue;
    const ms = when.getTime() - now.getTime();
    if (ms > 0 && ms <= dining * 60 * 1000) {
      return {
        code: 'table_reserved_soon',
        message: `Table ${r.table_number} has a reservation for ${r.name} at ${r.time}.`,
        reservation: r,
        alternatives: await suggestAlternativeTables(
          {
            partySize: parsePartySize(r.guests, r.party_size),
            startDate: r.date,
            startTime: r.time,
            excludeTableId: tableId,
            excludeReservationId: r.id,
          },
          db
        ),
        settings,
      };
    }
  }
  return null;
}
