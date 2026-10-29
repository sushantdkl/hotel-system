import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError, jsonError } from '@/lib/api-guard.js';
import { createCustomRole, deleteCustomRole, ensurePermissionsSchema, listRolePermissions, listUserPermissions, setRolePermissions, setUserPermissions, permissionAuditHistory } from '@/lib/permissions.js';

// Owner and managers. Managers may only change custom roles (enforced in
// setRolePermissions); built-in roles are owner-only.
export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const params = new URL(request.url).searchParams;
    const view = params.get('view');
    if (params.get('userId')) return NextResponse.json(await listUserPermissions(db, auth.user, params.get('userId')));
    if (view === 'staff') {
      await ensurePermissionsSchema(db);
      const staff = await db.all("SELECT u.id, u.username, u.full_name, u.role, u.custom_role, (SELECT COUNT(*) FROM user_permissions p WHERE p.user_id = u.id) AS overrides FROM users u WHERE u.role NOT IN ('admin', 'manager') AND COALESCE(u.is_active, 1) = 1 ORDER BY u.full_name, u.username");
      return NextResponse.json({ staff });
    }
    const matrix = await listRolePermissions(db);
    if (view === 'audit') {
      return NextResponse.json({ ...matrix, audit: await permissionAuditHistory(db) });
    }
    return NextResponse.json(matrix);
  } catch (error) {
    return handleRouteError(error, 'Could not load the permission matrix.');
  }
}

export async function PUT(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const body = await request.json();
    if (body.userId) return NextResponse.json({ message: 'Staff permissions updated.', ...(await setUserPermissions(db, auth.user, body.userId, body.updates)) });
    const matrix = await setRolePermissions(db, body.updates, auth.user);
    return NextResponse.json({ message: 'Permissions updated.', ...matrix });
  } catch (error) {
    return handleRouteError(error, 'Could not save permission changes.');
  }
}

/** { action: 'create_role', label, baseRole } | { action: 'delete_role', key } */
export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin'] });
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    const body = await request.json();
    if (body.action === 'create_role') return NextResponse.json({ ...(await createCustomRole(db, auth.user, body)), ...(await listRolePermissions(db)) });
    if (body.action === 'delete_role') return NextResponse.json({ ...(await deleteCustomRole(db, auth.user, body.key)), ...(await listRolePermissions(db)) });
    return jsonError('Unknown action.');
  } catch (error) {
    return handleRouteError(error, 'Could not update roles.');
  }
}
