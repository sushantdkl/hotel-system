/**
 * Reservations + inquiries — production lifecycle.
 */

import Database from '@/lib/db/index.js';
import {
  RESERVATION_STATUS,
  CANCEL_REASON,
  INQUIRY_STATUS,
  assertReservationTransition,
  reservationDateTime,
  formatDbDateTime,
  parsePartySize,
  guestsLabelFromSize,
  parsePreferences,
} from '@/lib/reservation-core.js';
import {
  getReservationSettings,
  ensureReservationSettingDefaults,
} from '@/lib/reservation-settings.js';
import {
  checkTableConflict,
  isHoldActive,
  findHoldForTable,
} from '@/lib/reservation-conflicts.js';
import { columnExists, ensureColumn, serialPkSql } from '@/lib/db/schema-helpers.js';
import { nextDocumentNumber } from '@/lib/document-numbers.js';
import { currentBusinessDayId } from '@/lib/business-days.js';
import { nepalDateString } from '@/lib/report-dates.js';

export {
  RESERVATION_STATUS,
  CANCEL_REASON,
  INQUIRY_STATUS,
  reservationDateTime,
  parsePartySize,
  guestsLabelFromSize,
};

const RESERVATION_COLUMNS = [
  ['party_size', 'INTEGER'],
  ['cancel_reason', 'TEXT'],
  ['source', 'TEXT'],
  ['expected_end_at', 'TEXT'],
  ['checked_in_at', 'TEXT'],
  ['seated_at', 'TEXT'],
  ['completed_at', 'TEXT'],
  ['preferences', 'TEXT'],
  ['is_vip', 'INTEGER DEFAULT 0'],
  ['deposit_required', 'INTEGER DEFAULT 0'],
  ['deposit_paid', 'INTEGER DEFAULT 0'],
  ['deposit_amount', 'REAL DEFAULT 0'],
  ['customer_id', 'INTEGER'],
  ['viewed_at', 'DATETIME'],
];

