import { cashSafePayload, assertCashClosingAllowed } from '@/lib/cash-closing-policy.js';
import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureAccountingSchema, accountBalance } from '@/lib/accounting.js';
import {
  listDrawers,
  listSessions,
  openSession,
  closeSession,
  createDrawer,
  recordCashMovement,
  listCashMovements,
  listBankAccounts,
  CASH_IN_TYPES,
  CASH_OUT_TYPES,
} from '@/lib/accounting-cash.js';
import { currentBusinessDayId } from '@/lib/business-days.js';
import { isAdminLike } from '@/lib/roles.js';

const DRAWER_ROLES = ['admin', 'cashier'];

export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: DRAWER_ROLES, permission: 'cash_drawer.manage' });
    if (auth.error) return auth.error;
    const respond = (value, options) => NextResponse.json(cashSafePayload(value, auth.user), options);
    const db = Database.getInstance();
    await ensureAccountingSchema(db);
    const q = new URL(request.url).searchParams;
    const [drawers, sessionResult, movementResult, banks] = await Promise.all([
      listDrawers(db),
      listSessions(db, {
        paged: true,
        drawerId: q.get('drawer_id'), page: q.get('session_page'), pageSize: q.get('session_page_size'),
        search: q.get('session_search'), from: q.get('session_from'), to: q.get('session_to'), status: q.get('session_status'),
      }),
      listCashMovements(db, {
        paged: true,
        drawerId: q.get('drawer_id') || null, page: q.get('movement_page'), pageSize: q.get('movement_page_size'),
        search: q.get('movement_search'), from: q.get('movement_from'), to: q.get('movement_to'), direction: q.get('movement_direction'),
      }),
      listBankAccounts(db),
    ]);
    const open = await db.get(
      `SELECT s.*, d.name AS drawer_name, u.full_name AS opened_by_name
       FROM drawer_sessions s JOIN cash_drawers d ON d.id=s.drawer_id
       LEFT JOIN users u ON u.id=s.opened_by
       WHERE s.status='open' ${q.get('drawer_id') ? 'AND s.drawer_id=?' : ''} ORDER BY s.id DESC LIMIT 1`,
      q.get('drawer_id') ? [q.get('drawer_id')] : []
    ) || null;
    let expected_cash = null;
    if (open?.drawer_id) {
      expected_cash = await accountBalance(db, '1010', { drawerId: open.drawer_id });
    }
    return respond({
      drawers,
      sessions: sessionResult.rows,
      session_pagination: sessionResult.pagination,
      open,
      expected_cash,
      movements: movementResult.rows,
      movement_pagination: movementResult.pagination,
      banks,
      cash_in_types: Object.entries(CASH_IN_TYPES).map(([value, meta]) => ({
        value,
        label: meta.label,
        needs_bank: Boolean(meta.needsBank),
      })),
      cash_out_types: Object.entries(CASH_OUT_TYPES).map(([value, meta]) => ({
        value,
        label: meta.label,
        needs_bank: Boolean(meta.needsBank),
      })),
    });
  } catch (error) {
    return handleRouteError(error, 'Failed to load cash drawer');
  }
}

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: DRAWER_ROLES, permission: 'cash_drawer.manage' });
    if (auth.error) return auth.error;
    const respond = (value, options) => NextResponse.json(cashSafePayload(value, auth.user), options);
    const db = Database.getInstance();
    await ensureAccountingSchema(db);
    const data = await request.json();

    if (data.action === 'add_drawer') {
      if (!isAdminLike(auth.user?.role)) {
        return respond({ error: 'Only an admin or manager can add drawers.' }, { status: 403 });
      }
      return respond({ drawer: await createDrawer(db, data.name) }, { status: 201 });
    }

    if (data.action === 'cash_in' || data.action === 'cash_out') {
      const businessDayId = await currentBusinessDayId(db, { required: true });
      const result = await recordCashMovement(db, {
        direction: data.action === 'cash_in' ? 'in' : 'out',
        movement_type: data.movement_type,
        amount: data.amount,
        reason: data.reason || data.note,
        created_by: auth.user?.id || null,
        drawer_id: data.drawer_id || null,
        bank_account_id: data.bank_account_id || null,
        external_ref: data.external_ref || null,
        business_day_id: businessDayId,
      });
      const expected_cash = await accountBalance(db, '1010', { drawerId: result.drawer_id });
      return respond({
        message: data.action === 'cash_in' ? 'Cash in recorded.' : 'Cash out recorded.',
        ...result,
        expected_cash,
      }, { status: 201 });
    }

    const businessDayId = await currentBusinessDayId(db, { required: true });
    const session = await openSession(db, { ...data, opened_by: auth.user?.id || null, business_day_id: businessDayId });
    return respond({ message: 'Drawer opened.', session }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to update cash drawer');
  }
}

export async function PUT(request) {
  try {
    const auth = await requireAuth(request, { roles: DRAWER_ROLES, permission: 'cash_drawer.manage' });
    if (auth.error) return auth.error;
    const respond = (value, options) => NextResponse.json(cashSafePayload(value, auth.user), options);
    const db = Database.getInstance();
    await ensureAccountingSchema(db);
    await currentBusinessDayId(db, { required: true });
    const data = await request.json();
    assertCashClosingAllowed(auth.user);
    const session = await closeSession(db, { ...data, closed_by: auth.user?.id || null });
    return respond({ message: 'Drawer closed.', session });
  } catch (error) {
    return handleRouteError(error, 'Failed to close drawer');
  }
}
