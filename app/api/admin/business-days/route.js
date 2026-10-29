import { cashSafePayload, assertCashClosingAllowed } from '@/lib/cash-closing-policy.js';
import { NextResponse } from 'next/server';
import { cancellationWarningCounts } from '@/lib/cancellation-verification.js';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import {
  businessDayContext,
  businessDaySummary,
  closeBusinessDay,
  listBusinessDays,
  openBusinessDay,
} from '@/lib/business-days.js';

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { permission: 'business_days.view' });
    if (auth.error) return auth.error;
    const respond = (value, options) => NextResponse.json(cashSafePayload(value, auth.user), options);
    const db = Database.getInstance();
    const query = new URL(request.url).searchParams;
    const view = query.get('view') || 'context';
    if (view === 'history') {
      return respond(await listBusinessDays(db, {
        page: query.get('page'), pageSize: query.get('pageSize'),
      }));
    }
    const context = await businessDayContext(db);
    if (view === 'closing' && context.current) {
      // The audit rows come along so the open-day screen can show the same
      // "Notes & closing history" panel the closing-report dialog shows.
      const [summary, audit] = await Promise.all([
        businessDaySummary(db, context.current),
        db.all(
          `SELECT a.*, u.full_name AS actor_full_name
             FROM business_day_audit a
             LEFT JOIN users u ON u.id = a.actor_id
            WHERE a.business_day_id = ?
            ORDER BY a.created_at DESC, a.id DESC`,
          [context.current.id]
        ).catch(() => []),
      ]);
      summary.cancellationWarnings = await cancellationWarningCounts(db, context.current.id);
      return respond({ ...context, summary, audit });
    }
    return respond(context);
  } catch (error) {
    return handleRouteError(error, 'Could not load business day status.');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { permission: 'business_days.open' });
    if (auth.error) return auth.error;
    const respond = (value, options) => NextResponse.json(cashSafePayload(value, auth.user), options);
    const body = await request.json();
    const day = await openBusinessDay(Database.getInstance(), body, auth.user);
    const message = body.action === 'reopen_same_day' ? 'Store reopened.'
      : body.action === 'start_next' ? 'Next business day started.'
      : body.action === 'continue_stale' ? 'Business day continued.'
      : 'Business day opened.';
    return respond({ message, day }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Could not open the business day.');
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    const force = body.force === true;
    const auth = await requireAuth(request, {
      permission: force ? 'business_days.force_close' : 'business_days.close',
    });
    if (auth.error) return auth.error;
    const respond = (value, options) => NextResponse.json(cashSafePayload(value, auth.user), options);
    const result = await closeBusinessDay(Database.getInstance(), body, auth.user, { force });
    return respond({ message: force ? 'Store session force closed.' : 'Store session closed.', result });
  } catch (error) {
    return handleRouteError(error, 'Could not close the business day.');
  }
}