export async function ensureLeadsTables(db = Database.getInstance()) {
  // Production Postgres uses migrations; this is a local/dev safety net only.
  const isPg = db?.driver === 'postgres' || Database.isPostgres();
  if (isPg) {
    await ensureColumn(db, 'reservations', 'viewed_at', 'TIMESTAMP');
    await ensureColumn(db, 'inquiries', 'viewed_at', 'TIMESTAMP');
    await ensureReservationSettingDefaults(db);
    return;
  }

  const pk = serialPkSql(db);
  await db.run(`
    CREATE TABLE IF NOT EXISTS reservations (
      ${pk},
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT,
      guests TEXT,
      occasion TEXT,
      message TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      table_id INTEGER,
      order_id INTEGER,
      admin_notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS inquiries (
      ${pk},
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      subject TEXT,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      admin_notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  for (const [col, type] of RESERVATION_COLUMNS) {
    if (!(await columnExists(db, 'reservations', col))) {
      await db.run(`ALTER TABLE reservations ADD COLUMN ${col} ${type}`);
    }
  }
  await ensureColumn(db, 'inquiries', 'viewed_at', 'DATETIME');

  await ensureReservationSettingDefaults(db);

  // Backfill party_size from guests text
  try {
    const missing = await db.all(
      `SELECT id, guests, party_size FROM reservations WHERE party_size IS NULL OR party_size = 0`
    );
    for (const row of missing || []) {
      const size = parsePartySize(row.guests, null);
      await db.run(`UPDATE reservations SET party_size = ? WHERE id = ?`, [size, row.id]);
    }
  } catch {
    /* ignore */
  }
}

function digitsOnly(phone = '') {
  return String(phone).replace(/\D/g, '');
}

export function isWithinReservationWindow(res, minutes = 30, now = new Date()) {
  if (!res || ![RESERVATION_STATUS.CONFIRMED, RESERVATION_STATUS.ARRIVED].includes(res.status)) {
    return false;
  }
  const when = reservationDateTime(res.date, res.time);
  if (!when) return false;
  const ms = when.getTime() - now.getTime();
  return ms >= -5 * 60 * 1000 && ms <= minutes * 60 * 1000;
}

function expectedEndIso(dateStr, timeStr, settings) {
  const start = reservationDateTime(dateStr, timeStr);
  if (!start) return null;
  const end = new Date(
    start.getTime() +
      ((settings.reservation_dining_minutes || 90) + (settings.reservation_cleaning_minutes || 10)) *
        60 *
        1000
  );
  return formatDbDateTime(end);
}

async function linkCustomerByPhone(phone, db, { name, is_vip } = {}) {
  try {
    const { ensureCustomerFromGuest, ensureCustomersTable } = await import('@/lib/customers.js');
    await ensureCustomersTable(db);
    const { customer } = await ensureCustomerFromGuest(db, {
      name: name || '',
      phone,
      is_vip: !!is_vip,
    });
    return customer || null;
  } catch (e) {
    // Fall back to lookup-only if create fails unexpectedly
    try {
      const { findCustomerByPhone } = await import('@/lib/customers.js');
      return (await findCustomerByPhone(db, phone)) || null;
    } catch {
      return null;
    }
  }
}

export async function createReservation(data, db = Database.getInstance()) {
  await ensureLeadsTables(db);
  const settings = await getReservationSettings(db);
  const phone = digitsOnly(data.phone);
  if (!String(data.name || '').trim()) throw new Error('Please enter your name.');
  if (phone.length < 10) throw new Error('Please enter a valid phone number.');
  if (!data.date) throw new Error('Please select a date.');
  if (!data.time && data.source !== 'walkin_host') throw new Error('Please select a time.');

  const partySize = parsePartySize(data.guests, data.party_size);
  const guests = data.guests || guestsLabelFromSize(partySize);

  const start = reservationDateTime(data.date, data.time || '12:00');
  if (!start) throw new Error('Invalid date or time.');

  const minLead = settings.reservation_min_lead_minutes ?? 60;
  if (data.source === 'web' || !data.source) {
    const leadMs = start.getTime() - Date.now();
    if (leadMs < 0) throw new Error('Please choose a future date and time.');
    if (leadMs < minLead * 60 * 1000) {
      throw new Error(`Reservations need at least ${minLead} minutes notice.`);
    }
  }

  const customer = await linkCustomerByPhone(phone, db, {
    name: data.name,
    is_vip: data.is_vip,
  });
  if (customer?.is_blacklisted) {
    throw new Error('This phone number cannot book online. Please call the restaurant.');
  }

  const prefs = data.preferences
    ? typeof data.preferences === 'string'
      ? data.preferences
      : JSON.stringify(data.preferences)
    : null;

  const isVip = data.is_vip ? 1 : customer?.is_vip ? 1 : 0;
  const source = data.source || 'web';
  const status = data.status === RESERVATION_STATUS.CONFIRMED
    ? RESERVATION_STATUS.CONFIRMED
    : RESERVATION_STATUS.NEW;

  if (data.table_id) {
    const conflict = await checkTableConflict(
      {
        tableId: data.table_id,
        startDate: data.date,
        startTime: data.time,
        partySize,
        preferences: prefs,
      },
      db
    );
    if (!conflict.ok && !data.force) {
      const err = new Error(conflict.conflicts[0]?.message || 'Table is not available.');
      err.code = 'table_conflict';
      err.conflicts = conflict.conflicts;
      err.alternatives = conflict.alternatives;
      throw err;
    }
  }

  const expectedEnd = expectedEndIso(data.date, data.time, settings);
  const businessDayId = await currentBusinessDayId(db);

  const result = await db.run(
    `INSERT INTO reservations (
      name, phone, date, time, guests, party_size, occasion, message, status,
      table_id, admin_notes, source, expected_end_at, preferences, is_vip,
      deposit_required, deposit_paid, deposit_amount, customer_id, business_day_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      String(data.name).trim(),
      phone,
      data.date,
      data.time || null,
      guests,
      partySize,
      data.occasion || null,
      data.message?.trim() || null,
      status,
      data.table_id || null,
      data.admin_notes || null,
      source,
      expectedEnd,
      prefs,
      isVip,
      data.deposit_required ? 1 : 0,
      data.deposit_paid ? 1 : 0,
      Number(data.deposit_amount) || 0,
      customer?.id || data.customer_id || null,
      businessDayId,
    ]
  );
  return getReservationById(result.lastInsertRowid, db);
}

