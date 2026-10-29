/**
 * Staff self-service HR: clock in/out, leave requests and manager -> owner
 * alerts. Builds on the HRM attendance register (lib/hrm.js): clocking in marks
 * the day `present` (unless someone already marked it) and an approved leave
 * marks each day `leave`.
 *
 * Approval rules: nobody decides their own leave; a manager's leave is decided
 * only by the owner (admin); other staff by the owner, a manager, or anyone with
 * hrm.attendance.manage. The owner does not file leave.
 */
import { serialPkSql } from './db/schema-helpers.js';
import { ensureSqliteTable } from './db/ensure-sqlite-table.js';
import { ensureHrmSchema } from './hrm.js';
import { nepalDateString } from './report-dates.js';
import { isAdminLike } from './roles.js';
import { isPermissionAllowedSync } from './permissions.js';
import { listPayrollOverview, ensurePayrollSchema } from './payroll.js';
import { permissionRole } from './roles.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '') && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const text = (v, max) => String(v ?? '').trim().slice(0, max);
// ponytail: fixed 8-hour standard day for overtime; move to settings with shifts.
export const STANDARD_DAY_HOURS = 8;
export const LEAVE_TYPES = ['sick', 'casual', 'emergency'];
export const ALERT_SEVERITIES = ['low', 'medium', 'urgent', 'critical'];
export const ALERT_CATEGORIES = ['VIP issue', 'Security', 'Equipment failure', 'Cash dispute', 'Guest complaint', 'Other'];

