import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { handleRouteError } from '@/lib/api-guard.js';

/** Active staff for the login picker (no password hashes). */
export async function GET() {
  try {
    const db = Database.getInstance();
    const users = await db.all(`
      SELECT username, full_name, role
      FROM users
      WHERE COALESCE(is_active, 1) = 1
      ORDER BY
        CASE role
          WHEN 'admin' THEN 1
          WHEN 'manager' THEN 2
          WHEN 'cashier' THEN 3
          WHEN 'waiter' THEN 4
          WHEN 'kitchen' THEN 5
          WHEN 'receptionist' THEN 6
          WHEN 'housekeeping' THEN 7
          WHEN 'maintenance' THEN 8
          WHEN 'watchman' THEN 9
          ELSE 10
        END,
        full_name
    `);
    // Custom role names for display; tolerant of databases without the table/column yet.
    const custom = await db.all(`SELECT u.username, r.label FROM users u JOIN staff_custom_roles r ON r.role_key = u.custom_role`).catch(() => []);
    const labels = new Map(custom.map((row) => [row.username, row.label]));
    return NextResponse.json({ users: (users || []).map((u) => ({ ...u, role_label: labels.get(u.username) || null })) });
  } catch (error) {
    return handleRouteError(error, 'Could not load users.');
  }
}