export async function createInquiry(data, db = Database.getInstance()) {
  await ensureLeadsTables(db);
  if (!String(data.name || '').trim()) throw new Error('Please enter your name.');
  const email = String(data.email || '').trim();
  if (!email || !email.includes('@')) throw new Error('Please enter a valid email.');
  if (!String(data.message || '').trim()) throw new Error('Please enter a message.');

  const result = await db.run(
    `INSERT INTO inquiries (
      name, email, phone, subject, message, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'new', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      String(data.name).trim(),
      email,
      digitsOnly(data.phone) || null,
      data.subject || null,
      String(data.message).trim(),
    ]
  );
  return getInquiryById(result.lastInsertRowid, db);
}

export async function getReservationById(id, db = Database.getInstance()) {
  await ensureLeadsTables(db);
  return db.get(
    `SELECT r.*, t.table_number, t.capacity as table_capacity, o.order_number, o.status as order_status
     FROM reservations r
     LEFT JOIN tables t ON t.id = r.table_id
     LEFT JOIN orders o ON o.id = r.order_id
     WHERE r.id = ?`,
    [id]
  );
}

export async function getInquiryById(id, db = Database.getInstance()) {
  await ensureLeadsTables(db);
  return db.get(`SELECT * FROM inquiries WHERE id = ?`, [id]);
}

export async function listReservations(
  { status, date, fromDate, toDate, board } = {},
  db = Database.getInstance()
) {
  await ensureLeadsTables(db);
  let sql = `
    SELECT r.*, t.table_number, t.capacity as table_capacity, o.order_number, o.status as order_status
    FROM reservations r
    LEFT JOIN tables t ON t.id = r.table_id
    LEFT JOIN orders o ON o.id = r.order_id
    WHERE 1=1
  `;
  const params = [];

  if (status) {
    sql += ` AND r.status = ?`;
    params.push(status);
  }
  if (date) {
    sql += ` AND r.date = ?`;
    params.push(date);
  }
  if (fromDate) {
    sql += ` AND r.date >= ?`;
    params.push(fromDate);
  }
  if (toDate) {
    sql += ` AND r.date <= ?`;
    params.push(toDate);
  }
  /*
   * Board boundaries resolve in the Nepal calendar, not the server's.
   *
   * `reservations.date` is a Nepal calendar date string, but these branches
   * built "today" from `new Date().getFullYear()/getMonth()/getDate()`, which
   * reads the host clock. On a UTC-hosted server that is a whole day out from
   * Nepal midnight until 05:45 NPT — so through the late-night end of service
   * the host desk's Today board listed *yesterday's* bookings, Upcoming pulled
   * in a day that had already passed, and the ops window slid with it.
   */
  const todayNepal = nepalDateString();
  if (board === 'today') {
    sql += ` AND r.date = ? AND r.status NOT IN ('cancelled', 'completed', 'no_show')`;
    params.push(todayNepal);
  } else if (board === 'upcoming') {
    sql += ` AND r.date >= ? AND r.status IN ('new', 'confirmed', 'arrived')`;
    params.push(todayNepal);
  } else if (board === 'ops' || board === 'all') {
    // Floor ops: every booking from yesterday onward (all statuses — new, confirmed, etc.)
    const yesterday = new Date(`${todayNepal}T12:00:00+05:45`);
    yesterday.setDate(yesterday.getDate() - 1);
    sql += ` AND r.date >= ?`;
    params.push(nepalDateString(yesterday));
  } else if (board === 'history') {
    sql += ` AND r.status IN ('completed', 'cancelled', 'no_show', 'seated')`;
  }

  sql += ` ORDER BY r.date ASC, r.time ASC, r.id DESC`;
  return db.all(sql, params);
}

export async function listInquiries({ status } = {}, db = Database.getInstance()) {
  await ensureLeadsTables(db);
  let sql = `SELECT * FROM inquiries`;
  const params = [];
  if (status) {
    sql += ` WHERE status = ?`;
    params.push(status);
  }
  sql += ` ORDER BY created_at DESC, id DESC`;
  return db.all(sql, params);
}

async function clearTableHold(tableId, db) {
  if (!tableId) return;
  const table = await db.get(`SELECT status, current_order_id FROM tables WHERE id = ?`, [tableId]);
  if (table && !table.current_order_id && ['reserved', 'reserved_soon'].includes(table.status)) {
    await db.run(
      `UPDATE tables SET status = 'available', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [tableId]
    );
  }
}

