import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { resolveTableByToken } from '@/lib/table-qr.js';
import { checkRateLimit, clientIp } from '@/lib/rate-limit.js';
import {
  createWaiterRequest,
  getActiveWaiterRequestForTable,
  waiterRequestTypeLabel,
} from '@/lib/waiter-requests.js';

function publicRequest(request) {
  if (!request) return null;
  return {
    id: request.id,
    status: request.status,
    request_type: request.request_type,
    request_label: waiterRequestTypeLabel(request.request_type),
    requested_at: request.requested_at,
    acknowledged_at: request.acknowledged_at,
  };
}

async function tableFromParams(params) {
  const { token } = await params;
  const db = Database.getInstance();
  const table = await resolveTableByToken(db, token);
  return { token, db, table };
}

export async function GET(_request, { params }) {
  try {
    const { db, table } = await tableFromParams(params);
    if (!table || Number(table.is_active) === 0) {
      return NextResponse.json({ error: 'This QR code is not active.' }, { status: 404 });
    }
    const active = await getActiveWaiterRequestForTable(db, table.id);
    return NextResponse.json({ request: publicRequest(active) });
  } catch (error) {
    console.error('public waiter request GET:', error);
    return NextResponse.json({ error: 'Could not check your waiter call.' }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const { token, db, table } = await tableFromParams(params);
    if (!table || Number(table.is_active) === 0) {
      return NextResponse.json({ error: 'This QR code is not active.' }, { status: 404 });
    }

    const active = await getActiveWaiterRequestForTable(db, table.id);
    if (active) return NextResponse.json({ request: publicRequest(active), created: false });

    const limited = await checkRateLimit({
      key: `waiter-call:${token}:${clientIp(request)}`,
      limit: 3,
      windowSeconds: 300,
    });
    if (!limited.ok) {
      return NextResponse.json(
        { error: 'A waiter was called recently. Please give our team a moment.' },
        { status: 429, headers: { 'Retry-After': String(limited.retryAfter || 60) } }
      );
    }

    const body = await request.json().catch(() => ({}));
    const result = await createWaiterRequest(db, {
      tableId: table.id,
      requestType: String(body.request_type || 'service'),
    });
    return NextResponse.json(
      { request: publicRequest(result.request), created: result.created },
      { status: result.created ? 201 : 200 }
    );
  } catch (error) {
    console.error('public waiter request POST:', error);
    return NextResponse.json({ error: 'Could not call a waiter. Please try again.' }, { status: 500 });
  }
}
