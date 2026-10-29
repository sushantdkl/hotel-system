import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import {
  PERMISSION_CATALOG,
  ensurePermissionCache,
  isPermissionAllowedSync,
} from '@/lib/permissions.js';
import { isKotCancellationApprovalEnabled } from '@/lib/cancellation-verification.js';
import { permissionRole } from '@/lib/roles.js';

/** Current user's dynamic capabilities for navigation and action visibility. */
export async function GET(request) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;
    const db = Database.getInstance();
    await ensurePermissionCache(db);
    const kotCancellationApprovalEnabled = await isKotCancellationApprovalEnabled(db);
    return NextResponse.json(
      {
        role: auth.user.role,
        custom_role: auth.user.custom_role || null,
        capabilities: Object.fromEntries(
          [
            ...PERMISSION_CATALOG.map(({ key }) => [key, isPermissionAllowedSync(permissionRole(auth.user), key)]),
            ['kot_cancellation_approval.enabled', kotCancellationApprovalEnabled],
          ]
        ),
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  } catch (error) {
    return handleRouteError(error, 'Could not load staff permissions.');
  }
}
