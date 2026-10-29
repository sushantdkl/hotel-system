/**
 * Staff notifications: an in-app inbox (shown on /staff and as a sidebar badge)
 * plus optional external delivery (WhatsApp / SMS) through a webhook.
 *
 * External adapter: set NOTIFY_WEBHOOK_URL (and optionally NOTIFY_WEBHOOK_TOKEN,
 * sent as a Bearer token). Each new notification is POSTed as JSON
 * { to: <staff phone>, title, body, link } after the database transaction
 * commits. Point it at a WhatsApp / SMS gateway (Twilio, Meta Cloud API
 * bridge, Sparrow SMS, ...). Without it, notifications are in-app only.
 */
import { serialPkSql } from './db/schema-helpers.js';
import { ensureSqliteTable } from './db/ensure-sqlite-table.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

export async function ensureNotificationSchema(db) {
  if (db.driver === 'postgres') {
    const ready = await db.get("SELECT to_regclass('public.staff_notifications') AS t");
    if (!ready?.t) throw Object.assign(new Error('Notifications schema is not installed. Run database migration 081 (npm run db:migrate).'), { status: 503, expose: true });
    return;
  }
  await ensureSqliteTable(db, `CREATE TABLE IF NOT EXISTS staff_notifications (
    ${serialPkSql(db)}, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, body TEXT NOT NULL,
    link TEXT, read_at DATETIME, delivered_at DATETIME, delivery_error TEXT, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await db.run('CREATE INDEX IF NOT EXISTS idx_staff_notifications_user ON staff_notifications(user_id, read_at)');
}

/** Queue one notification (inside the caller's transaction). */
export async function notify(tx, userId, { title, body, link = null }) {
  if (!userId) return;
  await tx.run('INSERT INTO staff_notifications (user_id, title, body, link) VALUES (?, ?, ?, ?)', [userId, String(title).slice(0, 120), String(body).slice(0, 1000), link]);
}

/** Active users holding a role; optionally only those clocked in now. */
export async function usersWithRole(tx, role, { clockedIn = false } = {}) {
  const clock = clockedIn ? 'AND EXISTS (SELECT 1 FROM staff_clock_events c WHERE c.user_id = u.id AND c.clock_out_at IS NULL)' : '';
  return tx.all(`SELECT u.id, u.full_name, u.phone FROM users u WHERE u.role = ? AND COALESCE(u.is_active, 1) = 1 ${clock} ORDER BY u.id`, [role]).catch(() => []);
}

export async function myNotifications(db, userId) {
  await ensureNotificationSchema(db);
  const items = await db.all('SELECT id, title, body, link, read_at, created_at FROM staff_notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50', [userId]);
  return { items, unread: items.filter((n) => !n.read_at).length };
}

export async function markRead(db, userId, id = null) {
  await ensureNotificationSchema(db);
  if (id !== null && !Number.isFinite(Number(id))) fail('Invalid notification.');
  await db.run(`UPDATE staff_notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL${id === null ? '' : ' AND id = ?'}`, id === null ? [userId] : [userId, Number(id)]);
  return { message: 'Marked as read.' };
}

/**
 * Best-effort external delivery of undelivered notifications. Never throws;
 * failures are stored in delivery_error. Call after a transaction commits.
 */
export async function deliverPending(db, { fetchImpl = globalThis.fetch, url = process.env.NOTIFY_WEBHOOK_URL, token = process.env.NOTIFY_WEBHOOK_TOKEN } = {}) {
  if (!url || !fetchImpl) return 0;
  let sent = 0;
  try {
    const rows = await db.all(`SELECT n.id, n.title, n.body, n.link, u.phone FROM staff_notifications n JOIN users u ON u.id = n.user_id
      WHERE n.delivered_at IS NULL AND n.delivery_error IS NULL ORDER BY n.id LIMIT 20`);
    for (const row of rows) {
      try {
        if (!row.phone) throw new Error('Staff member has no phone number.');
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ to: row.phone, title: row.title, body: row.body, link: row.link }),
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error(`Gateway responded ${response.status}.`);
        await db.run('UPDATE staff_notifications SET delivered_at = CURRENT_TIMESTAMP WHERE id = ?', [row.id]);
        sent += 1;
      } catch (error) {
        await db.run('UPDATE staff_notifications SET delivery_error = ? WHERE id = ?', [String(error.message).slice(0, 300), row.id]);
      }
    }
  } catch { /* delivery must never break the operation that triggered it */ }
  return sent;
}