async function maybeSetReserved(tableId, res, settings, db) {
  if (!tableId || !res) return;
  const table = await db.get(`SELECT status, current_order_id FROM tables WHERE id = ?`, [tableId]);
  if (!table || table.current_order_id) return;
  if (!['available', 'reserved', 'reserved_soon'].includes(table.status || 'available')) return;
  if (await isHoldActive(res, settings)) {
    await db.run(
      `UPDATE tables SET status = 'reserved', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [tableId]
    );
  }
}

export async function updateReservation(id, updates, db = Database.getInstance()) {
  await ensureLeadsTables(db);
  const current = await getReservationById(id, db);
  if (!current) return null;

  const settings = await getReservationSettings(db);
  const nextStatus = updates.status !== undefined ? updates.status : current.status;

  if (updates.status !== undefined && updates.status !== current.status) {
    assertReservationTransition(current.status, updates.status, {
      allowComplete: updates._fromPayment === true,
    });
  }

  // Field edits blocked on terminal states
  const terminal = [RESERVATION_STATUS.COMPLETED, RESERVATION_STATUS.CANCELLED, RESERVATION_STATUS.NO_SHOW];
  if (terminal.includes(current.status) && updates.status === undefined) {
    throw new Error('This reservation can no longer be edited.');
  }

  const date = updates.date !== undefined ? updates.date : current.date;
  const time = updates.time !== undefined ? updates.time : current.time;
  let partySize =
    updates.party_size !== undefined
      ? parsePartySize(null, updates.party_size)
      : current.party_size || parsePartySize(current.guests, null);
  const guests =
    updates.guests !== undefined
      ? updates.guests
      : updates.party_size !== undefined
        ? guestsLabelFromSize(partySize)
        : current.guests;

  const tableId =
    updates.table_id !== undefined ? updates.table_id : current.table_id;

  const prefsRaw =
    updates.preferences !== undefined
      ? typeof updates.preferences === 'string'
        ? updates.preferences
        : JSON.stringify(updates.preferences || {})
      : current.preferences;

  if (
    tableId &&
    (updates.table_id !== undefined ||
      updates.date !== undefined ||
      updates.time !== undefined ||
      updates.party_size !== undefined ||
      nextStatus === RESERVATION_STATUS.CONFIRMED)
  ) {
    const conflict = await checkTableConflict(
      {
        tableId,
        startDate: date,
        startTime: time,
        excludeReservationId: id,
        partySize,
        preferences: prefsRaw,
      },
      db
    );
    if (!conflict.ok && !updates.force) {
      const err = new Error(conflict.conflicts[0]?.message || 'Table conflict.');
      err.code = 'table_conflict';
      err.conflicts = conflict.conflicts;
      err.alternatives = conflict.alternatives;
      throw err;
    }
  }

  const expectedEnd =
    updates.expected_end_at !== undefined
      ? updates.expected_end_at
      : expectedEndIso(date, time, settings);

  let nextCustomerId =
    updates.customer_id !== undefined ? updates.customer_id : current.customer_id;
  const nextName =
    updates.name !== undefined ? String(updates.name).trim() : current.name;
  const nextPhone =
    updates.phone !== undefined ? digitsOnly(updates.phone) : current.phone;
  const nextVip =
    updates.is_vip !== undefined ? (updates.is_vip ? 1 : 0) : current.is_vip || 0;

  if (
    updates.customer_id === undefined &&
    (updates.phone !== undefined || updates.name !== undefined)
  ) {
    const linked = await linkCustomerByPhone(nextPhone, db, {
      name: nextName,
      is_vip: nextVip,
    });
    if (linked?.is_blacklisted) {
      throw new Error('This phone number cannot book online. Please call the restaurant.');
    }
    if (linked?.id) nextCustomerId = linked.id;
  }

  let checkedInAt = current.checked_in_at;
  let seatedAt = current.seated_at;
  let completedAt = current.completed_at;
  if (nextStatus === RESERVATION_STATUS.ARRIVED && current.status !== RESERVATION_STATUS.ARRIVED) {
    checkedInAt = formatDbDateTime(new Date());
  }
  if (nextStatus === RESERVATION_STATUS.SEATED && current.status !== RESERVATION_STATUS.SEATED) {
    seatedAt = formatDbDateTime(new Date());
  }
  if (nextStatus === RESERVATION_STATUS.COMPLETED) {
    completedAt = formatDbDateTime(new Date());
  }

  // Cancel seated → cancel open order
  if (
    nextStatus === RESERVATION_STATUS.CANCELLED &&
    current.status === RESERVATION_STATUS.SEATED &&
    current.order_id
  ) {
    const { OrderRepository } = await import('@/lib/db/repositories/orders.js');
    const orderRepo = new OrderRepository();
    await orderRepo.cancelOrder(current.order_id, 'Reservation cancelled');
  }

  await db.run(
    `UPDATE reservations SET
      name = ?, phone = ?, date = ?, time = ?, guests = ?, party_size = ?,
      occasion = ?, message = ?, status = ?, table_id = ?, order_id = ?,
      admin_notes = ?, cancel_reason = ?, expected_end_at = ?,
      checked_in_at = ?, seated_at = ?, completed_at = ?, preferences = ?,
      is_vip = ?, deposit_required = ?, deposit_paid = ?, deposit_amount = ?,
      customer_id = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      nextName,
      nextPhone,
      date,
      time,
      guests,
      partySize,
      updates.occasion !== undefined ? updates.occasion : current.occasion,
      updates.message !== undefined ? updates.message : current.message,
      nextStatus,
      tableId || null,
      updates.order_id !== undefined ? updates.order_id : current.order_id,
      updates.admin_notes !== undefined ? updates.admin_notes : current.admin_notes,
      updates.cancel_reason !== undefined ? updates.cancel_reason : current.cancel_reason,
      expectedEnd,
      checkedInAt,
      seatedAt,
      completedAt,
      prefsRaw,
      nextVip,
      updates.deposit_required !== undefined
        ? updates.deposit_required
          ? 1
          : 0
        : current.deposit_required || 0,
      updates.deposit_paid !== undefined
        ? updates.deposit_paid
          ? 1
          : 0
        : current.deposit_paid || 0,
      updates.deposit_amount !== undefined
        ? Number(updates.deposit_amount) || 0
        : current.deposit_amount || 0,
      nextCustomerId,
      id,
    ]
  );

  if ([RESERVATION_STATUS.CANCELLED, RESERVATION_STATUS.NO_SHOW].includes(nextStatus)) {
    await clearTableHold(tableId || current.table_id, db);
  }

  const row = await getReservationById(id, db);
  if (
    [RESERVATION_STATUS.CONFIRMED, RESERVATION_STATUS.ARRIVED].includes(row.status) &&
    row.table_id
  ) {
    await maybeSetReserved(row.table_id, row, settings, db);
  }

  return row;
}

