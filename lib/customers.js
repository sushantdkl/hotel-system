/**
 * Find / create customers and bump visit stats after a sale.
 */

import { columnExists, ensureColumn, serialPkSql } from '@/lib/db/schema-helpers.js';
import { isPostgresUrl } from '@/lib/db/sql.js';

// Strips everything but digits, then drops a leading Nepal country code (977)
// so "9863995341" and "+977 9863995341" resolve to the same customer instead
// of silently creating a duplicate record with its own (empty) credit balance.
export function normalizePhone(phone = '') {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('977')) return digits.slice(3);
  return digits;
}

export async function ensureCustomersTable(db) {
  const isPg = db?.driver === 'postgres' || isPostgresUrl();
  if (isPg) {
    // Schema comes from migrations; only soft-add optional columns if missing.
    await ensureColumn(db, 'customers', 'is_vip', 'INTEGER DEFAULT 0');
    await ensureColumn(db, 'customers', 'is_blacklisted', 'INTEGER DEFAULT 0');
    await ensureColumn(db, 'customers', 'notes', 'TEXT');
    await ensureColumn(db, 'customers', 'phone_digits', 'TEXT');
    return;
  }

  const pk = serialPkSql(db);
  await db.run(`
    CREATE TABLE IF NOT EXISTS customers (
      ${pk},
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      address TEXT,
      total_visits INTEGER DEFAULT 0,
      total_spent REAL DEFAULT 0,
      credit_limit REAL DEFAULT 0,
      current_credit REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await ensureColumn(db, 'customers', 'is_vip', 'INTEGER DEFAULT 0');
  await ensureColumn(db, 'customers', 'is_blacklisted', 'INTEGER DEFAULT 0');
  await ensureColumn(db, 'customers', 'notes', 'TEXT');
  await ensureColumn(db, 'customers', 'phone_digits', 'TEXT');
}

export async function findCustomerByPhone(db, phone) {
  await ensureCustomersTable(db);
  const digits = normalizePhone(phone);
  if (!digits) return null;

  // Prefer indexed phone_digits when present
  if (await columnExists(db, 'customers', 'phone_digits')) {
    const byDigits = await db.get(
      `SELECT * FROM customers WHERE phone_digits = ? LIMIT 1`,
      [digits]
    );
    if (byDigits) return byDigits;
  }

  const exact = await db.get(
    `SELECT * FROM customers WHERE phone = ? OR REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '+', '') = ? LIMIT 1`,
    [digits, digits]
  );
  if (exact) return exact;

  // Fallback for oddly formatted phones (bounded)
  const customers = await db.all(
    `SELECT * FROM customers WHERE phone IS NOT NULL ORDER BY id DESC LIMIT 500`
  );
  return customers.find((c) => normalizePhone(c.phone) === digits) || null;
}

/**
 * Find or create a customer from a reservation/guest phone.
 * Does NOT bump visits or spend — payment handles that later.
 */
export async function ensureCustomerFromGuest(
  db,
  { name = '', phone = '', email = null, is_vip = false } = {}
) {
  await ensureCustomersTable(db);
  const digits = normalizePhone(phone);
  if (!digits || digits.length < 10) {
    throw new Error('Please enter a valid phone number.');
  }

  const trimmedName = String(name || '').trim();
  let customer = await findCustomerByPhone(db, digits);
  let created = false;

  if (customer) {
    if (customer.is_blacklisted) {
      return { customer, created: false };
    }
    // Soft-update VIP flag only; never overwrite stored name silently
    if (is_vip && !customer.is_vip) {
      try {
        await db.run(`UPDATE customers SET is_vip = 1 WHERE id = ?`, [customer.id]);
        customer = await db.get(`SELECT * FROM customers WHERE id = ?`, [customer.id]);
      } catch {
        /* ignore */
      }
    }
    return { customer, created: false };
  }

  if (!trimmedName) {
    throw new Error('Please enter the customer name.');
  }

  const result = await db.run(
    `INSERT INTO customers (
      name, phone, email, address, total_visits, total_spent,
      credit_limit, current_credit, is_vip, created_at
    ) VALUES (?, ?, ?, NULL, 0, 0, 0, 0, ?, CURRENT_TIMESTAMP)`,
    [trimmedName, digits, email || null, is_vip ? 1 : 0]
  );
  customer = await db.get(`SELECT * FROM customers WHERE id = ?`, [result.lastInsertRowid]);
  created = true;
  return { customer, created };
}

/**
 * Resolve walk-in vs registered customer for a sale.
 * - mode walkin → name "Walk-in Customer", no phone
 * - mode customer + existing phone → use stored name
 * - mode customer + new phone → create with name/address
 */
export async function resolveCustomerForSale(db, {
  mode = 'walkin',
  phone = '',
  name = '',
  address = '',
  amount = 0,
  recordSale = true,
} = {}) {
  await ensureCustomersTable(db);

  if (mode !== 'customer') {
    return {
      customer_id: null,
      customer_name: 'Walk-in Customer',
      customer_phone: null,
      customer: null,
      created: false,
    };
  }

  const digits = normalizePhone(phone);
  if (!digits) {
    throw new Error('Please enter a valid phone number.');
  }

  let customer = await findCustomerByPhone(db, digits);
  let created = false;

  if (!customer) {
    const trimmedName = String(name || '').trim();
    if (!trimmedName) {
      throw new Error('Please enter the customer name.');
    }
    const result = await db.run(
      `INSERT INTO customers (name, phone, address, total_visits, total_spent, credit_limit, current_credit, created_at)
       VALUES (?, ?, ?, 0, 0, 0, 0, CURRENT_TIMESTAMP)`,
      [trimmedName, digits, address?.trim() || null]
    );
    customer = await db.get(`SELECT * FROM customers WHERE id = ?`, [result.lastInsertRowid]);
    created = true;
  }

  if (recordSale) {
    try {
      await db.run(
        `UPDATE customers
         SET total_visits = COALESCE(total_visits, 0) + 1,
             total_spent = COALESCE(total_spent, 0) + ?
         WHERE id = ?`,
        [Number(amount) || 0, customer.id]
      );
      customer = await db.get(`SELECT * FROM customers WHERE id = ?`, [customer.id]);
    } catch {
      /* columns may differ on older DBs */
    }
  }

  return {
    customer_id: customer.id,
    customer_name: customer.name,
    customer_phone: customer.phone || digits,
    customer,
    created,
  };
}
