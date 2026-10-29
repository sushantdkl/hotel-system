import { NextResponse } from 'next/server';
import Database from '@/lib/db/index.js';
import { handleRouteError } from '@/lib/api-guard.js';
import { checkRateLimit, clientIp } from '@/lib/rate-limit.js';
import { publicPrecheckin, submitPrecheckin } from '@/lib/hotel/precheckin.js';

export const dynamic = 'force-dynamic';

/** Guest online check-in (public; the link token is the secret). */
export async function GET(request, context) {
  try {
    const { token } = await context.params;
    return NextResponse.json(await publicPrecheckin(Database.getInstance(), token), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleRouteError(error, 'Could not load your reservation.');
  }
}

export async function POST(request, context) {
  try {
    const { token } = await context.params;
    const limited = await checkRateLimit({ key: `checkin:${token}:${clientIp(request)}`, limit: 10, windowSeconds: 300 }).catch(() => ({ ok: true }));
    if (!limited.ok) return NextResponse.json({ error: 'Too many attempts. Please wait a few minutes.' }, { status: 429 });
    const form = await request.formData();
    const fields = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string'));
    const upload = form.get('idPhoto');
    const file = upload && typeof upload.arrayBuffer === 'function' && upload.size
      ? { fileName: upload.name, mime: upload.type, bytes: new Uint8Array(await upload.arrayBuffer()) }
      : null;
    return NextResponse.json(await submitPrecheckin(Database.getInstance(), token, fields, file));
  } catch (error) {
    return handleRouteError(error, 'Could not save your details.');
  }
}
