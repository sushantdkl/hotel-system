import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import Database from '@/lib/db/index.js';
import { requireAuth, handleRouteError } from '@/lib/api-guard.js';
import { ensureTableTokens } from '@/lib/table-qr.js';
import { getPublicAppUrl } from '@/lib/app-url.js';

/** Admin: QR (SVG) + ordering URL for one table (or ?id omitted → all tables). */
export async function GET(request) {
  try {
    const auth = await requireAuth(request, { roles: ['admin', 'cashier'], permission: 'tables.manage' });
    if (auth.error) return auth.error;

    const db = Database.getInstance();
    await ensureTableTokens(db);

    const url = new URL(request.url);
    const origin = getPublicAppUrl(request);
    if (!origin) {
      return NextResponse.json({
        error: 'Set APP_URL in the environment (e.g. https://your-domain.com) so table QR codes use a public link.',
      }, { status: 500 });
    }
    const id = url.searchParams.get('id');

    const orderUrl = (token) => `${origin}/order/${token}`;

    if (id) {
      const t = await db.get(`SELECT id, table_number, qr_token FROM tables WHERE id = ?`, [id]);
      if (!t) return NextResponse.json({ error: 'Table not found.' }, { status: 404 });
      const link = orderUrl(t.qr_token);
      const svg = await QRCode.toString(link, { type: 'svg', margin: 1, width: 320 });
      return NextResponse.json({ table_number: t.table_number, url: link, svg });
    }

    const tables = await db.all(
      `SELECT id, table_number, qr_token FROM tables WHERE (is_active = 1 OR is_active IS NULL) ORDER BY floor, table_number`
    );
    const list = tables.map((t) => ({ id: t.id, table_number: t.table_number, url: orderUrl(t.qr_token) }));
    return NextResponse.json({ tables: list });
  } catch (error) {
    return handleRouteError(error, 'Failed to build table QR');
  }
}