export async function updateInquiry(id, updates, db = Database.getInstance()) {
  await ensureLeadsTables(db);
  const current = await getInquiryById(id, db);
  if (!current) return null;

  await db.run(
    `UPDATE inquiries
     SET status = ?, admin_notes = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      updates.status ?? current.status,
      updates.admin_notes !== undefined ? updates.admin_notes : current.admin_notes,
      id,
    ]
  );
  return getInquiryById(id, db);
}

export async function checkInReservation(id, db = Database.getInstance()) {
  return updateReservation(id, { status: RESERVATION_STATUS.ARRIVED }, db);
}

/** Mark a reservation/inquiry as seen by an admin so it drops off the "new" badge count. */
export async function markReservationViewed(id, db = Database.getInstance()) {
  await ensureLeadsTables(db);
  await db.run(
    `UPDATE reservations SET viewed_at = CURRENT_TIMESTAMP WHERE id = ? AND viewed_at IS NULL`,
    [id]
  );
}

export async function markInquiryViewed(id, db = Database.getInstance()) {
  await ensureLeadsTables(db);
  await db.run(
    `UPDATE inquiries SET viewed_at = CURRENT_TIMESTAMP WHERE id = ? AND viewed_at IS NULL`,
    [id]
  );
}

/**
 * Move reservation (+ linked order) to another table in one transaction.
 */
export async function changeReservationTable(id, newTableId, { force = false } = {}, db = Database.getInstance()) {
  await ensureLeadsTables(db);
  const res = await getReservationById(id, db);
  if (!res) throw new Error('Reservation not found.');
  if ([RESERVATION_STATUS.COMPLETED, RESERVATION_STATUS.CANCELLED, RESERVATION_STATUS.NO_SHOW].includes(res.status)) {
    throw new Error('Cannot change table for this reservation.');
  }
  if (!newTableId) throw new Error('Please choose a table.');

  const partySize = parsePartySize(res.guests, res.party_size);
  const conflict = await checkTableConflict(
    {
      tableId: newTableId,
      startDate: res.date,
      startTime: res.time,
      excludeReservationId: id,
      partySize,
      preferences: res.preferences,
    },
    db
  );
  if (!conflict.ok && !force) {
    const err = new Error(conflict.conflicts[0]?.message || 'Table conflict.');
    err.code = 'table_conflict';
    err.conflicts = conflict.conflicts;
    err.alternatives = conflict.alternatives;
    throw err;
  }

  const newTable = await db.get(`SELECT * FROM tables WHERE id = ?`, [newTableId]);
  if (!newTable) throw new Error('Table not found.');
  if (newTable.current_order_id && newTable.current_order_id !== res.order_id) {
    throw new Error('That table already has an open order.');
  }

  const oldTableId = res.table_id;

  await db.transaction(async () => {
    await db.run(
      `UPDATE reservations SET table_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [newTableId, id]
    );

    if (res.order_id) {
      await db.run(
        `UPDATE orders SET table_id = ?, table_number = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [newTableId, newTable.table_number, res.order_id]
      );
      if (oldTableId) {
        await db.run(
          `UPDATE tables SET status = 'available', current_order_id = NULL, waiter_id = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND current_order_id = ?`,
          [oldTableId, res.order_id]
        );
      }
      await db.run(
        `UPDATE tables SET status = 'occupied', current_order_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [res.order_id, newTableId]
      );
    } else {
      if (oldTableId) await clearTableHold(oldTableId, db);
      const settings = await getReservationSettings(db);
      const updated = { ...res, table_id: newTableId };
      await maybeSetReserved(newTableId, updated, settings, db);
    }
  });

  return getReservationById(id, db);
}

export async function getLeadsCounts(db = Database.getInstance()) {
  await ensureLeadsTables(db);
  const settings = await getReservationSettings(db);
  const newReservations = await db.get(
    `SELECT COUNT(*) as c FROM reservations WHERE status = 'new' AND viewed_at IS NULL`
  );
  const newInquiries = await db.get(
    `SELECT COUNT(*) as c FROM inquiries WHERE status = 'new' AND viewed_at IS NULL`
  );
  const upcoming = await db.all(
    `SELECT * FROM reservations WHERE status IN ('confirmed', 'arrived')`
  );
  const arrivingSoon = upcoming.filter((r) =>
    isHoldActive(r, settings)
  ).length;

  return {
    new_reservations: Number(newReservations?.c || 0),
    new_inquiries: Number(newInquiries?.c || 0),
    new_total: Number(newReservations?.c || 0) + Number(newInquiries?.c || 0),
    arriving_soon: arrivingSoon,
  };
}

