/**
 * Watchman / security desk: visitor, vendor and vehicle gate entries (in/out),
 * night patrol rounds and incidents. Emergencies go to the owner's alert inbox
 * through createOwnerAlert (lib/staff-hr.js).
 */
import { serialPkSql } from './db/schema-helpers.js';
import { ensureSqliteTable } from './db/ensure-sqlite-table.js';
import { nepalDateString } from './report-dates.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const text = (v, max) => String(v ?? '').trim().slice(0, max);
export const SECURITY_KINDS = ['visitor', 'vendor', 'vehicle', 'patrol', 'incident'];

export async function ensureSecuritySchema(db) {
  if (db.driver === 'postgres') {
    const ready = await db.get("SELECT to_regclass('public.security_log') AS t");
    if (!ready?.t) throw Object.assign(new Error('Security schema is not installed. Run database migration 081 (npm run db:migrate).'), { status: 503, expose: true });
    return;
  }
  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS security_log (
    ${serialPkSql(db)}, kind TEXT NOT NULL CHECK (kind IN ('visitor', 'vendor', 'vehicle', 'patrol', 'incident')),
    name TEXT NOT NULL, purpose TEXT NOT NULL DEFAULT '', vehicle_no TEXT NOT NULL DEFAULT '', reference TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '', in_at TEXT NOT NULL, out_at TEXT, logged_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await db.run('CREATE INDEX IF NOT EXISTS idx_security_log_in ON security_log(in_at)');
}

export async function addSecurityEntry(db, actor, data, now = new Date()) {
  const kind = String(data?.kind || '');
  if (!SECURITY_KINDS.includes(kind)) fail('Choose visitor, vendor, vehicle, patrol or incident.');
  const name = text(data?.name, 100);
  if (!name) fail(kind === 'patrol' ? 'Enter the patrol checkpoint or route.' : kind === 'incident' ? 'Enter a short title.' : 'Enter the name.');
  if (kind === 'vehicle' && !text(data?.vehicleNo, 30)) fail('Enter the vehicle number.');
  // Patrols and incidents are single moments; gate entries stay open until checked out.
  const instant = ['patrol', 'incident'].includes(kind);
  await db.run(`INSERT INTO security_log (kind, name, purpose, vehicle_no, reference, notes, in_at, out_at, logged_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [kind, name, text(data?.purpose, 200), text(data?.vehicleNo, 30).toUpperCase(), text(data?.reference, 60), text(data?.notes, 1000), now.toISOString(), instant ? now.toISOString() : null, actor.id]);
  return { message: instant ? `${kind === 'patrol' ? 'Patrol round' : 'Incident'} logged.` : `${name} checked in.` };
}

export async function checkOutEntry(db, id, now = new Date()) {
  const result = await db.run('UPDATE security_log SET out_at = ? WHERE id = ? AND out_at IS NULL', [now.toISOString(), Number(id)]);
  if (!result.changes) fail('Entry not found or already checked out.', 409);
  return { message: 'Checked out.' };
}

/** Everyone still inside plus the chosen day's log (Kathmandu date). */
export async function securityDay(db, date, now = new Date()) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : nepalDateString(now);
  const start = new Date(Date.parse(`${day}T00:00:00+05:45`)).toISOString();
  const end = new Date(Date.parse(`${day}T00:00:00+05:45`) + 86400000).toISOString();
  const entries = await db.all(`SELECT s.*, u.full_name AS logged_by_name FROM security_log s LEFT JOIN users u ON u.id = s.logged_by
    WHERE s.out_at IS NULL OR (s.in_at >= ? AND s.in_at < ?) ORDER BY s.in_at DESC LIMIT 300`, [start, end]);
  return { date: day, inside: entries.filter((r) => r.out_at === null), entries };
}