export async function ensureStaffHrSchema(db) {
  await ensureHrmSchema(db);
  if (db.driver === 'postgres') {
    const ready = await db.get("SELECT to_regclass('public.leave_requests') AS t");
    if (!ready?.t) throw Object.assign(new Error('Staff HR schema is not installed. Run database migration 078 (npm run db:migrate).'), { status: 503, expose: true });
    return;
  }
  const pk = serialPkSql(db);
  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS staff_clock_events (
    ${pk}, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, business_date TEXT NOT NULL,
    clock_in_at TEXT NOT NULL, clock_out_at TEXT, handover_note TEXT, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await db.run('CREATE INDEX IF NOT EXISTS idx_staff_clock_user_date ON staff_clock_events(user_id, business_date)');
  await db.run('CREATE UNIQUE INDEX IF NOT EXISTS ux_staff_clock_open ON staff_clock_events(user_id) WHERE clock_out_at IS NULL');
  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS leave_requests (
    ${pk}, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    leave_type TEXT NOT NULL CHECK (leave_type IN ('sick', 'casual', 'emergency')),
    start_date TEXT NOT NULL, end_date TEXT NOT NULL, reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL, decided_at DATETIME, decision_note TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CHECK (end_date >= start_date))`);
  await db.run('CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status, start_date)');
  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS owner_alerts (
    ${pk}, created_by INTEGER NOT NULL REFERENCES users(id),
    severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'urgent', 'critical')),
    category TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL, link_label TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
    handled_by INTEGER REFERENCES users(id) ON DELETE SET NULL, handled_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await db.run('CREATE INDEX IF NOT EXISTS idx_owner_alerts_status ON owner_alerts(status, created_at)');
}

const hoursBetween = (from, to) => Math.max(0, (Date.parse(to) - Date.parse(from)) / 3600000);
const round1 = (n) => Math.round(n * 10) / 10;

function datesBetween(start, end) {
  const out = [];
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`); t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/* ---------------------------------------------------------------- clock */

export async function clockIn(db, user, now = new Date()) {
  const date = nepalDateString(now);
  return db.transaction(async (tx) => {
    const open = await tx.get('SELECT id FROM staff_clock_events WHERE user_id = ? AND clock_out_at IS NULL', [user.id]);
    if (open) fail('You are already clocked in.', 409);
    await tx.run('INSERT INTO staff_clock_events (user_id, business_date, clock_in_at) VALUES (?, ?, ?)', [user.id, date, now.toISOString()]);
    // A register entry someone already made (e.g. half day) wins over the clock.
    await tx.run(`INSERT INTO attendance (user_id, business_date, status, note, marked_by)
      VALUES (?, ?, 'present', 'Clocked in', ?) ON CONFLICT (user_id, business_date) DO NOTHING`, [user.id, date, user.id]);
    return { message: 'Clocked in.' };
  });
}

export async function clockOut(db, user, { note = '' } = {}, now = new Date()) {
  const open = await db.get('SELECT id, clock_in_at FROM staff_clock_events WHERE user_id = ? AND clock_out_at IS NULL', [user.id]);
  if (!open) fail('You are not clocked in.', 409);
  await db.run('UPDATE staff_clock_events SET clock_out_at = ?, handover_note = ? WHERE id = ? AND clock_out_at IS NULL', [now.toISOString(), text(note, 500) || null, open.id]);
  return { message: `Clocked out after ${round1(hoursBetween(open.clock_in_at, now.toISOString()))} hours.` };
}

/** Everyone clocked in right now (owner/manager dashboards). */
export async function clockedInNow(db) {
  return db.all(`SELECT c.user_id, c.clock_in_at, u.full_name, u.role FROM staff_clock_events c
    JOIN users u ON u.id = c.user_id WHERE c.clock_out_at IS NULL ORDER BY c.clock_in_at`);
}

/** One person's month: register status + clocked hours per day, totals and leave requests. */
export async function staffMonth(db, userId, month, now = new Date()) {
  const ym = /^\d{4}-\d{2}$/.test(month || '') ? month : nepalDateString(now).slice(0, 7);
  const from = `${ym}-01`;
  const to = `${ym}-31`;
  const [register, clocks, open, leaves] = await Promise.all([
    db.all('SELECT business_date, status, note FROM attendance WHERE user_id = ? AND business_date BETWEEN ? AND ?', [userId, from, to]),
    db.all('SELECT business_date, clock_in_at, clock_out_at FROM staff_clock_events WHERE user_id = ? AND business_date BETWEEN ? AND ? ORDER BY clock_in_at', [userId, from, to]),
    db.get('SELECT clock_in_at FROM staff_clock_events WHERE user_id = ? AND clock_out_at IS NULL', [userId]),
    db.all(`SELECT l.*, d.full_name AS decided_by_name FROM leave_requests l LEFT JOIN users d ON d.id = l.decided_by
      WHERE l.user_id = ? ORDER BY l.created_at DESC, l.id DESC LIMIT 50`, [userId]),
  ]);
  const days = new Map();
  for (const row of register) days.set(row.business_date, { date: row.business_date, status: row.status, hours: 0 });
  for (const c of clocks) {
    const day = days.get(c.business_date) || { date: c.business_date, status: 'present', hours: 0 };
    day.hours += hoursBetween(c.clock_in_at, c.clock_out_at || now.toISOString());
    days.set(c.business_date, day);
  }
  const list = [...days.values()].sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({ ...d, hours: round1(d.hours) }));
  const count = (status) => list.filter((d) => d.status === status).length;
  const hours = list.reduce((s, d) => s + d.hours, 0);
  const overtime = list.reduce((s, d) => s + Math.max(0, d.hours - STANDARD_DAY_HOURS), 0);
  return {
    month: ym,
    clockedInSince: open?.clock_in_at || null,
    days: list,
    totals: { present: count('present'), halfDay: count('half_day'), leave: count('leave'), absent: count('absent'), hours: round1(hours), overtime: round1(overtime) },
    leaves,
  };
}

/* ---------------------------------------------------------------- leave */

/** Pure rule, shared by API and UI. */
export function canDecideLeave(actor, requester) {
  if (!actor?.id || !requester?.id || Number(actor.id) === Number(requester.id)) return false;
  if (requester.role === 'manager') return actor.role === 'admin';
  if (isAdminLike(requester.role)) return false;
  return isAdminLike(actor.role) || isPermissionAllowedSync(permissionRole(actor), 'hrm.attendance.manage');
}

