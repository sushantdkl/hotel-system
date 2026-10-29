/**
 * Primary (first) admin is the oldest admin account by id.
 * That account cannot be deleted or deactivated.
 */

export async function getPrimaryAdminId(db) {
  const row = await db.get(`
    SELECT id FROM users
    WHERE role = 'admin'
    ORDER BY id ASC
    LIMIT 1
  `);
  return row?.id ?? null;
}

export async function isPrimaryAdmin(db, userId) {
  const primaryId = await getPrimaryAdminId(db);
  return primaryId != null && Number(primaryId) === Number(userId);
}
