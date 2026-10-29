/**
 * Shared API authentication / authorization helpers.
 */

import { NextResponse } from 'next/server';
import { AuthService } from '@/lib/auth/auth.js';
import { clientError, logger } from '@/lib/logger.js';
import { assertCsrf } from '@/lib/csrf.js';
import { ensurePermissionCache, DYNAMIC_PERMISSION_KEYS } from '@/lib/permissions.js';
import { guardReconciliationRead, refreshCashClosingConfig } from '@/lib/cash-closing-policy.js';
import { scheduledCashCountStatus } from '@/lib/scheduled-cash-counts.js';
import { isAdminLike, permissionRole } from '@/lib/roles.js';

const authService = new AuthService();

export function extractBearerToken(request) {
  const header = request.headers.get('authorization') || '';
  if (header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  // Cookie fallback (production cookie sessions)
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(/(?:^|;\s*)pos_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function requireAuth(request, { roles = null, permission = null, anyPermissions = null, csrf = null } = {}) {
  const method = (request.method || 'GET').toUpperCase();
  const needsCsrf =
    csrf === true || (csrf !== false && !['GET', 'HEAD', 'OPTIONS'].includes(method));
  if (needsCsrf) {
    const csrfError = assertCsrf(request);
    if (csrfError) return { error: csrfError };
  }

  const token = extractBearerToken(request);
  if (!token) {
    return { error: NextResponse.json(clientError('Please sign in again to continue.'), { status: 401 }) };
  }

  const user = await authService.verifySession(token);
  if (!user) {
    return { error: NextResponse.json(clientError('Please sign in again to continue.'), { status: 401 }) };
  }

  // Managers pass every role gate the owner passes; owner-only routes check
  // `user.role === 'admin'` explicitly after this guard.
  if (roles && roles.length && !roles.includes(user.role) && !isAdminLike(user.role)) {
    return { error: NextResponse.json(clientError('You do not have access to this action.'), { status: 403 }) };
  }

  if (permission) {
    if (DYNAMIC_PERMISSION_KEYS.has(permission)) await ensurePermissionCache(authService.db);
    if (!authService.hasPermission(permissionRole(user), permission)) {
      return { error: NextResponse.json(clientError('You do not have access to this action.'), { status: 403 }) };
    }
  }

  if (anyPermissions?.length) {
    if (anyPermissions.some((key) => DYNAMIC_PERMISSION_KEYS.has(key))) {
      await ensurePermissionCache(authService.db);
    }
    if (!anyPermissions.some((key) => authService.hasPermission(permissionRole(user), key))) {
      return { error: NextResponse.json(clientError('You do not have access to this action.'), { status: 403 }) };
    }
  }

  const pathname = new URL(request.url).pathname;
  if (user.role === 'cashier' && pathname.startsWith('/api/admin/')) {
    const readOnlyPosDependency = ['GET', 'HEAD'].includes(method) && /^\/api\/admin\/(settings|products|promotions|delivery-executives|bills|tables)(\/|$)/.test(pathname);
    const emergencyWorkspaceApi = /^\/api\/admin\/(cash-counts|pos|orders)(\/|$)/.test(pathname)
      || (['GET', 'HEAD'].includes(method) && /^\/api\/admin\/(dashboard|business-days)(\/|$)/.test(pathname))
      || pathname === '/api/admin/promotions/preview';
    if (!readOnlyPosDependency && !emergencyWorkspaceApi) {
      const cashCount = await scheduledCashCountStatus(authService.db, user);
      if (cashCount.due) {
        return {
          error: NextResponse.json({
            error: 'Complete the scheduled drawer cash count to continue. Dashboard and POS remain available.',
            code: 'cash_count_required',
            cashCount: {
              due: true,
              scheduledTime: cashCount.scheduledTime,
              countDate: cashCount.countDate,
              timeZone: cashCount.timeZone,
            },
          }, { status: 423 }),
        };
      }
    }
  }
  if (/^\/api\/admin\/(dashboard|reports|business-days|cash-drawer|ledger|accounts|finance-dashboard|financial-reports|summary-report)(\/|$)/.test(pathname)) {
    await refreshCashClosingConfig(authService.db);
  }
  guardReconciliationRead(request, user);
  return { user, token };
}

export function jsonError(message, status = 400, extra = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export function handleRouteError(error, fallback = 'Request failed. Please try again.') {
  logger.error('api_error', {
    message: error?.message,
    code: error?.code,
    status: error?.status,
    stack: error?.stack,
  });
  const status = error?.status && Number.isInteger(error.status) ? error.status : 500;
  /*
   * Masking every 5xx message protects the ones that leak internals, but it
   * also swallowed the few that are the ONLY useful thing we can say — a
   * "schema is not installed, run migration NNN" 503 reached the operator as
   * "Failed to load designations", which names neither the cause nor the fix.
   * An error may opt out by carrying `expose: true`, which is only set on
   * messages written FOR the operator and containing no internals.
   */
  const exposed = error?.expose === true;
  const message =
    !exposed && (status >= 500 || /sqlite|postgres|constraint|pragma|undefined/i.test(String(error?.message || '')))
      ? fallback
      : error.message || fallback;
  // Errors thrown as Object.assign(new Error(msg), {status, code, ...extra}) carry
  // machine-readable fields (code, business_day_id, blockers, ...) the client needs
  // to branch on (e.g. a stale business day vs. a missing store session).
  const extra = {};
  if (status < 500 || exposed) {
    for (const key of Object.keys(error || {})) {
      if (key !== 'status' && key !== 'expose') extra[key] = error[key];
    }
  }
  return NextResponse.json(
    {
      ...clientError(message.replace(/\s*\(have\s+-?[\d.,]+\)/gi, '')),
      ...extra,
    },
    { status: status >= 400 && status < 600 ? status : 500 }
  );
}

/** Disable legacy multi-shop / distribution endpoints. */
export function goneLegacy(feature = 'This endpoint') {
  return NextResponse.json(
    {
      error: `${feature} was removed from this production build. Use the restaurant POS APIs instead.`,
      code: 'legacy_removed',
    },
    { status: 410 }
  );
}