export async function getActiveTableHolds(db = Database.getInstance()) {
  await ensureLeadsTables(db);
  const settings = await getReservationSettings(db);
  const rows = await db.all(
    `SELECT r.*, t.table_number
     FROM reservations r
     LEFT JOIN tables t ON t.id = r.table_id
     WHERE r.status IN ('confirmed', 'arrived') AND r.table_id IS NOT NULL`
  );
  return rows.filter((r) => isHoldActive(r, settings));
}

/**
 * Seat: create dine-in order, link reservation. From arrived or confirmed (skip check-in).
 */
export async function seatReservation(
  id,
  { table_id, waiter_id, force = false, skip_checkin = false, force_deposit = false } = {},
  db = Database.getInstance()
) {
  await ensureLeadsTables(db);
  const res = await getReservationById(id, db);
  if (!res) throw new Error('Reservation not found.');

  const seatable = [RESERVATION_STATUS.ARRIVED, RESERVATION_STATUS.CONFIRMED];
  if (skip_checkin) seatable.push(RESERVATION_STATUS.NEW);
  if (!seatable.includes(res.status)) {
    throw new Error('Only arrived or confirmed reservations can be seated.');
  }

  if (res.deposit_required && !res.deposit_paid && !force_deposit) {
    const err = new Error('Deposit is unpaid. Confirm to seat anyway.');
    err.code = 'deposit_unpaid';
    throw err;
  }

  const tableId = table_id || res.table_id;
  if (!tableId) throw new Error('Please assign a table before seating.');

  const partySize = parsePartySize(res.guests, res.party_size);
  const conflict = await checkTableConflict(
    {
      tableId,
      startDate: res.date,
      startTime: res.time,
      excludeReservationId: id,
      partySize,
      preferences: res.preferences,
    },
    db
  );
  // open_order on same empty table shouldn't block if no current_order — check table
  const table = await db.get(`SELECT * FROM tables WHERE id = ?`, [tableId]);
  if (!table) throw new Error('Table not found.');
  if (table.current_order_id) {
    throw new Error('That table already has an open order. Choose another table.');
  }

  const hardConflicts = (conflict.conflicts || []).filter(
    (c) => c.type === 'reservation' || c.type === 'capacity'
  );
  if (hardConflicts.length && !force) {
    const err = new Error(hardConflicts[0].message);
    err.code = 'table_conflict';
    err.conflicts = conflict.conflicts;
    err.alternatives = conflict.alternatives;
    throw err;
  }

  // Create order without auto-cancelling other tables' orders — only this empty table
  const prefs = parsePreferences(res.preferences);
  const noteBits = [
    res.occasion ? `Occasion: ${res.occasion}` : null,
    res.message ? `Requests: ${res.message}` : null,
    prefs.high_chair ? 'High chair' : null,
    prefs.wheelchair ? 'Wheelchair access' : null,
    res.is_vip ? 'VIP' : null,
  ].filter(Boolean);

  let customerId = res.customer_id || null;
  if (!customerId && res.phone) {
    const linked = await linkCustomerByPhone(res.phone, db, {
      name: res.name,
      is_vip: res.is_vip,
    });
    customerId = linked?.id || null;
  }

  const result = await db.transaction(async () => {
    const businessDayId = await currentBusinessDayId(db, { required: true });
    const orderNumber = await nextDocumentNumber(db, {
      type: 'order', prefix: 'ORD',
      order: { order_type: 'dine_in', table_id: tableId, table_number: table.table_number },
    });
    try {
      const { ensureColumn } = await import('@/lib/db/schema-helpers.js');
      await ensureColumn(db, 'orders', 'customer_id', 'INTEGER');
    } catch {
      /* already exists */
    }

    const insert = await db.run(
      `INSERT INTO orders (
        order_number, table_id, table_number, waiter_id, order_type,
        status, notes, customer_name, customer_phone, customer_id, business_day_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'dine_in', 'pending', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        orderNumber,
        tableId,
        table.table_number,
        waiter_id || null,
        noteBits.length ? noteBits.join(' · ') : null,
        res.name,
        res.phone,
        customerId,
        businessDayId,
      ]
    );
    const orderId = insert.lastInsertRowid;

    await db.run(
      `UPDATE tables
       SET status = 'occupied', current_order_id = ?, waiter_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [orderId, waiter_id || null, tableId]
    );

    assertReservationTransition(res.status, RESERVATION_STATUS.SEATED);
    await db.run(
      `UPDATE reservations
       SET status = 'seated', table_id = ?, order_id = ?, customer_id = COALESCE(customer_id, ?),
           seated_at = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [tableId, orderId, customerId, formatDbDateTime(new Date()), id]
    );

    return { order_id: orderId, order_number: orderNumber };
  });

  return {
    reservation: await getReservationById(id, db),
    order_id: result.order_id,
    order_number: result.order_number,
  };
}

export async function completeReservationForOrder(orderId, db = Database.getInstance()) {
  await ensureLeadsTables(db);
  const row = await db.get(
    `SELECT * FROM reservations WHERE order_id = ? AND status = 'seated'`,
    [orderId]
  );
  if (!row) return;
  await db.run(
    `UPDATE reservations
     SET status = 'completed', completed_at = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [formatDbDateTime(new Date()), row.id]
  );
}

export async function cancelReservationForOrder(orderId, reason, db = Database.getInstance()) {
  await ensureLeadsTables(db);
  await db.run(
    `UPDATE reservations
     SET status = 'cancelled', cancel_reason = ?, updated_at = CURRENT_TIMESTAMP
     WHERE order_id = ? AND status IN ('seated', 'arrived')`,
    [reason || CANCEL_REASON.RESTAURANT, orderId]
  );
}

export async function applyReservationHoldsToTables(tables, db = Database.getInstance()) {
  const holds = await getActiveTableHolds(db);
  const byTable = new Map();
  for (const h of holds) {
    if (!byTable.has(h.table_id)) byTable.set(h.table_id, h);
  }

  return (tables || []).map((t) => {
    const tid = t.table_id || t.id;
    const hold = byTable.get(tid);
    if (!hold) return t;
    if (t.current_order_id || t.order_id) return t;
    if (['cooking', 'ready', 'dining', 'awaiting_payment', 'occupied'].includes(t.status)) {
      return t;
    }
    return {
      ...t,
      status: hold.status === 'arrived' ? 'reserved_arrived' : 'reserved',
      reservation_id: hold.id,
      reservation_name: hold.name,
      reservation_phone: hold.phone,
      reservation_time: hold.time,
      reservation_guests: hold.guests || guestsLabelFromSize(hold.party_size),
      reservation_party_size: hold.party_size,
      reservation_occasion: hold.occasion,
      reservation_message: hold.message,
      reservation_is_vip: hold.is_vip,
      reservation_status: hold.status,
      reservation_preferences: hold.preferences,
      reservation_date: hold.date,
    };
  });
}

/** Mark late / expired no-shows based on settings. */
export async function processAutoNoShows(db = Database.getInstance()) {
  await ensureLeadsTables(db);
  const settings = await getReservationSettings(db);
  const grace = settings.reservation_grace_minutes ?? 20;
  const auto = settings.reservation_auto_cancel_minutes ?? 20;
  const cutoffMs = (grace + auto) * 60 * 1000;
  const rows = await db.all(
    `SELECT * FROM reservations WHERE status IN ('confirmed', 'arrived')`
  );
  const now = Date.now();
  let count = 0;
  for (const r of rows) {
    const when = reservationDateTime(r.date, r.time);
    if (!when) continue;
    if (now - when.getTime() >= cutoffMs) {
      await updateReservation(
        r.id,
        {
          status: RESERVATION_STATUS.NO_SHOW,
          cancel_reason: CANCEL_REASON.LATE_NO_SHOW,
        },
        db
      );
      count += 1;
    }
  }
  return { processed: count };
}

export async function getReservationAlerts(db = Database.getInstance()) {
  await ensureLeadsTables(db);
  const settings = await getReservationSettings(db);
  const hold = settings.reservation_hold_minutes ?? 30;
  const grace = settings.reservation_grace_minutes ?? 20;
  const rows = await db.all(
    `SELECT r.*, t.table_number FROM reservations r
     LEFT JOIN tables t ON t.id = r.table_id
     WHERE r.status IN ('confirmed', 'arrived', 'new')
     ORDER BY r.date, r.time`
  );
  const now = new Date();
  const alerts = [];

  for (const r of rows) {
    const when = reservationDateTime(r.date, r.time);
    if (!when) continue;
    const ms = when.getTime() - now.getTime();
    if (r.status === RESERVATION_STATUS.ARRIVED) {
      alerts.push({
        type: r.is_vip ? 'vip_arrived' : 'arrived',
        reservation_id: r.id,
        title: r.is_vip ? `VIP arrived: ${r.name}` : `Arrived: ${r.name}`,
        subtitle: `Table ${r.table_number || '—'} · ${r.party_size || r.guests} guests`,
        reservation: r,
      });
    } else if (ms <= hold * 60 * 1000 && ms >= 0) {
      alerts.push({
        type: 'arriving_soon',
        reservation_id: r.id,
        title: `Arriving soon: ${r.name}`,
        subtitle: `${r.time} · ${r.party_size || r.guests} guests`,
        reservation: r,
      });
    } else if (ms < 0 && ms >= -(grace * 60 * 1000)) {
      alerts.push({
        type: 'late',
        reservation_id: r.id,
        title: `Late: ${r.name}`,
        subtitle: `Was ${r.time} · grace ${grace}m`,
        reservation: r,
      });
    } else if (ms < -(grace * 60 * 1000) && r.status === RESERVATION_STATUS.CONFIRMED) {
      alerts.push({
        type: 'no_show_candidate',
        reservation_id: r.id,
        title: `No-show candidate: ${r.name}`,
        subtitle: `Missed ${r.time}`,
        reservation: r,
      });
    }
    if (r.message || r.occasion) {
      if (ms <= hold * 60 * 1000 && ms >= -(grace * 60 * 1000)) {
        alerts.push({
          type: 'special_request',
          reservation_id: r.id,
          title: `Notes: ${r.name}`,
          subtitle: [r.occasion, r.message].filter(Boolean).join(' · '),
          reservation: r,
        });
      }
    }
    if (/birthday|anniversary/i.test(r.occasion || '')) {
      // Nepal calendar: a birthday alert keyed off the host clock stopped
      // firing (or fired a day early) for the late-night end of service.
      const todayStr = nepalDateString();
      if (r.date === todayStr && ['new', 'confirmed', 'arrived'].includes(r.status)) {
        alerts.push({
          type: 'occasion_today',
          reservation_id: r.id,
          title: `${r.occasion}: ${r.name}`,
          subtitle: `${r.time || '—'} · ${r.party_size || r.guests} guests`,
          reservation: r,
        });
      }
    }
  }

  return { alerts, settings };
}

export async function getReservationAnalytics(db = Database.getInstance()) {
  await ensureLeadsTables(db);
  /*
   * reservations.date is a Nepal calendar date, so "today" must be one too.
   * Built from the host clock, these two counts were a day out from Nepal
   * midnight to 05:45 NPT on a UTC-hosted server — the booking analytics
   * reported yesterday's covers as today's.
   */
  const todayStr = nepalDateString();

  const todayCount = await db.get(
    `SELECT COUNT(*) as c FROM reservations WHERE date = ?`,
    [todayStr]
  );
  const upcoming = await db.get(
    `SELECT COUNT(*) as c FROM reservations
     WHERE date >= ? AND status IN ('new', 'confirmed', 'arrived')`,
    [todayStr]
  );
  const totals = await db.get(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'no_show' THEN 1 ELSE 0 END) as no_shows,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN source = 'web' THEN 1 ELSE 0 END) as from_web,
      SUM(CASE WHEN source IN ('phone', 'walkin_host') OR source IS NULL THEN 1 ELSE 0 END) as from_host
    FROM reservations
  `);

  const peakHours = await db.all(`
    SELECT substr(time, 1, 2) as hour, COUNT(*) as c
    FROM reservations
    WHERE time IS NOT NULL AND length(time) >= 2
    GROUP BY substr(time, 1, 2)
    ORDER BY c DESC
    LIMIT 5
  `);

  const topTables = await db.all(`
    SELECT t.table_number, COUNT(*) as c
    FROM reservations r
    JOIN tables t ON t.id = r.table_id
    GROUP BY r.table_id, t.table_number
    ORDER BY c DESC
    LIMIT 5
  `);

  const timing = await db.all(`
    SELECT checked_in_at, seated_at, completed_at
    FROM reservations
    WHERE seated_at IS NOT NULL
  `);

  let waitSum = 0;
  let waitN = 0;
  let dineSum = 0;
  let dineN = 0;
  for (const row of timing || []) {
    if (row.checked_in_at && row.seated_at) {
      const a = new Date(String(row.checked_in_at).replace(' ', 'T')).getTime();
      const b = new Date(String(row.seated_at).replace(' ', 'T')).getTime();
      if (Number.isFinite(a) && Number.isFinite(b) && b >= a) {
        waitSum += (b - a) / 60000;
        waitN += 1;
      }
    }
    if (row.seated_at && row.completed_at) {
      const a = new Date(String(row.seated_at).replace(' ', 'T')).getTime();
      const b = new Date(String(row.completed_at).replace(' ', 'T')).getTime();
      if (Number.isFinite(a) && Number.isFinite(b) && b >= a) {
        dineSum += (b - a) / 60000;
        dineN += 1;
      }
    }
  }

  const total = Number(totals?.total) || 0;
  const noShows = Number(totals?.no_shows) || 0;
  const cancelled = Number(totals?.cancelled) || 0;

  return {
    today: Number(todayCount?.c) || 0,
    upcoming: Number(upcoming?.c) || 0,
    no_show_pct: total ? Math.round((noShows / total) * 100) : 0,
    cancel_rate: total ? Math.round((cancelled / total) * 100) : 0,
    avg_wait_minutes: waitN ? Math.round(waitSum / waitN) : null,
    avg_dining_minutes: dineN ? Math.round(dineSum / dineN) : null,
    peak_hours: peakHours || [],
    top_tables: topTables || [],
    from_web: Number(totals?.from_web) || 0,
    from_host: Number(totals?.from_host) || 0,
    completed: Number(totals?.completed) || 0,
  };
}

export { findHoldForTable };
