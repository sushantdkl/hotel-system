/**
 * HRM: departments, designations, staff attendance and holidays.
 * Staff records themselves stay on `users` (see lib/employees.js / the
 * employees API) — this module only adds department_id/designation_id there
 * plus the four new tables. Attendance is a manual daily register (no clock
 * hardware); it and holidays are informational only and do not touch payroll.
 */
import { ensureColumn, serialPkSql } from '@/lib/db/schema-helpers.js';
import { ensureSqliteTable } from '@/lib/db/ensure-sqlite-table.js';
import { nepalDateString } from '@/lib/report-dates.js';
import { isAdminLike } from '@/lib/roles.js';

const fail = (message, status = 400, extra = {}) => { throw Object.assign(new Error(message), { status, ...extra }); };

export async function ensureHrmSchema(db) {
  if (db.driver === 'postgres') {
    const ready = await db.get(`SELECT to_regclass('public.departments') AS t`);
    if (!ready?.t) fail('HRM schema is not installed. Run database migration 045 (npm run db:migrate).', 503, { code: 'schema_missing', expose: true });
    return;
  }
  const pk = serialPkSql(db);
  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS departments (
    ${pk}, name TEXT NOT NULL UNIQUE, description TEXT, is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS designations (
    ${pk}, name TEXT NOT NULL, department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
    description TEXT, is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS attendance (
    ${pk}, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    business_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'present',
    note TEXT, marked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, business_date))`);
  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS holidays (
    ${pk}, holiday_date TEXT NOT NULL UNIQUE, name TEXT NOT NULL, note TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await ensureColumn(db, 'users', 'department_id', 'INTEGER');
  await ensureColumn(db, 'users', 'designation_id', 'INTEGER');
  await db.run(`CREATE INDEX IF NOT EXISTS idx_designations_department ON designations(department_id)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(business_date, user_id)`);
}

const ACTIVE_ONLY = (includeInactive) => (includeInactive ? '' : 'WHERE d.is_active = 1');

/* ------------------------------------------------------------ departments */

export async function listDepartments(db, { includeInactive = true } = {}) {
  return db.all(`
    SELECT d.*, (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id) AS staff_count
    FROM departments d ${ACTIVE_ONLY(includeInactive)}
    ORDER BY d.name`);
}

export async function createDepartment(db, data) {
  const name = String(data?.name || '').trim();
  if (!name) fail('Enter a department name.');
  const result = await db.run(
    `INSERT INTO departments (name, description, is_active) VALUES (?, ?, ?)`,
    [name, String(data.description || '').trim() || null, data.is_active === false ? 0 : 1]
  );
  return db.get(`SELECT * FROM departments WHERE id = ?`, [result.lastInsertRowid]);
}

export async function updateDepartment(db, id, data) {
  const name = String(data?.name || '').trim();
  if (!name) fail('Enter a department name.');
  const existing = await db.get(`SELECT id FROM departments WHERE id = ?`, [id]);
  if (!existing) fail('Department not found.', 404);
  await db.run(
    `UPDATE departments SET name=?, description=?, is_active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [name, String(data.description || '').trim() || null, data.is_active === false ? 0 : 1, id]
  );
  return db.get(`SELECT * FROM departments WHERE id = ?`, [id]);
}

export async function deleteDepartment(db, id) {
  const existing = await db.get(`SELECT id FROM departments WHERE id = ?`, [id]);
  if (!existing) fail('Department not found.', 404);
  // Staff and designations referencing this department are unlinked, not blocked (ON DELETE SET NULL).
  await db.run(`DELETE FROM departments WHERE id = ?`, [id]);
}

/* ------------------------------------------------------------ designations */

export async function listDesignations(db, { includeInactive = true } = {}) {
  return db.all(`
    SELECT g.*, dep.name AS department_name,
      (SELECT COUNT(*) FROM users u WHERE u.designation_id = g.id) AS staff_count
    FROM designations g LEFT JOIN departments dep ON dep.id = g.department_id
    ${includeInactive ? '' : 'WHERE g.is_active = 1'}
    ORDER BY g.name`);
}

export async function createDesignation(db, data) {
  const name = String(data?.name || '').trim();
  if (!name) fail('Enter a designation name.');
  const departmentId = data.department_id ? Number(data.department_id) : null;
  const result = await db.run(
    `INSERT INTO designations (name, department_id, description, is_active) VALUES (?, ?, ?, ?)`,
    [name, departmentId, String(data.description || '').trim() || null, data.is_active === false ? 0 : 1]
  );
  return db.get(`SELECT * FROM designations WHERE id = ?`, [result.lastInsertRowid]);
}