export async function applyLeave(db, user, data, now = new Date()) {
  if (user.role === 'admin') fail('The owner account does not file leave requests.', 403);
  const type = String(data?.type || '').toLowerCase();
  const start = String(data?.start || '');
  const end = String(data?.end || start);
  const reason = text(data?.reason, 500);
  if (!LEAVE_TYPES.includes(type)) fail('Choose Sick, Casual or Emergency leave.');
  if (!isDate(start) || !isDate(end) || end < start) fail('Choose a valid date range.');
  if (datesBetween(start, end).length > 60) fail('A single leave request can cover up to 60 days.');
  if (type !== 'sick' && type !== 'emergency' && start < nepalDateString(now)) fail('Casual leave cannot start in the past.');
  if (!reason) fail('Enter a reason.');
  const overlap = await db.get(`SELECT id FROM leave_requests WHERE user_id = ? AND status IN ('pending', 'approved')
    AND start_date <= ? AND end_date >= ? LIMIT 1`, [user.id, end, start]);
  if (overlap) fail('You already have a pending or approved leave for some of these dates.', 409);
  await db.run('INSERT INTO leave_requests (user_id, leave_type, start_date, end_date, reason) VALUES (?, ?, ?, ?, ?)', [user.id, type, start, end, reason]);
  return { message: user.role === 'manager' ? 'Leave request sent to the owner.' : 'Leave request sent for approval.' };
}

export async function cancelLeave(db, user, id) {
  const result = await db.run("UPDATE leave_requests SET status = 'cancelled' WHERE id = ? AND user_id = ? AND status = 'pending'", [Number(id), user.id]);
  if (!result.changes) fail('Only your own pending requests can be cancelled.', 409);
  return { message: 'Leave request cancelled.' };
}

/**
 * Requests the actor may see and decide, with a coverage hint: how many other
 * staff in the same role are already off (approved or pending) on overlapping days.
 */
export async function leaveQueue(db, actor, { status = 'pending' } = {}) {
  const rows = await db.all(`SELECT l.*, u.full_name, u.role, d.full_name AS decided_by_name FROM leave_requests l
    JOIN users u ON u.id = l.user_id LEFT JOIN users d ON d.id = l.decided_by
    WHERE ${status === 'all' ? '1=1' : 'l.status = ?'} ORDER BY l.start_date DESC, l.id DESC LIMIT 200`, status === 'all' ? [] : [status]);
  const visible = rows.filter((row) => actor.role === 'admin' || (Number(row.user_id) !== Number(actor.id) && !isAdminLike(row.role)));
  const staffByRole = new Map((await db.all('SELECT role, COUNT(*) AS n FROM users WHERE COALESCE(is_active, 1) = 1 GROUP BY role')).map((r) => [r.role, Number(r.n)]));
  for (const row of visible) {
    const others = await db.get(`SELECT COUNT(DISTINCT l.user_id) AS n FROM leave_requests l JOIN users u ON u.id = l.user_id
      WHERE u.role = ? AND l.user_id <> ? AND l.status IN ('pending', 'approved') AND l.start_date <= ? AND l.end_date >= ?`,
    [row.role, row.user_id, row.end_date, row.start_date]);
    row.days = datesBetween(row.start_date, row.end_date).length;
    row.overlapping = Number(others?.n || 0);
    row.roleHeadcount = staffByRole.get(row.role) || 0;
    row.canDecide = row.status === 'pending' && canDecideLeave(actor, { id: row.user_id, role: row.role });
  }
  return visible;
}

export async function decideLeave(db, actor, id, { decision, note = '' } = {}) {
  if (!['approved', 'rejected'].includes(decision)) fail('Choose approve or reject.');
  return db.transaction(async (tx) => {
    const row = await tx.get('SELECT l.*, u.role FROM leave_requests l JOIN users u ON u.id = l.user_id WHERE l.id = ?', [Number(id)]);
    if (!row) fail('Leave request not found.', 404);
    if (row.status !== 'pending') fail('This request was already decided or cancelled.', 409);
    if (!canDecideLeave(actor, { id: row.user_id, role: row.role })) {
      fail(row.role === 'manager' ? "Only the owner can decide a manager's leave." : 'You cannot decide this leave request.', 403);
    }
    await tx.run('UPDATE leave_requests SET status = ?, decided_by = ?, decided_at = CURRENT_TIMESTAMP, decision_note = ? WHERE id = ?', [decision, actor.id, text(note, 500) || null, row.id]);
    if (decision === 'approved') {
      for (const date of datesBetween(row.start_date, row.end_date)) {
        await tx.run(`INSERT INTO attendance (user_id, business_date, status, note, marked_by, updated_at)
          VALUES (?, ?, 'leave', ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT (user_id, business_date) DO UPDATE SET status = 'leave', note = excluded.note, marked_by = excluded.marked_by, updated_at = CURRENT_TIMESTAMP`,
        [row.user_id, date, `${row.leave_type} leave approved`, actor.id]);
      }
    }
    return { message: decision === 'approved' ? 'Leave approved and marked in attendance.' : 'Leave rejected.' };
  });
}

