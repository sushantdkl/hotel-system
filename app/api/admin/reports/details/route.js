import { NextResponse } from 'next/server';
import Database from '@/lib/db/index';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { allowedReportTabs, REPORT_TABS } from '@/lib/reports.js';
import { buildReportRecordDetails } from '@/lib/report-record-details.js';
import { isPermissionAllowedSync } from '@/lib/permissions.js';
import { permissionRole } from '@/lib/roles.js';

export async function POST(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'reports.view' });
    if (auth.error) return auth.error;
    const body = await request.json();
    const tab = String(body.tab || '').toLowerCase();
    if (!REPORT_TABS.includes(tab)) return NextResponse.json({ error: 'Unknown report type.' }, { status: 400 });
    const allowedTabs = allowedReportTabs(auth.user?.role, (key) => isPermissionAllowedSync(permissionRole(auth.user), key));
    if (!allowedTabs.includes(tab)) return NextResponse.json({ error: 'This report has not been enabled for your role.' }, { status: 403 });
    const detail = await buildReportRecordDetails(Database.getInstance(), {
      tab,
      tableId: String(body.tableId || ''),
      row: body.row && typeof body.row === 'object' ? body.row : {},
      range: body.range && typeof body.range === 'object' ? body.range : null,
    });
    return NextResponse.json({ detail });
  } catch (error) {
    return handleRouteError(error, 'Failed to load record details.');
  }
}