export async function updateDesignation(db, id, data) {
  const name = String(data?.name || '').trim();
  if (!name) fail('Enter a designation name.');
  const existing = await db.get(`SELECT id FROM designations WHERE id = ?`, [id]);
  if (!existing) fail('Designation not found.', 404);
  const departmentId = data.department_id ? Number(data.department_id) : null;
  await db.run(
    `UPDATE designations SET name=?, department_id=?, description=?, is_active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [name, departmentId, String(data.description || '').trim() || null, data.is_active === false ? 0 : 1, id]
  );
  return db.get(`SELECT * FROM designations WHERE id = ?`, [id]);
}

export async function deleteDesignation(db, id) {
  const existing = await db.get(`SELECT id FROM designations WHERE id = ?`, [id]);
  if (!existing) fail('Designation not found.', 404);
  await db.run(`DELETE FROM designations WHERE id = ?`, [id]);
}

/* ------------------------------------------------------------------ holidays */

export async function listHolidays(db, { year = null } = {}) {
  const where = year ? `WHERE holiday_date LIKE '${String(Number(year))}-%'` : '';
  return db.all(`SELECT h.*, u.full_name AS created_by_name FROM holidays h
    LEFT JOIN users u ON u.id = h.created_by ${where} ORDER BY h.holiday_date`);
}

export async function createHoliday(db, data, actor) {
  const date = String(data?.holiday_date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('Choose a valid holiday date.');
  const name = String(data?.name || '').trim();
  if (!name) fail('Enter a holiday name.');
  const existing = await db.get(`SELECT id FROM holidays WHERE holiday_date = ?`, [date]);
  if (existing) fail('A holiday is already recorded for this date.', 409);
  const result = await db.run(
    `INSERT INTO holidays (holiday_date, name, note, created_by) VALUES (?, ?, ?, ?)`,
    [date, name, String(data.note || '').trim() || null, actor?.id || null]
  );
  return db.get(`SELECT * FROM holidays WHERE id = ?`, [result.lastInsertRowid]);
}

export async function deleteHoliday(db, id) {
  const existing = await db.get(`SELECT id FROM holidays WHERE id = ?`, [id]);
  if (!existing) fail('Holiday not found.', 404);
  await db.run(`DELETE FROM holidays WHERE id = ?`, [id]);
}

/* ---------------------------------------------------------------- attendance */

const ATTENDANCE_STATUSES = new Set(['present', 'absent', 'half_day', 'leave']);

/** All active staff plus (if marked) their attendance status for one date. */
export async function attendanceRegisterForDate(db, businessDate) {
  const date = String(businessDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('Choose a valid date.');
  const staff = await db.all(`
    SELECT u.id AS user_id, u.full_name, u.username, u.role, u.is_active,
      dep.name AS department_name, des.name AS designation_name,
      a.status, a.note, a.marked_by, marker.full_name AS marked_by_name, a.updated_at
    FROM users u
    LEFT JOIN departments dep ON dep.id = u.department_id
    LEFT JOIN designations des ON des.id = u.designation_id
    LEFT JOIN attendance a ON a.user_id = u.id AND a.business_date = ?
    LEFT JOIN users marker ON marker.id = a.marked_by
    WHERE u.is_active = 1
    ORDER BY u.full_name, u.username`, [date]);
  const holiday = await db.get(`SELECT name FROM holidays WHERE holiday_date = ?`, [date]);
  return { business_date: date, holiday: holiday?.name || null, staff };
}

// Only the owner may mark their own row or an admin/manager row, so a manager
// cannot edit their own attendance. The register page posts every row, so
// protected rows are skipped (left as they are) rather than failing the save.
export async function saveAttendanceRegister(db, { business_date, entries }, markedBy, actorRole = 'admin') {
  const date = String(business_date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('Choose a valid date.');
  const rows = Array.isArray(entries) ? entries : [];
  if (!rows.length) fail('Mark at least one staff member.');
  for (const row of rows) {
    if (!row?.user_id) fail('Each attendance entry needs a staff member.');
    if (!ATTENDANCE_STATUSES.has(row.status)) fail(`Invalid attendance status "${row.status}".`);
  }
  let allowed = rows;
  if (actorRole !== 'admin') {
    const roles = new Map((await db.all('SELECT id, role FROM users')).map((u) => [Number(u.id), u.role]));
    allowed = rows.filter((row) => Number(row.user_id) !== Number(markedBy) && !isAdminLike(roles.get(Number(row.user_id))));
  }
  return db.transaction(async (tx) => {
    for (const row of allowed) {
      await tx.run(
        `INSERT INTO attendance (user_id, business_date, status, note, marked_by, updated_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id, business_date) DO UPDATE SET
           status = excluded.status, note = excluded.note, marked_by = excluded.marked_by, updated_at = CURRENT_TIMESTAMP`,
        [row.user_id, date, row.status, String(row.note || '').trim() || null, markedBy || null]
      );
    }
    return attendanceRegisterForDate(tx, date);
  });
}

export async function attendanceHistory(db, { from = null, to = null, employeeId = null, limit = 200 } = {}) {
  const where = ['1=1'];
  const params = [];
  if (from) { where.push('a.business_date >= ?'); params.push(String(from).slice(0, 10)); }
  if (to) { where.push('a.business_date <= ?'); params.push(String(to).slice(0, 10)); }
  if (employeeId) { where.push('a.user_id = ?'); params.push(Number(employeeId)); }
  const rows = await db.all(
    `SELECT a.*, u.full_name, u.username FROM attendance a
     LEFT JOIN users u ON u.id = a.user_id
     WHERE ${where.join(' AND ')}
     ORDER BY a.business_date DESC, u.full_name
     LIMIT ${Math.min(1000, Math.max(1, Number(limit) || 200))}`,
    params
  );
  return rows;
}

export function todayNepal() {
  return nepalDateString(new Date());
}