/* ---------------------------------------------------------------- owner alerts */

export async function createOwnerAlert(db, actor, data) {
  // Managers escalate anything; the watchman raises security emergencies.
  if (!['manager', 'watchman'].includes(actor.role)) fail('Only a manager or the watchman can send an alert to the owner.', 403);
  const severity = String(data?.severity || '');
  const category = ALERT_CATEGORIES.includes(data?.category) ? data.category : 'Other';
  const title = text(data?.title, 120);
  const message = text(data?.message, 2000);
  if (!ALERT_SEVERITIES.includes(severity)) fail('Choose a severity.');
  if (!title || !message) fail('Enter a title and what happened.');
  await db.run('INSERT INTO owner_alerts (created_by, severity, category, title, message, link_label) VALUES (?, ?, ?, ?, ?, ?)',
    [actor.id, severity, category, title, message, text(data?.link, 80) || null]);
  return { message: 'Alert sent to the owner.' };
}

/** Owner sees every alert; a manager sees the alerts they sent. */
export async function listOwnerAlerts(db, actor) {
  const own = actor.role === 'admin' ? '' : 'WHERE a.created_by = ?';
  const alerts = await db.all(`SELECT a.*, u.full_name AS created_by_name, h.full_name AS handled_by_name FROM owner_alerts a
    JOIN users u ON u.id = a.created_by LEFT JOIN users h ON h.id = a.handled_by ${own}
    ORDER BY CASE a.status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END, a.id DESC LIMIT 200`, own ? [actor.id] : []);
  return { alerts, open: alerts.filter((a) => a.status === 'open').length };
}

export async function updateOwnerAlert(db, actor, id, status) {
  if (actor.role !== 'admin') fail('Only the owner can update alerts.', 403);
  if (!['acknowledged', 'resolved'].includes(status)) fail('Choose acknowledge or resolve.');
  const result = await db.run(`UPDATE owner_alerts SET status = ?, handled_by = ?, handled_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status <> 'resolved'`, [status, actor.id, Number(id)]);
  if (!result.changes) fail('Alert not found or already resolved.', 409);
  return { message: status === 'resolved' ? 'Alert resolved.' : 'Alert acknowledged.' };
}

/* ---------------------------------------------------------------- payroll */

/**
 * Suggested monthly pay from attendance. A suggestion only: salary payments
 * are still recorded on the Payroll page. Paid days = present + half days / 2
 * + approved leave (all leave types are treated as paid). Days with no
 * attendance record are not paid. Overtime is paid at the plain hourly rate
 * (salary / (days in month * STANDARD_DAY_HOURS)).
 */
export async function payrollAttendance(db, month, now = new Date()) {
  await ensurePayrollSchema(db);
  const ym = /^\d{4}-\d{2}$/.test(month || '') ? month : nepalDateString(now).slice(0, 7);
  const daysInMonth = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
  const staff = (await listPayrollOverview(db)).filter((u) => Number(u.is_active) === 1);
  const rows = [];
  for (const u of staff) {
    const { totals } = await staffMonth(db, u.id, ym, now);
    const salary = Number(u.salary) || 0;
    const paidDays = totals.present + totals.halfDay / 2 + totals.leave;
    const base = salary * Math.min(paidDays, daysInMonth) / daysInMonth;
    const overtimePay = salary ? (salary / (daysInMonth * STANDARD_DAY_HOURS)) * totals.overtime : 0;
    const advance = Math.max(0, Number(u.advance_outstanding) || 0);
    rows.push({
      id: u.id, name: u.full_name, role: u.role, salary, ...totals, paidDays,
      basePay: round2(base), overtimePay: round2(overtimePay), gross: round2(base + overtimePay),
      advanceOutstanding: round2(advance), suggestedNet: round2(Math.max(0, base + overtimePay - advance)),
    });
  }
  return { month: ym, daysInMonth, standardDayHours: STANDARD_DAY_HOURS, rows };
}
const round2 = (n) => Math.round(n * 100) / 100;
